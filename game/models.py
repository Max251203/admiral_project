import uuid
from django.db import models
from django.contrib.auth.models import User

class Game(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=8, unique=True)
    
    player1 = models.ForeignKey(User, on_delete=models.CASCADE, related_name="games_p1")
    player2 = models.ForeignKey(User, on_delete=models.CASCADE, related_name="games_p2", null=True, blank=True)
    
    status = models.CharField(max_length=16, default="SETUP")
    turn = models.IntegerField(default=1)
    
    # ИСПРАВЛЕНО: Индивидуальные таймеры для каждого игрока
    bank_ms_p1 = models.IntegerField(default=15*60*1000)  # 15 минут в миллисекундах
    bank_ms_p2 = models.IntegerField(default=15*60*1000)  # 15 минут в миллисекундах
    
    # Таймеры хода для каждого игрока
    turn_start_time_p1 = models.FloatField(null=True, blank=True)  # Unix timestamp начала хода игрока 1
    turn_start_time_p2 = models.FloatField(null=True, blank=True)  # Unix timestamp начала хода игрока 2
    last_bank_update_p1 = models.FloatField(null=True, blank=True)  # Последнее обновление банка игрока 1
    last_bank_update_p2 = models.FloatField(null=True, blank=True)  # Последнее обновление банка игрока 2
    
    setup_deadline_at = models.DateTimeField(null=True, blank=True)
    turn_deadline_at = models.DateTimeField(null=True, blank=True)
    turn_start_time = models.FloatField(null=True, blank=True)  # Общий таймер (оставляем для совместимости)
    last_bank_update = models.FloatField(null=True, blank=True)  # Общий банк (оставляем для совместимости)
    
    ready_p1 = models.BooleanField(default=False)
    ready_p2 = models.BooleanField(default=False)
    ready_at_p1 = models.DateTimeField(null=True, blank=True)
    ready_at_p2 = models.DateTimeField(null=True, blank=True)
    
    winner = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="won_games")
    win_reason = models.CharField(max_length=20, blank=True, default="")
    
    short_pause_p1 = models.BooleanField(default=False)
    long_pause_p1 = models.BooleanField(default=False)
    short_pause_p2 = models.BooleanField(default=False)
    long_pause_p2 = models.BooleanField(default=False)
    pause_until = models.DateTimeField(null=True, blank=True)
    pause_initiator = models.IntegerField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return self.code

class GameState(models.Model):
    game = models.OneToOneField(Game, on_delete=models.CASCADE, related_name="state")
    data = models.JSONField(default=dict)

class Move(models.Model):
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="moves")
    number = models.IntegerField()
    actor = models.IntegerField()
    type = models.CharField(max_length=16)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['number']

class KilledCounter(models.Model):
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="kills")
    owner = models.IntegerField()
    piece = models.CharField(max_length=8)
    killed = models.IntegerField(default=0)
    
    class Meta:
        unique_together = ['game', 'owner', 'piece']