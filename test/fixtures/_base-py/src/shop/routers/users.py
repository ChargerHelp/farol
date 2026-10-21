from fastapi import APIRouter

from shop.models import User
from shop.services.users import current_user

router = APIRouter()


@router.get("/me")
def me() -> User:
    return current_user()
