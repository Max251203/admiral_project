from django.shortcuts import render, get_object_or_404
from django.contrib.auth.decorators import login_required
from .models import Game

@login_required
def room(request, code: str):
    game = get_object_or_404(Game, code=code)
    side = 1 if game.player1_id == request.user.id else 2
    return render(request, "game/room.html", {"game": game, "side": side})