import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { tMobile, enumLabel, type MobileLang } from "../../i18n";
import { loadModuleSnapshot, saveModuleSnapshot } from "../../lib/offlineSnapshots";
import {
  cacheMobileFile,
  getCachedMobileFile,
  queueMobileDocumentUpload,
} from "../../lib/offlineFileQueue";
import {
  buildCreatePayload,
  closePath,
  createPath,
  updatePath,
  documentDownloadPath,
  documentUploadPath,
  listPath,
  normalizeLifeItem,
  offlineEntityType,
} from "../../services/lifeArchitectureApi";

type PhaseItem = {
  id: string;
  module_type: string;
  name: string;
  category?: string;
  sub_type?: string;
  amount?: string;
  currency?: string;
  status?: string;
  renewal_or_expiry_date?: string | null;
  provider?: string | null;
  reference?: string | null;
  has_file?: boolean;
  file_name?: string | null;
  file_size?: number | null;
  file_encrypted?: boolean;
};

type UpcomingRow = {
  id: string;
  module_type?: string;
  name?: string;
  due_date?: string;
  amount?: string;
  currency?: string;
};

type Props = {
  token: string;
  familyId: string;
  currency: string;
  apiBaseUrl: string;
  apiGet: (path: string, authToken?: string) => Promise<any>;
  apiPost: (path: string, body: object, authToken?: string) => Promise<any>;
  apiPatch: (path: string, body: object, authToken?: string) => Promise<any>;
  formatAmount: (value?: string | number | null, currency?: string) => string;
  onMessage: (message: string, ok?: boolean) => void;
  lang?: MobileLang;
  onQueueOffline?: (entityType: string, action: string, payload: object) => Promise<void>;
  initialModuleType?: string;
};

const PHASE15_TYPES = ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"] as const;
const PHASE16_TYPES = ["SUBSCRIPTION", "DOCUMENT", "PROPERTY"] as const;

const PHASE15_SUB: Record<string, string[]> = {
  INVESTMENT: ["STOCK", "MUTUAL_FUND", "FIXED_DEPOSIT", "GOLD", "DPS", "FDR", "SHARES", "SAVINGS_CERTIFICATE", "OTHER"],
  HEALTH: ["DOCTOR", "MEDICINE", "HOSPITAL", "TEST", "CHECKUP", "INSURANCE", "OTHER"],
  VEHICLE: ["FUEL", "SERVICE", "TAX", "INSURANCE", "CAR", "BIKE", "OTHER"],
  EDUCATION: ["SCHOOL_FEE", "COACHING", "BOOKS", "SUPPLIES", "TUITION", "COURSE", "OTHER"],
};

const PHASE16_SUB: Record<string, string[]> = {
  SUBSCRIPTION: ["STREAMING", "DOMAIN", "HOSTING", "SOFTWARE", "OTHER"],
  DOCUMENT: ["NID", "PASSPORT", "BIRTH_CERTIFICATE", "DEED", "OTHER"],
  PROPERTY: ["HOUSE", "LAND", "SHOP", "APARTMENT", "OTHER"],
};

