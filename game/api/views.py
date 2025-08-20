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
    game.turn = eng.gd.turn
    if eng.gd.phase in ("TURN_P1", "TURN_P2"):
        game.status = eng.gd.phase
        # ИСПРАВЛЕНО: Сбрасываем время начала хода только при смене хода
        if game.turn != eng.gd.turn:
            game.turn_start_time = time.time()
    elif eng.gd.phase == "SETUP":
        game.status = "SETUP"
    elif eng.gd.phase == "FINISHED":
        game.status = "FINISHED"
        game.turn_start_time = None
    game.save(update_fields=["turn", "status", "turn_start_time"])

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
                coord = (int(placement["x"]), int(placement["y"]))
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
            if g.ready_at_p1 and g.ready_at_p2 and g.ready_at_p1 <= g.ready_at_p2:
                g.status = "TURN_P1"
                g.turn = 1
            else:
                g.status = "TURN_P2"
                g.turn = 2
            
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
            src = tuple(request.data["src"])
            dst = tuple(request.data["dst"])
            followers = []
            
            if "followers" in request.data:
                for f in request.data["followers"]:
                    followers.append((tuple(f[:2]), tuple(f[2:])))
            
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
                g.turn_start_time = None
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
            torpedo_coord = tuple(request.data["torpedo"])
            tk_coord = tuple(request.data["tk"])
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
                g.turn_start_time = None
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
            carrier_coord = tuple(request.data["carrier"])
            plane_coord = tuple(request.data["plane"])
            
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
                g.turn_start_time = None
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
            bomb_coord = tuple(request.data["bomb"])
            
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
                g.turn_start_time = None
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
        
        # ИСПРАВЛЕНО: НЕ сбрасываем turn_start_time при паузе
        
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
        g.turn_start_time = None
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
                # ИСПРАВЛЕНО: НЕ сбрасываем turn_start_time
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
        
        # ИСПРАВЛЕНО: Правильный расчет времени хода и банка
        turn_left = 30
        if g.turn_start_time:
            turn_elapsed = current_time - g.turn_start_time
            turn_left = max(0, 30 - int(turn_elapsed))
        
        bank_attr = "bank_ms_p1" if g.turn == 1 else "bank_ms_p2"
        bank_ms = getattr(g, bank_attr)
        
        # ИСПРАВЛЕНО: Если время хода истекло, списываем из банка
        if turn_left == 0 and g.turn_start_time:
            turn_elapsed = current_time - g.turn_start_time
            if turn_elapsed > 30:
                overtime_seconds = turn_elapsed - 30
                bank_ms = max(0, bank_ms - int(overtime_seconds * 1000))
                setattr(g, bank_attr, bank_ms)
                g.save()
        
        bank_left = bank_ms // 1000
        
        return Response({
            "turn": g.turn,
            "turn_left": turn_left,
            "bank_left": bank_left,
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
        # ИСПРАВЛЕНО: НЕ сбрасываем turn_start_time
        g.save()
        
        Move.objects.create(
            game=g,
            number=g.moves.count() + 1,
            actor=me,
            type="cancel_pause",
            payload={}
        )
        
        return Response({"ok": True})

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
        
        coord = tuple(request.data["coord"])
        candidates = eng.get_group_candidates(coord, me)
        
        return Response({"candidates": candidates})

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
        
        return Response({"options": options})

class GetCarriedPieces(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        eng = Engine(st.data)
        
        coord = tuple(request.data["coord"])
        carried = eng.get_carried_pieces(coord)
        
        return Response({"carried": carried})