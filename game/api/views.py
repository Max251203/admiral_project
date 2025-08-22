from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from ..models import Game, GameState, KilledCounter
from ..engine.board import Engine

class GetState(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request, game_id):
        try:
            g = get_object_or_404(Game, id=game_id)
            if g.player1_id != request.user.id and g.player2_id != request.user.id:
                return Response({"error": "not your game"}, status=403)
            
            st, _ = GameState.objects.get_or_create(game=g, defaults={"data": {}})
            if not st.data:
                st.data = {"turn": 1, "phase": "SETUP", "board": {}, "setup_counts": {1: {}, 2: {}}}
                st.save()
            
            eng = Engine(st.data)
            my_player = 1 if g.player1_id == request.user.id else 2
            
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

class GameByCode(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request, code):
        try:
            g = get_object_or_404(Game, code=code)
            if g.player1_id != request.user.id and g.player2_id != request.user.id:
                return Response({"error": "not your game"}, status=403)
            
            st, _ = GameState.objects.get_or_create(game=g, defaults={"data": {}})
            if not st.data:
                st.data = {"turn": 1, "phase": "SETUP", "board": {}, "setup_counts": {1: {}, 2: {}}}
                st.save()
            
            eng = Engine(st.data)
            me = 1 if g.player1_id == request.user.id else 2
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
            from django.db.models import Q
            qs = Game.objects.filter(Q(player1=request.user) | Q(player2=request.user))
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
            
            me = 1 if g.player1_id == request.user.id else 2
            opponent = 3 - me
            killed = KilledCounter.objects.filter(game=g, owner=opponent)
            items = [{"piece": k.piece, "killed": k.killed} for k in killed]
            
            return Response({"items": items})
        except Exception as e:
            return Response({"error": str(e)}, status=500)