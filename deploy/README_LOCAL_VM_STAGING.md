# Local VM staging — finish remaining deploy work without a paid VPS

Use a Virtual Machine as a **staging server** for the remaining architecture ops work
(Docker stack, Postgres, Nginx, backup drills). This does **not** replace a public
domain + Let's Encrypt for real go-live, but it unblocks almost all remaining
server-side practice on your PC.

## What you can finish on a VM

| Remaining work | On local VM? |
|----------------|--------------|
| Docker production compose (backend/frontend/postgres/redis/minio) | Yes |
| Alembic migrate + health smoke | Yes |
| Postgres dump / restore drill | Yes |
| Nginx reverse proxy | Yes |
| Self-signed TLS practice | Yes |
| Real public DNS + Let's Encrypt | No (needs public IP/domain) |
| Real FCM push | Needs Firebase JSON (any host) |
| Real SMTP provider | Needs provider credentials |

## Recommended VM shape

- OS: **Ubuntu 24.04 LTS** (Desktop ISO is easiest on VirtualBox)
- RAM: **4 GB+** (8 GB better)
- Disk: **40 GB+** (VDI, dynamically allocated)
- Hypervisor: **VirtualBox** (detected on this PC: 7.x)
- Network: start with **NAT + port forwarding**; switch to **Bridged** when you want host browser → VM IP

## VirtualBox on this Windows PC (you already have it)

Confirmed: `VBoxManage` at `C:\Program Files\Oracle\VirtualBox\` (no S4 VM created yet).

### 1) Download Ubuntu ISO (host)

- Ubuntu 24.04 Desktop: https://ubuntu.com/download/desktop  
- Save ISO somewhere easy, e.g. `D:\ISOs\ubuntu-24.04-desktop-amd64.iso`

### 2) Create VM in VirtualBox GUI

1. New → Name: `s4-staging` → Type: Linux → Ubuntu (64-bit)
2. Memory: **4096 MB** minimum (8192 if PC has RAM)
3. Create virtual disk: **40 GB**, VDI, Dynamically allocated
4. Settings → System → Processor: **2 CPUs**
5. Settings → Storage → Controller → Empty → choose the Ubuntu ISO
6. Settings → Network → Adapter 1 → **NAT**
7. Settings → Network → Advanced → Port Forwarding (optional but useful):

| Name | Protocol | Host IP | Host Port | Guest IP | Guest Port |
|------|----------|---------|-----------|----------|------------|
| s4-http | TCP |  | 8088 |  | 80 |
| s4-api | TCP |  | 8000 |  | 8000 |
| s4-ssh | TCP |  | 2222 |  | 22 |
| s4-mail | TCP |  | 8025 |  | 8025 |

8. Start VM → install Ubuntu (normal guided install) → reboot → remove ISO from Storage if asked

### 3) Shared folder (copy project from `S:\`)

1. Install **Guest Additions**: VM menu → Devices → Insert Guest Additions CD → run installer inside Ubuntu → reboot
2. Settings → Shared Folders → Add:
   - Folder Path: `S:\S4-FAMILY-FINANCE-143-FINAL`
   - Folder Name: `s4`
   - Auto-mount + Make Permanent
3. Inside Ubuntu:

```bash
sudo usermod -aG vboxsf $USER
# log out / log in
ls /media/sf_s4
# or:
ls ~/sf_s4
```

If auto-mount path differs, check `/media/sf_*`.

### 4) Inside Ubuntu — Docker + staging stack

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# log out / log in

# use shared folder / tarball from release kit / clone
# Host package: deploy/scripts/package_release.ps1 → copy tar into VM
cd /media/sf_s4   # adjust if needed
cp deploy/docker/.env.staging.example deploy/docker/.env.production
nano deploy/docker/.env.production
# replace CHANGE_ME_* passwords; keep Mailpit SMTP block for staging

cd deploy/docker
docker compose --env-file .env.production -f docker-compose.production.yml --profile staging up -d --build
```

Full operator spine (package → VPS): [`README_RELEASE_KIT.md`](README_RELEASE_KIT.md)

