S4 FAMILY FINANCE 143 — Windows installer

Legacy Inno Setup scripts and bundled Setup.exe outputs were removed.

Current Windows installer is built by the Tauri pipeline:

- Script: `deploy/scripts/build_tauri_windows.ps1`
- CI: `.github/workflows/release.yml` → `build-windows-exe`
- Artifact: `S4-Family-Finance-143-Setup.exe` (published on GitHub Releases)
