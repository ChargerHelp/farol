from django.urls import path

from web.views import health

urlpatterns = [path("health/", health)]
