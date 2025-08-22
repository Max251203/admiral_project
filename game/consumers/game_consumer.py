import asyncio
import json
import time
from channels.generic.websocket import AsyncWebsocketConsumer
from django.utils import timezone
from asgiref.sync import sync_to_async
from django.db import transaction
from django.db import models
from ..models import Game, GameState, Move, KilledCounter
from ..engine.board import Engine

active_connections = {}

class GameConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.game_id = self.scope["url_route"]["kwargs"]["game_id"]
        self.user = self.scope.get("user")

        if not self.user or not self.user.is_authenticated:
            await self.close()
            return

        game = await self.get_game()
        if not game or (game.player1_id != self.user.id and game.player2_id != self.user.id):
            await self.close()
            return

        if str(self.game_id) not in active_connections:
            active_connections[str(self.game_id)] = {}
        
        active_connections[str(self.game_id)][self.user.id] = self
        
        await self.accept()
        await self.send_initial_state()
        
        self._running_ticker = True
        self.ticker_task = asyncio.create_task(self.game_ticker())

    async def disconnect(self, close_code):
        self._running_ticker = False
        if hasattr(self, 'ticker_task'):
            self.ticker_task.cancel()
        
        if str(self.game_id) in active_connections:
            active_connections[str(self.game_id)].pop(self.user.id, None)
            if not active_connections[str(self.game_id)]:
                del active_connections[str(self.game_id)]

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            message_type = data.get('type')
            
            if message_type == 'make_move':
                await self.handle_move(data.get('data', {}))
            elif message_type == 'setup_piece':
                await self.handle_setup(data.get('data', {}))
            elif message_type == 'torpedo_attack':
                await self.handle_torpedo(data.get('data', {}))
            elif message_type == 'air_attack':
                await self.handle_air_attack(data.get('data', {}))
            elif message_type == 'bomb_attack':
                await self.handle_bomb(data.get('data', {}))
            elif message_type == 'get_group_candidates':
                await self.handle_group_candidates(data.get('data', {}))
            elif message_type == 'get_special_attacks':
                await self.handle_special_attacks(data.get('data', {}))
            elif message_type == 'submit_setup':
                await self.handle_submit_setup()
            elif message_type == 'auto_setup':
                await self.handle_auto_setup()
            elif message_type == 'clear_setup':
                await self.handle_clear_setup()
            elif message_type == 'resign':
                await self.handle_resign()
            elif message_type == 'pause':
                await self.handle_pause(data.get('data', {}))
                
        except json.JSONDecodeError:
            await self.send_error('Invalid JSON')

    async def handle_auto_setup(self):
        try:
            game = await self.get_game()
            state = await self.get_game_state(game)
            me = 1 if game.player1_id == self.user.id else 2
            
            eng = Engine(state.data)
            placed = eng.auto_setup(me)
            
            await self.persist_after_engine(game, state, eng)
            await self.create_move(game, me, 'auto_setup', {'count': placed})
            
            await self.broadcast_to_game({
                'type': 'game_state_update',
                'game_id': str(game.id),
                'state': eng.to_json(),
                'status': game.status,
                'turn': game.turn,
            })
            
        except Exception as e:
            await self.send_error(str(e))

    async def handle_submit_setup(self):
        try:
            game = await self.get_game()
            state = await self.get_game_state(game)
            me = 1 if game.player1_id == self.user.id else 2
            now = timezone.now()
            
            if me == 1 and not game.ready_p1:
                game.ready_p1 = True
                game.ready_at_p1 = now
            elif me == 2 and not game.ready_p2:
                game.ready_p2 = True
                game.ready_at_p2 = now
            
            await sync_to_async(game.save)()
            
            if game.ready_p1 and game.ready_p2 and game.status == "SETUP":
                if game.ready_at_p1 <= game.ready_at_p2:
                    game.status = "TURN_P1"
                    game.turn = 1
                    game.turn_start_time_p1 = time.time()
                else:
                    game.status = "TURN_P2"
                    game.turn = 2
                    game.turn_start_time_p2 = time.time()
                
                game.turn_start_time = time.time()
                state.data["phase"] = game.status
                state.data["turn"] = game.turn
                await sync_to_async(game.save)()
                await sync_to_async(state.save)()
                
                await self.broadcast_to_game({
                    'type': 'game_started',
                    'status': game.status,
                    'turn': game.turn
                })
            else:
                await self.send(text_data=json.dumps({
                    'type': 'setup_submitted',
                    'waiting_for_opponent': True
                }))
            
        except Exception as e:
            await self.send_error(str(e))

    async def send_initial_state(self):
        game = await self.get_game()
        if not game:
            return
            
        state = await self.get_game_state(game)
        my_player_num = 1 if game.player1_id == self.user.id else 2
        
        eng = Engine(state.data)
        visible_board = eng.get_visible_board_for_player(my_player_num)
        
        await self.send(text_data=json.dumps({
            "type": "game_state_update",
            "game_id": str(game.id),
            "state": {**state.data, "board": visible_board},
            "status": game.status,
            "turn": game.turn,
            "my_player": my_player_num,
        }))

    async def broadcast_to_game(self, message):
        if str(self.game_id) in active_connections:
            for user_id, connection in active_connections[str(self.game_id)].items():
                try:
                    game = await self.get_game()
                    my_player = 1 if connection.user.id == game.player1_id else 2
                    
                    if 'state' in message:
                        eng = Engine(message['state'])
                        visible_board = eng.get_visible_board_for_player(my_player)
                        message_copy = message.copy()
                        message_copy['state'] = {**message['state'], "board": visible_board}
                        message_copy['my_player'] = my_player
                    else:
                        message_copy = {**message, 'my_player': my_player}
                    
                    await connection.send(text_data=json.dumps(message_copy))
                except Exception as e:
                    print(f"Broadcast error: {e}")
                    active_connections[str(self.game_id)].pop(user_id, None)

    async def game_ticker(self):
        while self._running_ticker:
            try:
                tick_data = await self.update_timers()
                if tick_data:
                    await self.broadcast_to_game({
                        "type": "tick", 
                        **tick_data
                    })
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

    # Остальные методы остаются без изменений...
    async def handle_move(self, move_data):
        try:
            game = await self.get_game()
            if not game:
                return
                
            state = await self.get_game_state(game)
            me = 1 if game.player1_id == self.user.id else 2
            
            eng = Engine(state.data)
            if eng.gd.turn != me:
                await self.send_error('Не ваш ход')
                return
            
            src = tuple(move_data['src'])
            dst = tuple(move_data['dst'])
            followers = move_data.get('followers', [])
            
            result = eng.move_piece(me, src, dst, followers)
            
            await self.persist_after_engine(game, state, eng)
            
            if result.get('captures'):
                for kind in result['captures']:
                    await self.update_killed_counter(game, 3-me, kind)
            
            await self.create_move(game, me, 'move', {**move_data, **result})
            
            if state.data.get('winner'):
                await self.handle_game_end(game, state)
            
            await self.broadcast_to_game({
                'type': 'game_state_update',
                'game_id': str(game.id),
                'state': eng.to_json(),
                'status': game.status,
                'turn': game.turn,
                'result': result
            })
            
        except Exception as e:
            await self.send_error(str(e))

    async def handle_setup(self, setup_data):
        try:
            game = await self.get_game()
            if not game or game.status != 'SETUP':
                await self.send_error('Не в фазе расстановки')
                return
                
            state = await self.get_game_state(game)
            me = 1 if game.player1_id == self.user.id else 2
            
            eng = Engine(state.data)
            
            placements = setup_data.get('placements', [])
            for placement in placements:
                coord = (int(placement["x"]), int(placement["y"]))
                ship_type = placement["kind"]
                eng.place_ship(me, coord, ship_type)
            
            await self.persist_after_engine(game, state, eng)
            await self.create_move(game, me, 'setup', {'count': len(placements)})
            
            await self.broadcast_to_game({
                'type': 'game_state_update',
                'game_id': str(game.id),
                'state': eng.to_json(),
                'status': game.status,
                'turn': game.turn,
            })
            
        except Exception as e:
            await self.send_error(str(e))

    async def handle_clear_setup(self):
        try:
            game = await self.get_game()
            state = await self.get_game_state(game)
            me = 1 if game.player1_id == self.user.id else 2
            
            eng = Engine(state.data)
            eng.clear_setup(me)
            
            await self.persist_after_engine(game, state, eng)
            
            if me == 1:
                game.ready_p1 = False
            else:
                game.ready_p2 = False
            await sync_to_async(game.save)(update_fields=["ready_p1", "ready_p2"])
            
            await self.create_move(game, me, 'setup_clear', {})
            
            await self.broadcast_to_game({
                'type': 'game_state_update',
                'game_id': str(game.id),
                'state': eng.to_json(),
                'status': game.status,
                'turn': game.turn,
            })
            
        except Exception as e:
            await self.send_error(str(e))

    async def handle_torpedo(self, torpedo_data):
        try:
            game = await self.get_game()
            state = await self.get_game_state(game)
            me = 1 if game.player1_id == self.user.id else 2
            
            eng = Engine(state.data)
            torpedo_coord = tuple(torpedo_data["torpedo"])
            tk_coord = tuple(torpedo_data["tk"])
            direction = tuple(torpedo_data["direction"])
            
            result = eng.torpedo_attack(me, torpedo_coord, tk_coord, direction)
            
            await self.persist_after_engine(game, state, eng)
            
            if result.get('captures'):
                for kind in result['captures']:
                    await self.update_killed_counter(game, 3-me, kind)
            
            await self.create_move(game, me, 'torpedo', {**torpedo_data, **result})
            
            await self.broadcast_to_game({
                'type': 'game_state_update',
                'game_id': str(game.id),
                'state': eng.to_json(),
                'status': game.status,
                'turn': game.turn,
                'result': result
            })
            
        except Exception as e:
            await self.send_error(str(e))

    async def handle_air_attack(self, air_data):
        try:
            game = await self.get_game()
            state = await self.get_game_state(game)
            me = 1 if game.player1_id == self.user.id else 2
            
            eng = Engine(state.data)
            carrier_coord = tuple(air_data["carrier"])
            plane_coord = tuple(air_data["plane"])
            
            result = eng.air_attack(me, carrier_coord, plane_coord)
            
            await self.persist_after_engine(game, state, eng)
            
            if result.get('captures'):
                for kind in result['captures']:
                    await self.update_killed_counter(game, 3-me, kind)
            
            await self.create_move(game, me, 'air_attack', {**air_data, **result})
            
            await self.broadcast_to_game({
                'type': 'game_state_update',
                'game_id': str(game.id),
                'state': eng.to_json(),
                'status': game.status,
                'turn': game.turn,
                'result': result
            })
            
        except Exception as e:
            await self.send_error(str(e))

    async def handle_bomb(self, bomb_data):
        try:
            game = await self.get_game()
            state = await self.get_game_state(game)
            me = 1 if game.player1_id == self.user.id else 2
            
            eng = Engine(state.data)
            bomb_coord = tuple(bomb_data["bomb"])
            
            result = eng.detonate_bomb(me, bomb_coord)
            
            await self.persist_after_engine(game, state, eng)
            
            if result.get('captures'):
                for kind in result['captures']:
                    await self.update_killed_counter(game, 3-me, kind)
            
            await self.create_move(game, me, 'atomic_bomb', {**bomb_data, **result})
            
            await self.broadcast_to_game({
                'type': 'game_state_update',
                'game_id': str(game.id),
                'state': eng.to_json(),
                'status': game.status,
                'turn': game.turn,
                'result': result
            })
            
        except Exception as e:
            await self.send_error(str(e))

    async def handle_resign(self):
        try:
            game = await self.get_game()
            state = await self.get_game_state(game)
            me = 1 if game.player1_id == self.user.id else 2
            
            eng = Engine(state.data)
            eng.gd.winner = 3 - me
            eng.gd.win_reason = "resign"
            eng.gd.phase = "FINISHED"
            
            game.status = "FINISHED"
            game.winner_id = game.player2_id if me == 1 else game.player1_id
            game.win_reason = "resign"
            game.turn_start_time_p1 = None
            game.turn_start_time_p2 = None
            game.last_bank_update_p1 = None
            game.last_bank_update_p2 = None
            game.turn_start_time = None
            game.last_bank_update = None
            await sync_to_async(game.save)()
            
            state.data = eng.to_json()
            await sync_to_async(state.save)()
            
            await self.create_move(game, me, 'resign', {})
            
            winner = game.player2 if me == 1 else game.player1
            loser = self.user
            await self.update_ratings(winner, loser)
            
            await self.broadcast_to_game({
                'type': 'game_finished',
                'winner': eng.gd.winner,
                'reason': 'resign'
            })
            
        except Exception as e:
            await self.send_error(str(e))

    async def handle_pause(self, pause_data):
        try:
            game = await self.get_game()
            me = 1 if game.player1_id == self.user.id else 2
            
            if game.status not in ("TURN_P1", "TURN_P2"):
                await self.send_error("Игра не активна")
                return
            
            if game.turn != me:
                await self.send_error("Не ваш ход")
                return
            
            pause_type = pause_data.get("type", "")
            if pause_type not in ["short", "long"]:
                await self.send_error("Неверный тип паузы")
                return
            
            if me == 1:
                if pause_type == "short" and game.short_pause_p1:
                    await self.send_error("Короткая пауза уже использована")
                    return
                if pause_type == "long" and game.long_pause_p1:
                    await self.send_error("Длинная пауза уже использована")
                    return
            else:
                if pause_type == "short" and game.short_pause_p2:
                    await self.send_error("Короткая пауза уже использована")
                    return
                if pause_type == "long" and game.long_pause_p2:
                    await self.send_error("Длинная пауза уже использована")
                    return
            
            now = timezone.now()
            pause_duration = 60 if pause_type == "short" else 180
            
            game.status = "PAUSED"
            game.pause_until = now + timezone.timedelta(seconds=pause_duration)
            game.pause_initiator = me
            
            if me == 1:
                if pause_type == "short":
                    game.short_pause_p1 = True
                else:
                    game.long_pause_p1 = True
            else:
                if pause_type == "short":
                    game.short_pause_p2 = True
                else:
                    game.long_pause_p2 = True
            
            await sync_to_async(game.save)()
            
            await self.create_move(game, me, 'pause', {"type": pause_type, "duration": pause_duration})
            
            await self.broadcast_to_game({
                'type': 'game_paused',
                'pause_type': pause_type,
                'duration': pause_duration,
                'initiator': me
            })
            
        except Exception as e:
            await self.send_error(str(e))

    async def handle_group_candidates(self, data):
        try:
            game = await self.get_game()
            state = await self.get_game_state(game)
            me = 1 if game.player1_id == self.user.id else 2
            
            eng = Engine(state.data)
            coord = tuple(data["coord"])
            candidates = eng.get_group_candidates(coord, me)
            
            await self.send(text_data=json.dumps({
                'type': 'group_candidates',
                'candidates': candidates
            }))
            
        except Exception as e:
            await self.send_error(str(e))

    async def handle_special_attacks(self, data):
        try:
            game = await self.get_game()
            state = await self.get_game_state(game)
            me = 1 if game.player1_id == self.user.id else 2
            
            eng = Engine(state.data)
            options = eng.get_special_attack_options(me)
            
            await self.send(text_data=json.dumps({
                'type': 'special_attacks',
                'options': options
            }))
            
        except Exception as e:
            await self.send_error(str(e))

    async def send_error(self, message):
        await self.send(text_data=json.dumps({
            'type': 'error',
            'message': message
        }))

    @sync_to_async
    def get_game(self):
        try:
            return Game.objects.select_related('player1', 'player2').get(id=self.game_id)
        except Game.DoesNotExist:
            return None

    @sync_to_async
    def get_game_state(self, game):
        state, _ = GameState.objects.get_or_create(game=game, defaults={"data": {}})
        if not state.data:
            state.data = {"turn": 1, "phase": "SETUP", "board": {}, "setup_counts": {1: {}, 2: {}}}
            state.save()
        return state

    @sync_to_async
    def persist_after_engine(self, game, state, eng):
        state.data = eng.to_json()
        state.save()
        old_turn = game.turn
        game.turn = eng.gd.turn
        
        if eng.gd.phase in ("TURN_P1", "TURN_P2"):
            game.status = eng.gd.phase
            if old_turn != eng.gd.turn:
                current_time = time.time()
                if eng.gd.turn == 1:
                    game.turn_start_time_p1 = current_time
                    game.last_bank_update_p1 = None
                else:
                    game.turn_start_time_p2 = current_time
                    game.last_bank_update_p2 = None
                game.turn_start_time = current_time
                game.last_bank_update = None
        elif eng.gd.phase == "SETUP":
            game.status = "SETUP"
        elif eng.gd.phase == "FINISHED":
            game.status = "FINISHED"
            game.turn_start_time_p1 = None
            game.turn_start_time_p2 = None
            game.last_bank_update_p1 = None
            game.last_bank_update_p2 = None
            game.turn_start_time = None
            game.last_bank_update = None
        
        game.save()

    @sync_to_async
    def create_move(self, game, actor, move_type, payload):
        Move.objects.create(
            game=game, 
            number=game.moves.count() + 1, 
            actor=actor,
            type=move_type, 
            payload=payload
        )

    @sync_to_async
    def update_killed_counter(self, game, owner, piece):
        KilledCounter.objects.update_or_create(
            game=game, owner=owner, piece=piece,
            defaults={"killed": models.F("killed") + 1}
        )

    @sync_to_async
    def update_ratings(self, winner, loser):
        winner.profile.wins += 1
        winner.profile.rating_elo += 100
        winner.profile.save()
        loser.profile.losses += 1
        loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
        loser.profile.save()

    async def handle_game_end(self, game, state):
        if state.data.get('winner'):
            game.status = "FINISHED"
            game.winner_id = game.player1_id if state.data["winner"] == 1 else game.player2_id
            game.win_reason = state.data.get("win_reason", "")
            game.turn_start_time_p1 = None
            game.turn_start_time_p2 = None
            game.last_bank_update_p1 = None
            game.last_bank_update_p2 = None
            game.turn_start_time = None
            game.last_bank_update = None
            await sync_to_async(game.save)()
            
            if game.winner_id:
                winner = game.player1 if game.winner_id == game.player1_id else game.player2
                loser = game.player2 if game.winner_id == game.player1_id else game.player1
                await self.update_ratings(winner, loser)