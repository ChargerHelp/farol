"""Contracts of FastAPI endpoints: the parameters and body a handler takes and the response it declares, with the
fields of the Pydantic models (and enums) of the project they use. Read from the AST only: nothing is imported."""

from __future__ import annotations

import ast
import builtins

from .modules import Module

SCALARS = {
    "str": "str", "int": "int", "float": "float", "bool": "bool", "bytes": "bytes", "None": "null", "Any": "any", "object": "any",
    "typing.Any": "any", "datetime.datetime": "datetime", "datetime.date": "date", "datetime.time": "time", "uuid.UUID": "uuid",
    "decimal.Decimal": "decimal", "pydantic.EmailStr": "str", "pydantic.HttpUrl": "str", "pydantic.AnyUrl": "str",
}
LISTS = {"list", "List", "typing.List", "Sequence", "typing.Sequence", "set", "Set", "typing.Set", "frozenset", "tuple", "Tuple", "typing.Tuple", "Iterable", "typing.Iterable", "collections.abc.Sequence"}
MAPS = {"dict", "Dict", "typing.Dict", "Mapping", "typing.Mapping", "collections.abc.Mapping"}
OPTIONAL = {"Optional", "typing.Optional"}
UNION = {"Union", "typing.Union"}
LITERAL = {"Literal", "typing.Literal", "typing_extensions.Literal"}
ANNOTATED = {"Annotated", "typing.Annotated", "typing_extensions.Annotated"}
ENUM_BASES = {"enum.Enum", "enum.IntEnum", "enum.StrEnum", "Enum", "IntEnum", "StrEnum"}
# Parameters FastAPI fills itself: not part of the contract.
INJECTED = {"fastapi.Request", "fastapi.Response", "fastapi.BackgroundTasks", "fastapi.WebSocket", "starlette.requests.Request", "starlette.responses.Response", "fastapi.requests.Request", "fastapi.responses.Response", "fastapi.background.BackgroundTasks"}
SOURCES = {"Query": "query", "Path": "path", "Header": "header", "Cookie": "cookie", "Body": "body", "Form": "form", "File": "form"}
MAX_DEPTH = 8


def path_params(path: str) -> set[str]:
    """Names of the `{name}` / `{name:path}` parameters of a route path."""
    names = set()
    for part in path.split("{")[1:]:
        name = part.split("}", 1)[0].split(":", 1)[0].strip()
        if name:
            names.add(name)
    return names


def _field(shape: dict, req: bool, null: bool) -> dict:
    return {"s": shape, "req": req, "null": null}


