from shop import store
from shop.models import Brand


class BrandService:
    """Reads brands from the store."""

    def list(self) -> list[Brand]:
        return store.all_brands()

    def find(self, brand_id: str) -> Brand | None:
        # The store returns None for unknown ids.
        return store.find_brand(brand_id.strip())
