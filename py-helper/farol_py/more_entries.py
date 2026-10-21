"""Entry points besides HTTP apps: MCP tools/resources/prompts, Celery tasks, Temporal activities and workflows, Prefect
flows, and Django URL patterns (from ROOT_URLCONF, following include())."""

from __future__ import annotations

import ast
import hashlib
from typing import TYPE_CHECKING

from .decls import Graph
from .modules import Module

if TYPE_CHECKING:
    from .routes import RouteFinder

MCP_TYPES = {"fastmcp.FastMCP", "fastmcp.server.FastMCP", "fastmcp.server.server.FastMCP", "mcp.server.fastmcp.FastMCP", "mcp.server.FastMCP"}
CELERY_TYPES = {"celery.Celery", "celery.app.Celery"}
MCP_KINDS = {"tool": "TOOL", "resource": "RESOURCE", "prompt": "PROMPT"}
PREFECT_FLOWS = {"prefect.flow", "prefect.flows.flow"}
DJANGO_PATHS = {"django.urls.path", "django.urls.re_path", "django.conf.urls.url"}
DJANGO_INCLUDE = {"django.urls.include", "django.conf.urls.include"}
# Methods a class-based view runs through as_view() and dispatch().
VIEW_METHODS = {"dispatch", "get", "post", "put", "patch", "delete", "head", "options", "get_queryset", "get_object", "get_context_data", "form_valid", "list", "retrieve", "create", "update", "partial_update", "destroy"}


def _hash(node: ast.AST) -> str:
    return hashlib.sha1(ast.dump(node, include_attributes=False).encode()).hexdigest()[:16]


def _entry(key: str, module: Module, line: int, kind: str, anchors: list[int], inline: str) -> dict:
    return {"key": key, "file": module.file, "line": line, "kind": kind, "anchors": sorted(set(anchors)), "inline": inline}


