from django.contrib import admin
from .models import Game, GameState, Move, KilledCounter

@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display=("code","status","player1","player2","turn","created_at")
    search_fields=("code",)

@admin.register(GameState)
class GameStateAdmin(admin.ModelAdmin):
    list_display=("game",)

@admin.register(Move)
class MoveAdmin(admin.ModelAdmin):
    list_display=("game","number","actor","type","created_at")
    list_filter=("type",)

@admin.register(KilledCounter)
class KilledCounterAdmin(admin.ModelAdmin):
    list_display=("game","owner","piece","killed")