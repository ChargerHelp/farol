from fastapi import FastAPI

from shop.routers import brands, users

app = FastAPI(title="shop")
app.include_router(brands.router, prefix="/brands")
app.include_router(users.router)


@app.get("/health")
def health() -> dict:
    return {"ok": True}