function formatBytes(size?: number | null) {
  const value = Number(size || 0);
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveLifeTab(moduleType: string): "PHASE15" | "PHASE16" {
  return (PHASE16_TYPES as readonly string[]).includes(moduleType) ? "PHASE16" : "PHASE15";
}

export function LifeModulesPanel({
  token,
  familyId,
  currency,
  apiBaseUrl,
  apiGet,
  apiPost,
  apiPatch,
  formatAmount,
  onMessage,
  lang = "bn",
  onQueueOffline,
  initialModuleType,
}: Props) {
  const tm = (key: string) => tMobile(lang, key);
  const el = (code: string) => enumLabel(lang, code);
  const [tab, setTab] = useState<"PHASE15" | "PHASE16">(
    initialModuleType ? resolveLifeTab(initialModuleType) : "PHASE15"
  );
  const [moduleType, setModuleType] = useState<string>(initialModuleType || "INVESTMENT");
  const [items, setItems] = useState<PhaseItem[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingRow[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [members, setMembers] = useState<{ id: string; label: string }[]>([]);
  const [pendingFile, setPendingFile] = useState<File | { uri: string; name: string; mimeType?: string } | null>(null);
  const webFileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string>("");
  const [form, setForm] = useState({
    name: "",
    sub_type: "",
    amount: "0",
    renewal_or_expiry_date: "",
    provider: "",
    reference: "",
    billing_cycle: "MONTHLY",
    member_id: "",
    note: "",
  });

  useEffect(() => {
    if (!initialModuleType) return;
    setModuleType(initialModuleType);
    setTab(resolveLifeTab(initialModuleType));
  }, [initialModuleType]);

  const types = tab === "PHASE15" ? PHASE15_TYPES : PHASE16_TYPES;
  const subOptions = (tab === "PHASE15" ? PHASE15_SUB : PHASE16_SUB)[moduleType] || [];
  const needsMember = tab === "PHASE15" && (moduleType === "HEALTH" || moduleType === "EDUCATION");
  const isDocument = moduleType === "DOCUMENT";

  const load = useCallback(async () => {
    if (!token || !familyId) return;
    setLoading(true);
    try {
      const listRaw = await apiGet(listPath(moduleType, familyId), token);
      const list = (Array.isArray(listRaw) ? listRaw : []).map((row: any) => normalizeLifeItem(moduleType, row));
      // Summary/upcoming come from the dedicated life-modules APIs (not phase15/16).
      let sum: any = null;
      let upcomingRows: UpcomingRow[] = [];
      try {
        const [s, upcomingPayload] = await Promise.all([
          apiGet(`/api/v1/life-modules/summary?family_id=${encodeURIComponent(familyId)}`, token),
          apiGet(`/api/v1/life-modules/upcoming?family_id=${encodeURIComponent(familyId)}&days=30`, token),
        ]);
        sum = s;
        upcomingRows = Array.isArray(upcomingPayload?.items) ? upcomingPayload.items : upcomingPayload?.upcoming || [];
      } catch {
        sum = { modules: { [moduleType]: { active: list.filter((i: PhaseItem) => i.status === "ACTIVE").length } } };
      }
      setItems(list);
      setSummary(sum);
      setUpcoming(
        upcomingRows.filter((row: UpcomingRow) => !row.module_type || row.module_type === moduleType)
      );
      try {
        const memberPayload = await apiGet(`/api/v1/permissions/family/${familyId}/members`, token);
        const rows = Array.isArray(memberPayload) ? memberPayload : memberPayload?.members || [];
        setMembers(
          rows
            .map((row: any) => ({
              id: row.member_id || row.id,
              label: row.display_name || row.relationship_display_label || row.name || row.user_email || row.member_id || row.id,
            }))
            .filter((row: { id: string }) => row.id)
        );
      } catch {
        setMembers([]);
      }
      onMessage(`${moduleType} loaded (${list.length})`, true);
      await saveModuleSnapshot(familyId, `life:${tab}:${moduleType}`, {
        items: list,
        summary: sum,
        upcoming: upcomingRows.filter((row: UpcomingRow) => !row.module_type || row.module_type === moduleType),
      });
    } catch (error) {
      const cached = await loadModuleSnapshot<{ items: PhaseItem[]; summary: any; upcoming: UpcomingRow[] }>(
        familyId,
        `life:${tab}:${moduleType}`
      );
      if (cached) {
        setItems(Array.isArray(cached.items) ? cached.items : []);
        setSummary(cached.summary || null);
        setUpcoming(Array.isArray(cached.upcoming) ? cached.upcoming : []);
        onMessage("Offline life cache loaded", true);
      } else {
        onMessage(error instanceof Error ? error.message : "Life module load failed", false);
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [apiGet, familyId, moduleType, onMessage, tab, token]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      sub_type: "",
      member_id: "",
      billing_cycle: moduleType === "SUBSCRIPTION" ? "MONTHLY" : prev.billing_cycle,
    }));
    setPendingFile(null);
    load();
  }, [load, moduleType, tab]);

  async function uploadDocumentFile(itemId: string, file: File | { uri: string; name: string; mimeType?: string }) {
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    if (!online) {
      if (Platform.OS === "web" && file instanceof File) {
        throw new Error("Web offline document queue needs native file URI — connect once or use mobile app");
      }
      const nativeFile = file as { uri: string; name: string; mimeType?: string };
      await queueMobileDocumentUpload({
        familyId,
        itemId,
        fileUri: nativeFile.uri,
        fileName: nativeFile.name,
        mimeType: nativeFile.mimeType,
      });
      return { queued: true };
    }

    const formData = new FormData();
    formData.append("family_id", familyId);
    if (Platform.OS === "web" && file instanceof File) {
      formData.append("file", file);
    } else {
      const nativeFile = file as { uri: string; name: string; mimeType?: string };
      formData.append("file", {
        uri: nativeFile.uri,
        name: nativeFile.name,
        type: nativeFile.mimeType || "application/octet-stream",
      } as any);
    }

    const response = await fetch(`${apiBaseUrl}${documentUploadPath(itemId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Network-ish failure → queue for later
      if (Platform.OS !== "web" && !(file instanceof File)) {
        const nativeFile = file as { uri: string; name: string; mimeType?: string };
        await queueMobileDocumentUpload({
          familyId,
          itemId,
          fileUri: nativeFile.uri,
          fileName: nativeFile.name,
          mimeType: nativeFile.mimeType,
        });
        return { queued: true };
      }
      throw new Error(data.detail || "Document upload failed");
    }
    return data;
  }

  async function pickDocumentFile(forItemId = "") {
    setUploadTargetId(forItemId);
    if (Platform.OS === "web") {
      webFileInputRef.current?.click();
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/*", "text/plain", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const picked = { uri: asset.uri, name: asset.name || "document.bin", mimeType: asset.mimeType || undefined };
    if (forItemId) {
      setLoading(true);
      try {
        const resultUpload = await uploadDocumentFile(forItemId, picked);
        onMessage(resultUpload?.queued ? "Document queued offline — will upload when online" : "Document file uploaded (encrypted at rest)", true);
        await load();
      } catch (error) {
        onMessage(error instanceof Error ? error.message : "Upload failed", false);
      } finally {
        setLoading(false);
        setUploadTargetId("");
      }
    } else {
      setPendingFile(picked);
      onMessage(`Selected: ${picked.name}`, true);
    }
  }

  async function onWebFileSelected(event: any) {
    const file = event?.target?.files?.[0] as File | undefined;
    if (event?.target) event.target.value = "";
    if (!file) return;
    if (uploadTargetId) {
      setLoading(true);
      try {
        const resultUpload = await uploadDocumentFile(uploadTargetId, file);
        onMessage(resultUpload?.queued ? "Document queued offline — will upload when online" : "Document file uploaded (encrypted at rest)", true);
        await load();
      } catch (error) {
        onMessage(error instanceof Error ? error.message : "Upload failed", false);
      } finally {
        setLoading(false);
        setUploadTargetId("");
      }
      return;
    }
    setPendingFile(file);
    onMessage(`Selected: ${file.name}`, true);
  }

  async function downloadDocument(item: PhaseItem) {
    setLoading(true);
    const kind = `document-${item.id}`;
    try {
      const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
      if (!online) {
        const cached = await getCachedMobileFile(familyId, kind);
        if (cached?.file_uri) {
          if (Platform.OS === "web") {
            onMessage(`Offline cache ready: ${cached.file_name}`, true);
          } else {
            const Sharing = await import("expo-sharing");
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(cached.file_uri, {
                mimeType: cached.mime_type || "application/octet-stream",
                dialogTitle: cached.file_name,
              });
            }
            onMessage(`Opened offline cache: ${cached.file_name}`, true);
          }
          return;
        }
        throw new Error("No offline copy yet — download once while online");
      }

      const response = await fetch(
        `${apiBaseUrl}${documentDownloadPath(item.id, familyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Download failed");
      }
      const blob = await response.blob();
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = item.file_name || "document.bin";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        onMessage("Document download started", true);
      } else {
        const FileSystem = await import("expo-file-system");
        const Sharing = await import("expo-sharing");
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
        const fileName = item.file_name || `document-${item.id}.bin`;
        const uri = `${directory}${fileName}`;
        await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
        await cacheMobileFile({
          familyId,
          kind,
          fileUri: uri,
          fileName,
          mimeType: blob.type || "application/octet-stream",
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: blob.type || "application/octet-stream", dialogTitle: fileName });
        }
        onMessage(`Document cached offline: ${fileName}`, true);
      }
    } catch (error) {
      try {
        const cached = await getCachedMobileFile(familyId, kind);
        if (cached?.file_uri && Platform.OS !== "web") {
          const Sharing = await import("expo-sharing");
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(cached.file_uri, {
              mimeType: cached.mime_type || "application/octet-stream",
              dialogTitle: cached.file_name,
            });
          }
          onMessage(`Opened offline cache: ${cached.file_name}`, true);
          return;
        }
      } catch {
        /* ignore */
      }
      onMessage(error instanceof Error ? error.message : "Download failed", false);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setEditingId("");
    setForm({
      name: "",
      sub_type: "",
      amount: "0",
      renewal_or_expiry_date: "",
      provider: "",
      reference: "",
      billing_cycle: "MONTHLY",
      member_id: "",
      note: "",
    });
    setPendingFile(null);
  }

  function startEdit(item: PhaseItem) {
    setEditingId(item.id);
    setForm({
      name: item.name || "",
      sub_type: item.sub_type || "",
      amount: String(item.amount ?? "0"),
      renewal_or_expiry_date: item.renewal_or_expiry_date || (item as any).target_date || "",
      provider: item.provider || "",
      reference: item.reference || "",
      billing_cycle: (item as any).billing_cycle || "MONTHLY",
      member_id: (item as any).member_id || "",
      note: (item as any).note || "",
    });
    onMessage(`Editing ${item.name}`, true);
  }

  async function closeItem(item: PhaseItem) {
    setLoading(true);
    try {
      const entityType = offlineEntityType(moduleType);
      const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
      if (onQueueOffline) {
        await onQueueOffline(entityType, "DELETE", {
          family_id: familyId,
          id: item.id,
          entity_id: item.id,
          status: "CLOSED",
        });
        if (token) {
          try {
            const { syncManager } = await import("../../sync/syncManager");
            await syncManager.replayPending(token, familyId, 20);
          } catch {
            /* stay queued */
          }
        }
        if (editingId === item.id) resetForm();
        setItems((prev) => prev.filter((row) => row.id !== item.id));
        onMessage(`${item.name} close queued offline`, true);
        setLoading(false);
        return;
      }
      await apiPost(closePath(moduleType, item.id), { family_id: familyId, reason: "Closed from mobile" }, token);
      if (editingId === item.id) resetForm();
      onMessage(`${item.name} closed`, true);
      await load();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Close failed";
      if (onQueueOffline && /failed to fetch|network|offline/i.test(msg)) {
        const entityType = offlineEntityType(moduleType);
        await onQueueOffline(entityType, "DELETE", {
          family_id: familyId,
          id: item.id,
          entity_id: item.id,
          status: "CLOSED",
        });
        if (editingId === item.id) resetForm();
        onMessage(`${item.name} close queued offline`, true);
        setLoading(false);
        return;
      }
      onMessage(msg, false);
      setLoading(false);
    }
  }

  async function saveItem() {
    if (!form.name.trim()) {
      onMessage(tm("nameRequired"), false);
      return;
    }
    if (!form.sub_type) {
      onMessage("Type/sub_type required", false);
      return;
    }
    if (needsMember && !form.member_id && !editingId) {
      onMessage("Member required for Health/Education", false);
      return;
    }
    if (moduleType === "SUBSCRIPTION" && !form.renewal_or_expiry_date) {
      onMessage("Subscription renewal date required", false);
      return;
    }
    if (moduleType === "DOCUMENT" && !form.renewal_or_expiry_date && !editingId) {
      onMessage("Document expiry date required", false);
      return;
    }
    setLoading(true);
    try {
      const entityType = offlineEntityType(moduleType);
      const payload = buildCreatePayload(moduleType, familyId, currency, form);

      const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
      if (onQueueOffline) {
        const op = editingId ? "UPDATE" : "CREATE";
        if (editingId) {
          (payload as any).id = editingId;
          (payload as any).entity_id = editingId;
        } else {
          (payload as any).module_type = moduleType;
          (payload as any).status = "ACTIVE";
        }
        await onQueueOffline(entityType, op, payload);
        {
          const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
          if (_online && token) {
            try {
              const { syncManager } = await import("../../sync/syncManager");
              await syncManager.replayPending(token, familyId, 20);
            } catch { /* stay queued */ }
          }
        }
        if (isDocument && pendingFile && !editingId) {
          onMessage("Item queued offline — attach file after first sync (needs server id)", true);
        } else {
          onMessage(`${moduleType} queued offline`, true);
        }
        resetForm();
        await load();
        setLoading(false);
        return;
      }

      if (editingId) {
        await apiPatch(updatePath(moduleType, editingId), payload, token);
        onMessage(`${moduleType} updated`, true);
        if (isDocument && pendingFile) {
          await uploadDocumentFile(editingId, pendingFile);
        }
      } else {
        const created = await apiPost(createPath(moduleType), payload, token);
        if (isDocument && pendingFile && created?.id) {
          await uploadDocumentFile(created.id, pendingFile);
          onMessage("Document created + file uploaded (encrypted)", true);
        } else {
          onMessage(`${moduleType} item created`, true);
        }
      }
      resetForm();
      await load();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Save failed";
      if (onQueueOffline && /failed to fetch|network|offline/i.test(msg)) {
        const entityType = offlineEntityType(moduleType);
        const op = editingId ? "UPDATE" : "CREATE";
        const fallback = buildCreatePayload(moduleType, familyId, currency, form) as Record<string, unknown>;
        fallback.module_type = moduleType;
        fallback.status = "ACTIVE";
        if (editingId) {
          fallback.id = editingId;
          fallback.entity_id = editingId;
        }
        await onQueueOffline(entityType, op, fallback);
        onMessage(`${moduleType} queued offline`, true);
        resetForm();
        setLoading(false);
        return;
      }
      onMessage(msg, false);
      setLoading(false);
    }
  }

  const moduleSummary = summary?.modules?.[moduleType];

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{tm("lifeModules")}</Text>
      <Text style={styles.muted}>Investment / Health / Vehicle / Education + Subscription / Document / Property — offline queue + sync</Text>

      {Platform.OS === "web" ? (
        // @ts-expect-error web input element
        <input
          ref={webFileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt,application/pdf,image/*"
          style={{ display: "none" }}
          onChange={onWebFileSelected}
        />
      ) : null}

      <View style={styles.statusRow}>
        <Pressable onPress={() => { setTab("PHASE15"); setModuleType("INVESTMENT"); }}>
          <Text style={[styles.statusPill, tab === "PHASE15" ? styles.ok : null]}>{tm("phase15")}</Text>
        </Pressable>
        <Pressable onPress={() => { setTab("PHASE16"); setModuleType("DOCUMENT"); }}>
          <Text style={[styles.statusPill, tab === "PHASE16" ? styles.ok : null]}>{tm("phase16")}</Text>
        </Pressable>
        <Pressable onPress={load} disabled={loading}>
          <Text style={styles.statusPill}>{loading ? "Loading..." : "Refresh"}</Text>
        </Pressable>
      </View>

      <View style={styles.statusRow}>
        {types.map((type) => (
          <Pressable key={type} onPress={() => setModuleType(type)}>
            <Text style={[styles.statusPill, moduleType === type ? styles.ok : null]}>{el(type)}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.grid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>{tm("active")}</Text>
          <Text style={styles.metricValue}>{String(moduleSummary?.active ?? items.filter((i) => i.status === "ACTIVE").length)}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>{tm("total")}</Text>
          <Text style={styles.metricValue}>{formatAmount(moduleSummary?.total_amount || 0, currency)}</Text>
        </View>
        {moduleType === "SUBSCRIPTION" && moduleSummary?.monthly_cost_total ? (
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>{tm("monthly")}</Text>
            <Text style={styles.metricValue}>{formatAmount(moduleSummary.monthly_cost_total, currency)}</Text>
          </View>
        ) : null}
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>{tm("dueSoon")}</Text>
          <Text style={styles.metricValue}>{String(upcoming.length)}</Text>
        </View>
      </View>

      {upcoming.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>{tm("dueSoon")} ({el(moduleType)})</Text>
          {upcoming.slice(0, 6).map((row) => (
            <View style={styles.listRow} key={row.id}>
              <Text style={styles.listTitle}>{row.name || "Due item"}</Text>
              <Text style={styles.muted}>
                {row.due_date || "soon"} · {formatAmount(row.amount, row.currency || currency)}
              </Text>
            </View>
          ))}
        </>
      ) : null}

      <Text style={styles.sectionLabel}>{editingId ? `${tm("edit")} ${el(moduleType)}` : `${tm("add")} ${el(moduleType)}`}</Text>
      <View style={styles.statusRow}>
        {subOptions.map((option) => (
          <Pressable key={option} onPress={() => setForm((current) => ({ ...current, sub_type: option }))}>
            <Text style={[styles.statusPill, form.sub_type === option ? styles.ok : null]}>{option}</Text>
          </Pressable>
        ))}
      </View>
      {needsMember ? (
        <>
          <Text style={styles.sectionLabel}>{tm("member")}</Text>
          <View style={styles.statusRow}>
            {members.map((member) => (
              <Pressable key={member.id} onPress={() => setForm((c) => ({ ...c, member_id: member.id }))}>
                <Text style={[styles.statusPill, form.member_id === member.id ? styles.ok : null]}>{member.label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <TextInput style={styles.input} placeholder={tm("namePlaceholder")} placeholderTextColor="#8aa39a" value={form.name} onChangeText={(name) => setForm((c) => ({ ...c, name }))} />
      <TextInput style={styles.input} placeholder={tm("amount")} placeholderTextColor="#8aa39a" keyboardType="decimal-pad" value={form.amount} onChangeText={(amount) => setForm((c) => ({ ...c, amount }))} />
      {(moduleType === "SUBSCRIPTION" || moduleType === "DOCUMENT" || moduleType === "INVESTMENT" || moduleType === "VEHICLE" || moduleType === "HEALTH" || moduleType === "EDUCATION") ? (
        <TextInput style={styles.input} placeholder={tm("dueExpiryDate")} placeholderTextColor="#8aa39a" value={form.renewal_or_expiry_date} onChangeText={(renewal_or_expiry_date) => setForm((c) => ({ ...c, renewal_or_expiry_date }))} />
      ) : null}
      {moduleType === "SUBSCRIPTION" ? (
        <View style={styles.statusRow}>
          {["MONTHLY", "YEARLY"].map((cycle) => (
            <Pressable key={cycle} onPress={() => setForm((c) => ({ ...c, billing_cycle: cycle }))}>
              <Text style={[styles.statusPill, form.billing_cycle === cycle ? styles.ok : null]}>{cycle}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {moduleType === "PROPERTY" ? (
        <TextInput style={styles.input} placeholder={tm("location")} placeholderTextColor="#8aa39a" value={form.provider} onChangeText={(provider) => setForm((c) => ({ ...c, provider }))} />
      ) : (
        <TextInput style={styles.input} placeholder={tm("providerRef")} placeholderTextColor="#8aa39a" value={form.reference || form.provider} onChangeText={(value) => setForm((c) => ({ ...c, reference: value, provider: value }))} />
      )}
      <TextInput style={styles.input} placeholder={tm("note")} placeholderTextColor="#8aa39a" value={form.note} onChangeText={(note) => setForm((c) => ({ ...c, note }))} />

      {isDocument ? (
        <>
          <Pressable style={styles.secondaryButton} onPress={() => pickDocumentFile("")} disabled={loading}>
            <Text style={styles.secondaryButtonText}>{pendingFile ? "Change file" : "Attach document file"}</Text>
          </Pressable>
          {pendingFile ? (
            <Text style={styles.muted}>
              Ready: {"name" in pendingFile ? pendingFile.name : "file"}
            </Text>
          ) : (
            <Text style={styles.muted}>{tm("attachFileHint")}</Text>
          )}
        </>
      ) : null}

      <View style={styles.statusRow}>
        <Pressable style={styles.primaryButton} onPress={saveItem} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? tm("saving") : editingId ? tm("edit") : `${tm("add")} ${el(moduleType)}`}</Text>
        </Pressable>
        {editingId ? (
          <Pressable style={styles.secondaryButton} onPress={resetForm} disabled={loading}>
            <Text style={styles.secondaryButtonText}>{tm("cancelEdit")}</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.sectionLabel}>{el(moduleType)} · {tm("items")}</Text>
      {items.length === 0 ? <Text style={styles.muted}>{tm("noItemsYet")}</Text> : null}
      {items.slice(0, 12).map((item) => (
        <View style={styles.listRow} key={item.id}>
          <Text style={styles.listTitle}>{item.name}</Text>
          <Text style={styles.muted}>
            {item.sub_type || item.category} · {formatAmount(item.amount, item.currency || currency)} · {item.status || "ACTIVE"}
          </Text>
          <Text style={styles.muted}>
            {item.renewal_or_expiry_date || (item as any).target_date || "No date"}
            {item.has_file
              ? ` · ${item.file_name || "file"}${item.file_size ? ` · ${formatBytes(item.file_size)}` : ""}${item.file_encrypted ? " · encrypted" : ""}`
              : " · no file"}
          </Text>
          <View style={styles.statusRow}>
            {item.status === "ACTIVE" ? (
              <>
                <Pressable onPress={() => startEdit(item)} disabled={loading}>
                  <Text style={styles.statusPill}>{tm("edit")}</Text>
                </Pressable>
                <Pressable onPress={() => closeItem(item)} disabled={loading}>
                  <Text style={styles.statusPill}>{tm("close")}</Text>
                </Pressable>
              </>
            ) : null}
            {isDocument ? (
              <>
                <Pressable onPress={() => pickDocumentFile(item.id)} disabled={loading}>
                  <Text style={styles.statusPill}>{item.has_file ? "Replace file" : "Upload file"}</Text>
                </Pressable>
                {item.has_file ? (
                  <Pressable onPress={() => downloadDocument(item)} disabled={loading}>
                    <Text style={[styles.statusPill, styles.ok]}>{tm("download")}</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#ffffff", borderColor: "#dce7e3", borderWidth: 1, borderRadius: 24, padding: 16, gap: 12 },
  panelTitle: { color: "#17211e", fontSize: 20, fontWeight: "900" },
  muted: { color: "#6c7b76", fontSize: 13, lineHeight: 19 },
  input: { backgroundColor: "#f8fbfa", borderColor: "#dce7e3", borderWidth: 1, borderRadius: 16, color: "#17211e", paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  primaryButton: { backgroundColor: "#0f8f6f", borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  primaryButtonText: { color: "#ffffff", fontWeight: "900", fontSize: 15 },
  secondaryButton: { borderColor: "#0f8f6f", borderWidth: 1, borderRadius: 16, paddingVertical: 12, alignItems: "center", backgroundColor: "#ffffff" },
  secondaryButtonText: { color: "#0f8f6f", fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricCard: { flexGrow: 1, minWidth: "45%", backgroundColor: "#f8fbfa", borderRadius: 18, padding: 12 },
  metricLabel: { color: "#6c7b76", fontSize: 12, fontWeight: "700" },
  metricValue: { color: "#17211e", fontSize: 18, fontWeight: "900", marginTop: 6 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusPill: { color: "#0b6f58", backgroundColor: "#e0f4ed", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: "800" },
  ok: { backgroundColor: "#0f8f6f", color: "#ffffff" },
  listRow: { borderTopColor: "#dce7e3", borderTopWidth: 1, paddingTop: 10, gap: 2 },
  listTitle: { color: "#17211e", fontWeight: "900", fontSize: 15 },
  sectionLabel: { color: "#0b6f58", fontWeight: "900", marginTop: 6 },
});
