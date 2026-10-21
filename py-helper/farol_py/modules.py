"""Finds the Python modules of a project and what their import statements bind."""

from __future__ import annotations

import ast
import os
from dataclasses import dataclass, field

SKIP_DIRS = {".git", ".venv", "venv", "env", "node_modules", "__pycache__", "build", "dist", ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache", "site-packages"}


def is_test_file(rel: str) -> bool:
    parts = rel.split("/")
    name = parts[-1]
    return "tests" in parts[:-1] or "test" in parts[:-1] or name.startswith("test_") or name.endswith("_test.py") or name == "conftest.py"


@dataclass
class Module:
    name: str  # dotted module name ("orders_api.services.mailer"); packages are named after their directory
    file: str  # repo-relative path
    tree: ast.Module | None = None
    source: str = ""
    # local name -> dotted target ("orders_api.persistence", "fastapi.FastAPI")
    imports: dict[str, str] = field(default_factory=dict)
    is_package: bool = False


def module_name(rel_to_root: str) -> tuple[str, bool]:
    parts = rel_to_root[:-3].split("/")
    if parts[-1] == "__init__":
        return ".".join(parts[:-1]), True
    return ".".join(parts), False


def discover(root: str, project: str, roots: list[str]) -> dict[str, Module]:
    """Every non-test .py file under the project, named relative to the first import root that contains it."""
    base = os.path.normpath(os.path.join(root, project))
    root_dirs = [os.path.normpath(os.path.join(base, r)) for r in roots]
    modules: dict[str, Module] = {}
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith("."))
        for name in sorted(filenames):
            if not name.endswith(".py"):
                continue
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, root).replace(os.sep, "/")
            if is_test_file(os.path.relpath(path, base).replace(os.sep, "/")):
                continue
            owner = next((r for r in root_dirs if path.startswith(r + os.sep)), base)
            dotted, is_package = module_name(os.path.relpath(path, owner).replace(os.sep, "/"))
            if dotted == "" or dotted in modules:
                continue
            modules[dotted] = Module(name=dotted, file=rel, is_package=is_package)
    return modules


def resolve_relative(module: Module, level: int, target: str | None) -> str:
    package = module.name if module.is_package else module.name.rpartition(".")[0]
    for _ in range(level - 1):
        package = package.rpartition(".")[0]
    if not target:
        return package
    return f"{package}.{target}" if package else target


def collect_imports(module: Module) -> None:
    """Import bindings anywhere in the module (function-level imports bind for the whole module: an approximation)."""
    assert module.tree is not None
    for node in ast.walk(module.tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname:
                    module.imports[alias.asname] = alias.name
                else:
                    head = alias.name.split(".")[0]
                    module.imports.setdefault(head, head)
        elif isinstance(node, ast.ImportFrom):
            source = resolve_relative(module, node.level, node.module) if node.level else (node.module or "")
            for alias in node.names:
                if alias.name == "*":
                    continue
                module.imports[alias.asname or alias.name] = f"{source}.{alias.name}" if source else alias.name
