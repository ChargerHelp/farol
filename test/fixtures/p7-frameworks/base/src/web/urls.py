from django.urls import include, path

from web import views

urlpatterns = [
    path("brands/<str:brand_id>/", views.BrandView.as_view()),
    path("api/", include("web.api_urls")),
]
