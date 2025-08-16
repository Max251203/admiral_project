from django.urls import path
from django.contrib.auth import views as auth_views
from django.views.generic import TemplateView
from .views import profile, profile_edit, friends, friends_add, friends_accept, friends_decline, friends_remove, register_page
from .api.views import Register, Me, UsersSearch, UserInfo

urlpatterns = [
    path("login/", auth_views.LoginView.as_view(template_name="registration/login.html",
        redirect_authenticated_user=True), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("register/", register_page, name="register"),

    path("profile/", profile, name="profile"),
    path("profile/edit/", profile_edit, name="profile_edit"),

    path("friends/", friends, name="friends"),
    path("friends/add/", friends_add, name="friends_add"),
    path("friends/accept/<int:uid>/", friends_accept, name="friends_accept"),
    path("friends/decline/<int:uid>/", friends_decline, name="friends_decline"),
    path("friends/remove/<int:uid>/", friends_remove, name="friends_remove"),

    path("users/", TemplateView.as_view(template_name="accounts/users.html"), name="users"),

    path("api/register/", Register.as_view(), name="api_register"),
    path("api/me/", Me.as_view(), name="api_me"),
    path("api/users/", UsersSearch.as_view(), name="api_users"),
    path("api/users/<int:user_id>/", UserInfo.as_view(), name="api_user_info"),
]