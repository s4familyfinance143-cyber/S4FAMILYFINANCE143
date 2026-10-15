"""alembic/env.py imports model modules by name. Deleting a model file while
env.py still imports it makes `alembic upgrade head` crash on deploy (the
backend container runs it on start), so every import there must resolve."""

from __future__ import annotations

import ast
import importlib
from pathlib import Path

ENV = Path(__file__).resolve().parents[1] / "alembic" / "env.py"


def test_alembic_env_imports_resolve():
    tree = ast.parse(ENV.read_text(encoding="utf-8-sig"))
    modules = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(a.name for a in node.names if a.name.startswith("app."))
        elif isinstance(node, ast.ImportFrom) and (node.module or "").startswith("app."):
            modules.add(node.module)
    assert modules, "expected app.* imports in alembic/env.py"
    for name in sorted(modules):
        importlib.import_module(name)
