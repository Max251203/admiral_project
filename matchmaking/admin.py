from django.contrib import admin
from .models import MatchTicket, FriendInvite, Notification


@admin.register(MatchTicket)
class MatchTicketAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "active", "assigned_game", "created_at")


@admin.register(FriendInvite)
class FriendInviteAdmin(admin.ModelAdmin):
    list_display = ("id", "inviter", "invitee", "status", "created_at", "game")
    list_filter = ("status",)


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("id", "to_user", "type", "read", "created_at")
    list_filter = ("type", "read")