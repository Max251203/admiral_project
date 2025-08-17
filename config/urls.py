# config/urls.py
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic import TemplateView

urlpatterns = [
    path("admin/", admin.site.urls),  # Убедитесь, что этот путь есть и не изменен
    path("", TemplateView.as_view(template_name="app.html"), name="home"),
    path("accounts/", include("accounts.urls")),
    path("game/", include("game.urls")),
    path("match/", include("matchmaking.urls")),
]
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)