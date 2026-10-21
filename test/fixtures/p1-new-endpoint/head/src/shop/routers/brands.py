from fastapi import APIRouter, HTTPException

from shop.models import Brand
from shop.services.brands import BrandService

router = APIRouter()
service = BrandService()


@router.get("")
def list_brands() -> list[Brand]:
    return service.list()


@router.get("/{brand_id}")
def get_brand(brand_id: str) -> Brand:
    brand = service.find(brand_id)
    if brand is None:
        raise HTTPException(status_code=404)
    return brand


@router.get("/count")
def count_brands() -> int:
    return len(service.list())
