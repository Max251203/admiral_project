from django.urls import path
from .views import room
from .api.views import (
    GetState, SetupAPI, SubmitSetup, AutoSetup,
    MoveAPI, TorpedoAPI, AirAPI, BombAPI, ResignAPI,
    GameByCode, MyGames
    # Убрали PauseAPI
)

urlpatterns = [
    path("state/<uuid:game_id>/", GetState.as_view(), name="game_state"),
    path("setup/<uuid:game_id>/", SetupAPI.as_view(), name="game_setup"),
    path("submit_setup/<uuid:game_id>/", SubmitSetup.as_view(), name="submit_setup"),
    path("autosetup/<uuid:game_id>/", AutoSetup.as_view(), name="auto_setup"),
    path("move/<uuid:game_id>/", MoveAPI.as_view(), name="game_move"),
    path("torpedo/<uuid:game_id>/", TorpedoAPI.as_view(), name="game_torpedo"),
    path("air/<uuid:game_id>/", AirAPI.as_view(), name="game_air"),
    path("bomb/<uuid:game_id>/", BombAPI.as_view(), name="game_bomb"),
    path("resign/<uuid:game_id>/", ResignAPI.as_view(), name="game_resign"),
    # Убрали path("pause/<uuid:game_id>/", PauseAPI.as_view(), name="game_pause"),
    path("by-code/<str:code>/", GameByCode.as_view(), name="game_by_code"),
    path("my/", MyGames.as_view(), name="my_games"),
    path("r/<str:code>/", room, name="room"),
]