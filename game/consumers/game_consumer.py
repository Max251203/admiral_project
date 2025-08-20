import asyncio
import json
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone
from asgiref.sync import sync_to_async
from ..models import Game, GameState
import time

class GameConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.game_id = self.scope["url_route"]["kwargs"]["game_id"]
        self.room = f"game_{self.game_id}"
        
        # Проверяем права доступа
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close()
            return
        
        game = await self._get_game()
        if not game or (game.player1_id != user.id and game.player2_id != user.id):
            await self.close()
            return
        
        await self.channel_layer.group_add(self.room, self.channel_name)
        await self.accept()
        await self.send_state()
        
        self._running = True
        asyncio.create_task(self._ticker())

    async def disconnect(self, code):
        self._running = False
        await self.channel_layer.group_discard(self.room, self.channel_name)

    async def receive_json(self, content, **kwargs):
        # Ретранслируем сообщения другим участникам
        await self.channel_layer.group_send(self.room, {
            "type": "broadcast",
            "payload": content
        })

    async def broadcast(self, event):
        await self.send_json(event["payload"])

    async def send_state(self):
        st = await self._get_state()
        await self.send_json({"type": "state", "state": st})

    @sync_to_async
    def _get_game(self):
        try:
            return Game.objects.get(id=self.game_id)
        except Game.DoesNotExist:
            return None

    @sync_to_async
    def _get_state(self):
        try:
            g = Game.objects.get(id=self.game_id)
            st = GameState.objects.get(game=g)
            return st.data
        except (Game.DoesNotExist, GameState.DoesNotExist):
            return {}

    @sync_to_async
    def _tick_db(self):
        try:
            g = Game.objects.select_for_update().get(id=self.game_id)
            now = timezone.now()
            current_time = time.time()
            
            # Если игра завершена, не тикаем
            if g.status == "FINISHED":
                return {
                    "turn": g.turn, 
                    "finished": True,
                    "winner": g.winner_id if g.winner_id else None,
                    "reason": g.win_reason
                }
            
            # Если игра на паузе, проверяем не закончилась ли пауза
            if g.status == "PAUSED" and g.pause_until:
                if now >= g.pause_until:
                    # Пауза закончилась, возвращаемся к игре
                    g.status = f"TURN_P{g.turn}"
                    g.pause_until = None
                    g.save()
                else:
                    # Пауза еще активна
                    pause_left = int((g.pause_until - now).total_seconds())
                    return {
                        "turn": g.turn,
                        "paused": True,
                        "pause_left": pause_left,
                        "pause_initiator": g.pause_initiator
                    }
            
            # Если игра не активна, не тикаем
            if g.status not in ("TURN_P1", "TURN_P2"):
                return {
                    "turn": g.turn, 
                    "finished": g.status == "FINISHED",
                    "winner": g.winner_id if g.winner_id else None,
                    "reason": g.win_reason
                }
            
            # ИСПРАВЛЕНО: Индивидуальные таймеры для каждого игрока
            current_player = g.turn
            
            # Инициализируем таймеры если нужно
            if current_player == 1 and not g.turn_start_time_p1:
                g.turn_start_time_p1 = current_time
                g.save()
            elif current_player == 2 and not g.turn_start_time_p2:
                g.turn_start_time_p2 = current_time
                g.save()
            
            # Получаем данные текущего игрока
            if current_player == 1:
                turn_start = g.turn_start_time_p1
                bank_ms = g.bank_ms_p1
                last_bank_update = g.last_bank_update_p1
            else:
                turn_start = g.turn_start_time_p2
                bank_ms = g.bank_ms_p2
                last_bank_update = g.last_bank_update_p2
            
            if not turn_start:
                return {"turn": g.turn, "turn_left": 30, "bank_left": bank_ms // 1000}
            
            # Вычисляем время хода
            turn_elapsed = current_time - turn_start
            turn_left = max(0, 30 - int(turn_elapsed))
            bank_seconds = bank_ms // 1000
            
            # ИСПРАВЛЕНО: Если время хода истекло, списываем банк по 1 секунде
            if turn_left == 0 and turn_elapsed > 30:
                # Время хода истекло, списываем из банка
                if last_bank_update is None:
                    last_bank_update = turn_start + 30
                    if current_player == 1:
                        g.last_bank_update_p1 = last_bank_update
                    else:
                        g.last_bank_update_p2 = last_bank_update
                
                seconds_since_update = current_time - last_bank_update
                
                if seconds_since_update >= 1.0:
                    seconds_to_deduct = int(seconds_since_update)
                    bank_ms = max(0, bank_ms - (seconds_to_deduct * 1000))
                    
                    if current_player == 1:
                        g.bank_ms_p1 = bank_ms
                        g.last_bank_update_p1 = current_time
                    else:
                        g.bank_ms_p2 = bank_ms
                        g.last_bank_update_p2 = current_time
                    
                    bank_seconds = bank_ms // 1000
                
                # Проверяем окончание банка времени
                if bank_seconds <= 0:
                    g.status = "FINISHED"
                    g.winner_id = g.player2_id if current_player == 1 else g.player1_id
                    g.win_reason = "time"
                    g.turn_start_time_p1 = None
                    g.turn_start_time_p2 = None
                    g.last_bank_update_p1 = None
                    g.last_bank_update_p2 = None
                    
                    # Обновляем статистику игроков
                    winner = g.player2 if current_player == 1 else g.player1
                    loser = g.player1 if current_player == 1 else g.player2
                    
                    winner.profile.wins += 1
                    winner.profile.rating_elo += 100
                    winner.profile.save()
                    
                    loser.profile.losses += 1
                    loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
                    loser.profile.save()
                    
                    # Обновляем состояние игры
                    try:
                        st = GameState.objects.get(game=g)
                        st.data["phase"] = "FINISHED"
                        st.data["winner"] = 2 if current_player == 1 else 1
                        st.data["win_reason"] = "time"
                        st.save()
                    except GameState.DoesNotExist:
                        pass
                    
                    g.save()
                    
                    return {
                        "turn": g.turn,
                        "finished": True,
                        "winner": g.winner_id,
                        "reason": "time"
                    }
            
            g.save()
            
            # ИСПРАВЛЕНО: Возвращаем данные для обоих игроков
            p1_bank = g.bank_ms_p1 // 1000
            p2_bank = g.bank_ms_p2 // 1000
            
            return {
                "turn": g.turn,
                "turn_left": turn_left,
                "bank_left_p1": p1_bank,
                "bank_left_p2": p2_bank,
                "finished": False
            }
        except Game.DoesNotExist:
            return {"error": "game not found"}

    async def _ticker(self):
        while self._running:
            try:
                data = await self._tick_db()
                await self.channel_layer.group_send(self.room, {
                    "type": "broadcast",
                    "payload": {"type": "tick", **data}
                })
                await asyncio.sleep(1)
            except Exception as e:
                print(f"Ticker error: {e}")
                await asyncio.sleep(5)