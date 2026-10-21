import os

from fastapi import FastAPI

from shop.config import settings
from shop.routers import brands, users

app = FastAPI(title="shop")
app.include_router(brands.router, prefix=settings.API_V1_STR)
app.include_router(users.router, prefix=os.environ.get("USERS_PREFIX", ""))


@app.get("/health")
def health() -> dict:
    return {"ok": True}
