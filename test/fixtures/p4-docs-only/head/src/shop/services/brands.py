from shop import store
from shop.models import Brand


class BrandService:
    """Reads brands from the in-memory store."""

    def list(self) -> list[Brand]:
        return store.all_brands()

    def find(self, brand_id: str) -> Brand | None:
        # Unknown ids give None (see store.find_brand).
        return store.find_brand(brand_id)
