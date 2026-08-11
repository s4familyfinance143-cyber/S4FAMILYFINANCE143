import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.database import engine
from app.models.base import Base
from app.workers.recurring_scheduler import (
    process_recurring_transactions,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="S4 FAMILY FINANCE API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


async def recurring_worker():
    while True:
        try:
            process_recurring_transactions()
        except Exception as e:
            print("Scheduler Worker Error:", str(e))

        await asyncio.sleep(60)


@app.on_event("startup")
async def startup_event():
    asyncio.create_task(recurring_worker())


@app.get("/")
def root():
    return {
        "message": "S4 FAMILY FINANCE API Running"
    }