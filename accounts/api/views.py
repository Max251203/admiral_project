from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.contrib.auth.models import User
from ..serializers import RegisterSerializer, ProfileSerializer

class Register(APIView):
    permission_classes=[AllowAny]
    def post(self, request):
        s=RegisterSerializer(data=request.data); s.is_valid(raise_exception=True)
        u=s.save(); return Response({"ok":True,"user":u.username})

class Me(APIView):
    permission_classes=[IsAuthenticated]
    def get(self, request): return Response(ProfileSerializer(request.user.profile).data)

class UsersSearch(APIView):
    permission_classes=[IsAuthenticated]
    def get(self, request):
        q = (request.GET.get("q") or "").strip()
        qs = User.objects.select_related("profile").exclude(id=request.user.id)
        if q: qs = qs.filter(profile__login__icontains=q)
        qs = qs.order_by("-profile__rating_elo","profile__login")[:50]
        items = [{
            "id": u.id,
            "login": u.profile.login,
            "username": u.username,
            "rating": u.profile.rating_elo,
            "wins": u.profile.wins,
            "losses": u.profile.losses,
        } for u in qs]
        return Response({"items": items})

class UserInfo(APIView):
    permission_classes=[IsAuthenticated]
    def get(self, request, user_id:int):
        from django.shortcuts import get_object_or_404
        u = get_object_or_404(User.objects.select_related("profile"), id=user_id)
        p = u.profile
        return Response({"id":u.id,"username":u.username,"login":p.login,
                         "avatar": p.avatar.url if p.avatar else "",
                         "rating":p.rating_elo,"wins":p.wins,"losses":p.losses})