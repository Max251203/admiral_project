from django.urls import path
from . import views

urlpatterns = [
    path("quick/", views.quick, name="quick_match"),
    path("cancel/", views.cancel, name="cancel_match"),
    path("invite_ajax/<int:user_id>/", views.invite_ajax, name="invite_ajax"),
    path("invite/<str:token>/accept/", views.invite_accept_api, name="invite_accept"),
    path("invite/<str:token>/decline/", views.invite_decline_api, name="invite_decline"),
    path("invite/<str:token>/cancel/", views.invite_cancel, name="invite_cancel"),
]