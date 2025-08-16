import asyncio
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone
from asgiref.sync import sync_to_async
from ..models import Game, GameState

class GameConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.game_id = self.scope["url_route"]["kwargs"]["game_id"]
        self.room = f"game_{self.game_id}"
        await self.channel_layer.group_add(self.room, self.channel_name)
        await self.accept()
        await self.send_state()
        self._running=True
        asyncio.create_task(self._ticker())

    async def disconnect(self, code):
        self._running=False
        await self.channel_layer.group_discard(self.room, self.channel_name)

    async def receive_json(self, content, **kwargs):
        await self.channel_layer.group_send(self.room, {"type":"broadcast","payload":content})

    async def broadcast(self, event):
        await self.send_json(event["payload"])

    async def send_state(self):
        st = await self._get_state()
        await self.send_json({"type":"state","state":st})

    @sync_to_async
    def _get_state(self):
        g = Game.objects.get(id=self.game_id)
        st = GameState.objects.get(game=g)
        return st.data

    @sync_to_async
    def _tick_db(self):
        g = Game.objects.select_for_update().get(id=self.game_id)
        now = timezone.now()
        if g.pause_until and now < g.pause_until:
            return {"paused": True, "until": g.pause_until.isoformat(), "turn": g.turn}
        if g.status not in ("TURN_P1","TURN_P2"):
            return {"paused": False, "turn": g.turn, "finished": g.status=="FINISHED"}

        if not g.last_tick_at: g.last_tick_at = now
        overflow = (now - g.turn_deadline_at).total_seconds() if g.turn_deadline_at else 0
        delta = (now - g.last_tick_at).total_seconds()
        bank_attr = "bank_ms_p1" if g.turn==1 else "bank_ms_p2"
        bank = getattr(g, bank_attr)

        if overflow > 0:
            bank = max(0, bank - int(delta*1000))
            setattr(g, bank_attr, bank)

        if bank <= 0:
            g.status="FINISHED"; g.winner = g.player2 if g.turn==1 else g.player1; g.win_reason="time"; g.turn_deadline_at=None

        g.last_tick_at = now; g.save()
        turn_left = int(max(0,(g.turn_deadline_at - now).total_seconds()) if g.turn_deadline_at else 0)
        return {"paused":False,"turn":g.turn,"turn_left":turn_left,"bank_left":bank//1000,"finished":g.status=="FINISHED","winner":g.winner_id if g.winner_id else None,"reason":g.win_reason}

    async def _ticker(self):
        while self._running:
            data = await self._tick_db()
            await self.channel_layer.group_send(self.room, {"type":"broadcast","payload":{"type":"tick", **data}})
            await asyncio.sleep(1)