class Contracts:
    def __init__(self, graph, finder):
        self.g = graph
        self.f = finder

    # --- names ------------------------------------------------------------------------------------------------------

    def _class(self, module: Module, expr: ast.expr):
        """The project ClassDef an expression names, with its module, or None."""
        dotted = self.f.qualified(module, expr)
        if dotted is None:
            return None
        for i in self.g.resolve_dotted(dotted):
            d = self.g.decls[i]
            if d.kind == "class" and isinstance(d.node, ast.ClassDef):
                return d.node, d.module, d.id
        return None

    def _alias(self, module: Module, expr: ast.expr):
        """The value of a project type alias an expression names (`Title = Annotated[str, …]`), with its module."""
        dotted = self.f.qualified(module, expr)
        if dotted is None:
            return None
        for i in self.g.resolve_dotted(dotted):
            d = self.g.decls[i]
            node = d.node
            if isinstance(node, (ast.Assign, ast.AnnAssign)) and node.value is not None and isinstance(node.value, (ast.Subscript, ast.Name, ast.Attribute, ast.BinOp)):
                return node.value, d.module, d.id
            if hasattr(ast, "TypeAlias") and isinstance(node, ast.TypeAlias):
                return node.value, d.module, d.id
        return None

    def _name(self, module: Module, expr: ast.expr) -> str:
        # A builtin (`str`, `dict`) that the module neither imports nor defines keeps its own name.
        if isinstance(expr, ast.Name) and expr.id not in module.imports and f"{module.name}.{expr.id}" not in self.g.by_id and hasattr(builtins, expr.id):
            return expr.id
        return self.f.qualified(module, expr) or ast.unparse(expr)

    @staticmethod
    def _short(dotted: str) -> str:
        return dotted.rsplit(".", 1)[-1]

    # --- shapes -----------------------------------------------------------------------------------------------------

    def shape(self, module: Module, ann: ast.expr | None, seen: tuple[str, ...] = ()) -> tuple[dict, bool]:
        """Shape of an annotation and whether it admits None."""
        if ann is None:
            return {"k": "unknown", "n": "unannotated"}, False
        if len(seen) > MAX_DEPTH:
            return {"k": "unknown", "n": ast.unparse(ann)}, False
        if isinstance(ann, ast.Constant):
            if ann.value is None:
                return {"k": "scalar", "n": "null"}, True
            if isinstance(ann.value, str):  # forward reference
                try:
                    return self.shape(module, ast.parse(ann.value, mode="eval").body, seen)
                except SyntaxError:
                    return {"k": "unknown", "n": ann.value}, False
        if isinstance(ann, ast.BinOp) and isinstance(ann.op, ast.BitOr):
            return self._union(module, self._flatten_or(ann), seen)
        if isinstance(ann, ast.Subscript):
            outer = self._name(module, ann.value)
            args = list(ann.slice.elts) if isinstance(ann.slice, ast.Tuple) else [ann.slice]
            if outer in ANNOTATED or self._short(outer) == "Annotated":
                return self.shape(module, args[0], seen)
            if outer in OPTIONAL or self._short(outer) == "Optional":
                s, _ = self.shape(module, args[0], seen)
                return s, True
            if outer in UNION or self._short(outer) == "Union":
                return self._union(module, args, seen)
            if outer in LITERAL or self._short(outer) == "Literal":
                return {"k": "enum", "n": "", "v": sorted(str(a.value) for a in args if isinstance(a, ast.Constant))}, any(isinstance(a, ast.Constant) and a.value is None for a in args)
            if outer in LISTS or self._short(outer) in LISTS:
                s, _ = self.shape(module, args[0], seen)
                return {"k": "list", "of": s}, False
            if outer in MAPS or self._short(outer) in MAPS:
                return {"k": "scalar", "n": "object"}, False
            return {"k": "unknown", "n": ast.unparse(ann)}, False
        if isinstance(ann, (ast.Name, ast.Attribute)):
            dotted = self._name(module, ann)
            if dotted in SCALARS or self._short(dotted) in SCALARS and "." not in dotted:
                n = SCALARS.get(dotted, SCALARS.get(self._short(dotted), dotted))
                return {"k": "scalar", "n": n}, n == "null"
            if dotted in LISTS:
                return {"k": "list", "of": {"k": "scalar", "n": "any"}}, False
            if dotted in MAPS:
                return {"k": "scalar", "n": "object"}, False
            found = self._class(module, ann)
            if found is not None:
                return self._class_shape(*found, seen), False
            alias = self._alias(module, ann)
            if alias is not None and alias[2] not in seen:
                return self.shape(alias[1], alias[0], (*seen, alias[2]))
            return {"k": "scalar", "n": dotted}, False
        return {"k": "unknown", "n": ast.unparse(ann)}, False

    @staticmethod
    def _flatten_or(node: ast.expr) -> list[ast.expr]:
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
            return Contracts._flatten_or(node.left) + Contracts._flatten_or(node.right)
        return [node]

    def _union(self, module: Module, members: list[ast.expr], seen: tuple[str, ...]) -> tuple[dict, bool]:
        shapes = []
        nullable = False
        for m in members:
            s, null = self.shape(module, m, seen)
            if s == {"k": "scalar", "n": "null"}:
                nullable = True
                continue
            nullable = nullable or null
            shapes.append(s)
        if len(shapes) == 1:
            return shapes[0], nullable
        return {"k": "union", "of": shapes}, nullable

    def _bases(self, node: ast.ClassDef, module: Module) -> list[str]:
        return [self._name(module, b) for b in node.bases]

    def _class_shape(self, node: ast.ClassDef, module: Module, cid: str, seen: tuple[str, ...]) -> dict:
        name = node.name
        if cid in seen:
            return {"k": "ref", "n": name}
        bases = self._bases(node, module)
        if any(b in ENUM_BASES or self._short(b) in ENUM_BASES for b in bases):
            values = []
            for stmt in node.body:
                if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name) and isinstance(stmt.value, ast.Constant):
                    values.append(str(stmt.value.value))
            return {"k": "enum", "n": name, "v": sorted(values)}
        fields: dict[str, dict] = {}
        # Fields of project base models first (a subclass may override them).
        for base in node.bases:
            found = self._class(module, base)
            if found is not None:
                inherited = self._class_shape(*found, (*seen, cid))
                if inherited.get("k") == "object":
                    fields.update(inherited["f"])
        for stmt in node.body:
            if not (isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name)):
                continue
            if stmt.target.id.startswith("_") or self._name(module, stmt.annotation).endswith("ClassVar"):
                continue
            s, null = self.shape(module, stmt.annotation, (*seen, cid))
            req, alias = self._default(stmt.value)
            fields[alias or stmt.target.id] = _field(s, req, null)
        return {"k": "object", "n": name, "f": dict(sorted(fields.items()))}

    @staticmethod
    def _default(value: ast.expr | None) -> tuple[bool, str | None]:
        """Whether a Pydantic field is required, and its alias: `= Field(...)`, `= Field(default=…, alias=…)`, `= x`."""
        if value is None:
            return True, None
        if isinstance(value, ast.Call) and isinstance(value.func, (ast.Name, ast.Attribute)) and ast.unparse(value.func).split(".")[-1] == "Field":
            alias = next((k.value.value for k in value.keywords if k.arg in ("alias", "serialization_alias") and isinstance(k.value, ast.Constant) and isinstance(k.value.value, str)), None)
            has_default = any(k.arg in ("default", "default_factory") for k in value.keywords)
            if value.args:
                first = value.args[0]
                has_default = not (isinstance(first, ast.Constant) and first.value is Ellipsis)
            return not has_default, alias
        return False, None

    # --- endpoints --------------------------------------------------------------------------------------------------

    def endpoint(self, module: Module, handler: ast.FunctionDef | ast.AsyncFunctionDef, decorator: ast.Call | None, path: str) -> dict:
        in_path = path_params(path)
        params: dict[str, dict] = {}
        body_fields: list[tuple[str, dict]] = []
        args = handler.args
        positional = args.posonlyargs + args.args
        defaults = [None] * (len(positional) - len(args.defaults)) + list(args.defaults)
        pairs = list(zip(positional, defaults)) + list(zip(args.kwonlyargs, args.kw_defaults))
        for arg, default in pairs:
            if arg.arg in ("self", "cls"):
                continue
            ann = arg.annotation
            # `x: Annotated[int, Query()]` carries the marker in the annotation; `x: int = Query(…)` in the default.
            marker = default if isinstance(default, ast.Call) else None
            marker_module = module
            # A project alias carries it too: `CurrentUser = Annotated[User, Depends(get_current_user)]`.
            annotated, annotated_module = ann, module
            if isinstance(ann, (ast.Name, ast.Attribute)):
                alias = self._alias(module, ann)
                if alias is not None and isinstance(alias[0], ast.Subscript):
                    annotated, annotated_module = alias[0], alias[1]
            if marker is None and isinstance(annotated, ast.Subscript) and self._short(self._name(annotated_module, annotated.value)) == "Annotated":
                parts = list(annotated.slice.elts) if isinstance(annotated.slice, ast.Tuple) else [annotated.slice]
                marker = next((p for p in parts[1:] if isinstance(p, ast.Call)), None)
                marker_module = annotated_module
            source, marker_req = self._source(marker_module, marker)
            marked = source is not None
            if source == "depends" or (ann is not None and self._name(module, ann) in INJECTED):
                continue
            s, null = self.shape(module, ann)
            if source is None:
                is_model = s.get("k") == "object" or (s.get("k") == "list" and s["of"].get("k") == "object")
                source = "path" if arg.arg in in_path else "body" if is_model else "query"
            if source == "path":
                req = True
            elif marker is not None and marked:
                # The marker's own default decides, unless the parameter also has a plain default.
                req = marker_req and (default is None or default is marker)
            else:
                req = default is None
            field = _field(s, req, null)
            if source == "body":
                body_fields.append((arg.arg, field))
            else:
                params[f"{source}:{arg.arg}"] = field
        if len(body_fields) == 1:
            body = body_fields[0][1]
        elif body_fields:
            # Several body parameters: FastAPI expects an object with one key per parameter.
            body = _field({"k": "object", "n": "", "f": dict(sorted(body_fields))}, True, False)
        else:
            body = None
        response_ann = Contracts._kwarg(decorator, "response_model") if decorator is not None else None
        if response_ann is None:
            response_ann = handler.returns
        response = None
        if response_ann is not None and not (isinstance(response_ann, ast.Constant) and response_ann.value is None):
            response, _ = self.shape(module, response_ann)
        return {"params": dict(sorted(params.items())), "body": body, "response": response}

    def _source(self, module: Module, default: ast.expr | None) -> tuple[str | None, bool]:
        """Where a parameter comes from (`Query(…)`, `Depends(…)`…) and whether it is required."""
        if not isinstance(default, ast.Call):
            return None, default is None
        name = self._short(self._name(module, default.func))
        if name in ("Depends", "Security"):
            return "depends", False
        if name in SOURCES:
            first = default.args[0] if default.args else Contracts._kwarg(default, "default")
            required = first is None or (isinstance(first, ast.Constant) and first.value is Ellipsis)
            if any(k.arg == "default_factory" for k in default.keywords):
                required = False
            return SOURCES[name], required
        return None, False

    @staticmethod
    def _kwarg(call: ast.Call, name: str) -> ast.expr | None:
        return next((k.value for k in call.keywords if k.arg == name), None)
