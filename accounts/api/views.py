from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

from accounts.models import Profile, Friendship
from ..serializers import RegisterSerializer

def notify_user(user_id, event_type, data):
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f"user_{user_id}",
        {"type": "notify", "payload": {"type": event_type, **data}}
    )

class Register(APIView):
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]
    
    def post(self, request):
        s = RegisterSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = s.save()
        return Response({"ok": True, "user": user.username})

class LoginAPI(APIView):
    permission_classes = [AllowAny]
    def post(self, request):
        username = request.data.get("username", "")
        password = request.data.get("password", "")
        user = authenticate(request, username=username, password=password)
        if not user:
            return Response({"ok": False, "error": "Invalid credentials"}, status=400)
        login(request, user)
        avatar = user.profile.get_avatar_url()
        return Response({"ok": True, "login": getattr(user.profile, 'login', user.username), "avatar": avatar, "id": user.id})

class LogoutAPI(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        logout(request)
        return Response({"ok": True})

class Me(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        p = request.user.profile
        return Response({
            "id": request.user.id, "username": request.user.username, "email": request.user.email,
            "login": p.login, "avatar": p.get_avatar_url(),
            "rating_elo": p.rating_elo, "wins": p.wins, "losses": p.losses,
        })

class UsersSearch(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        q = (request.GET.get("q") or "").strip()
        qs = User.objects.select_related("profile").exclude(id=request.user.id)
        if q:
            qs = qs.filter(Q(profile__login__icontains=q) | Q(username__icontains=q))
        qs = qs.order_by("-profile__rating_elo", "profile__login")[:50]
        items = [{
            "id": u.id, "login": u.profile.login, "username": u.username,
            "rating": u.profile.rating_elo, "wins": u.profile.wins, "losses": u.profile.losses
        } for u in qs]
        return Response({"items": items})

class UserInfo(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, user_id: int):
        u = get_object_or_404(User.objects.select_related("profile"), id=user_id)
        p = u.profile
        return Response({
            "id": u.id, "username": u.username, "login": p.login,
            "avatar": p.get_avatar_url(), "rating": p.rating_elo,
            "wins": p.wins, "losses": p.losses
        })

class FriendsList(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        me = request.user
        friend_relations = Friendship.objects.filter(
            (Q(from_user=me) | Q(to_user=me)),
            status=Friendship.ACCEPTED        ).select_related('from_user__profile', 'to_user__profile')
        
        friends = []
        for fr in friend_relations:
            friend_user = fr.to_user if fr.from_user == me else fr.from_user
            friends.append({
                "id": friend_user.id,
                "login": friend_user.profile.login,
                "rating": friend_user.profile.rating_elo,
                "wins": friend_user.profile.wins,
                "losses": friend_user.profile.losses
            })
        
        return Response({"items": friends})

class FriendAdd(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        target_id = request.data.get("user_id")
        target = get_object_or_404(User, id=target_id)
        if target == request.user:
            return Response({"ok": False, "error": "Cannot add yourself"}, status=400)
        
        if Friendship.objects.filter(
            (Q(from_user=request.user, to_user=target) | Q(from_user=target, to_user=request.user))
        ).exists():
            return Response({"ok": False, "error": "Friendship already exists or pending"}, status=400)
            
        friendship = Friendship.objects.create(from_user=request.user, to_user=target, status=Friendship.PENDING)
        
        notify_user(target.id, 'friend_request', {
            'from_user': {'id': request.user.id, 'login': request.user.profile.login},
            'request_id': friendship.id
        })
        
        return Response({"ok": True})

class FriendRemove(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, user_id: int):
        target = get_object_or_404(User, id=user_id)
        Friendship.objects.filter(
            (Q(from_user=request.user, to_user=target) | Q(from_user=target, to_user=request.user))
        ).delete()
        
        notify_user(target.id, 'friend_removed', {'from_user_id': request.user.id})
        return Response({"ok": True})

class FriendAccept(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        request_id = request.data.get("request_id")
        friend_request = get_object_or_404(Friendship, id=request_id, to_user=request.user, status=Friendship.PENDING)
        friend_request.status = Friendship.ACCEPTED
        friend_request.save()
        
        notify_user(friend_request.from_user.id, 'friend_request_accepted', {
            'user': {'id': request.user.id, 'login': request.user.profile.login}
        })
        return Response({"ok": True})

class FriendDecline(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        request_id = request.data.get("request_id")
        friend_request = get_object_or_404(Friendship, id=request_id, to_user=request.user, status=Friendship.PENDING)
        friend_request.delete()
        
        notify_user(friend_request.from_user.id, 'friend_request_declined', {
            'from_user_login': request.user.profile.login
        })
        return Response({"ok": True})

class ProfileUpdate(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]
    
    def post(self, request):
        user = request.user
        p = user.profile
        username = request.POST.get("username", "").strip() or user.username
        email = request.POST.get("email", "").strip()
        login_name = request.POST.get("login", "").strip() or p.login
        
        errors = {}
        if User.objects.exclude(pk=user.pk).filter(username__iexact=username).exists():
            errors['username'] = "Этот username уже занят."
        if Profile.objects.exclude(pk=p.pk).filter(login__iexact=login_name).exists():
            errors['login'] = "Этот никнейм уже занят."
            
        if errors:
            return Response({"ok": False, "errors": errors}, status=400)
            
        user.username = username
        user.email = email
        user.save()
        p.login = login_name
        if 'avatar' in request.FILES:
            p.avatar = request.FILES['avatar']
        p.save()
        return Response({"ok": True, "profile": {"login": p.login, "avatar": p.get_avatar_url()}})