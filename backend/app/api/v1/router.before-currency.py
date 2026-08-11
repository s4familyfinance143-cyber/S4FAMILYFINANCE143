from fastapi import APIRouter

from app.api.v1.accounts import router as account_router
from app.api.v1.audit_logs import router as audit_logs_router
from app.api.v1.auth import router as auth_router
from app.api.v1.backup import router as backup_router
from app.api.v1.budgets import router as budgets_router
from app.api.v1.categories import router as category_router
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.families import router as family_router
from app.api.v1.goals import router as goals_router
from app.api.v1.invites import router as invite_router
from app.api.v1.join_requests import router as join_request_router
from app.api.v1.loans import router as loans_router
from app.api.v1.notifications import router as notifications_router
from app.api.v1.permissions import router as permission_router
from app.api.v1.recurring import router as recurring_router
from app.api.v1.reports import router as reports_router
from app.api.v1.savings import router as savings_router
from app.api.v1.transactions import router as transaction_router

api_router = APIRouter()

api_router.include_router(auth_router)
api_router.include_router(backup_router)
api_router.include_router(family_router)
api_router.include_router(invite_router)
api_router.include_router(join_request_router)
api_router.include_router(permission_router)
api_router.include_router(account_router)
api_router.include_router(transaction_router)
api_router.include_router(category_router)
api_router.include_router(reports_router)
api_router.include_router(savings_router)
api_router.include_router(loans_router)
api_router.include_router(recurring_router)
api_router.include_router(budgets_router)
api_router.include_router(notifications_router)
api_router.include_router(goals_router)
api_router.include_router(audit_logs_router)
api_router.include_router(dashboard_router)