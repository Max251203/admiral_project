import json
from channels.generic.websocket import AsyncWebsocketConsumer

lobby_connections = {}

class LobbyConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope.get("user")
        if not self.user or not self.user.is_authenticated:
            await self.close()
            return
        
        lobby_connections[self.user.id] = self
        await self.accept()

    async def disconnect(self, close_code):
        lobby_connections.pop(self.user.id, None)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            message_type = data.get('type')
            
            if message_type == 'ping':
                await self.send(text_data=json.dumps({'type': 'pong'}))
                
        except json.JSONDecodeError:
            pass

async def notify_user(user_id, message):
    if user_id in lobby_connections:
        try:
            await lobby_connections[user_id].send(text_data=json.dumps(message))
        except:
            lobby_connections.pop(user_id, None)