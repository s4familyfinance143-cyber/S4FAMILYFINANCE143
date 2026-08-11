from datetime import date, datetime

from pydantic import BaseModel, Field


class TaskCreateRequest(BaseModel):
    family_id: str
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    due_date: date | None = None
    priority: str = "MEDIUM"
    assigned_to_member_id: str | None = None
    reminder_at: datetime | None = None


class TaskUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    due_date: date | None = None
    priority: str | None = None
    status: str | None = None
    assigned_to_member_id: str | None = None
    reminder_at: datetime | None = None


class CalendarEventCreateRequest(BaseModel):
    family_id: str
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    event_date: date
    start_time: str | None = None
    end_time: str | None = None
    event_type: str = "GENERAL"
    reminder_at: datetime | None = None


class CalendarEventUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    event_date: date | None = None
    start_time: str | None = None
    end_time: str | None = None
    event_type: str | None = None
    status: str | None = None
    reminder_at: datetime | None = None


class OwnershipTransferCreateRequest(BaseModel):
    to_member_id: str
    note: str | None = None


class MemberRoleUpdateRequest(BaseModel):
    role: str = Field(description="MEMBER, ADMIN, VIEWER, or CHILD")
