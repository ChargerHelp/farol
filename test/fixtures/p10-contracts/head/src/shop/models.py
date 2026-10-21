from pydantic import BaseModel


class Brand(BaseModel):
    id: str
    title: str
    logo: str | None = None


class User(BaseModel):
    name: str
