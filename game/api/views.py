import random
import time
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.db import models
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response

from ..models import Game, GameState, Move, KilledCounter
from ..engine.board import Engine

def _ensure_state(game: Game) -> GameState:
    st, _ = GameState.objects.get_or_create(game=game, defaults={"data": {}})
    if not st.data:
        st.data = {"turn": 1, "phase": "SETUP", "board": {}, "setup_counts": {1: {}, 2: {}}}
        st.save()
    return st

def _actor(game: Game, user) -> int:
    return 1 if game.player1_id == user.id else 2

def _persist_after_engine(game: Game, st: GameState, eng: Engine):
    st.data = eng.to_json()
    st.save()
    old_turn = game.turn
    game.turn = eng.gd.turn
    
    if eng.gd.phase in ("TURN_P1", "TURN_P2"):
        game.status = eng.gd.phase
        # ИСПРАВЛЕНО: Сбрасываем индивидуальные таймеры при смене хода
        if old_turn != eng.gd.turn:
            current_time = time.time()
            if eng.gd.turn == 1:
                game.turn_start_time_p1 = current_time
                game.last_bank_update_p1 = None
            else:
                game.turn_start_time_p2 = current_time
                game.last_bank_update_p2 = None
            # Обновляем общий таймер для совместимости
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

