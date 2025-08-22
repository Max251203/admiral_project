from django.core.asgi import get_asgi_application
from django.urls import path
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from game.consumers.game_consumer import GameConsumer
from matchmaking.consumers.lobby_consumer import LobbyConsumer

django_asgi_app = get_asgi_application()

websocket_urlpatterns = [
    path("ws/game/<uuid:game_id>/", GameConsumer.as_asgi()),
    path("ws/lobby/", LobbyConsumer.as_asgi()),
]

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AuthMiddlewareStack(
        URLRouter(websocket_urlpatterns)
    ),
})