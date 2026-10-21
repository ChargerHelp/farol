from prefect import flow, task

from shop.store import all_brands, find_brand


@task
def count_brands() -> int:
    return len(all_brands())


@task(retries=2)
def lookup(brand_id: str):
    return find_brand(brand_id)


@flow
def nightly_report() -> int:
    return count_brands()


@flow(name="brand-sync", log_prints=True)
def sync(brand_id: str):
    return lookup(brand_id)
