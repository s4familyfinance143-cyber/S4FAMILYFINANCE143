const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const _SCRIPT_ID = "s4-google-identity-services";
const TOKEN_KEY = "s4_google_drive_token";
const TOKEN_EXP_KEY = "s4_google_drive_token_exp";

function readEnv(key) {
  const v = import.meta.env[key];
  return typeof v === "string" ? v.trim() : "";
}

export function isGoogleDriveConfigured() {
  return Boolean(readEnv("VITE_GOOGLE_CLIENT_ID"));
}

export function getGoogleClientId() {
  return readEnv("VITE_GOOGLE_CLIENT_ID");
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(el);
  });
}

export async function ensureGoogleIdentityScript() {
  await loadScript("https://accounts.google.com/gsi/client");
  if (!window.google?.accounts?.oauth2) {
    throw new Error("Google Identity Services unavailable");
  }
}

function storeToken(accessToken, expiresInSeconds = 3500) {
  try {
    sessionStorage.setItem(TOKEN_KEY, accessToken);
    sessionStorage.setItem(TOKEN_EXP_KEY, String(Date.now() + expiresInSeconds * 1000));
  } catch {
    /* ignore */
  }
}

export function getStoredDriveToken() {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const exp = Number(sessionStorage.getItem(TOKEN_EXP_KEY) || 0);
    if (!token || !exp || Date.now() > exp) return null;
    return token;
  } catch {
    return null;
  }
}

export function clearStoredDriveToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXP_KEY);
  } catch {
    /* ignore */
  }
}

export async function connectGoogleDrive({ prompt = "" } = {}) {
  if (!isGoogleDriveConfigured()) {
    throw new Error("Google Drive is not configured (VITE_GOOGLE_CLIENT_ID)");
  }
  await ensureGoogleIdentityScript();
  const clientId = getGoogleClientId();

  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        storeToken(response.access_token, Number(response.expires_in) || 3500);
        resolve(response.access_token);
      },
    });
    client.requestAccessToken({ prompt });
  });
}

export async function getDriveAccessToken() {
  const cached = getStoredDriveToken();
  if (cached) return cached;
  return connectGoogleDrive({ prompt: "consent" });
}

async function driveFetch(path, accessToken, options = {}) {
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Drive API error ${res.status}`);
  }
  return res;
}

export async function uploadBackupToDrive(accessToken, fileName, blob) {
  const metadata = {
    name: fileName,
    mimeType: "application/json",
    description: "S4 Family Finance backup",
  };
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.append("file", blob);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Drive upload failed ${res.status}`);
  }
  return res.json();
}

export async function listDriveBackups(accessToken, limit = 10) {
  const q = encodeURIComponent(
    "name contains 's4-backup-' and mimeType='application/json' and trashed=false",
  );
  const res = await driveFetch(
    `/files?q=${q}&orderBy=modifiedTime desc&pageSize=${limit}&fields=files(id,name,modifiedTime,size)`,
    accessToken,
  );
  const data = await res.json();
  return data.files || [];
}

export async function downloadDriveBackup(accessToken, fileId) {
  const res = await driveFetch(`/files/${fileId}?alt=media`, accessToken);
  return res.blob();
}
