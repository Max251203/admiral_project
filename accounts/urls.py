from django.urls import path
from .api.views import (
    Register, LoginAPI, LogoutAPI, Me, UsersSearch, UserInfo,
    FriendsList, FriendAdd, FriendRemove, ProfileUpdate, 
    FriendAccept, FriendDecline
)

urlpatterns = [
    path("api/register/", Register.as_view(), name="api_register"),
    path("api/login/", LoginAPI.as_view(), name="api_login"),
    path("api/logout/", LogoutAPI.as_view(), name="api_logout"),
    path("api/me/", Me.as_view(), name="api_me"),
    path("api/users/", UsersSearch.as_view(), name="api_users"),
    path("api/users/<int:user_id>/", UserInfo.as_view(), name="api_user_info"),
    
    path("api/friends/", FriendsList.as_view(), name="api_friends"),
    path("api/friends/add/", FriendAdd.as_view(), name="api_friend_add"),
    path("api/friends/remove/<int:user_id>/", FriendRemove.as_view(), name="api_friend_remove"),
    
    path("api/friends/accept/", FriendAccept.as_view(), name="api_friend_accept"),
    path("api/friends/decline/", FriendDecline.as_view(), name="api_friend_decline"),

    path("api/profile/update/", ProfileUpdate.as_view(), name="api_profile_update"),
]