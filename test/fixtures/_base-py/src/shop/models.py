from pydantic import BaseModel


class Brand(BaseModel):
    id: str
    name: str


class User(BaseModel):
    name: str