class MoreEntries:
    def __init__(self, graph: Graph, finder: RouteFinder):
        self.g = graph
        self.f = finder
        self.entries: list[dict] = []
        self.problems: list[dict] = []
        self.objects: dict[str, str] = {}  # "module.NAME" -> "mcp" | "celery"

    def find_objects(self) -> None:
        for module in self.g.modules.values():
            for stmt in module.tree.body if module.tree else []:
                if isinstance(stmt, (ast.Assign, ast.AnnAssign)) and isinstance(stmt.value, ast.Call):
                    q = self.f.qualified(module, stmt.value.func) or ""
                    kind = "mcp" if q in MCP_TYPES else "celery" if q in CELERY_TYPES else None
                    targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]
                    if kind and len(targets) == 1 and isinstance(targets[0], ast.Name):
                        self.objects[f"{module.name}.{targets[0].id}"] = kind

    def kind_of(self, module: Module, expr: ast.expr) -> str | None:
        name = self.f.qualified(module, expr)
        for _ in range(6):
            if name is None:
                return None
            if name in self.objects:
                return self.objects[name]
            owner, _, attr = name.rpartition(".")
            mod = self.g.modules.get(owner)
            if mod is None or attr not in mod.imports:
                return None
            name = mod.imports[attr]
        return None

    def decorators(self) -> None:
        for i, decl in enumerate(self.g.decls):
            node, module = decl.node, decl.module
            if isinstance(node, ast.ClassDef):
                self.workflow_class(i, node, module)
                continue
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for dec in node.decorator_list:
                base = dec.func if isinstance(dec, ast.Call) else dec
                call = dec if isinstance(dec, ast.Call) else None
                named = self.f.string(module, self.f.kwarg(call, "name")) if call else None
                q = self.f.qualified(module, base) or ""
                if isinstance(base, ast.Attribute) and base.attr in MCP_KINDS and self.kind_of(module, base.value) == "mcp":
                    first = self.f.string(module, call.args[0]) if call and call.args else None
                    label = named or (first if base.attr == "resource" else None) or node.name
                    self.entries.append(_entry(f"{MCP_KINDS[base.attr]} {label}", module, dec.lineno, "tool", [i], _hash(dec)))
                elif (isinstance(base, ast.Attribute) and base.attr == "task" and self.kind_of(module, base.value) == "celery") or q in ("celery.shared_task", "celery.app.shared_task"):
                    self.entries.append(_entry(f"TASK {named or f'{module.name}.{node.name}'}", module, dec.lineno, "task", [i], _hash(dec)))
                elif q == "temporalio.activity.defn":
                    self.entries.append(_entry(f"ACTIVITY {named or node.name}", module, dec.lineno, "task", [i], _hash(dec)))
                elif q in PREFECT_FLOWS:
                    # Prefect runs flows (deployments, schedules); tasks run inside them and are reached through them.
                    # A flow's default name is its function name with hyphens, as Prefect names it.
                    self.entries.append(_entry(f"FLOW {named or node.name.replace('_', '-')}", module, dec.lineno, "task", [i], _hash(dec)))

    def workflow_class(self, i: int, node: ast.ClassDef, module: Module) -> None:
        for dec in node.decorator_list:
            base = dec.func if isinstance(dec, ast.Call) else dec
            if self.f.qualified(module, base) == "temporalio.workflow.defn":
                named = self.f.string(module, self.f.kwarg(dec, "name")) if isinstance(dec, ast.Call) else None
                # Temporal calls the run, signal and query methods: every method of the workflow class runs.
                methods = [j for j, d in enumerate(self.g.decls) if d.owner == self.g.decls[i].id]
                self.entries.append(_entry(f"WORKFLOW {named or node.name}", module, dec.lineno, "task", [i, *methods], _hash(dec)))

    def mcp_calls(self) -> None:
        """`mcp.add_tool(fn)` registrations anywhere in the project."""
        for module in self.g.modules.values():
            for node in ast.walk(module.tree) if module.tree else []:
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "add_tool" and node.args and self.kind_of(module, node.func.value) == "mcp":
                    anchors = self.g.resolve_expr(module, node.args[0])
                    name = self.f.string(module, self.f.kwarg(node, "name")) or (anchors and self.g.decls[anchors[0]].id.rsplit(".", 1)[-1]) or None
                    if name:
                        self.entries.append(_entry(f"TOOL {name}", module, node.lineno, "tool", anchors, _hash(node)))

    # --- Django ------------------------------------------------------------------------------------------------------

    def django(self) -> None:
        roots: dict[str, Module] = {}
        for module in self.g.modules.values():
            for stmt in module.tree.body if module.tree else []:
                if isinstance(stmt, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "ROOT_URLCONF" for t in stmt.targets):
                    name = self.f.string(module, stmt.value)
                    if name and name in self.g.modules:
                        roots[name] = self.g.modules[name]
        for root in sorted(roots.values(), key=lambda m: m.name):
            self.urlconf(root, "", (), [])

    def urlconf(self, module: Module, prefix: str, seen: tuple[str, ...], anchors: list[int]) -> None:
        if module.name in seen or module.tree is None:
            return
        for stmt in module.tree.body:
            targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target] if isinstance(stmt, (ast.AugAssign, ast.AnnAssign)) else []
            if not any(isinstance(t, ast.Name) and t.id == "urlpatterns" for t in targets):
                continue
            value = stmt.value
            for el in value.elts if isinstance(value, (ast.List, ast.Tuple)) else []:
                if isinstance(el, ast.Call) and (self.f.qualified(module, el.func) or "") in DJANGO_PATHS:
                    self.pattern(module, el, prefix, (*seen, module.name), anchors)

    def pattern(self, module: Module, call: ast.Call, prefix: str, seen: tuple[str, ...], anchors: list[int]) -> None:
        route = self.f.string(module, call.args[0]) if call.args else None
        view = call.args[1] if len(call.args) > 1 else self.f.kwarg(call, "view")
        if route is None or view is None:
            self.f.problem(module, call, "Django URL pattern with a route or view farol cannot read")
            return
        if isinstance(view, ast.Call) and (self.f.qualified(module, view.func) or "") in DJANGO_INCLUDE and view.args:
            target = view.args[0].elts[0] if isinstance(view.args[0], ast.Tuple) and view.args[0].elts else view.args[0]
            name = self.f.string(module, target)
            included = self.g.modules.get(name) if name else None
            if included is None and isinstance(target, ast.Name) and target.id in module.imports:
                included = self.g.modules.get(module.imports[target.id])
            if included is None:
                self.f.problem(module, call, "Django include() of a module farol cannot find")
                return
            self.urlconf(included, prefix + route, seen, anchors)
            return
        target = view.func.value if isinstance(view, ast.Call) and isinstance(view.func, ast.Attribute) and view.func.attr == "as_view" else view
        found = self.g.resolve_expr(module, target)
        for j in list(found):
            if self.g.decls[j].kind == "class":
                found += [k for k, d in enumerate(self.g.decls) if d.owner == self.g.decls[j].id and d.id.rsplit(".", 1)[-1] in VIEW_METHODS]
        path = "/" + (prefix + route).lstrip("^").rstrip("$")
        self.entries.append(_entry(f"ANY {path}", module, call.lineno, "http", found + anchors, _hash(call)))


def find_more_entries(graph: Graph, finder: RouteFinder) -> tuple[list[dict], list[dict]]:
    more = MoreEntries(graph, finder)
    more.find_objects()
    more.decorators()
    more.mcp_calls()
    more.django()
    return more.entries, more.problems
