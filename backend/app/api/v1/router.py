from fastapi import APIRouter

from app.api.v1.accounts import router as account_router
from app.api.v1.accounting import router as accounting_router
from app.api.v1.architecture_api_contract import router as architecture_api_contract_router
from app.api.v1.architecture_features_api import router as architecture_features_router
from app.api.v1.architecture_modules_api import router as architecture_modules_router
from app.api.v1.architecture_system_api import router as architecture_system_router
from app.api.v1.audit_logs import router as audit_logs_router
from app.api.v1.auth import router as auth_router
from app.api.v1.backup import router as backup_router
from app.api.v1.budgets import router as budgets_router
from app.api.v1.categories import router as category_router
from app.api.v1.compat_aliases import router as compat_alias_router
from app.api.v1.currency import router as currency_router
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.families import router as family_router
from app.api.v1.goals import router as goals_router
from app.api.v1.grocery import router as grocery_router
from app.api.v1.invites import router as invite_router
from app.api.v1.join_requests import router as join_request_router
from app.api.v1.jobs import router as jobs_router
from app.api.v1.life_planner import router as life_planner_router
from app.api.v1.loans import router as loans_router
from app.api.v1.missing_features_api import router as missing_features_router
from app.api.v1.notifications import router as notifications_router
from app.api.v1.phase15 import router as phase15_router
from app.api.v1.phase16 import router as phase16_router
from app.api.v1.permissions import router as permission_router
from app.api.v1.recurring import router as recurring_router
from app.api.v1.reports import router as reports_router
from app.api.v1.savings import router as savings_router
from app.api.v1.transactions import router as transaction_router
from app.api.v1.zakat import router as zakat_router

api_router = APIRouter()

api_router.include_router(auth_router)
api_router.include_router(architecture_api_contract_router)
api_router.include_router(backup_router)
api_router.include_router(family_router)
api_router.include_router(invite_router)
api_router.include_router(join_request_router)
api_router.include_router(permission_router)
api_router.include_router(account_router)
api_router.include_router(accounting_router)
api_router.include_router(transaction_router)
api_router.include_router(missing_features_router)
api_router.include_router(category_router)
api_router.include_router(compat_alias_router)
api_router.include_router(currency_router)
api_router.include_router(reports_router)
api_router.include_router(savings_router)
api_router.include_router(loans_router)
api_router.include_router(recurring_router)
api_router.include_router(budgets_router)
api_router.include_router(notifications_router)
api_router.include_router(goals_router)
api_router.include_router(grocery_router)
api_router.include_router(audit_logs_router)
api_router.include_router(dashboard_router)
api_router.include_router(zakat_router)
api_router.include_router(phase15_router)
api_router.include_router(phase16_router)
api_router.include_router(architecture_modules_router)
api_router.include_router(architecture_features_router)
api_router.include_router(architecture_system_router)
api_router.include_router(life_planner_router)
api_router.include_router(jobs_router)
