from shop.models import User


def display_name(name: str) -> str:
    return name.upper()


def current_user() -> User:
    return User(name=display_name("ada"))
