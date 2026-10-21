from shop.services.users import display_name


def test_display_name():
    assert display_name("ada") == "ADA"
