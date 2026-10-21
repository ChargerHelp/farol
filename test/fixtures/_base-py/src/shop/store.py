from shop.models import Brand

_BRANDS = [Brand(id="1", name="Acme")]


def all_brands() -> list[Brand]:
    return list(_BRANDS)


def find_brand(brand_id: str) -> Brand | None:
    return next((b for b in _BRANDS if b.id == brand_id), None)
