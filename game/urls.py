from django.urls import path
from .views import room
from .api.views import (
    GetState, GameByCode, MyGames, KilledPieces
)

urlpatterns = [
    path("state/<uuid:game_id>/", GetState.as_view(), name="game_state"),
    path("by-code/<str:code>/", GameByCode.as_view(), name="game_by_code"),
    path("my/", MyGames.as_view(), name="my_games"),
    path("r/<str:code>/", room, name="room"),
    path("killed/<uuid:game_id>/", KilledPieces.as_view(), name="killed_pieces"),
]