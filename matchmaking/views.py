from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.contrib.auth.models import User
import secrets
import asyncio

from .models import MatchTicket, FriendInvite
from game.models import Game, GameState

def safe_notify_user(user_id, event_type, data):
    try:
        from matchmaking.consumers.lobby_consumer import notify_user
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(notify_user(user_id, {"type": event_type, **data}))
        loop.close()
    except:
        pass

@login_required
def quick(request):
    me = request.user
    other_ticket = (MatchTicket.objects.filter(active=True, assigned_game__isnull=True)
             .exclude(user=me).order_by("created_at").first())
    
    if other_ticket:
        code = secrets.token_hex(3)
        g = Game.objects.create(code=code, player1=other_ticket.user, player2=me, status="SETUP")
        GameState.objects.create(game=g, data={"turn":1,"phase":"SETUP","board":{},"setup_counts":{1:{},2:{}}})
        other_ticket.assigned_game = g
        other_ticket.matched_at = timezone.now()
        other_ticket.active = False
        other_ticket.save()

        game_url = f"/game/r/{g.code}/"
        safe_notify_user(other_ticket.user.id, 'match_found', {'url': game_url, 'game_id': str(g.id)})
        return JsonResponse({"ok": True, "url": game_url, 'game_id': str(g.id)})

    t, _ = MatchTicket.objects.update_or_create(user=me, active=True, defaults={"assigned_game": None})
    return JsonResponse({"queued": True, "ticket": t.id})

@login_required
def cancel(request):
    me = request.user
    MatchTicket.objects.filter(user=me, active=True).update(active=False, assigned_game=None)
    return JsonResponse({"ok": True})

@login_required
def invite_ajax(request, user_id:int):
    invitee = get_object_or_404(User, id=user_id)
    token = secrets.token_hex(12)
    inv, _ = FriendInvite.objects.update_or_create(
        inviter=request.user, invitee=invitee, status=FriendInvite.PENDING,
        defaults={'token': token}
    )
    
    safe_notify_user(invitee.id, "game_invite", {
        "from_user": {'login': request.user.profile.login},
        "token": token
    })
    return JsonResponse({"ok": True, "token": token})

@login_required
def invite_accept_api(request, token:str):
    inv = get_object_or_404(FriendInvite, token=token, invitee=request.user, status=FriendInvite.PENDING)
    code = secrets.token_hex(3)
    g = Game.objects.create(code=code, player1=inv.inviter, player2=inv.invitee, status="SETUP")
    GameState.objects.create(game=g, data={"turn":1,"phase":"SETUP","board":{},"setup_counts":{1:{},2:{}}})
    inv.status = FriendInvite.ACCEPTED
    inv.game = g
    inv.save()
    
    game_url = f"/game/r/{g.code}/"
    safe_notify_user(inv.inviter_id, "invite_accepted", {'url': game_url, 'game_id': str(g.id)})
    return JsonResponse({"ok": True, "url": game_url, 'game_id': str(g.id)})

@login_required
def invite_decline_api(request, token:str):
    inv = get_object_or_404(FriendInvite, token=token, invitee=request.user, status=FriendInvite.PENDING)
    inv.status = FriendInvite.DECLINED
    inv.save(update_fields=["status"])
    
    safe_notify_user(inv.inviter_id, "invite_declined", {"from_login": request.user.profile.login})
    return JsonResponse({"ok": True})

@login_required
def invite_cancel(request, token:str):
    inv = get_object_or_404(FriendInvite, token=token, inviter=request.user, status=FriendInvite.PENDING)
    inv.status = FriendInvite.EXPIRED
    inv.save(update_fields=["status"])
    
    safe_notify_user(inv.invitee_id, "invite_cancelled", {"from_login": request.user.profile.login})
    return JsonResponse({"ok": True})