from pydantic import BaseModel


class JoinRequestDecisionRequest(BaseModel):
    action: str  # APPROVE / REJECT
    note: str | None = None
