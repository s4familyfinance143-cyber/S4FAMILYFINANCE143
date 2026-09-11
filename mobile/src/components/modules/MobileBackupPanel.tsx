import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { tMobile, type MobileLang } from "../../i18n";
import { documentScanner } from "../../services/documentScanner";
import { queueMobileDocumentUpload } from "../../lib/offlineFileQueue";

type BackupFile = {
  file_name: string;
  size_bytes?: number;
  created_at?: string;
};

type Props = {
  token: string;
  familyId: string;
  apiBaseUrl: string;
  lang?: MobileLang;
  apiGet: (path: string, authToken?: string) => Promise<any>;
  apiPost: (path: string, body: object, authToken?: string) => Promise<any>;
  onMessage: (message: string, ok?: boolean) => void;
};

async function downloadBackupBlob(
  apiBaseUrl: string,
  familyId: string,
  fileName: string,
  token: string
): Promise<void> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (apiBaseUrl.includes("loca.lt")) headers["bypass-tunnel-reminder"] = "true";
  const path = `/api/v1/backup/download/${familyId}/${encodeURIComponent(fileName)}`;
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}${path}`, { headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === "object" ? JSON.stringify(data.detail) : data.detail || `Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const contentType = response.headers.get("content-type") || blob.type || "application/octet-stream";

  if (Platform.OS === "web" && typeof document !== "undefined") {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return;
  }

  const FileSystemMod = await import("expo-file-system");
  const Sharing = await import("expo-sharing");
  const FileSystem: any = (FileSystemMod as any).default ?? FileSystemMod;
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const base64 = globalThis.btoa(binary);
  const directory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!directory) throw new Error("No writable cache directory");
  const uri = `${directory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: contentType, dialogTitle: fileName });
  }
}

export function MobileBackupPanel({
  token,
  familyId,
  apiBaseUrl,
  lang = "bn",
  apiGet,
  apiPost,
  onMessage,
}: Props) {
  const tm = (key: string) => tMobile(lang, key);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState("");
  const [downloading, setDownloading] = useState("");
  const [integrity, setIntegrity] = useState<any>(null);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [lastScan, setLastScan] = useState("");

  async function scanDocument(mode: "pick" | "camera") {
    setScanBusy(true);
    try {
      const doc =
        mode === "camera" ? await documentScanner.captureDocumentPhoto() : await documentScanner.pickDocument();
      if (!doc) {
        onMessage("Document scan cancelled", false);
        return;
      }
      setLastScan(`${doc.name} · ${doc.source}`);
      try {
        await queueMobileDocumentUpload({
          familyId,
          itemId: `scan-${Date.now()}`,
          fileUri: doc.uri,
          fileName: doc.name,
          mimeType: doc.mimeType || "application/octet-stream",
        });
      } catch {
        /* queue optional */
      }
      onMessage(`Document captured: ${doc.name} (${documentScanner.engine})`, true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Document scan failed", false);
    } finally {
      setScanBusy(false);
    }
  }

  const load = useCallback(async () => {
    if (!token || !familyId) return;
    setLoading(true);
    try {
      const [integrityRes, listRes] = await Promise.all([
        apiGet("/api/v1/backup/integrity", token),
        apiGet(`/api/v1/backup/list/${familyId}`, token),
      ]);
      setIntegrity(integrityRes);
      setBackups(listRes?.backups || []);
      onMessage(tMobile(lang, "backupLoaded"), true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Backup load failed", false);
      setBackups([]);
    } finally {
      setLoading(false);
    }
  }, [apiGet, familyId, lang, onMessage, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function createBackup() {
    setCreating(true);
    try {
      await apiPost(`/api/v1/backup/create/${familyId}`, {}, token);
      onMessage(tm("backupCreated"), true);
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Backup create failed", false);
    } finally {
      setCreating(false);
    }
  }

  async function previewRestore(fileName: string) {
    setPreviewing(fileName);
    try {
      const data = await apiGet(
        `/api/v1/backup/restore/preview-file/${familyId}?file_name=${encodeURIComponent(fileName)}`,
        token
      );
      setPreview(data);
      onMessage(tm("backupPreviewReady"), true);
    } catch (error) {
      setPreview(null);
      onMessage(error instanceof Error ? error.message : "Preview failed", false);
    } finally {
      setPreviewing("");
    }
  }

  async function downloadBackup(fileName: string) {
    if (!apiBaseUrl) {
      onMessage(tm("backupDownloadFailed") || "Backup download failed", false);
      return;
    }
    setDownloading(fileName);
    try {
      await downloadBackupBlob(apiBaseUrl, familyId, fileName, token);
      onMessage(tm("backupDownloadStarted") || "Download started", true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : tm("backupDownloadFailed") || "Backup download failed", false);
    } finally {
      setDownloading("");
    }
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{tm("backupCenter")}</Text>
      <Text style={styles.sub}>{tm("backupHint")}</Text>

      <View style={styles.row}>
        <View style={styles.card}>
          <Text style={styles.label}>{tm("databaseIntegrity")}</Text>
          <Text style={styles.value}>{integrity?.ok ? "OK" : "—"}</Text>
          <Text style={styles.muted}>{integrity?.integrity_check || tm("refreshToCheck")}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>{tm("availableBackups")}</Text>
          <Text style={styles.value}>{String(backups.length)}</Text>
          <Text style={styles.muted}>{tm("familyScopedBackupFiles")}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.secondaryButton} onPress={load} disabled={loading}>
          <Text style={styles.secondaryButtonText}>{loading ? tm("loading") : tm("refreshBackups")}</Text>
        </Pressable>
        <Pressable style={styles.primaryButton} onPress={createBackup} disabled={creating || loading}>
          <Text style={styles.primaryButtonText}>{creating ? tm("creatingBackup") : tm("createBackup")}</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Document Scan</Text>
      <Text style={styles.muted}>
        Expo document capture ({documentScanner.engine}). Barcode uses expo-camera; receipts/docs use picker + camera.
      </Text>
      <View style={styles.actions}>
        <Pressable style={styles.secondaryButton} onPress={() => void scanDocument("pick")} disabled={scanBusy}>
          <Text style={styles.secondaryButtonText}>{scanBusy ? "..." : "Pick Document / Image"}</Text>
        </Pressable>
        <Pressable style={styles.primaryButton} onPress={() => void scanDocument("camera")} disabled={scanBusy}>
          <Text style={styles.primaryButtonText}>{scanBusy ? "..." : "Camera Capture"}</Text>
        </Pressable>
      </View>
      {lastScan ? <Text style={styles.muted}>Last scan: {lastScan}</Text> : null}

      <Text style={styles.section}>{tm("backupFiles")}</Text>
      {backups.length === 0 ? (
        <Text style={styles.muted}>{tm("noBackupsYet")}</Text>
      ) : (
        backups.map((backup) => (
          <View style={styles.fileCard} key={backup.file_name}>
            <Text style={styles.fileName}>{backup.file_name}</Text>
            <Text style={styles.muted}>
              {backup.size_bytes != null ? `${backup.size_bytes} bytes` : ""}
              {backup.created_at ? ` · ${backup.created_at}` : ""}
            </Text>
            <View style={styles.actions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => previewRestore(backup.file_name)}
                disabled={previewing === backup.file_name}
              >
                <Text style={styles.secondaryButtonText}>
                  {previewing === backup.file_name ? tm("previewing") : tm("previewRestore")}
                </Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={() => void downloadBackup(backup.file_name)}
                disabled={downloading === backup.file_name}
              >
                <Text style={styles.primaryButtonText}>
                  {downloading === backup.file_name ? tm("downloading") || "..." : tm("download")}
                </Text>
              </Pressable>
            </View>
          </View>
        ))
      )}

      {preview ? (
        <View style={styles.previewCard}>
          <Text style={styles.section}>{tm("restorePreview")}</Text>
          <Text style={styles.value}>{preview.restore_safe ? "Valid Backup" : "Not Safe"}</Text>
          <Text style={styles.muted}>{preview.message}</Text>
          <Text style={styles.muted}>
            {(preview.contains_files || []).join(", ") || "—"}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#ffffff", borderRadius: 18, borderWidth: 1, borderColor: "#dce7e3", padding: 14, gap: 12 },
  title: { fontSize: 20, fontWeight: "900", color: "#17211e" },
  sub: { color: "#5f746d", fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", gap: 10 },
  card: { flex: 1, backgroundColor: "#f5faf8", borderRadius: 14, padding: 12, gap: 4 },
  label: { color: "#5f746d", fontSize: 11, fontWeight: "700" },
  value: { color: "#0f8f6f", fontSize: 18, fontWeight: "900" },
  muted: { color: "#7a8f88", fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  section: { fontSize: 15, fontWeight: "800", color: "#17211e", marginTop: 4 },
  fileCard: { backgroundColor: "#f5faf8", borderRadius: 14, padding: 12, gap: 8 },
  fileName: { color: "#17211e", fontWeight: "800", fontSize: 13 },
  previewCard: { backgroundColor: "#eef8f4", borderRadius: 14, padding: 12, gap: 6 },
  primaryButton: { backgroundColor: "#0f8f6f", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 },
  primaryButtonText: { color: "#ffffff", fontWeight: "800", textAlign: "center" },
  secondaryButton: { borderWidth: 1, borderColor: "#c9dbd4", borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, backgroundColor: "#ffffff" },
  secondaryButtonText: { color: "#0b6f58", fontWeight: "800", textAlign: "center" },
});
