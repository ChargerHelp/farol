from enum import Enum
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from shop.models import Brand
from shop.services.brands import BrandService

router = APIRouter()
service = BrandService()


class Tier(str, Enum):
    free = "free"
    pro = "pro"
    enterprise = "enterprise"


class BrandIn(BaseModel):
    name: str
    tier: Tier = Tier.free
    notes: str | None = Field(default=None)


@router.get("")
def list_brands(limit: int = 50) -> list[Brand]:
    return service.list()


@router.get("/{brand_id}")
def get_brand(brand_id: str) -> Brand:
    brand = service.find(brand_id)
    if brand is None:
        raise HTTPException(status_code=404)
    return brand


@router.post("", response_model=Brand)
def create_brand(brand: BrandIn, dry_run: bool = Query(default=False)):
    return service.list()[0]


def get_current_brand() -> Brand:
    return service.list()[0]


# A dependency through a project alias (FastAPI's recommended style): injected, not part of the request.
CurrentBrand = Annotated[Brand, Depends(get_current_brand)]


@router.get("/current/owner")
def current_owner(brand: CurrentBrand) -> str:
    return "owner"
