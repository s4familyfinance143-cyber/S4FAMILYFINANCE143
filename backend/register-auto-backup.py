from pathlib import Path

p = Path("app/main.py")
text = p.read_text(encoding="utf-8")

if "process_auto_backup" not in text:
    text = text.replace(
        "from app.workers.recurring_scheduler import (\n    process_recurring_transactions,\n)",
        "from app.workers.recurring_scheduler import (\n    process_recurring_transactions,\n)\nfrom app.workers.auto_backup_worker import process_auto_backup",
        1,
    )

if "async def auto_backup_worker()" not in text:
    insert = '''

async def auto_backup_worker():
    while True:
        try:
            result = process_auto_backup()
            print("Auto Backup Worker:", result)
        except Exception as e:
            print("Auto Backup Worker Error:", str(e))

        await asyncio.sleep(3600)

'''

    text = text.replace(
        "\n@app.on_event(\"startup\")\nasync def startup_event():",
        insert + "\n@app.on_event(\"startup\")\nasync def startup_event():",
        1,
    )

if "asyncio.create_task(auto_backup_worker())" not in text:
    text = text.replace(
        "asyncio.create_task(recurring_worker())",
        "asyncio.create_task(recurring_worker())\n    asyncio.create_task(auto_backup_worker())",
        1,
    )

p.write_text(text, encoding="utf-8")
print("AUTO BACKUP SCHEDULER REGISTERED OK")
