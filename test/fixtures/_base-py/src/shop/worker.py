from shop.store import all_brands


def run() -> int:
    return len(all_brands())


if __name__ == "__main__":
    print(run())
