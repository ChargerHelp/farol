from temporalio import activity, workflow

from shop.store import find_brand


@activity.defn
async def load_brand(brand_id: str):
    return find_brand(brand_id)


@workflow.defn
class BrandWorkflow:
    @workflow.run
    async def run(self, brand_id: str):
        return await workflow.execute_activity(load_brand, brand_id)
