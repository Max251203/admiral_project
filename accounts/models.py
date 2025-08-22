from django.db import models
from django.contrib.auth.models import User

def avatar_upload_to(instance, filename):
    return f"avatars/{instance.user_id}/{filename}"

class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    login = models.CharField(max_length=32, unique=True)
    avatar = models.ImageField(upload_to=avatar_upload_to, blank=True, null=True)
    bio = models.CharField(max_length=240, blank=True, default="")
    rating_elo = models.IntegerField(default=1000)
    wins = models.IntegerField(default=0)
    losses = models.IntegerField(default=0)
    
    def __str__(self): 
        return self.login or self.user.username
    
    def get_avatar_url(self):
        if self.avatar:
            return self.avatar.url
        return '/static/img/default-avatar.png'

class Friendship(models.Model):
    PENDING = "pending"
    ACCEPTED = "accepted" 
    STATUSES = ((PENDING,"pending"),(ACCEPTED,"accepted"))
    
    from_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="friendship_sent")
    to_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="friendship_received")
    status = models.CharField(max_length=16, choices=STATUSES, default=PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ("from_user","to_user")