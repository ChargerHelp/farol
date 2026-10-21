"""Small, local type inference: which project class a name or a `self.` attribute holds, so that `x.method()` resolves
to that class's method instead of every project method with the same name."""

from __future__ import annotations

import ast
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .decls import Graph
    from .modules import Module

WRAPPERS = {"Optional", "Annotated", "Final", "ClassVar", "Required", "NotRequired"}


def annotation_class(graph: Graph, module: Module, expr: ast.expr | None) -> str | None:
    """The project class an annotation names: `Repo`, `models.Repo`, `Optional[Repo]`, `Repo | None`, `Annotated[Repo, …]`, `"Repo"`."""
    if expr is None:
        return None
    if isinstance(expr, ast.Constant) and isinstance(expr.value, str):
        try:
            expr = ast.parse(expr.value, mode="eval").body
        except SyntaxError:
            return None
    if isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.BitOr):
        left, right = annotation_class(graph, module, expr.left), annotation_class(graph, module, expr.right)
        return left if right is None else right if left is None else None
    if isinstance(expr, ast.Subscript):
        base = expr.value.attr if isinstance(expr.value, ast.Attribute) else expr.value.id if isinstance(expr.value, ast.Name) else ""
        if base in WRAPPERS:
            inner = expr.slice.elts[0] if isinstance(expr.slice, ast.Tuple) and expr.slice.elts else expr.slice
            return annotation_class(graph, module, inner)
        return None
    return call_class(graph, module, expr)


def call_class(graph: Graph, module: Module, func: ast.expr) -> str | None:
    """The project class an expression refers to (a class name used as a callable or an annotation)."""
    for i in graph.resolve_expr(module, func)[:1]:
        if graph.decls[i].kind == "class":
            return graph.decls[i].id
    return None


def class_attribute_types(graph: Graph) -> dict[str, dict[str, str]]:
    """For each project class: attribute -> project class, from class-level annotations (dataclasses, pydantic) and
    from methods (`self.x = Repo()`, `self.x: Repo = …`, `self.x = repo` with `repo: Repo` a parameter)."""
    out: dict[str, dict[str, str]] = {}
    for decl in graph.decls:
        node, module = decl.node, decl.module
        if decl.kind == "class" and isinstance(node, ast.ClassDef):
            attrs = out.setdefault(decl.id, {})
            for stmt in node.body:
                if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
                    t = annotation_class(graph, module, stmt.annotation)
                    if t:
                        attrs[stmt.target.id] = t
        elif decl.kind == "method" and decl.owner and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            attrs = out.setdefault(decl.owner, {})
            params = {a.arg: annotation_class(graph, module, a.annotation) for a in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]}
            for n in ast.walk(node):
                target, value, annotation = None, None, None
                if isinstance(n, ast.Assign) and len(n.targets) == 1:
                    target, value = n.targets[0], n.value
                elif isinstance(n, ast.AnnAssign):
                    target, value, annotation = n.target, n.value, n.annotation
                if not (isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name) and target.value.id == "self"):
                    continue
                t = annotation_class(graph, module, annotation) if annotation is not None else None
                if t is None and isinstance(value, ast.Call):
                    t = call_class(graph, module, value.func)
                if t is None and isinstance(value, ast.Name):
                    t = params.get(value.id)
                if t:
                    attrs.setdefault(target.attr, t)
    return out


def local_types(graph: Graph, module: Module, node: ast.AST) -> dict[str, str]:
    """Names of a function bound to a project class: annotated parameters and `x = Repo(…)` / `x: Repo = …`."""
    types: dict[str, str] = {}
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        for a in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]:
            t = annotation_class(graph, module, a.annotation)
            if t:
                types[a.arg] = t
        for n in ast.walk(node):
            if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name) and isinstance(n.value, ast.Call):
                t = call_class(graph, module, n.value.func)
                if t:
                    types.setdefault(n.targets[0].id, t)
            elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name):
                t = annotation_class(graph, module, n.annotation)
                if t:
                    types.setdefault(n.target.id, t)
    return types
