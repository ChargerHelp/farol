from celery import Celery, shared_task

from shop.store import all_brands

celery_app = Celery("shop")


@celery_app.task
def reindex() -> int:
    return len(all_brands())


@shared_task(name="shop.ping")
def ping() -> str:
    return "pong"
