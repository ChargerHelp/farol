from pydantic import BaseModel


class Brand(BaseModel):
    id: str
    name: str
    logo: str | None = None


class User(BaseModel):
    name: str
