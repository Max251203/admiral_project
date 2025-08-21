import asyncio
import time
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone
from asgiref.sync import sync_to_async
from django.db import transaction

from ..models import Game, GameState

class GameConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.game_id = self.scope["url_route"]["kwargs"]["game_id"]
        self.game_group_name = f"game_{self.game_id}"
        self.user = self.scope.get("user")

        if not self.user or not self.user.is_authenticated:
            await self.close()
            return

        game = await self.get_game()
        if not game or (game.player1_id != self.user.id and game.player2_id != self.user.id):
            await self.close()
            return

        await self.channel_layer.group_add(self.game_group_name, self.channel_name)
        await self.accept()

        self._running_ticker = True
        self.ticker_task = asyncio.create_task(self.game_ticker())
        
        await self.send_initial_state()

    async def disconnect(self, close_code):
        self._running_ticker = False
        if hasattr(self, 'ticker_task'):
            self.ticker_task.cancel()
        await self.channel_layer.group_discard(self.game_group_name, self.channel_name)

    async def broadcast_message(self, event):
        payload = event["payload"]
        target_player_id = payload.pop("target_player_id", None)
        if target_player_id is None or target_player_id == self.user.id:
            await self.send_json(payload)

    async def send_initial_state(self):
        game = await self.get_game()
        if not game:
            return
            
        state = await self.get_game_state(game)
        my_player_num = 1 if game.player1_id == self.user.id else 2
        
        await self.send_json({
            "type": "game_state_update",
            "game_id": str(game.id),
            "state": state.data,
            "status": game.status,
            "turn": game.turn,
            "my_player": my_player_num,
        })

    async def game_ticker(self):
        while self._running_ticker:
            try:
                tick_data = await self.update_timers()
                if tick_data:
                    await self.channel_layer.group_send(
                        self.game_group_name,
                        {"type": "broadcast_message", "payload": {"type": "tick", **tick_data}}
                    )
            except Exception as e:
                print(f"Ticker error in game {self.game_id}: {e}")
            await asyncio.sleep(1)

    @sync_to_async
    def update_timers(self):
        try:
            with transaction.atomic():
                g = Game.objects.select_for_update().get(id=self.game_id)
                
                if g.status == "FINISHED":
                    self._running_ticker = False
                    return {"finished": True}

                now = timezone.now()
                current_timestamp = time.time()

                if g.status == "PAUSED" and g.pause_until:
                    if now >= g.pause_until:
                        g.status = f"TURN_P{g.turn}"
                        g.pause_until = None
                        if g.turn == 1:
                            g.turn_start_time_p1 = current_timestamp
                        else:
                            g.turn_start_time_p2 = current_timestamp
                        g.save()
                    else:
                        pause_left = int((g.pause_until - now).total_seconds())
                        return {"paused": True, "pause_left": pause_left}

                if g.status not in ("TURN_P1", "TURN_P2"):
                    return None

                current_player_num = g.turn
                turn_start_time = g.turn_start_time_p1 if current_player_num == 1 else g.turn_start_time_p2
                
                if turn_start_time is None:
                    if current_player_num == 1:
                        g.turn_start_time_p1 = current_timestamp
                    else:
                        g.turn_start_time_p2 = current_timestamp
                    g.save()
                    turn_start_time = current_timestamp

                turn_elapsed = current_timestamp - turn_start_time
                if turn_elapsed > 30:
                    bank_to_deduct_from = g.bank_ms_p1 if current_player_num == 1 else g.bank_ms_p2
                    last_update = g.last_bank_update_p1 if current_player_num == 1 else g.last_bank_update_p2
                    
                    if last_update is None:
                        last_update = turn_start_time + 30

                    seconds_to_deduct = int(current_timestamp - last_update)
                    if seconds_to_deduct > 0:
                        bank_to_deduct_from -= seconds_to_deduct * 1000

                        if current_player_num == 1:
                            g.bank_ms_p1 = max(0, bank_to_deduct_from)
                            g.last_bank_update_p1 = current_timestamp
                        else:
                            g.bank_ms_p2 = max(0, bank_to_deduct_from)
                            g.last_bank_update_p2 = current_timestamp

                        if bank_to_deduct_from <= 0:
                            g.status = "FINISHED"
                            g.winner_id = g.player2_id if current_player_num == 1 else g.player1_id
                            g.win_reason = "time"
                            g.save()
                            
                            winner = g.player2 if current_player_num == 1 else g.player1
                            loser = g.player1 if current_player_num == 1 else g.player2
                            
                            winner.profile.wins += 1
                            winner.profile.rating_elo += 100
                            winner.profile.save()
                            
                            loser.profile.losses += 1
                            loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
                            loser.profile.save()
                            
                            self._running_ticker = False
                            return {"finished": True}
                        g.save()

                return {
                    "turn": g.turn,
                    "turn_start_time_p1": g.turn_start_time_p1,
                    "turn_start_time_p2": g.turn_start_time_p2,
                    "bank_ms_p1": g.bank_ms_p1,
                    "bank_ms_p2": g.bank_ms_p2,
                }
        except Game.DoesNotExist:
            self._running_ticker = False
            return None
        except Exception as e:
            print(f"Timer update error: {e}")
            return None

    @sync_to_async
    def get_game(self):
        try:
            return Game.objects.select_related('player1', 'player2').get(id=self.game_id)
        except Game.DoesNotExist:
            return None

    @sync_to_async
    def get_game_state(self, game):
        state, _ = GameState.objects.get_or_create(game=game, defaults={"data": {}})
        return state