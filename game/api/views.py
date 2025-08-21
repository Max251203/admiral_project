import random
import time
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.db import models
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

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

def broadcast_game_state(game: Game):
    st, _ = GameState.objects.get_or_create(game=game)
    channel_layer = get_channel_layer()

    for player_id, player_num in [(game.player1_id, 1), (game.player2_id, 2)]:
        if player_id:
            eng = Engine(st.data)
            visible_board = eng.get_visible_board_for_player(player_num)
            
            payload = {
                "type": "game_state_update",
                "game_id": str(game.id),
                "state": {**st.data, "board": visible_board},
                "status": game.status,
                "turn": game.turn,
                "my_player": player_num,
            }
            
            async_to_sync(channel_layer.group_send)(
                f"game_{game.id}",
                {"type": "broadcast_message", "payload": payload}
            )

class GetState(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request, game_id):
        try:
            g = get_object_or_404(Game, id=game_id)
            if g.player1_id != request.user.id and g.player2_id != request.user.id:
                return Response({"error": "not your game"}, status=403)
            
            st = _ensure_state(g)
            eng = Engine(st.data)
            my_player = _actor(g, request.user)
            
            visible_board = eng.get_visible_board_for_player(my_player)
            
            return Response({
                "game": str(g.id),
                "state": {**st.data, "board": visible_board},
                "status": g.status,
                "turn": g.turn,
                "my_player": my_player
            })
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class SetupAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        try:
            g = get_object_or_404(Game, id=game_id)
            if g.player1_id != request.user.id and g.player2_id != request.user.id:
                return Response({"error": "not your game"}, status=403)
            
            if g.status != "SETUP":
                return Response({"error": "not in setup phase"}, status=400)
            
            st = _ensure_state(g)
            eng = Engine(st.data)
            me = _actor(g, request.user)
            
            placements = request.data.get("placements", [])
            if not placements:
                return Response({"error": "no placements provided"}, status=400)
            
            for placement in placements:
                if not all(k in placement for k in ["x", "y", "kind"]):
                    return Response({"error": "invalid placement data"}, status=400)
                
                coord = (int(placement["x"]), int(placement["y"]))
                ship_type = placement["kind"]
                eng.place_ship(me, coord, ship_type)
            
            _persist_after_engine(g, st, eng)
            Move.objects.create(
                game=g, number=g.moves.count() + 1, actor=me,
                type="setup", payload={"count": len(placements)}
            )
            
            broadcast_game_state(g)
            return Response({"ok": True})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class SubmitSetup(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        try:
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
                if g.ready_at_p1 <= g.ready_at_p2:
                    g.status = "TURN_P1"
                    g.turn = 1
                    g.turn_start_time_p1 = time.time()
                else:
                    g.status = "TURN_P2"
                    g.turn = 2
                    g.turn_start_time_p2 = time.time()
                
                g.turn_start_time = time.time()
                st.data["phase"] = g.status
                st.data["turn"] = g.turn
                g.save()
                st.save()
            
            broadcast_game_state(g)
            return Response({"ok": True, "status": g.status, "turn": g.turn})
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class MoveAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        try:
            g = get_object_or_404(Game, id=game_id)
            if g.player1_id != request.user.id and g.player2_id != request.user.id:
                return Response({"error": "not your game"}, status=403)
            
            if g.status not in ("TURN_P1", "TURN_P2"):
                return Response({"error": "not in game phase"}, status=400)
            
            st = _ensure_state(g)
            eng = Engine(st.data)
            me = _actor(g, request.user)
            
            if eng.gd.turn != me:
                return Response({"error": "not your turn"}, status=400)
            
            if not all(k in request.data for k in ["src", "dst"]):
                return Response({"error": "missing src or dst"}, status=400)
            
            src = tuple(request.data["src"])
            dst = tuple(request.data["dst"])
            
            followers = []
            if "followers" in request.data:
                for f in request.data["followers"]:
                    if len(f) >= 4:
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
                game=g, number=g.moves.count() + 1, actor=me,
                type="move", payload={**request.data, **result}
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
            
            broadcast_game_state(g)
            return Response({"ok": True, "result": result})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class AutoSetup(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        try:
            g = get_object_or_404(Game, id=game_id)
            if g.player1_id != request.user.id and g.player2_id != request.user.id:
                return Response({"error": "not your game"}, status=403)
            
            st = _ensure_state(g)
            eng = Engine(st.data)
            me = _actor(g, request.user)
            
            placed = eng.auto_setup(me)
            _persist_after_engine(g, st, eng)
            
            Move.objects.create(
                game=g, number=g.moves.count() + 1, actor=me,
                type="auto_setup", payload={"count": placed}
            )
            
            broadcast_game_state(g)
            return Response({"ok": True, "placed": placed})
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class ClearSetup(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        try:
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
                game=g, number=g.moves.count() + 1, actor=me,
                type="setup_clear", payload={}
            )
            
            broadcast_game_state(g)
            return Response({"ok": True})
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class TorpedoAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        try:
            g = get_object_or_404(Game, id=game_id)
            if g.player1_id != request.user.id and g.player2_id != request.user.id:
                return Response({"error": "not your game"}, status=403)
            
            st = _ensure_state(g)
            eng = Engine(st.data)
            me = _actor(g, request.user)
            
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
                game=g, number=g.moves.count() + 1, actor=me,
                type="torpedo", payload={**request.data, **result}
            )
            
            broadcast_game_state(g)
            return Response({"ok": True, "result": result})
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class AirAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        try:
            g = get_object_or_404(Game, id=game_id)
            if g.player1_id != request.user.id and g.player2_id != request.user.id:
                return Response({"error": "not your game"}, status=403)
            
            st = _ensure_state(g)
            eng = Engine(st.data)
            me = _actor(g, request.user)
            
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
                game=g, number=g.moves.count() + 1, actor=me,
                type="air_attack", payload={**request.data, **result}
            )
            
            broadcast_game_state(g)
            return Response({"ok": True, "result": result})
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class BombAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        try:
            g = get_object_or_404(Game, id=game_id)
            if g.player1_id != request.user.id and g.player2_id != request.user.id:
                return Response({"error": "not your game"}, status=403)
            
            st = _ensure_state(g)
            eng = Engine(st.data)
            me = _actor(g, request.user)
            
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
                game=g, number=g.moves.count() + 1, actor=me,
                type="atomic_bomb", payload={**request.data, **result}
            )
            
            broadcast_game_state(g)
            return Response({"ok": True, "result": result})
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class PauseAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        try:
            g = get_object_or_404(Game, id=game_id)
            if g.player1_id != request.user.id and g.player2_id != request.user.id:
                return Response({"error": "not your game"}, status=403)
            
            if g.status not in ("TURN_P1", "TURN_P2"):
                return Response({"error": "game not active"}, status=400)
            
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
                game=g, number=g.moves.count() + 1, actor=me,
                type="pause", payload={"type": pause_type, "duration": pause_duration}
            )
            
            broadcast_game_state(g)
            return Response({"ok": True})
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class CancelPauseAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        try:
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
                game=g, number=g.moves.count() + 1, actor=me,
                type="cancel_pause", payload={}
            )
            
            broadcast_game_state(g)
            return Response({"ok": True})
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class ResignAPI(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        try:
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
                game=g, number=g.moves.count() + 1, actor=me,
                type="resign", payload={}
            )
            
            winner = g.player2 if me == 1 else g.player1
            loser = request.user
            winner.profile.wins += 1
            winner.profile.rating_elo += 100
            winner.profile.save()
            loser.profile.losses += 1
            loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
            loser.profile.save()
            
            broadcast_game_state(g)
            return Response({"ok": True})
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class GameByCode(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request, code):
        try:
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
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class MyGames(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        try:
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
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class KilledPieces(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request, game_id):
        try:
            g = get_object_or_404(Game, id=game_id)
            if g.player1_id != request.user.id and g.player2_id != request.user.id:
                return Response({"error": "not your game"}, status=403)
            
            me = _actor(g, request.user)
            opponent = 3 - me
            killed = KilledCounter.objects.filter(game=g, owner=opponent)
            items = [{"piece": k.piece, "killed": k.killed} for k in killed]
            
            return Response({"items": items})
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class GetGroupCandidates(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        try:
            g = get_object_or_404(Game, id=game_id)
            if g.player1_id != request.user.id and g.player2_id != request.user.id:
                return Response({"error": "not your game"}, status=403)
            
            st = _ensure_state(g)
            eng = Engine(st.data)
            me = _actor(g, request.user)
            
            coord = tuple(request.data["coord"])
            candidates = eng.get_group_candidates(coord, me)
            
            return Response({"candidates": candidates})
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class GetSpecialAttacks(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request, game_id):
        try:
            g = get_object_or_404(Game, id=game_id)
            if g.player1_id != request.user.id and g.player2_id != request.user.id:
                return Response({"error": "not your game"}, status=403)
            
            st = _ensure_state(g)
            eng = Engine(st.data)
            me = _actor(g, request.user)
            
            options = eng.get_special_attack_options(me)
            
            return Response({"options": options})
        except Exception as e:
            return Response({"error": str(e)}, status=500)

class GetCarriedPieces(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, game_id):
        try:
            g = get_object_or_404(Game, id=game_id)
            if g.player1_id != request.user.id and g.player2_id != request.user.id:
                return Response({"error": "not your game"}, status=403)
            
            st = _ensure_state(g)
            eng = Engine(st.data)
            me = _actor(g, request.user)
            
            coord = tuple(request.data["coord"])
            carried = eng.get_carried_pieces(coord)
            
            return Response({"carried": carried})
        except Exception as e:
            return Response({"error": str(e)}, status=500)