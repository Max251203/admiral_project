import random
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
    st.data = eng.to_json(); st.save()
    game.turn = eng.gd.turn
    if eng.gd.phase in ("TURN_P1","TURN_P2"): game.status = eng.gd.phase
    elif eng.gd.phase == "SETUP": game.status = "SETUP"
    elif eng.gd.phase == "FINISHED": game.status = "FINISHED"
    game.save(update_fields=["turn","status"])

class GetState(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        st = _ensure_state(g)
        return Response({"game": str(g.id), "state": st.data, "status": g.status, "turn": g.turn, "my_player": _actor(g, request.user)})

class SetupAPI(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        st = _ensure_state(g); eng = Engine(st.data); me = _actor(g, request.user)
        try:
            for it in request.data.get("placements", []):
                eng.place(me, (int(it["x"]), int(it["y"])), it["kind"])
            _persist_after_engine(g, st, eng)
            Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="setup", payload={"count": len(request.data.get("placements", []))})
            return Response({"ok": True, "state": st.data})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

class ClearSetup(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        st = _ensure_state(g); eng = Engine(st.data); me = _actor(g, request.user)
        for k in list(eng.gd.board.keys()):
            arr = eng.gd.board[k]
            if arr and arr[0].owner == me:
                del eng.gd.board[k]
        eng.gd.setup_counts[me] = {}
        _persist_after_engine(g, st, eng)
        if me == 1: g.ready_p1 = False
        else: g.ready_p2 = False
        g.save(update_fields=["ready_p1","ready_p2"])
        Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="setup_clear", payload={})
        return Response({"ok": True, "state": st.data})

class SubmitSetup(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        st = _ensure_state(g); now = timezone.now(); me = _actor(g, request.user)
        if me == 1 and not g.ready_p1:
            g.ready_p1 = True; g.ready_at_p1 = now
        elif me == 2 and not g.ready_p2:
            g.ready_p2 = True; g.ready_at_p2 = now
        g.save()
        if g.ready_p1 and g.ready_p2 and g.status == "SETUP":
            if g.ready_at_p1 and g.ready_at_p2 and g.ready_at_p1 <= g.ready_at_p2:
                g.status = "TURN_P1"; g.turn = 1
            else:
                g.status = "TURN_P2"; g.turn = 2
            g.turn_deadline_at = now + timezone.timedelta(seconds=30)
            st.data["phase"] = g.status; st.data["turn"] = g.turn; g.save(); st.save()
        return Response({"ok": True, "status": g.status, "turn": g.turn})

class AutoSetup(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        st = _ensure_state(g); eng = Engine(st.data); me = _actor(g, request.user)
        for k in list(eng.gd.board.keys()):
            arr = eng.gd.board[k]
            if arr and arr[0].owner == me:
                del eng.gd.board[k]
        eng.gd.setup_counts[me] = {}
        rows = list(range(10, 15)) if me == 1 else list(range(0, 5))
        cols = list(range(0, 14))
        cells = [(x, y) for y in rows for x in cols]; random.shuffle(cells)
        def free_neighbors(c):
            x,y=c; nn=[]
            for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]:
                nx,ny=x+dx,y+dy
                if 0<=nx<14 and 0<=ny<15 and ny in rows and not eng._get((nx,ny)):
                    nn.append((nx,ny))
            random.shuffle(nn); return nn
        plan=[("VMB",2),("BDK",2),("L",2),("A",1),("S",1),("TN",1),("ES",6),("M",6),("TK",6),("T",6),("KR",6),("F",6),("TR",6),("ST",6),("PL",1),("KRPL",1),("SM",1),("AB",1)]
        placed=0
        try:
            for kind,cnt in plan:
                for _ in range(cnt):
                    if kind in ("S","M","T"):
                        carrier={"S":"A","M":"ES","T":"TK"}[kind]
                        hosts=[c for c,arr in eng.gd.board.items() if arr and arr[0].owner==me and arr[0].kind==carrier]
                        random.shuffle(hosts); done=False
                        for hc in hosts:
                            for n in free_neighbors(hc):
                                eng.place(me,n,kind); placed+=1; done=True; break
                            if done: break
                        if not done:
                            while cells:
                                c=cells.pop()
                                try: eng.place(me,c,kind); placed+=1; break
                                except ValueError: continue
                    else:
                        while cells:
                            c=cells.pop()
                            try: eng.place(me,c,kind); placed+=1; break
                            except ValueError: continue
            _persist_after_engine(g, st, eng)
            Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="setup", payload={"auto": True, "count": placed})
            return Response({"ok": True, "state": st.data, "placed": placed})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

class MoveAPI(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        st = _ensure_state(g); eng = Engine(st.data); me = _actor(g, request.user)
        try:
            res = eng.move(me, tuple(request.data["src"]), tuple(request.data["dst"]), followers=request.data.get("followers", []))
            g.turn_deadline_at = timezone.now() + timezone.timedelta(seconds=30)
            _persist_after_engine(g, st, eng)
            if "captures" in res and res["captures"]:
                for kind in res["captures"]:
                    KilledCounter.objects.update_or_create(game=g, owner=3-me, piece=kind, defaults={"killed": models.F("killed")+1})
            Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="move", payload={**request.data, **res})
            if st.data.get("winner"):
                g.status="FINISHED"; g.winner_id = g.player1_id if st.data["winner"]==1 else g.player2_id
                g.win_reason = st.data.get("win_reason",""); g.turn_deadline_at=None; g.save()
                if g.winner_id:
                    winner = g.player1 if g.winner_id==g.player1_id else g.player2
                    loser = g.player2 if g.winner_id==g.player1_id else g.player1
                    winner.profile.wins+=1; winner.profile.rating_elo+=100; winner.profile.save()
                    loser.profile.losses+=1; loser.profile.rating_elo=max(0,loser.profile.rating_elo-100); loser.profile.save()
            return Response({"ok": True, "res": res, "state": st.data})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

class TorpedoAPI(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        st = _ensure_state(g); eng = Engine(st.data); me = _actor(g, request.user)
        try:
            res = eng.torpedo(me, tuple(request.data["t"]), tuple(request.data["tk"]), tuple(request.data["dir"]))
            g.turn_deadline_at = timezone.now() + timezone.timedelta(seconds=30)
            _persist_after_engine(g, st, eng)
            if "captures" in res and res["captures"]:
                for kind in res["captures"]:
                    KilledCounter.objects.update_or_create(game=g, owner=3-me, piece=kind, defaults={"killed": models.F("killed")+1})
            Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="torpedo", payload={**request.data, **res})
            if st.data.get("winner"):
                g.status="FINISHED"; g.winner_id = g.player1_id if st.data["winner"]==1 else g.player2_id
                g.win_reason = st.data.get("win_reason",""); g.turn_deadline_at=None; g.save()
                if g.winner_id:
                    winner = g.player1 if g.winner_id==g.player1_id else g.player2
                    loser = g.player2 if g.winner_id==g.player1_id else g.player1
                    winner.profile.wins+=1; winner.profile.rating_elo+=100; winner.profile.save()
                    loser.profile.losses+=1; loser.profile.rating_elo=max(0,loser.profile.rating_elo-100); loser.profile.save()
            return Response({"ok": True, "res": res, "state": st.data})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

class AirAPI(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        st = _ensure_state(g); eng = Engine(st.data); me = _actor(g, request.user)
        try:
            res = eng.airstrike(me, tuple(request.data["a"]), tuple(request.data["s"]))
            g.turn_deadline_at = timezone.now() + timezone.timedelta(seconds=30)
            _persist_after_engine(g, st, eng)
            if "captures" in res and res["captures"]:
                for kind in res["captures"]:
                    KilledCounter.objects.update_or_create(game=g, owner=3-me, piece=kind, defaults={"killed": models.F("killed")+1})
            Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="air", payload={**request.data, **res})
            if st.data.get("winner"):
                g.status="FINISHED"; g.winner_id = g.player1_id if st.data["winner"]==1 else g.player2_id
                g.win_reason = st.data.get("win_reason",""); g.turn_deadline_at=None; g.save()
                if g.winner_id:
                    winner = g.player1 if g.winner_id==g.player1_id else g.player2
                    loser = g.player2 if g.winner_id==g.player1_id else g.player1
                    winner.profile.wins+=1; winner.profile.rating_elo+=100; winner.profile.save()
                    loser.profile.losses+=1; loser.profile.rating_elo=max(0,loser.profile.rating_elo-100); loser.profile.save()
            return Response({"ok": True, "res": res, "state": st.data})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

class BombAPI(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        st = _ensure_state(g); eng = Engine(st.data); me = _actor(g, request.user)
        try:
            res = eng.bomb(me, tuple(request.data["ab"]))
            g.turn_deadline_at = timezone.now() + timezone.timedelta(seconds=30)
            _persist_after_engine(g, st, eng)
            if "captures" in res and res["captures"]:
                for kind in res["captures"]:
                    KilledCounter.objects.update_or_create(game=g, owner=3-me, piece=kind, defaults={"killed": models.F("killed")+1})
            Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="bomb", payload={**request.data, **res})
            if st.data.get("winner"):
                g.status="FINISHED"; g.winner_id = g.player1_id if st.data["winner"]==1 else g.player2_id
                g.win_reason = st.data.get("win_reason",""); g.turn_deadline_at=None; g.save()
                if g.winner_id:
                    winner = g.player1 if g.winner_id==g.player1_id else g.player2
                    loser = g.player2 if g.winner_id==g.player1_id else g.player1
                    winner.profile.wins+=1; winner.profile.rating_elo+=100; winner.profile.save()
                    loser.profile.losses+=1; loser.profile.rating_elo=max(0,loser.profile.rating_elo-100); loser.profile.save()
            return Response({"ok": True, "res": res, "state": st.data})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

class PauseAPI(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        me = _actor(g, request.user)
        if g.turn != me: return Response({"error": "not your turn"}, status=400)
        pause_type = request.data.get("type","")
        if pause_type not in ["short","long"]: return Response({"error":"invalid pause type"}, status=400)
        if me==1:
            if pause_type=="short" and g.short_pause_p1: return Response({"error":"short pause already used"}, status=400)
            if pause_type=="long" and g.long_pause_p1: return Response({"error":"long pause already used"}, status=400)
        else:
            if pause_type=="short" and g.short_pause_p2: return Response({"error":"short pause already used"}, status=400)
            if pause_type=="long" and g.long_pause_p2: return Response({"error":"long pause already used"}, status=400)
        now=timezone.now(); pause_duration=60 if pause_type=="short" else 180
        g.status="PAUSED"; g.pause_until = now + timezone.timedelta(seconds=pause_duration); g.pause_initiator=me
        if me==1:
            if pause_type=="short": g.short_pause_p1=True
            else: g.long_pause_p1=True
        else:
            if pause_type=="short": g.short_pause_p2=True
            else: g.long_pause_p2=True
        g.save()
        Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="pause", payload={"type":pause_type,"duration":pause_duration})
        return Response({"ok": True, "pause_until": g.pause_until.isoformat(), "duration": pause_duration})

class ResignAPI(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        st = _ensure_state(g); eng = Engine(st.data); me = _actor(g, request.user)
        eng.gd.winner = 3 - me; eng.gd.win_reason="resign"; eng.gd.phase="FINISHED"
        g.status="FINISHED"; g.winner_id = g.player2_id if me==1 else g.player1_id; g.win_reason="resign"; g.turn_deadline_at=None; g.save()
        st.data = eng.to_json(); st.save()
        Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="resign", payload={})
        winner = g.player2 if me==1 else g.player1; loser = request.user
        winner.profile.wins += 1; winner.profile.rating_elo += 100; winner.profile.save()
        loser.profile.losses += 1; loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100); loser.profile.save()
        return Response({"ok": True, "state": st.data})

