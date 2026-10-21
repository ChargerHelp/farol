from flask import Blueprint, Flask

from shop.store import all_brands, find_brand

app = Flask(__name__)
admin = Blueprint("admin", __name__, url_prefix="/admin")


@admin.route("/stats")
def stats() -> dict:
    return {"brands": len(all_brands())}


@app.route("/legacy/brands/<brand_id>", methods=["GET", "DELETE"])
def legacy_brand(brand_id: str):
    return find_brand(brand_id)


app.register_blueprint(admin)
