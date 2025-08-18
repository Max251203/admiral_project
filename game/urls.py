from django.urls import path
from .views import room
from .api.views import (
    GetState, SetupAPI, SubmitSetup, AutoSetup, ClearSetup,
    MoveAPI, TorpedoAPI, AirAPI, BombAPI, ResignAPI, PauseAPI,
    GameByCode, MyGames, UpdateStats, GameTimers, CancelPauseAPI, KilledPieces
)

urlpatterns = [
    path("state/<uuid:game_id>/", GetState.as_view(), name="game_state"),
    path("setup/<uuid:game_id>/", SetupAPI.as_view(), name="game_setup"),
    path("clear_setup/<uuid:game_id>/", ClearSetup.as_view(), name="clear_setup"),
    path("submit_setup/<uuid:game_id>/", SubmitSetup.as_view(), name="submit_setup"),
    path("autosetup/<uuid:game_id>/", AutoSetup.as_view(), name="auto_setup"),
    path("move/<uuid:game_id>/", MoveAPI.as_view(), name="game_move"),
    path("torpedo/<uuid:game_id>/", TorpedoAPI.as_view(), name="game_torpedo"),
    path("air/<uuid:game_id>/", AirAPI.as_view(), name="game_air"),
    path("bomb/<uuid:game_id>/", BombAPI.as_view(), name="game_bomb"),
    path("resign/<uuid:game_id>/", ResignAPI.as_view(), name="game_resign"),
    path("pause/<uuid:game_id>/", PauseAPI.as_view(), name="game_pause"),
    path("timers/<uuid:game_id>/", GameTimers.as_view(), name="game_timers"),
    path("by-code/<str:code>/", GameByCode.as_view(), name="game_by_code"),
    path("my/", MyGames.as_view(), name="my_games"),
    path("update_stats/", UpdateStats.as_view(), name="update_stats"),
    path("r/<str:code>/", room, name="room"),
    path("cancel_pause/<uuid:game_id>/", CancelPauseAPI.as_view(), name="cancel_pause"),
    path("killed/<uuid:game_id>/", KilledPieces.as_view(), name="killed_pieces"),
]