class GetState(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        eng = Engine(st.data)
        my_player = _actor(g, request.user)
        
        # Возвращаем только видимые для игрока фишки
        visible_board = eng.get_visible_board_for_player(my_player)
        
        return Response({
            "game": str(g.id),
            "state": {
                **st.data,
                "board": visible_board
            },
            "status": g.status,
            "turn": g.turn,
            "my_player": my_player
        })

class SetupAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        eng = Engine(st.data)
        me = _actor(g, request.user)
        
        try:
            for placement in request.data.get("placements", []):
                # ИСПРАВЛЕНО: Преобразуем UI координаты в реальные координаты поля
                ui_x = int(placement["x"])
                ui_y = int(placement["y"])
                
                # Для игрока 2 инвертируем Y координату
                if me == 2:
                    real_y = 14 - ui_y  # Инвертируем Y для игрока 2
                    real_x = ui_x
                else:
                    real_y = ui_y
                    real_x = ui_x
                
                coord = (real_x, real_y)
                ship_type = placement["kind"]
                eng.place_ship(me, coord, ship_type)
            
            _persist_after_engine(g, st, eng)
            Move.objects.create(
                game=g,
                number=g.moves.count() + 1,
                actor=me,
                type="setup",
                payload={"count": len(request.data.get("placements", []))}
            )
            
            # Возвращаем только видимые фишки
            visible_board = eng.get_visible_board_for_player(me)
            return Response({"ok": True, "state": {**st.data, "board": visible_board}})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

class ClearSetup(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        eng = Engine(st.data)
        me = _actor(g, request.user)
        
        eng.clear_setup(me)
        _persist_after_engine(g, st, eng)
        
        if me == 1:
            g.ready_p1 = False
        else:
            g.ready_p2 = False
        g.save(update_fields=["ready_p1", "ready_p2"])
        
        Move.objects.create(
            game=g,
            number=g.moves.count() + 1,
            actor=me,
            type="setup_clear",
            payload={}
        )
        
        visible_board = eng.get_visible_board_for_player(me)
        return Response({"ok": True, "state": {**st.data, "board": visible_board}})

class SubmitSetup(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        now = timezone.now()
        me = _actor(g, request.user)
        
        if me == 1 and not g.ready_p1:
            g.ready_p1 = True
            g.ready_at_p1 = now
        elif me == 2 and not g.ready_p2:
            g.ready_p2 = True
            g.ready_at_p2 = now
        
        g.save()
        
        if g.ready_p1 and g.ready_p2 and g.status == "SETUP":
            # ИСПРАВЛЕНО: Первым ходит тот, кто первым нажал "готов"
            if g.ready_at_p1 <= g.ready_at_p2:
                g.status = "TURN_P1"
                g.turn = 1
                g.turn_start_time_p1 = time.time()
            else:
                g.status = "TURN_P2"
                g.turn = 2
                g.turn_start_time_p2 = time.time()
            
            # Обновляем общий таймер для совместимости
            g.turn_start_time = time.time()
            st.data["phase"] = g.status
            st.data["turn"] = g.turn
            g.save()
            st.save()
        
        return Response({"ok": True, "status": g.status, "turn": g.turn})

class AutoSetup(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        eng = Engine(st.data)
        me = _actor(g, request.user)
        
        try:
            placed = eng.auto_setup(me)
            _persist_after_engine(g, st, eng)
            
            Move.objects.create(
                game=g,
                number=g.moves.count() + 1,
                actor=me,
                type="auto_setup",
                payload={"count": placed}
            )
            
            visible_board = eng.get_visible_board_for_player(me)
            return Response({"ok": True, "state": {**st.data, "board": visible_board}, "placed": placed})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

class MoveAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        eng = Engine(st.data)
        me = _actor(g, request.user)
        
        try:
            # ИСПРАВЛЕНО: Преобразуем UI координаты в реальные координаты
            ui_src = tuple(request.data["src"])
            ui_dst = tuple(request.data["dst"])
            
            # Преобразуем координаты для игрока 2
            if me == 2:
                src = (ui_src[0], 14 - ui_src[1])
                dst = (ui_dst[0], 14 - ui_dst[1])
            else:
                src = ui_src
                dst = ui_dst
            
            followers = []
            if "followers" in request.data:
                for f in request.data["followers"]:
                    if me == 2:
                        f_src = (f[0], 14 - f[1])
                        f_dst = (f[2], 14 - f[3])
                    else:
                        f_src = (f[0], f[1])
                        f_dst = (f[2], f[3])
                    followers.append((f_src, f_dst))
            
            result = eng.move_piece(me, src, dst, followers)
            
            _persist_after_engine(g, st, eng)
            
            if "captures" in result and result["captures"]:
                for kind in result["captures"]:
                    KilledCounter.objects.update_or_create(
                        game=g, owner=3-me, piece=kind,
                        defaults={"killed": models.F("killed") + 1}
                    )
            
            Move.objects.create(
                game=g,
                number=g.moves.count() + 1,
                actor=me,
                type="move",
                payload={**request.data, **result}
            )
            
            if st.data.get("winner"):
                g.status = "FINISHED"
                g.winner_id = g.player1_id if st.data["winner"] == 1 else g.player2_id
                g.win_reason = st.data.get("win_reason", "")
                g.turn_start_time_p1 = None
                g.turn_start_time_p2 = None
                g.last_bank_update_p1 = None
                g.last_bank_update_p2 = None
                g.turn_start_time = None
                g.last_bank_update = None
                g.save()
                
                if g.winner_id:
                    winner = g.player1 if g.winner_id == g.player1_id else g.player2
                    loser = g.player2 if g.winner_id == g.player1_id else g.player1
                    winner.profile.wins += 1
                    winner.profile.rating_elo += 100
                    winner.profile.save()
                    loser.profile.losses += 1
                    loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
                    loser.profile.save()
            
            visible_board = eng.get_visible_board_for_player(me)
            return Response({"ok": True, "result": result, "state": {**st.data, "board": visible_board}})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

class TorpedoAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        eng = Engine(st.data)
        me = _actor(g, request.user)
        
        try:
            # ИСПРАВЛЕНО: Преобразуем UI координаты в реальные
            ui_torpedo = tuple(request.data["torpedo"])
            ui_tk = tuple(request.data["tk"])
            
            if me == 2:
                torpedo_coord = (ui_torpedo[0], 14 - ui_torpedo[1])
                tk_coord = (ui_tk[0], 14 - ui_tk[1])
            else:
                torpedo_coord = ui_torpedo
                tk_coord = ui_tk
            
            direction = tuple(request.data["direction"])
            
            result = eng.torpedo_attack(me, torpedo_coord, tk_coord, direction)
            
            _persist_after_engine(g, st, eng)
            
            if "captures" in result and result["captures"]:
                for kind in result["captures"]:
                    KilledCounter.objects.update_or_create(
                        game=g, owner=3-me, piece=kind,
                        defaults={"killed": models.F("killed") + 1}
                    )
            
            Move.objects.create(
                game=g,
                number=g.moves.count() + 1,
                actor=me,
                type="torpedo",
                payload={**request.data, **result}
            )
            
            if st.data.get("winner"):
                g.status = "FINISHED"
                g.winner_id = g.player1_id if st.data["winner"] == 1 else g.player2_id
                g.win_reason = st.data.get("win_reason", "")
                g.turn_start_time_p1 = None
                g.turn_start_time_p2 = None
                g.last_bank_update_p1 = None
                g.last_bank_update_p2 = None
                g.turn_start_time = None
                g.last_bank_update = None
                g.save()
                
                if g.winner_id:
                    winner = g.player1 if g.winner_id == g.player1_id else g.player2
                    loser = g.player2 if g.winner_id == g.player1_id else g.player1
                    winner.profile.wins += 1
                    winner.profile.rating_elo += 100
                    winner.profile.save()
                    loser.profile.losses += 1
                    loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
                    loser.profile.save()
            
            visible_board = eng.get_visible_board_for_player(me)
            return Response({"ok": True, "result": result, "state": {**st.data, "board": visible_board}})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

class AirAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        eng = Engine(st.data)
        me = _actor(g, request.user)
        
        try:
            # ИСПРАВЛЕНО: Преобразуем UI координаты в реальные
            ui_carrier = tuple(request.data["carrier"])
            ui_plane = tuple(request.data["plane"])
            
            if me == 2:
                carrier_coord = (ui_carrier[0], 14 - ui_carrier[1])
                plane_coord = (ui_plane[0], 14 - ui_plane[1])
            else:
                carrier_coord = ui_carrier
                plane_coord = ui_plane
            
            result = eng.air_attack(me, carrier_coord, plane_coord)
            
            _persist_after_engine(g, st, eng)
            
            if "captures" in result and result["captures"]:
                for kind in result["captures"]:
                    KilledCounter.objects.update_or_create(
                        game=g, owner=3-me, piece=kind,
                        defaults={"killed": models.F("killed") + 1}
                    )
            
            Move.objects.create(
                game=g,
                number=g.moves.count() + 1,
                actor=me,
                type="air_attack",
                payload={**request.data, **result}
            )
            
            if st.data.get("winner"):
                g.status = "FINISHED"
                g.winner_id = g.player1_id if st.data["winner"] == 1 else g.player2_id
                g.win_reason = st.data.get("win_reason", "")
                g.turn_start_time_p1 = None
                g.turn_start_time_p2 = None
                g.last_bank_update_p1 = None
                g.last_bank_update_p2 = None
                g.turn_start_time = None
                g.last_bank_update = None
                g.save()
                
                if g.winner_id:
                    winner = g.player1 if g.winner_id == g.player1_id else g.player2
                    loser = g.player2 if g.winner_id == g.player1_id else g.player1
                    winner.profile.wins += 1
                    winner.profile.rating_elo += 100
                    winner.profile.save()
                    loser.profile.losses += 1
                    loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
                    loser.profile.save()
            
            visible_board = eng.get_visible_board_for_player(me)
            return Response({"ok": True, "result": result, "state": {**st.data, "board": visible_board}})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

class BombAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        eng = Engine(st.data)
        me = _actor(g, request.user)
        
        try:
            # ИСПРАВЛЕНО: Преобразуем UI координаты в реальные
            ui_bomb = tuple(request.data["bomb"])
            
            if me == 2:
                bomb_coord = (ui_bomb[0], 14 - ui_bomb[1])
            else:
                bomb_coord = ui_bomb
            
            result = eng.detonate_bomb(me, bomb_coord)
            
            _persist_after_engine(g, st, eng)
            
            if "captures" in result and result["captures"]:
                for kind in result["captures"]:
                    KilledCounter.objects.update_or_create(
                        game=g, owner=3-me, piece=kind,
                        defaults={"killed": models.F("killed") + 1}
                    )
            
            Move.objects.create(
                game=g,
                number=g.moves.count() + 1,
                actor=me,
                type="atomic_bomb",
                payload={**request.data, **result}
            )
            
            if st.data.get("winner"):
                g.status = "FINISHED"
                g.winner_id = g.player1_id if st.data["winner"] == 1 else g.player2_id
                g.win_reason = st.data.get("win_reason", "")
                g.turn_start_time_p1 = None
                g.turn_start_time_p2 = None
                g.last_bank_update_p1 = None
                g.last_bank_update_p2 = None
                g.turn_start_time = None
                g.last_bank_update = None
                g.save()
                
                if g.winner_id:
                    winner = g.player1 if g.winner_id == g.player1_id else g.player2
                    loser = g.player2 if g.winner_id == g.player1_id else g.player1
                    winner.profile.wins += 1
                    winner.profile.rating_elo += 100
                    winner.profile.save()
                    loser.profile.losses += 1
                    loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
                    loser.profile.save()
            
            visible_board = eng.get_visible_board_for_player(me)
            return Response({"ok": True, "result": result, "state": {**st.data, "board": visible_board}})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

class PauseAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        me = _actor(g, request.user)
        if g.turn != me:
            return Response({"error": "not your turn"}, status=400)
        
        pause_type = request.data.get("type", "")
        if pause_type not in ["short", "long"]:
            return Response({"error": "invalid pause type"}, status=400)
        
        if me == 1:
            if pause_type == "short" and g.short_pause_p1:
                return Response({"error": "short pause already used"}, status=400)
            if pause_type == "long" and g.long_pause_p1:
                return Response({"error": "long pause already used"}, status=400)
        else:
            if pause_type == "short" and g.short_pause_p2:
                return Response({"error": "short pause already used"}, status=400)
            if pause_type == "long" and g.long_pause_p2:
                return Response({"error": "long pause already used"}, status=400)
        
        now = timezone.now()
        pause_duration = 60 if pause_type == "short" else 180
        
        g.status = "PAUSED"
        g.pause_until = now + timezone.timedelta(seconds=pause_duration)
        g.pause_initiator = me
        
        if me == 1:
            if pause_type == "short":
                g.short_pause_p1 = True
            else:
                g.long_pause_p1 = True
        else:
            if pause_type == "short":
                g.short_pause_p2 = True
            else:
                g.long_pause_p2 = True
        
        g.save()
        
        Move.objects.create(
            game=g,
            number=g.moves.count() + 1,
            actor=me,
            type="pause",
                        payload={"type": pause_type, "duration": pause_duration}
        )
        
        return Response({
            "ok": True,
            "pause_until": g.pause_until.isoformat(),
            "duration": pause_duration
        })

class GameTimers(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        now = timezone.now()
        current_time = time.time()
        me = _actor(g, request.user)
        
        pauses_info = {
            "short_available": not (g.short_pause_p1 if me == 1 else g.short_pause_p2),
            "long_available": not (g.long_pause_p1 if me == 1 else g.long_pause_p2)
        }
        
        if g.status == "FINISHED":
            winner_player = 1 if (g.winner_id == g.player1_id) else (2 if g.winner_id else None)
            return Response({
                "turn": g.turn,
                "finished": True,
                "winner_player": winner_player,
                "reason": g.win_reason,
                **pauses_info
            })
        
        if g.status == "PAUSED" and g.pause_until:
            if now >= g.pause_until:
                g.status = f"TURN_P{g.turn}"
                g.pause_until = None
                g.save()
            else:
                pause_left = int((g.pause_until - now).total_seconds())
                return Response({
                    "turn": g.turn,
                    "paused": True,
                    "pause_left": pause_left,
                    "pause_initiator": g.pause_initiator,
                    **pauses_info
                })
        
        if g.status not in ("TURN_P1", "TURN_P2"):
            winner_player = 1 if (g.winner_id == g.player1_id) else (2 if g.winner_id else None)
            return Response({
                "turn": g.turn,
                "finished": g.status == "FINISHED",
                "winner_player": winner_player,
                "reason": g.win_reason,
                **pauses_info
            })
        
        # ИСПРАВЛЕНО: Индивидуальные таймеры для каждого игрока
        my_turn_left = 30
        my_bank_left = 0
        opponent_turn_left = 30
        opponent_bank_left = 0
        
        # Мои таймеры
        if me == 1:
            my_bank_ms = g.bank_ms_p1
            my_turn_start = g.turn_start_time_p1
            my_last_bank_update = g.last_bank_update_p1
            opponent_bank_ms = g.bank_ms_p2
        else:
            my_bank_ms = g.bank_ms_p2
            my_turn_start = g.turn_start_time_p2
            my_last_bank_update = g.last_bank_update_p2
            opponent_bank_ms = g.bank_ms_p1
        
        my_bank_left = my_bank_ms // 1000
        opponent_bank_left = opponent_bank_ms // 1000
        
        # ИСПРАВЛЕНО: Таймеры работают только в свой ход
        if g.turn == me and my_turn_start:
            # Мой ход - считаем мои таймеры
            turn_elapsed = current_time - my_turn_start
            my_turn_left = max(0, 30 - int(turn_elapsed))
            
            # Если время хода истекло, списываем из моего банка
            if my_turn_left == 0 and turn_elapsed > 30:
                if my_last_bank_update is None:
                    my_last_bank_update = my_turn_start + 30
                    if me == 1:
                        g.last_bank_update_p1 = my_last_bank_update
                    else:
                        g.last_bank_update_p2 = my_last_bank_update
                
                seconds_since_update = current_time - my_last_bank_update
                
                if seconds_since_update >= 1.0:
                    seconds_to_deduct = int(seconds_since_update)
                    my_bank_ms = max(0, my_bank_ms - (seconds_to_deduct * 1000))
                    
                    if me == 1:
                        g.bank_ms_p1 = my_bank_ms
                        g.last_bank_update_p1 = current_time
                    else:
                        g.bank_ms_p2 = my_bank_ms
                        g.last_bank_update_p2 = current_time
                    
                    my_bank_left = my_bank_ms // 1000
                    g.save()
                
                # Проверяем окончание банка времени
                if my_bank_left <= 0:
                    g.status = "FINISHED"
                    g.winner_id = g.player2_id if me == 1 else g.player1_id
                    g.win_reason = "time"
                    g.turn_start_time_p1 = None
                    g.turn_start_time_p2 = None
                    g.last_bank_update_p1 = None
                    g.last_bank_update_p2 = None
                    g.save()
                    
                    # Обновляем статистику игроков
                    winner = g.player2 if me == 1 else g.player1
                    loser = g.player1 if me == 1 else g.player2
                    
                    winner.profile.wins += 1
                    winner.profile.rating_elo += 100
                    winner.profile.save()
                    
                    loser.profile.losses += 1
                    loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
                    loser.profile.save()
                    
                    return Response({
                        "turn": g.turn,
                        "finished": True,
                        "winner": g.winner_id,
                        "reason": "time"
                    })
        
        return Response({
            "turn": g.turn,
            "my_turn": g.turn == me,
            "my_turn_left": my_turn_left if g.turn == me else 30,
            "my_bank_left": my_bank_left,
            "opponent_turn_left": opponent_turn_left if g.turn != me else 30,
            "opponent_bank_left": opponent_bank_left,
            **pauses_info
        })

class CancelPauseAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        me = _actor(g, request.user)
        if g.status != "PAUSED":
            return Response({"error": "game not paused"}, status=400)
        if g.pause_initiator != me:
            return Response({"error": "only pause initiator can cancel it"}, status=400)
        
        g.status = f"TURN_P{g.turn}"
        g.pause_until = None
        g.save()
        
        Move.objects.create(
            game=g,
            number=g.moves.count() + 1,
            actor=me,
            type="cancel_pause",
            payload={}
        )
        
        return Response({"ok": True})
                                 
class ResignAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        eng = Engine(st.data)
        me = _actor(g, request.user)
        
        eng.gd.winner = 3 - me
        eng.gd.win_reason = "resign"
        eng.gd.phase = "FINISHED"
        
        g.status = "FINISHED"
        g.winner_id = g.player2_id if me == 1 else g.player1_id
        g.win_reason = "resign"
        g.turn_start_time_p1 = None
        g.turn_start_time_p2 = None
        g.last_bank_update_p1 = None
        g.last_bank_update_p2 = None
        g.turn_start_time = None
        g.last_bank_update = None
        g.save()
        
        st.data = eng.to_json()
        st.save()
        
        Move.objects.create(
            game=g,
            number=g.moves.count() + 1,
            actor=me,
            type="resign",
            payload={}
        )
        
        winner = g.player2 if me == 1 else g.player1
        loser = request.user
        winner.profile.wins += 1
        winner.profile.rating_elo += 100
        winner.profile.save()
        loser.profile.losses += 1
        loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
        loser.profile.save()
        
        visible_board = eng.get_visible_board_for_player(me)
        return Response({"ok": True, "state": {**st.data, "board": visible_board}})

class GameByCode(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request, code):
        g = get_object_or_404(Game, code=code)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        eng = Engine(st.data)
        me = _actor(g, request.user)
        visible_board = eng.get_visible_board_for_player(me)
        
        return Response({
            "id": str(g.id),
            "state": {**st.data, "board": visible_board},
            "my_player": me
        })

class MyGames(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        qs = Game.objects.filter(player1=request.user) | Game.objects.filter(player2=request.user)
        qs = qs.order_by('-created_at')[:50]
        items = []
        
        for g in qs:
            opp = g.player2 if g.player1_id == request.user.id else g.player1
            opp_login = getattr(getattr(opp, 'profile', None), 'login', opp.username) if opp else '—'
            result = "В процессе"
            
            if g.status == "FINISHED":
                if g.winner_id == request.user.id:
                    result = "Победа"
                elif g.winner_id:
                    result = "Поражение"
                else:
                    result = "Ничья"
            
            items.append({
                "id": str(g.id),
                "code": g.code,
                "opponent": opp_login,
                "status": g.status,
                "result": result,
                "created_at": g.created_at.strftime("%d.%m.%Y %H:%M")
            })
        
        return Response({"items": items})

class KilledPieces(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        me = _actor(g, request.user)
        opponent = 3 - me
        
        killed = KilledCounter.objects.filter(game=g, owner=opponent)
        items = [{"piece": k.piece, "killed": k.killed} for k in killed]
        
        return Response({"items": items})

class GetGroupCandidates(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        eng = Engine(st.data)
        me = _actor(g, request.user)
        
        # ИСПРАВЛЕНО: Преобразуем UI координаты в реальные
        ui_coord = tuple(request.data["coord"])
        if me == 2:
            coord = (ui_coord[0], 14 - ui_coord[1])
        else:
            coord = ui_coord
        
        candidates = eng.get_group_candidates(coord, me)
        
        # ИСПРАВЛЕНО: Преобразуем реальные координаты обратно в UI
        ui_candidates = []
        for candidate in candidates:
            if me == 2:
                ui_candidates.append([candidate[0], 14 - candidate[1]])
            else:
                ui_candidates.append(candidate)
        
        return Response({"candidates": ui_candidates})

class GetSpecialAttacks(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        eng = Engine(st.data)
        me = _actor(g, request.user)
        
        options = eng.get_special_attack_options(me)
        
        # ИСПРАВЛЕНО: Преобразуем реальные координаты в UI координаты
        ui_options = {"torpedo": [], "air": []}
        
        for torpedo in options["torpedo"]:
            if me == 2:
                ui_tk = [torpedo["tk"][0], 14 - torpedo["tk"][1]]
                ui_torpedo = [torpedo["torpedo"][0], 14 - torpedo["torpedo"][1]]
            else:
                ui_tk = torpedo["tk"]
                ui_torpedo = torpedo["torpedo"]
            
            ui_options["torpedo"].append({
                "tk": ui_tk,
                "torpedo": ui_torpedo,
                "directions": torpedo["directions"]
            })
        
        for air in options["air"]:
            if me == 2:
                ui_carrier = [air["carrier"][0], 14 - air["carrier"][1]]
                ui_plane = [air["plane"][0], 14 - air["plane"][1]]
            else:
                ui_carrier = air["carrier"]
                ui_plane = air["plane"]
            
            ui_options["air"].append({
                "carrier": ui_carrier,
                "plane": ui_plane,
                "direction": air["direction"]
            })
        
        return Response({"options": ui_options})

class GetCarriedPieces(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        eng = Engine(st.data)
        me = _actor(g, request.user)
        
        # ИСПРАВЛЕНО: Преобразуем UI координаты в реальные
        ui_coord = tuple(request.data["coord"])
        if me == 2:
            coord = (ui_coord[0], 14 - ui_coord[1])
        else:
            coord = ui_coord
        
        carried = eng.get_carried_pieces(coord)
        
        # ИСПРАВЛЕНО: Преобразуем реальные координаты обратно в UI
        ui_carried = []
        for piece_coord in carried:
            if me == 2:
                ui_carried.append([piece_coord[0], 14 - piece_coord[1]])
            else:
                ui_carried.append(piece_coord)
        
        return Response({"carried": ui_carried})