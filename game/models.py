import uuid
from django.db import models
from django.contrib.auth.models import User

class Game(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=8, unique=True)

    player1 = models.ForeignKey(User, on_delete=models.CASCADE, related_name="games_p1")
    player2 = models.ForeignKey(User, on_delete=models.CASCADE, related_name="games_p2", null=True, blank=True)

    status = models.CharField(max_length=16, default="SETUP")  # SETUP/TURN_P1/TURN_P2/PAUSED/FINISHED
    turn = models.IntegerField(default=1)

    bank_ms_p1 = models.IntegerField(default=15*60*1000)
    bank_ms_p2 = models.IntegerField(default=15*60*1000)
    

    setup_deadline_at = models.DateTimeField(null=True, blank=True)
    turn_deadline_at = models.DateTimeField(null=True, blank=True)
    last_tick_at = models.DateTimeField(null=True, blank=True)

    ready_p1 = models.BooleanField(default=False)
    ready_p2 = models.BooleanField(default=False)
    ready_at_p1 = models.DateTimeField(null=True, blank=True)
    ready_at_p2 = models.DateTimeField(null=True, blank=True)

    winner = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="wins_as_user")
    win_reason = models.CharField(max_length=20, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self): return self.code

class GameState(models.Model):
    game = models.OneToOneField(Game, on_delete=models.CASCADE, related_name="state")
    data = models.JSONField(default=dict)

class Move(models.Model):
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="moves")
    number = models.IntegerField()
    actor = models.IntegerField()  # 1/2
    type = models.CharField(max_length=16)  # move/torpedo/air/bomb/pause/resign/setup
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

class KilledCounter(models.Model):
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="kills")
    owner = models.IntegerField()
    piece = models.CharField(max_length=8)
    killed = models.IntegerField(default=0)