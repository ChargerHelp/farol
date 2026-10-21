from django.views import View

from shop.store import find_brand


class BrandView(View):
    def get(self, request, brand_id: str):
        return find_brand(brand_id)


def health(request):
    return "ok"
