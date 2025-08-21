from django.urls import path
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from game.consumers.game_consumer import GameConsumer
from matchmaking.consumers.lobby_consumer import LobbyConsumer

websocket_urlpatterns = [
    path("ws/game/<uuid:game_id>/", GameConsumer.as_asgi()),
    path("ws/lobby/", LobbyConsumer.as_asgi()),
]

application = ProtocolTypeRouter({
    "websocket": AuthMiddlewareStack(
        URLRouter(websocket_urlpatterns)
    ),
})