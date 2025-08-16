from django.urls import path
from .views import room  # не используется в SPA, но оставим совместимость
from .api.views import (
    GetState, SetupAPI, SubmitSetup, AutoSetup,
    MoveAPI, TorpedoAPI, AirAPI, BombAPI, ResignAPI,
    GameByCode, MyGames
)

urlpatterns = [
    path("state/<uuid:game_id>/", GetState.as_view()),
    path("setup/<uuid:game_id>/", SetupAPI.as_view()),
    path("submit_setup/<uuid:game_id>/", SubmitSetup.as_view()),
    path("autosetup/<uuid:game_id>/", AutoSetup.as_view()),
    path("move/<uuid:game_id>/", MoveAPI.as_view()),
    path("torpedo/<uuid:game_id>/", TorpedoAPI.as_view()),
    path("air/<uuid:game_id>/", AirAPI.as_view()),
    path("bomb/<uuid:game_id>/", BombAPI.as_view()),
    path("resign/<uuid:game_id>/", ResignAPI.as_view()),
    path("by-code/<str:code>/", GameByCode.as_view()),
    path("my/", MyGames.as_view()),
    path("r/<str:code>/", room, name="room"),
]