from fastapi import APIRouter, Depends

from shop.models import User
from shop.services.audit import AuditLog
from shop.services.users import current_user

router = APIRouter()


@router.get("/me")
def me() -> User:
    return current_user()


@router.get("/audit/{key}")
def audit(key: str, log: AuditLog = Depends(AuditLog)) -> str | None:
    return log.find(key)
