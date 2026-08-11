from pathlib import Path

p = Path("app/api/v1/backup.py")
text = p.read_text(encoding="utf-8")

if '@router.get("/restore/preview/{family_id}/{file_name}")' not in text:

    text += '''

@router.get("/restore/preview/{family_id}/{file_name}")
def preview_restore_backup(
    family_id: str,
    file_name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="backup.restore",
    )

    if not file_name.startswith(f"s4_backup_{family_id}_") or not file_name.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Invalid backup file")

    zip_path = BACKUP_DIR / file_name

    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")

    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()

    return {
        "success": True,
        "family_id": family_id,
        "file_name": file_name,
        "contains_files": names,
        "restore_safe": True,
        "message": "Backup file is valid. Full restore must be done with server stopped.",
    }


@router.post("/restore/prepare/{family_id}/{file_name}")
def prepare_restore_backup(
    family_id: str,
    file_name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="backup.restore",
    )

    if not file_name.startswith(f"s4_backup_{family_id}_") or not file_name.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Invalid backup file")

    zip_path = BACKUP_DIR / file_name

    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")

    restore_dir = BACKUP_DIR / "restore_prepare"
    restore_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(restore_dir)

    extracted = [x.name for x in restore_dir.glob("*.db")]

    return {
        "success": True,
        "family_id": family_id,
        "file_name": file_name,
        "prepared_dir": str(restore_dir),
        "extracted_db_files": extracted,
        "next_step": "Stop server, verify extracted DB, then replace current database manually.",
    }

'''

    p.write_text(text, encoding="utf-8")
    print("RESTORE PREVIEW/PREPARE ENDPOINTS ADDED")
else:
    print("RESTORE ENDPOINTS ALREADY EXIST")
