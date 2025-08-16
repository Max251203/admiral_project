import secrets, datetime as dt, random
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from ..models import Game, GameState, Move
from ..engine.board import Engine

def _ensure_state(game:Game)->GameState:
    st,_=GameState.objects.get_or_create(game=game, defaults={"data":{}})
    if not st.data:
        st.data={"turn":1,"phase":"SETUP","board":{}}; st.save()
    return st

def _actor(game,user)->int: return 1 if game.player1_id==user.id else 2

class GetState(APIView):
    permission_classes=[IsAuthenticated]
    def get(self, request, game_id):
        g=get_object_or_404(Game,id=game_id); st=_ensure_state(g)
        return Response({"game":str(g.id),"state":st.data,"status":g.status,"turn":g.turn})

class SetupAPI(APIView):
    permission_classes=[IsAuthenticated]
    def post(self, request, game_id):
        g=get_object_or_404(Game, id=game_id); st=_ensure_state(g); eng=Engine(st.data); me=_actor(g, request.user)
        for it in request.data.get("placements", []):
            eng.place(me,(int(it["x"]),int(it["y"])),it["kind"])
        st.data=eng.to_json(); st.save()
        Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="setup", payload={"count":len(request.data.get("placements",[]))})
        return Response({"ok":True,"state":st.data})

class SubmitSetup(APIView):
    permission_classes=[IsAuthenticated]
    def post(self, request, game_id):
        g=get_object_or_404(Game, id=game_id); st=_ensure_state(g); now=timezone.now(); me=_actor(g, request.user)
        if me==1 and not g.ready_p1: g.ready_p1=True; g.ready_at_p1=now
        elif me==2 and not g.ready_p2: g.ready_p2=True; g.ready_at_p2=now
        g.save()
        if g.ready_p1 and g.ready_p2 and g.status=="SETUP":
            if g.ready_at_p1<=g.ready_at_p2: g.status="TURN_P1"; g.turn=1
            else: g.status="TURN_P2"; g.turn=2
            st.data["phase"]=g.status; g.save(); st.save()
        return Response({"ok":True,"status":g.status,"turn":g.turn})

class AutoSetup(APIView):
    permission_classes=[IsAuthenticated]
    def post(self, request, game_id):
        g=get_object_or_404(Game, id=game_id); st=_ensure_state(g); eng=Engine(st.data); me=_actor(g, request.user)
        rows = list(range(10,15)) if me==1 else list(range(0,5))
        cols = list(range(0,14))
        cells=[(x,y) for y in rows for x in cols]; random.shuffle(cells)
        pieces = {"BDK":2,"KR":6,"A":1,"S":1,"TN":1,"L":2,"ES":6,"M":6,"SM":1,"F":6,"TK":6,"T":6,"TR":6,"ST":6,"PL":1,"KRPL":1,"AB":1,"VMB":2}
        placed=0
        for kind,count in pieces.items():
            for _ in range(count):
                if not cells: break
                x,y=cells.pop(); eng.place(me,(x,y),kind); placed+=1
        st.data=eng.to_json(); st.save()
        Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="setup", payload={"auto":True,"count":placed})
        return Response({"ok":True,"state":st.data,"placed":placed})

class MoveAPI(APIView):
    permission_classes=[IsAuthenticated]
    def post(self, request, game_id):
        g=get_object_or_404(Game, id=game_id); st=_ensure_state(g); eng=Engine(st.data); me=_actor(g, request.user)
        res=eng.move(me, tuple(request.data["src"]), tuple(request.data["dst"]), followers=request.data.get("followers",[]))
        st.data=eng.to_json(); st.save()
        Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="move", payload=request.data|res)
        return Response({"ok":True,"res":res,"state":st.data})

class TorpedoAPI(APIView):
    permission_classes=[IsAuthenticated]
    def post(self, request, game_id):
        g=get_object_or_404(Game,id=game_id); st=_ensure_state(g); eng=Engine(st.data); me=_actor(g, request.user)
        res=eng.torpedo(me, tuple(request.data["t"]), tuple(request.data["tk"]), tuple(request.data["dir"]))
        st.data=eng.to_json(); st.save()
        Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="torpedo", payload=request.data|res)
        return Response({"ok":True,"res":res,"state":st.data})

class AirAPI(APIView):
    permission_classes=[IsAuthenticated]
    def post(self, request, game_id):
        g=get_object_or_404(Game,id=game_id); st=_ensure_state(g); eng=Engine(st.data); me=_actor(g, request.user)
        res=eng.airstrike(me, tuple(request.data["a"]), tuple(request.data["s"]))
        st.data=eng.to_json(); st.save()
        Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="air", payload=request.data|res)
        return Response({"ok":True,"res":res,"state":st.data})

class BombAPI(APIView):
    permission_classes=[IsAuthenticated]
    def post(self, request, game_id):
        g=get_object_or_404(Game,id=game_id); st=_ensure_state(g); eng=Engine(st.data); me=_actor(g, request.user)
        res=eng.bomb(me, tuple(request.data["ab"]))
        st.data=eng.to_json(); st.save()
        Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="bomb", payload=request.data|res)
        return Response({"ok":True,"res":res,"state":st.data})

class ResignAPI(APIView):
    permission_classes=[IsAuthenticated]
    def post(self, request, game_id):
        g=get_object_or_404(Game, id=game_id); st=_ensure_state(g); eng=Engine(st.data); me=_actor(g, request.user)
        eng.gd.winner=2 if me==1 else 1; eng.gd.win_reason="resign"; eng.gd.phase="FINISHED"
        st.data=eng.to_json(); st.save()
        Move.objects.create(game=g, number=g.moves.count()+1, actor=me, type="resign", payload={})
        return Response({"ok":True,"state":st.data})