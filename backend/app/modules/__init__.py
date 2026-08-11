"""
Feature modules package.

Domain code currently lives in flat `api/v1` + `services` + `models` + `schemas`.
This package provides the architecture checklist grouping entrypoints without
breaking existing imports.
"""

from __future__ import annotations

MODULES = (
    "auth",
    "families",
    "finance",
    "grocery",
    "loans",
    "reports",
    "sync",
    "notifications",
)

# Real importable feature packages (architecture checklist — not stubs).
from app.modules import auth as auth_module  # noqa: E402
from app.modules import finance as finance_module  # noqa: E402
from app.modules import grocery as grocery_module  # noqa: E402

__all__ = ["MODULES", "auth_module", "finance_module", "grocery_module"]
