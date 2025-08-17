import asyncio
import json
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone
from asgiref.sync import sync_to_async
from ..models import Game, GameState

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
                    g.turn_deadline_at = now + timezone.timedelta(seconds=30)
                    g.save()
                else:
                    # Пауза еще активна
                    pause_left = int((g.pause_until - now).total_seconds())
                    return {
                        "turn": g.turn,
                        "paused": True,
                        "pause_left": pause_left
                    }
            
            # Если игра не активна, не тикаем
            if g.status not in ("TURN_P1", "TURN_P2"):
                return {
                    "turn": g.turn, 
                    "finished": g.status == "FINISHED",
                    "winner": g.winner_id if g.winner_id else None,
                    "reason": g.win_reason
                }
            
            # Инициализируем last_tick_at если нужно
            if not g.last_tick_at:
                g.last_tick_at = now
            
            # Вычисляем превышение времени хода
            overflow = 0
            if g.turn_deadline_at:
                overflow = max(0, (now - g.turn_deadline_at).total_seconds())
            
            # Вычисляем время с последнего тика
            delta = (now - g.last_tick_at).total_seconds()
            
            # Определяем банк времени текущего игрока
            bank_attr = "bank_ms_p1" if g.turn == 1 else "bank_ms_p2"
            bank = getattr(g, bank_attr)
            
            # Если есть превышение, списываем из банка
            if overflow > 0:
                bank = max(0, bank - int(delta * 1000))
                setattr(g, bank_attr, bank)
            
            # Проверяем окончание времени
            if bank <= 0:
                g.status = "FINISHED"
                g.winner = g.player2 if g.turn == 1 else g.player1
                g.win_reason = "time"
                g.turn_deadline_at = None
                
                # Обновляем статистику игроков
                winner = g.player2 if g.turn == 1 else g.player1
                loser = g.player1 if g.turn == 1 else g.player2
                
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
                    st.data["winner"] = 2 if g.turn == 1 else 1
                    st.data["win_reason"] = "time"
                    st.save()
                except GameState.DoesNotExist:
                    pass
            
            g.last_tick_at = now
            g.save()
            
            # Вычисляем оставшееся время хода
            turn_left = 0
            if g.turn_deadline_at:
                turn_left = max(0, int((g.turn_deadline_at - now).total_seconds()))
            
            return {
                "turn": g.turn,
                "turn_left": turn_left,
                "bank_left": bank // 1000,
                "finished": g.status == "FINISHED",
                "winner": g.winner_id if g.winner_id else None,
                "reason": g.win_reason
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