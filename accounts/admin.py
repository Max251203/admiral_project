from django.contrib import admin
from .models import Profile, Friendship

@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display=("id","user","login","rating_elo","wins","losses")
    search_fields=("login","user__username")

@admin.register(Friendship)
class FriendshipAdmin(admin.ModelAdmin):
    list_display=("id","from_user","to_user","status","created_at")
    list_filter=("status",)