### Host → VM sync (after code changes)

From Windows (NAT 2222/8088):

#### SSH environment variables

Before running any `vm_*.py` SSH script, set one authentication method:

- `S4_VM_PASSWORD` — VM login password (also used for sudo commands), or
- `S4_VM_SSH_KEY` — path to the VM user's private SSH key.

Optional connection settings are `S4_VM_HOST`, `S4_VM_PORT`, `S4_VM_USER`, and
`S4_VM_KNOWN_HOSTS`. Scripts default to the local-lab host, forwarded port, and
user; setting `S4_VM_KNOWN_HOSTS` enables host-key verification by default.

```powershell
powershell -ExecutionPolicy Bypass -File deploy\scripts\package_release.ps1
$env:PYTHONUNBUFFERED=1
.\backend\.venv\Scripts\python.exe -u deploy\scripts\vm_wait_sync_rebuild.py
powershell -ExecutionPolicy Bypass -File deploy\scripts\verify_live.ps1 -BaseUrl http://127.0.0.1:8088
.\backend\.venv\Scripts\python.exe -u deploy\scripts\vm_login_smoke.py
.\backend\.venv\Scripts\python.exe -u deploy\scripts\vm_wait_backup_drill.py
.\backend\.venv\Scripts\python.exe -u deploy\scripts\vm_selfsigned_tls_practice.py
```

### 5) Test from Windows host

With NAT port forward above:

```powershell
Invoke-WebRequest http://127.0.0.1:8088/api/health
Invoke-WebRequest http://127.0.0.1:8088/api/auth/email-status
# Mailpit UI (add NAT forward host 8025 → guest 8025):
Start-Process http://127.0.0.1:8025
```

Optional CLI create (if you prefer command line later):

```powershell
& "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" list vms
```

## One-time VM setup (inside Ubuntu)

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
# Docker Engine + Compose plugin (official Docker docs for Ubuntu)
sudo usermod -aG docker $USER
# log out / back in after docker group change
```

Copy the project into the VM (VirtualBox Shared Folder, `scp`, or `git clone`).

## Staging deploy (inside VM)

```bash
cd /path/to/S4-FAMILY-FINANCE-143-FINAL
cp deploy/docker/.env.production.example deploy/docker/.env.production
# edit secrets: POSTGRES_PASSWORD, JWT_SECRET_KEY, REDIS_PASSWORD, MINIO_*, CORS_ORIGINS, APP_PUBLIC_URL
# APP_PUBLIC_URL can be http://<vm-lan-ip> for bridged networking

cd deploy/docker
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

Checks:

```bash
curl -s http://127.0.0.1:8000/health || curl -s http://127.0.0.1/health
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

From Windows host (bridged VM IP example):

```powershell
Invoke-WebRequest http://192.168.x.x/health
```

Point PC frontend temporarily:

```env
VITE_API_BASE=http://192.168.x.x:8000
```

(or the nginx-published port from compose)

## Windows host checklist (no VM yet)

If Docker Desktop is already on Windows, you can practice the same stack without a VM:

```powershell
cd S:\S4-FAMILY-FINANCE-143-FINAL
powershell -ExecutionPolicy Bypass -File deploy\scripts\validate_production_packaging.ps1
powershell -ExecutionPolicy Bypass -File deploy\scripts\run_local_vm_staging_checklist.ps1
```

Postgres cutover drill (keeps live sqlite `:8000` unless you explicitly switch):

```powershell
cd S:\S4-FAMILY-FINANCE-143-FINAL\deploy\postgres
docker compose up -d
```

See `deploy/postgres/README.md`.

## After VM staging works — still blocked on you

1. Public VPS **or** port-forward + real domain (only for true go-live)
2. Firebase service-account JSON → FCM
3. Production SMTP credentials

## Safety

- Do **not** casually flip live Windows `:8000` to Postgres while sqlite holds your real `test@s4family.com` family data.
- Prefer side-by-side `:8001` Postgres API (`backend/scripts/start_postgres_api_sidebyside.ps1`) until you decide to migrate rows.
- Never commit `.env.production` with real secrets.
