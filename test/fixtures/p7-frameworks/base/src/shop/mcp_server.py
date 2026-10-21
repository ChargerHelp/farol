from fastmcp import FastMCP

from shop.store import all_brands, find_brand

mcp = FastMCP("shop")


@mcp.tool()
def brand(brand_id: str) -> dict:
    return find_brand(brand_id).model_dump()


@mcp.tool(name="count_brands")
def count() -> int:
    return len(all_brands())


@mcp.resource("brands://all")
def brands_resource() -> list:
    return all_brands()
