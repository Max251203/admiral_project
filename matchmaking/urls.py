from django.urls import path
from django.http import JsonResponse, HttpResponseRedirect
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.db import DatabaseError
from django.contrib.auth.models import User
import secrets

from .models import MatchTicket, FriendInvite, Notification
from .utils import safe_notify
from game.models import Game, GameState

@login_required
def quick(request):
    me = request.user
    other = (MatchTicket.objects.filter(active=True, assigned_game__isnull=True)
             .exclude(user=me).order_by("created_at").first())
    if other:
        code = secrets.token_hex(3)
        g = Game.objects.create(code=code, player1=other.user, player2=me, status="SETUP", turn=1)
        GameState.objects.create(game=g, data={"turn":1,"phase":"SETUP","board":{}})
        other.assigned_game = g
        other.matched_at = timezone.now()
        other.save(update_fields=["assigned_game","matched_at"])
        return JsonResponse({"ok":True, "url":f"/game/r/{g.code}/"})
    t, _ = MatchTicket.objects.update_or_create(user=me, defaults={"active":True,"assigned_game":None})
    return JsonResponse({"queued":True, "ticket": t.id})

@login_required
def status(request):
    me = request.user
    t = MatchTicket.objects.filter(user=me, active=True).order_by("-created_at").first()
    if t and t.assigned_game_id:
        t.active=False; t.save(update_fields=["active"])
        return JsonResponse({"ok":True, "url":f"/game/r/{t.assigned_game.code}/"})
    return JsonResponse({"queued":True})

@login_required
def cancel(request):
    me = request.user
    MatchTicket.objects.filter(user=me, active=True).update(active=False, assigned_game=None)
    return JsonResponse({"ok":True})

@login_required
def invite_ajax(request, user_id:int):
    invitee = get_object_or_404(User, id=user_id)
    token = secrets.token_hex(12)
    FriendInvite.objects.create(inviter=request.user, invitee=invitee, token=token)
    safe_notify(invitee.id, {"type":"friend_invite","from":request.user.profile.login,"token":token})
    return JsonResponse({"ok":True, "token":token})

@login_required
def invite_link(request, user_id:int):
    invitee = get_object_or_404(User, id=user_id)
    token = secrets.token_hex(12)
    FriendInvite.objects.create(inviter=request.user, invitee=invitee, token=token)
    safe_notify(invitee.id, {"type":"friend_invite","from":request.user.profile.login,"token":token})
    return HttpResponseRedirect("/match/invites/")

@login_required
def invites(request):
    pending = FriendInvite.objects.filter(invitee=request.user, status=FriendInvite.PENDING).order_by("-created_at")
    return render(request, "match/invites.html", {"invites": pending})

@login_required
def invite_accept(request, token:str):
    inv = get_object_or_404(FriendInvite, token=token, invitee=request.user, status=FriendInvite.PENDING)
    code = secrets.token_hex(3)
    g = Game.objects.create(code=code, player1=inv.inviter, player2=inv.invitee, status="SETUP", turn=1)
    GameState.objects.create(game=g, data={"turn":1,"phase":"SETUP","board":{}})
    inv.status = FriendInvite.ACCEPTED; inv.game = g; inv.save()
    safe_notify(inv.inviter_id, {"type":"invite_accepted","url":f"/game/r/{g.code}/"})
    return HttpResponseRedirect(f"/game/r/{g.code}/")

@login_required
def invite_decline(request, token:str):
    inv = get_object_or_404(FriendInvite, token=token, invitee=request.user, status=FriendInvite.PENDING)
    inv.status = FriendInvite.DECLINED; inv.save(update_fields=["status"])
    safe_notify(inv.inviter_id, {"type":"invite_declined"})
    return HttpResponseRedirect("/match/invites/")

@login_required
def invite_cancel(request, token:str):
    inv = get_object_or_404(FriendInvite, token=token, inviter=request.user, status=FriendInvite.PENDING)
    inv.status = FriendInvite.EXPIRED; inv.save(update_fields=["status"])
    safe_notify(inv.invitee_id, {"type":"invite_cancelled"})
    return JsonResponse({"ok":True})

@login_required
def notify_poll(request):
    try:
        base_qs = Notification.objects.filter(to_user=request.user, read=False).order_by("created_at")
        ids = list(base_qs.values_list("id", flat=True)[:50])
        if not ids: return JsonResponse({"items": []})
        items_qs = Notification.objects.filter(id__in=ids).order_by("created_at")
        items = [{"type": n.type, **(n.payload or {})} for n in items_qs]
        Notification.objects.filter(id__in=ids).update(read=True)
        return JsonResponse({"items": items})
    except DatabaseError:
        return JsonResponse({"items":[]})

urlpatterns = [
    path("quick/", quick),
    path("status/", status),
    path("cancel/", cancel),

    path("invite/<int:user_id>/", invite_link),
    path("invite_ajax/<int:user_id>/", invite_ajax),
    path("invites/", invites),
    path("invite/<str:token>/accept/", invite_accept),
    path("invite/<str:token>/decline/", invite_decline),
    path("invite/<str:token>/cancel/", invite_cancel),

    path("notify/poll/", notify_poll),
]