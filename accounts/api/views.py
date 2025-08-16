from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated

from accounts.models import Profile, Friendship
from ..serializers import RegisterSerializer


class Register(APIView):
    permission_classes = [AllowAny]
    def post(self, request):
        s = RegisterSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = s.save()
        return Response({"ok": True, "user": user.username})


class LoginAPI(APIView):
    permission_classes = [AllowAny]
    def post(self, request):
        username = request.data.get("username","")
        password = request.data.get("password","")
        user = authenticate(request, username=username, password=password)
        if not user:
            return Response({"ok": False}, status=400)
        login(request, user)
        avatar = user.profile.avatar.url if hasattr(user,'profile') and user.profile.avatar else ""
        return Response({"ok": True, "login": getattr(user.profile,'login', user.username), "avatar": avatar})


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
            "id": request.user.id,
            "username": request.user.username,
            "email": request.user.email,
            "login": p.login,
            "avatar": p.avatar.url if p.avatar else ""
        })


class UsersSearch(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        q = (request.GET.get("q") or "").strip()
        qs = User.objects.select_related("profile").exclude(id=request.user.id)
        if q:
            qs = qs.filter(profile__login__icontains=q)
        qs = qs.order_by("-profile__rating_elo","profile__login")[:50]
        items = [{
            "id": u.id, "login": u.profile.login, "username": u.username,
            "rating": u.profile.rating_elo, "wins": u.profile.wins, "losses": u.profile.losses
        } for u in qs]
        return Response({"items": items})


class UserInfo(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, user_id: int):
        from django.shortcuts import get_object_or_404
        u = get_object_or_404(User.objects.select_related("profile"), id=user_id)
        p = u.profile
        return Response({
            "id": u.id, "username": u.username, "login": p.login,
            "avatar": p.avatar.url if p.avatar else "", "rating": p.rating_elo,
            "wins": p.wins, "losses": p.losses
        })


class FriendsList(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        me = request.user
        out = set(Friendship.objects.filter(from_user=me, status=Friendship.ACCEPTED).values_list("to_user", flat=True))
        inc = set(Friendship.objects.filter(to_user=me, status=Friendship.ACCEPTED).values_list("from_user", flat=True))
        ids = list(out | inc)
        items = [{"id": u.id, "login": u.profile.login} for u in User.objects.filter(id__in=ids).select_related('profile')]
        return Response({"items": items})


class FriendAdd(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        login_name = (request.data.get("login") or "").strip()
        if not login_name:
            return Response({"ok": False}, status=400)
        try:
            u = User.objects.get(profile__login__iexact=login_name)
        except User.DoesNotExist:
            return Response({"ok": False, "error": "not_found"}, status=404)
        if u == request.user:
            return Response({"ok": False}, status=400)
        Friendship.objects.get_or_create(from_user=request.user, to_user=u, defaults={"status": Friendship.PENDING})
        return Response({"ok": True})


class FriendRemove(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, user_id: int):
        from django.shortcuts import get_object_or_404
        target = get_object_or_404(User, id=user_id)
        Friendship.objects.filter(from_user=request.user, to_user=target).delete()
        Friendship.objects.filter(from_user=target, to_user=request.user).delete()
        return Response({"ok": True})


class ProfileUpdate(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        user = request.user
        p = user.profile
        username = request.POST.get("username","").strip() or user.username
        email = request.POST.get("email","").strip()
        login_name = request.POST.get("login","").strip() or p.login
        if User.objects.exclude(pk=user.pk).filter(username__iexact=username).exists():
            return Response({"ok": False, "error": "username_taken"}, status=400)
        if Profile.objects.exclude(pk=p.pk).filter(login__iexact=login_name).exists():
            return Response({"ok": False, "error": "login_taken"}, status=400)
        user.username = username; user.email = email; user.save()
        p.login = login_name
        if 'avatar' in request.FILES: p.avatar = request.FILES['avatar']
        p.save()
        return Response({"ok": True, "profile": {"login": p.login, "avatar": p.avatar.url if p.avatar else ""}})