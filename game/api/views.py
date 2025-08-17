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

class GetState(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        return Response({
            "game": str(g.id), 
            "state": st.data, 
            "status": g.status, 
            "turn": g.turn,
            "my_player": _actor(g, request.user)
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
            for it in request.data.get("placements", []):
                eng.place(me, (int(it["x"]), int(it["y"])), it["kind"])
            
            st.data = eng.to_json()
            st.save()
            
            Move.objects.create(
                game=g, 
                number=g.moves.count() + 1, 
                actor=me, 
                type="setup", 
                payload={"count": len(request.data.get("placements", []))}
            )
            
            return Response({"ok": True, "state": st.data})
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

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
            if g.ready_at_p1 <= g.ready_at_p2:
                g.status = "TURN_P1"
                g.turn = 1
            else:
                g.status = "TURN_P2"
                g.turn = 2
            
            # Устанавливаем дедлайн первого хода
            g.turn_deadline_at = now + timezone.timedelta(seconds=30)
            st.data["phase"] = g.status
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
        
        # Определяем зону расстановки
        rows = list(range(10, 15)) if me == 1 else list(range(0, 5))
        cols = list(range(0, 14))
        cells = [(x, y) for y in rows for x in cols]
        random.shuffle(cells)
        
        # Список всех фишек
        pieces = {
            "BDK": 2, "KR": 6, "A": 1, "S": 1, "TN": 1, "L": 2, "ES": 6,
            "M": 6, "SM": 1, "F": 6, "TK": 6, "T": 6, "TR": 6, "ST": 6,
            "PL": 1, "KRPL": 1, "AB": 1, "VMB": 2
        }
        
        placed = 0
        try:
            for kind, count in pieces.items():
                for _ in range(count):
                    if not cells:
                        break
                    x, y = cells.pop()
                    eng.place(me, (x, y), kind)
                    placed += 1
            
            st.data = eng.to_json()
            st.save()
            
            Move.objects.create(
                game=g, 
                number=g.moves.count() + 1, 
                actor=me, 
                type="setup", 
                payload={"auto": True, "count": placed}
            )
            
            return Response({"ok": True, "state": st.data, "placed": placed})
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
            res = eng.move(
                me, 
                tuple(request.data["src"]), 
                tuple(request.data["dst"]), 
                followers=request.data.get("followers", [])
            )
            
            st.data = eng.to_json()
            st.save()
            
            # Обновляем дедлайн следующего хода
            if not res.get("extra_turn", False):
                g.turn_deadline_at = timezone.now() + timezone.timedelta(seconds=30)
                g.save()
            
            # Обновляем счетчик убитых фишек
            if "captures" in res and res["captures"]:
                for kind in res["captures"]:
                    KilledCounter.objects.update_or_create(
                        game=g, owner=3-me, piece=kind,
                        defaults={"killed": models.F("killed") + 1}
                    )
            
            Move.objects.create(
                game=g, 
                number=g.moves.count() + 1, 
                actor=me, 
                type="move", 
                payload={**request.data, **res}
            )
            
            # Проверяем окончание игры
            if st.data.get("winner"):
                g.status = "FINISHED"
                g.winner_id = g.player1_id if st.data["winner"] == 1 else g.player2_id
                g.win_reason = st.data.get("win_reason", "")
                g.save()
                
                # Обновляем статистику игроков
                if g.winner_id:
                    winner = g.player1 if g.winner_id == g.player1_id else g.player2
                    loser = g.player2 if g.winner_id == g.player1_id else g.player1
                    
                    winner.profile.wins += 1
                    winner.profile.rating_elo += 100
                    winner.profile.save()
                    
                    loser.profile.losses += 1
                    loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
                    loser.profile.save()
            
            return Response({"ok": True, "res": res, "state": st.data})
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
            res = eng.torpedo(
                me, 
                tuple(request.data["t"]), 
                tuple(request.data["tk"]), 
                tuple(request.data["dir"])
            )
            
            st.data = eng.to_json()
            st.save()
            
            g.turn_deadline_at = timezone.now() + timezone.timedelta(seconds=30)
            g.save()
            
            # Обновляем счетчик убитых фишек
            if "captures" in res and res["captures"]:
                for kind in res["captures"]:
                    KilledCounter.objects.update_or_create(
                        game=g, owner=3-me, piece=kind,
                        defaults={"killed": models.F("killed") + 1}
                    )
            
            Move.objects.create(
                game=g, 
                number=g.moves.count() + 1, 
                actor=me, 
                type="torpedo", 
                payload={**request.data, **res}
            )
            
            # Проверяем окончание игры
            if st.data.get("winner"):
                g.status = "FINISHED"
                g.winner_id = g.player1_id if st.data["winner"] == 1 else g.player2_id
                g.win_reason = st.data.get("win_reason", "")
                g.save()
                
                # Обновляем статистику игроков
                if g.winner_id:
                    winner = g.player1 if g.winner_id == g.player1_id else g.player2
                    loser = g.player2 if g.winner_id == g.player1_id else g.player1
                    
                    winner.profile.wins += 1
                    winner.profile.rating_elo += 100
                    winner.profile.save()
                    
                    loser.profile.losses += 1
                    loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
                    loser.profile.save()
            
            return Response({"ok": True, "res": res, "state": st.data})
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
            res = eng.airstrike(
                me, 
                tuple(request.data["a"]), 
                tuple(request.data["s"])
            )
            
            st.data = eng.to_json()
            st.save()
            
            g.turn_deadline_at = timezone.now() + timezone.timedelta(seconds=30)
            g.save()
            
            # Обновляем счетчик убитых фишек
            if "captures" in res and res["captures"]:
                for kind in res["captures"]:
                    KilledCounter.objects.update_or_create(
                        game=g, owner=3-me, piece=kind,
                        defaults={"killed": models.F("killed") + 1}
                    )
            
            Move.objects.create(
                game=g, 
                number=g.moves.count() + 1, 
                actor=me, 
                type="air", 
                payload={**request.data, **res}
            )
            
            # Проверяем окончание игры
            if st.data.get("winner"):
                g.status = "FINISHED"
                g.winner_id = g.player1_id if st.data["winner"] == 1 else g.player2_id
                g.win_reason = st.data.get("win_reason", "")
                g.save()
                
                # Обновляем статистику игроков
                if g.winner_id:
                    winner = g.player1 if g.winner_id == g.player1_id else g.player2
                    loser = g.player2 if g.winner_id == g.player1_id else g.player1
                    
                    winner.profile.wins += 1
                    winner.profile.rating_elo += 100
                    winner.profile.save()
                    
                    loser.profile.losses += 1
                    loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
                    loser.profile.save()
            
            return Response({"ok": True, "res": res, "state": st.data})
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
            res = eng.bomb(me, tuple(request.data["ab"]))
            
            st.data = eng.to_json()
            st.save()
            
            g.turn_deadline_at = timezone.now() + timezone.timedelta(seconds=30)
            g.save()
            
            # Обновляем счетчик убитых фишек
            if "captures" in res and res["captures"]:
                for kind in res["captures"]:
                    KilledCounter.objects.update_or_create(
                        game=g, owner=3-me, piece=kind,
                        defaults={"killed": models.F("killed") + 1}
                    )
            
            Move.objects.create(
                game=g, 
                number=g.moves.count() + 1, 
                actor=me, 
                type="bomb", 
                payload={**request.data, **res}
            )
            
            # Проверяем окончание игры
            if st.data.get("winner"):
                g.status = "FINISHED"
                g.winner_id = g.player1_id if st.data["winner"] == 1 else g.player2_id
                g.win_reason = st.data.get("win_reason", "")
                g.save()
                
                # Обновляем статистику игроков
                if g.winner_id:
                    winner = g.player1 if g.winner_id == g.player1_id else g.player2
                    loser = g.player2 if g.winner_id == g.player1_id else g.player1
                    
                    winner.profile.wins += 1
                    winner.profile.rating_elo += 100
                    winner.profile.save()
                    
                    loser.profile.losses += 1
                    loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
                    loser.profile.save()
            
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
        
        # Проверяем, чей сейчас ход
        if g.turn != me:
            return Response({"error": "not your turn"}, status=400)
        
        # Проверяем тип паузы
        pause_type = request.data.get("type", "")
        if pause_type not in ["short", "long"]:
            return Response({"error": "invalid pause type"}, status=400)
        
        # Проверяем, использовал ли игрок уже паузы
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
        
        # Устанавливаем паузу
        now = timezone.now()
        pause_duration = 60 if pause_type == "short" else 180  # 1 или 3 минуты
        
        g.status = "PAUSED"
        g.pause_until = now + timezone.timedelta(seconds=pause_duration)
        
        # Отмечаем использованную паузу
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
        
        # Создаем запись о паузе
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
        
        eng.gd.winner = 2 if me == 1 else 1
        eng.gd.win_reason = "resign"
        eng.gd.phase = "FINISHED"
        
        g.status = "FINISHED"
        g.winner_id = g.player2_id if me == 1 else g.player1_id
        g.win_reason = "resign"
        g.turn_deadline_at = None
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
        
        # Обновляем статистику игроков
        winner = g.player2 if me == 1 else g.player1
        loser = request.user
        
        winner.profile.wins += 1
        winner.profile.rating_elo += 100
        winner.profile.save()
        
        loser.profile.losses += 1
        loser.profile.rating_elo = max(0, loser.profile.rating_elo - 100)
        loser.profile.save()
        
        return Response({"ok": True, "state": st.data})

class GameByCode(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, code):
        g = get_object_or_404(Game, code=code)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        st = _ensure_state(g)
        return Response({
            "id": str(g.id), 
            "state": st.data,
            "my_player": _actor(g, request.user)
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
            
            # Определяем результат для текущего пользователя
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

class UpdateStats(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        # Этот метод можно использовать для обновления статистики игрока
        # Но основное обновление происходит при завершении игры
        return Response({"ok": True})
    
class GameTimers(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, game_id):
        g = get_object_or_404(Game, id=game_id)
        if g.player1_id != request.user.id and g.player2_id != request.user.id:
            return Response({"error": "not your game"}, status=403)
        
        now = timezone.now()
        me = _actor(g, request.user)
        
        # Информация о доступных паузах
        pauses_info = {
            "short_available": not (g.short_pause_p1 if me == 1 else g.short_pause_p2),
            "long_available": not (g.long_pause_p1 if me == 1 else g.long_pause_p2),
        }
        
        # Если игра завершена
        if g.status == "FINISHED":
            return Response({
                "turn": g.turn,
                "finished": True,
                "winner": g.winner_id,
                "reason": g.win_reason,
                **pauses_info
            })
        
        # Если игра на паузе
        if g.status == "PAUSED" and g.pause_until:
            if now >= g.pause_until:
                # Пауза закончилась, возвращаемся к игре
                g.status = f"TURN_P{g.turn}"
                g.pause_until = None
                g.turn_deadline_at = now + timezone.timedelta(seconds=30)
                g.save()
            else:
                # Пауза еще активна
                pause_left = int((g.pause_until - now).total_seconds())
                return Response({
                    "turn": g.turn,
                    "paused": True,
                    "pause_left": pause_left,
                    **pauses_info
                })
        
        # Если игра не активна
        if g.status not in ("TURN_P1", "TURN_P2"):
            return Response({
                "turn": g.turn,
                "finished": g.status == "FINISHED",
                "winner": g.winner_id,
                "reason": g.win_reason,
                **pauses_info
            })
        
        # Вычисляем оставшееся время хода
        turn_left = 0
        if g.turn_deadline_at:
            turn_left = max(0, int((g.turn_deadline_at - now).total_seconds()))
            
            # Если время хода истекло, списываем из банка
            if turn_left == 0:
                # Определяем банк времени текущего игрока
                bank_attr = "bank_ms_p1" if g.turn == 1 else "bank_ms_p2"
                bank = getattr(g, bank_attr)
                
                # Вычисляем превышение времени хода
                overflow = max(0, (now - g.turn_deadline_at).total_seconds())
                
                # Списываем из банка
                bank = max(0, bank - int(overflow * 1000))
                setattr(g, bank_attr, bank)
                
                # Проверяем окончание времени
                if bank <= 0:
                    g.status = "FINISHED"
                    g.winner = g.player2 if g.turn == 1 else g.player1
                    g.win_reason = "time"
                    g.turn_deadline_at = None
                    g.save()
                    
                    # Обновляем состояние игры
                    st = _ensure_state(g)
                    st.data["phase"] = "FINISHED"
                    st.data["winner"] = 2 if g.turn == 1 else 1
                    st.data["win_reason"] = "time"
                    st.save()
                    
                    # Обновляем статистику игроков
                    winner = g.player2 if g.turn == 1 else g.player1
                    loser = g.player1 if g.turn == 1 else g.player2
                    
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
                        "reason": "time",
                        **pauses_info
                    })
        
        # Определяем банк времени текущего игрока
        bank_attr = "bank_ms_p1" if g.turn == 1 else "bank_ms_p2"
        bank = getattr(g, bank_attr)
        
        return Response({
            "turn": g.turn,
            "turn_left": turn_left,
            "bank_left": bank // 1000,
            **pauses_info
        })
    
class UpdateStats(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        # Этот метод можно использовать для обновления статистики игрока
        # Но основное обновление происходит при завершении игры
        return Response({"ok": True})
        