class GameByCode(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, code):
        g = get_object_or_404(Game, code=code)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        st = _ensure_state(g)
        return Response({"id": str(g.id), "state": st.data, "my_player": _actor(g, request.user)})

class MyGames(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        qs = Game.objects.filter(player1=request.user) | Game.objects.filter(player2=request.user)
        qs = qs.order_by('-created_at')[:50]
        items=[]
        for g in qs:
            opp = g.player2 if g.player1_id==request.user.id else g.player1
            opp_login = getattr(getattr(opp,'profile',None),'login', opp.username) if opp else '—'
            result = "В процессе"
            if g.status=="FINISHED":
                if g.winner_id==request.user.id: result="Победа"
                elif g.winner_id: result="Поражение"
                else: result="Ничья"
            items.append({"id":str(g.id),"code":g.code,"opponent":opp_login,"status":g.status,"result":result,"created_at":g.created_at.strftime("%d.%m.%Y %H:%M")})
        return Response({"items": items})

class UpdateStats(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        return Response({"ok": True})

class GameTimers(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        now=timezone.now(); me=_actor(g,request.user)
        pauses_info={"short_available": not (g.short_pause_p1 if me==1 else g.short_pause_p2), "long_available": not (g.long_pause_p1 if me==1 else g.long_pause_p2)}
        if g.status=="FINISHED":
            winner_player = 1 if (g.winner_id==g.player1_id) else (2 if g.winner_id else None)
            return Response({"turn": g.turn, "finished": True, "winner_player": winner_player, "reason": g.win_reason, **pauses_info})
        if g.status=="PAUSED" and g.pause_until:
            if now>=g.pause_until:
                g.status=f"TURN_P{g.turn}"; g.pause_until=None; g.turn_deadline_at = now + timezone.timedelta(seconds=30); g.save()
            else:
                pause_left=int((g.pause_until-now).total_seconds())
                return Response({"turn": g.turn, "paused": True, "pause_left": pause_left, "pause_initiator": g.pause_initiator, **pauses_info})
        if g.status not in ("TURN_P1","TURN_P2"):
            winner_player = 1 if (g.winner_id==g.player1_id) else (2 if g.winner_id else None)
            return Response({"turn": g.turn, "finished": g.status=="FINISHED", "winner_player": winner_player, "reason": g.win_reason, **pauses_info})
        turn_left=0
        if g.turn_deadline_at:
            turn_left=max(0,int((g.turn_deadline_at-now).total_seconds()))
            if turn_left==0:
                bank_attr="bank_ms_p1" if g.turn==1 else "bank_ms_p2"; bank=getattr(g,bank_attr)
                overflow=max(0,(now-g.turn_deadline_at).total_seconds()); bank=max(0, bank - int(overflow*1000)); setattr(g,bank_attr,bank)
                if bank<=0:
                    g.status="FINISHED"; g.winner_id = g.player2_id if g.turn==1 else g.player1_id; g.win_reason="time"; g.turn_deadline_at=None; g.save()
                    st=_ensure_state(g); st.data["phase"]="FINISHED"; st.data["winner"] = 2 if g.turn==1 else 1; st.data["win_reason"]="time"; st.save()
                    winner=g.player2 if g.turn==1 else g.player1; loser=g.player1 if g.turn==1 else g.player2
                    winner.profile.wins+=1; winner.profile.rating_elo+=100; winner.profile.save()
                    loser.profile.losses+=1; loser.profile.rating_elo=max(0,loser.profile.rating_elo-100); loser.profile.save()
                    return Response({"turn": g.turn, "finished": True, "winner_player": 2 if g.turn==1 else 1, "reason":"time", **pauses_info})
        bank_attr="bank_ms_p1" if g.turn==1 else "bank_ms_p2"; bank=getattr(g,bank_attr)
        return Response({"turn": g.turn, "turn_left": turn_left, "bank_left": bank//1000, **pauses_info})

class CancelPauseAPI(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        me=_actor(g,request.user)
        if g.status!="PAUSED": return Response({"error":"game not paused"}, status=400)
        if g.pause_initiator!=me: return Response({"error":"only pause initiator can cancel it"}, status=400)
        g.status=f"TURN_P{g.turn}"; g.pause_until=None; g.turn_deadline_at = timezone.now()+timezone.timedelta(seconds=30); g.save()
        Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="cancel_pause", payload={})
        return Response({"ok": True})

class KilledPieces(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        me=_actor(g,request.user); opponent=3-me
        killed = KilledCounter.objects.filter(game=g, owner=opponent)
        items=[{"piece":k.piece,"killed":k.killed} for k in killed]
        return Response({"items": items})