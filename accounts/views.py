from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.contrib.auth.models import User
from .models import Profile, Friendship
from .forms import ProfileForm
from django.db.models import Q

@login_required
def profile(request):
    pf = request.user.profile
    from game.models import Game
    games = (Game.objects.filter(Q(player1=request.user)|Q(player2=request.user))
                  .filter(moves__isnull=False).distinct()
                  .order_by("-created_at")[:20])
    return render(request, "accounts/profile.html", {"profile": pf, "games": games})

@login_required
def profile_edit(request):
    pf = request.user.profile
    if request.method == "POST":
        form = ProfileForm(request.POST, request.FILES, instance=pf)
        username = request.POST.get("username","").strip()
        email = request.POST.get("email","").strip()
        if form.is_valid():
            login_new = form.cleaned_data["login"].strip()
            if Profile.objects.exclude(pk=pf.pk).filter(login__iexact=login_new).exists():
                messages.error(request, "Никнейм уже занят.")
            else:
                if User.objects.exclude(pk=request.user.pk).filter(username__iexact=username).exists():
                    messages.error(request, "Username уже занят.")
                else:
                    request.user.username = username or request.user.username
                    request.user.email = email
                    request.user.save()
                    form.save()
                    messages.success(request, "Профиль обновлён.")
                    return redirect("profile")
        else:
            messages.error(request, "Исправьте ошибки формы.")
    else:
        form = ProfileForm(instance=pf)
    return render(request, "accounts/profile_edit.html", {"form": form})

@login_required
def friends(request):
    me=request.user
    accepted = Friendship.objects.filter(from_user=me, status=Friendship.ACCEPTED).values_list("to_user", flat=True)
    accepted_rev = Friendship.objects.filter(to_user=me, status=Friendship.ACCEPTED).values_list("from_user", flat=True)
    ids = set(accepted) | set(accepted_rev)
    friends = [{"other_id":u.id,"other_login":u.profile.login} for u in User.objects.filter(id__in=ids)]
    reqs = Friendship.objects.filter(to_user=me, status=Friendship.PENDING)
    requests = [{"from_id":f.from_user_id,"from_login":f.from_user.profile.login} for f in reqs]
    return render(request, "accounts/friends.html", {"friends":friends,"requests":requests})

@login_required
def friends_add(request):
    login_name = (request.POST.get("login") or request.GET.get("login") or "").strip()
    if login_name:
        try:
            u = User.objects.get(profile__login=login_name)
        except User.DoesNotExist:
            messages.error(request, "Пользователь с таким никнеймом не найден.")
            return redirect("friends")
        if u != request.user:
            Friendship.objects.get_or_create(from_user=request.user, to_user=u, defaults={"status":Friendship.PENDING})
            messages.success(request, "Заявка отправлена.")
    return redirect("friends")

@login_required
def friends_accept(request, uid:int):
    other = get_object_or_404(User, id=uid)
    from .models import Friendship as F
    f = get_object_or_404(F, from_user=other, to_user=request.user, status=F.PENDING)
    f.status = F.ACCEPTED; f.save()
    F.objects.get_or_create(from_user=request.user, to_user=other, defaults={"status":F.ACCEPTED})
    messages.success(request, "Заявка принята.")
    return redirect("friends")

@login_required
def friends_decline(request, uid:int):
    other = get_object_or_404(User, id=uid)
    from .models import Friendship as F
    F.objects.filter(from_user=other, to_user=request.user, status=F.PENDING).delete()
    messages.info(request, "Заявка отклонена.")
    return redirect("friends")

@login_required
def friends_remove(request, uid:int):
    other = get_object_or_404(User, id=uid)
    from .models import Friendship as F
    F.objects.filter(from_user=request.user, to_user=other).delete()
    F.objects.filter(from_user=other, to_user=request.user).delete()
    messages.info(request, "Друг удалён.")
    return redirect("friends")

def register_page(request):
    if request.method == "POST":
        username = request.POST.get("username","").strip()
        email = request.POST.get("email","").strip()
        login_name = request.POST.get("login","").strip()
        password = request.POST.get("password","")
        password2 = request.POST.get("password2","")
        avatar = request.FILES.get("avatar")
        if not username or not login_name or not password:
            messages.error(request, "Заполните обязательные поля.")
            return render(request, "accounts/register.html")
        if password != password2:
            messages.error(request, "Пароли не совпадают.")
            return render(request, "accounts/register.html")
        if User.objects.filter(username=username).exists():
            messages.error(request, "Такой username уже занят.")
            return render(request, "accounts/register.html")
        if Profile.objects.filter(login__iexact=login_name).exists():
            messages.error(request, "Никнейм уже занят.")
            return render(request, "accounts/register.html")
        user = User.objects.create_user(username=username, email=email, password=password)
        prof = user.profile
        prof.login = login_name
        if avatar: prof.avatar = avatar
        prof.save()
        from django.contrib.auth import authenticate, login as auth_login
        user = authenticate(request, username=username, password=password)
        if user:
            auth_login(request, user)
            messages.success(request, "Регистрация успешна. Добро пожаловать!")
            return redirect("menu")
        messages.info(request, "Аккаунт создан. Войдите.")
        return redirect("login")
    return render(request, "accounts/register.html")