from fastapi import FastAPI

from shop.routers import brands

app = FastAPI(title="shop")
app.include_router(brands.router, prefix="/brands")


@app.get("/health")
def health() -> dict:
    return {"ok": True}
