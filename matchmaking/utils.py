from .models import Notification

def safe_notify(user_id: int, payload: dict) -> None:
    Notification.objects.create(to_user_id=user_id, type=payload.get("type",""), payload=payload)