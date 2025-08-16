from django.db import models
from django.contrib.auth.models import User

class MatchTicket(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    active = models.BooleanField(default=True)
    assigned_game = models.ForeignKey("game.Game", null=True, blank=True, on_delete=models.SET_NULL)
    matched_at = models.DateTimeField(null=True, blank=True)

class FriendInvite(models.Model):
    PENDING="pending"; ACCEPTED="accepted"; DECLINED="declined"; EXPIRED="expired"
    inviter = models.ForeignKey(User, on_delete=models.CASCADE, related_name="invites_sent")
    invitee = models.ForeignKey(User, on_delete=models.CASCADE, related_name="invites_received")
    token = models.CharField(max_length=40, unique=True)
    status = models.CharField(max_length=10, default=PENDING)
    game = models.ForeignKey("game.Game", null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

class Notification(models.Model):
    to_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="notifications")
    type = models.CharField(max_length=32)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    read = models.BooleanField(default=False)
    class Meta:
        indexes = [models.Index(fields=["to_user","read","-created_at"])]