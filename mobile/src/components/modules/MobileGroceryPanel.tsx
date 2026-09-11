import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { GroceryBarcodeCamera } from "./GroceryBarcodeCamera";
import { tMobile, type MobileLang } from "../../i18n";

type GroceryList = {
  id: string;
  title: string;
  status: string;
  vendor_name?: string;
  budget_amount?: string;
  currency?: string;
  sync_version?: number;
};

type GroceryItem = {
  id: string;
  name: string;
  category?: string;
  quantity?: string;
  unit?: string;
  is_bought: boolean;
  actual_price?: string;
  estimated_price?: string;
  vendor_name?: string;
  barcode?: string;
  sync_version?: number;
  note?: string;
};

type GroceryVendor = {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  category?: string;
  is_active?: boolean;
};

type CollabStatus = {
  open_lists?: number;
  pending_items?: number;
  activity_count?: number;
  mode?: string;
  realtime_transport?: string;
  websocket_path?: string;
  subscribers?: number;
};

type ActivityRow = {
  id?: string;
  action_type?: string;
  title?: string;
  description?: string;
  created_at?: string;
};

type Account = { id: string; name: string; currency?: string };
type ExpenseCategory = { id: string; name_en?: string; name_bn?: string; category_type: string };

type Props = {
  token: string;
  familyId: string;
  currency: string;
  apiBaseUrl: string;
  apiGet: (path: string, authToken?: string) => Promise<any>;
  apiPost: (path: string, body: object, authToken?: string) => Promise<any>;
  apiPut: (path: string, body: object, authToken?: string) => Promise<any>;
  formatAmount: (value?: string | number | null, currency?: string) => string;
  onMessage: (message: string, ok?: boolean) => void;
  onChanged?: () => void;
  offlineSlot?: React.ReactNode;
  lang?: MobileLang;
  onQueueOffline?: (entityType: string, action: string, payload: object) => Promise<void>;
  online?: boolean;
};

type GrocerySub = "LISTS" | "ITEMS" | "VENDORS" | "SCAN" | "COLLAB" | "OFFLINE";

export function MobileGroceryPanel({
  token,
  familyId,
  currency,
  apiBaseUrl,
  apiGet,
  apiPost,
  apiPut,
  formatAmount,
  onMessage,
  onChanged,
  offlineSlot,
  lang = "bn",
  onQueueOffline,
  online = typeof navigator === "undefined" ? true : navigator.onLine !== false,
}: Props) {
  const tm = (key: string) => tMobile(lang, key);
  const [sub, setSub] = useState<GrocerySub>("LISTS");
  const [loading, setLoading] = useState(false);
  const [wsState, setWsState] = useState("off");
  const [lastWsEvent, setLastWsEvent] = useState("");
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [vendors, setVendors] = useState<GroceryVendor[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [collab, setCollab] = useState<CollabStatus | null>(null);
  const [selectedListId, setSelectedListId] = useState("");
  const [barcodeResult, setBarcodeResult] = useState<any>(null);
  const [ocrPreview, setOcrPreview] = useState<any>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [expenseForm, setExpenseForm] = useState({ account_id: "", category_id: "" });

  const [listForm, setListForm] = useState({ title: "", vendor_name: "", budget_amount: "0" });
  const [itemForm, setItemForm] = useState({
    name: "",
    category: "GENERAL",
    quantity: "1",
    unit: "pcs",
    estimated_price: "0",
    vendor_name: "",
    barcode: "",
  });
  const [vendorForm, setVendorForm] = useState({ name: "", phone: "", address: "", category: "GENERAL" });
  const [scanForm, setScanForm] = useState({ barcode: "", raw_text: "" });

  const load = useCallback(async () => {
    if (!token || !familyId || sub === "OFFLINE") return;
    setLoading(true);
    try {
      const [listRows, vendorRows, activityRows, collabStatus, accountRows, categoryRows] = await Promise.all([
        apiGet(`/api/v1/grocery/lists/${familyId}`, token),
        apiGet(`/api/v1/grocery/vendors/${familyId}`, token),
        apiGet(`/api/v1/grocery/activity/${familyId}`, token),
        apiGet(`/api/v1/grocery/collaboration/status/${familyId}`, token),
        apiGet(`/api/v1/accounts/family/${familyId}`, token).catch(() => []),
        apiGet(`/api/v1/categories/family/${familyId}`, token).catch(() => []),
      ]);
      const nextLists = Array.isArray(listRows) ? listRows : [];
      setLists(nextLists);
      setVendors(Array.isArray(vendorRows) ? vendorRows : []);
      setActivity(Array.isArray(activityRows) ? activityRows : []);
      setCollab(collabStatus && typeof collabStatus === "object" ? collabStatus : null);
      const nextAccounts = Array.isArray(accountRows) ? accountRows : [];
      const nextExpenseCats = (Array.isArray(categoryRows) ? categoryRows : []).filter(
        (row: ExpenseCategory) => row.category_type === "EXPENSE"
      );
      setAccounts(nextAccounts);
      setExpenseCategories(nextExpenseCats);
      setExpenseForm((current) => ({
        account_id: current.account_id || nextAccounts[0]?.id || "",
        category_id: current.category_id || nextExpenseCats[0]?.id || "",
      }));

      let activeId = "";
      setSelectedListId((current) => {
        activeId = current && nextLists.some((row: GroceryList) => row.id === current) ? current : nextLists[0]?.id || "";
        return activeId;
      });

      if (activeId) {
        const itemRows = await apiGet(`/api/v1/grocery/lists/${familyId}/${activeId}/items`, token);
        setItems(Array.isArray(itemRows) ? itemRows : []);
      } else {
        setItems([]);
      }
      onMessage(tm("groceryLoaded").replace("{n}", String(nextLists.length)), true);
    } catch (error) {
      try {
        const { listLocal } = await import("../../database/localRepository");
        const localLists = await listLocal("grocery_lists", familyId, 100);
        if (localLists?.length) {
          setLists(
            localLists.map((row: any) => ({
              id: String(row.server_id || row.id),
              title: String(row.name || "Grocery"),
              status: String(row.status || "OPEN"),
              vendor_name: row.vendor_name,
              budget_amount: row.budget_amount,
              currency: row.currency,
            }))
          );
          onMessage("Showing offline grocery lists", true);
          return;
        }
      } catch {
        /* ignore */
      }
      onMessage(error instanceof Error ? error.message : "Grocery load failed", false);
    } finally {
      setLoading(false);
    }
  }, [apiGet, familyId, onMessage, sub, token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token || !familyId || !apiBaseUrl) {
      setWsState("off");
      return;
    }
    let alive = true;
    setWsState("connecting");
    const wsBase = apiBaseUrl.replace(/\/$/, "").replace(/^http/i, "ws");
    // Mobile API paths use /api/v1; WS is mounted on both /grocery and /api/v1/grocery
    const wsUrl = `${wsBase}/api/v1/grocery/ws/${familyId}?token=${encodeURIComponent(token)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      setWsState("error");
      return;
    }
    ws.onopen = () => {
      if (alive) setWsState("connected");
    };
    ws.onmessage = (event) => {
      if (!alive) return;
      try {
        const data = JSON.parse(String(event.data));
        if (data?.type === "grocery.changed") {
          setLastWsEvent(`${data.action || "changed"} · ${data.title || data.entity_type || ""}`);
          // Do not auto-refresh parent dashboard — user taps Refresh when ready.
          void load();
        } else if (data?.type === "grocery.subscribed") {
          setLastWsEvent(`subscribed · ${data.subscribers || 0} clients`);
        }
      } catch {
        // ignore
      }
    };
    ws.onerror = () => {
      if (alive) setWsState("error");
    };
    ws.onclose = () => {
      if (alive) setWsState("disconnected");
    };
    return () => {
      alive = false;
      try {
        ws.close();
      } catch {
        // ignore
      }
      setWsState("off");
    };
  }, [apiBaseUrl, familyId, load, sub, token]);

  async function selectList(listId: string) {
    setSelectedListId(listId);
    setLoading(true);
    try {
      const itemRows = await apiGet(`/api/v1/grocery/lists/${familyId}/${listId}/items`, token);
      setItems(Array.isArray(itemRows) ? itemRows : []);
      setSub("ITEMS");
      onMessage(tm("listItemsLoaded"), true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Items load failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function afterWrite(msg: string) {
    onMessage(msg, true);
    await load();
    onChanged?.();
  }

  async function queueFirst(entityType: string, action: string, payload: object, okMessage: string, reset?: () => void) {
    if (!onQueueOffline) return false;
    await onQueueOffline(entityType, action, payload);
    reset?.();
    if (online && token) {
      try {
        const { syncManager } = await import("../../sync/syncManager");
        await syncManager.replayPending(token, familyId, 20);
      } catch { /* stay queued */ }
    }
    await afterWrite(okMessage);
    return true;
  }


  async function createList() {
    if (!listForm.title.trim()) {
      onMessage(tm("listTitleRequired"), false);
      return;
    }
    setLoading(true);
    const payload = {
      family_id: familyId,
      title: listForm.title.trim(),
      name: listForm.title.trim(),
      vendor_name: listForm.vendor_name || undefined,
      budget_amount: Number(listForm.budget_amount || 0),
      currency,
      mobile_sync_key: `mobile-glist-${Date.now()}`,
    };
    try {
      if (
        await queueFirst("grocery_lists", "CREATE", payload, "Grocery list created", () =>
          setListForm({ title: "", vendor_name: "", budget_amount: "0" })
        )
      ) {
        return;
      }
      await apiPost("/api/v1/grocery/lists", payload, token);
      setListForm({ title: "", vendor_name: "", budget_amount: "0" });
      await afterWrite("Grocery list created");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "List create failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function createItem() {
    if (!selectedListId) {
      onMessage(tm("selectListFirst"), false);
      return;
    }
    if (!itemForm.name.trim()) {
      onMessage(tm("itemNameRequired"), false);
      return;
    }
    setLoading(true);
    const payload = {
      family_id: familyId,
      grocery_list_id: selectedListId,
      name: itemForm.name.trim(),
      category: itemForm.category || "GENERAL",
      quantity: itemForm.quantity || "1",
      unit: itemForm.unit || "pcs",
      estimated_price: itemForm.estimated_price || "0",
      actual_price: "0",
      vendor_name: itemForm.vendor_name || undefined,
      barcode: itemForm.barcode || undefined,
      mobile_sync_key: `mobile-gitem-${Date.now()}`,
    };
    try {
      if (
        await queueFirst("grocery_items", "CREATE", payload, "Item added", () =>
          setItemForm({
            name: "",
            category: itemForm.category || "GENERAL",
            quantity: "1",
            unit: itemForm.unit || "pcs",
            estimated_price: "0",
            vendor_name: "",
            barcode: "",
          })
        )
      ) {
        return;
      }
      await apiPost("/api/v1/grocery/items", payload, token);
      setItemForm({
        name: "",
        category: itemForm.category || "GENERAL",
        quantity: "1",
        unit: itemForm.unit || "pcs",
        estimated_price: "0",
        vendor_name: "",
        barcode: "",
      });
      await afterWrite("Item added");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Item create failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function markBought(item: GroceryItem) {
    setLoading(true);
    const payload = {
      family_id: familyId,
      id: item.id,
      entity_id: item.id,
      grocery_list_id: selectedListId,
      is_bought: true,
      actual_price: String(item.actual_price || item.estimated_price || 0),
      vendor_name: item.vendor_name || undefined,
      expected_sync_version: item.sync_version || 1,
      last_client_updated_at: new Date().toISOString(),
    };
    try {
      setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, is_bought: true } : row)));
      if (await queueFirst("grocery_items", "UPDATE", payload, `${item.name} marked bought`)) {
        return;
      }
      await apiPut(
        `/api/v1/grocery/items/${item.id}/buy`,
        {
          family_id: familyId,
          actual_price: Number(item.actual_price || item.estimated_price || 0),
          vendor_name: item.vendor_name || undefined,
          expected_sync_version: item.sync_version || 1,
        },
        token
      );
      await afterWrite(`${item.name} marked bought`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Mark bought failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function postGroceryExpense(item: GroceryItem) {
    if (!expenseForm.account_id || !expenseForm.category_id) {
      onMessage(tm("selectWalletExpenseCategory") || "Select wallet and expense category", false);
      return;
    }
    setLoading(true);
    try {
      const result = await apiPost(
        `/api/v1/grocery/items/${item.id}/post-expense`,
        {
          family_id: familyId,
          account_id: expenseForm.account_id,
          category_id: expenseForm.category_id,
          amount: item.actual_price || item.estimated_price || "0",
          description: `Grocery expense: ${item.name}`,
        },
        token
      );
      await afterWrite(
        (tm("groceryExpensePosted") || "Grocery expense posted").replace("{id}", String(result?.transaction_id || ""))
      );
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Grocery expense post failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function createVendor() {
    if (!vendorForm.name.trim()) {
      onMessage(tm("vendorNameRequired") || "Vendor name required", false);
      return;
    }
    setLoading(true);
    const payload = {
      family_id: familyId,
      name: vendorForm.name.trim(),
      phone: vendorForm.phone || undefined,
      address: vendorForm.address || undefined,
      category: vendorForm.category || "GENERAL",
      note: undefined,
    };
    try {
      if (
        await queueFirst("grocery_vendors", "CREATE", payload, "Vendor created", () =>
          setVendorForm({ name: "", phone: "", address: "", category: "GENERAL" })
        )
      ) {
        return;
      }
      await apiPost("/api/v1/grocery/vendors", payload, token);
      setVendorForm({ name: "", phone: "", address: "", category: "GENERAL" });
      await afterWrite("Vendor created");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Vendor create failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function lookupBarcode(codeOverride?: string) {
    const code = String(codeOverride || scanForm.barcode || "").trim();
    if (!code) {
      onMessage(tm("barcodeRequired"), false);
      return;
    }
    setScanForm((current) => ({ ...current, barcode: code }));
    setLoading(true);
    try {
      const result = await apiGet(`/api/v1/grocery/barcode/${familyId}/${encodeURIComponent(code)}`, token);
      setBarcodeResult(result);
      const latest = result?.latest;
      if (result?.found && latest) {
        setItemForm((current) => ({
          ...current,
          name: latest.name || current.name,
          estimated_price: String(latest.estimated_price ?? latest.actual_price ?? current.estimated_price),
          vendor_name: latest.vendor_name || current.vendor_name,
          barcode: code,
          category: latest.category || current.category,
        }));
        onMessage(`Barcode matched: ${latest.name}`, true);
      } else {
        setItemForm((current) => ({ ...current, barcode: code }));
        onMessage("No barcode match — code filled; enter name to add as new item", false);
      }
    } catch (error) {
      setBarcodeResult(null);
      onMessage(error instanceof Error ? error.message : "Barcode lookup failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function parseOcr() {
    if (!scanForm.raw_text.trim()) {
      onMessage(tm("pasteOcrText"), false);
      return;
    }
    setLoading(true);
    try {
      const preview = await apiPost(
        "/api/v1/grocery/ocr/parse",
        { family_id: familyId, raw_text: scanForm.raw_text.trim() },
        token
      );
      setOcrPreview(preview);
      onMessage(tm("ocrParsed"), true);
    } catch (error) {
      setOcrPreview(null);
      onMessage(error instanceof Error ? error.message : "OCR parse failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function parseOcrImage() {
    setLoading(true);
    try {
      let uri = "";
      let name = "receipt.jpg";
      let mimeType = "image/jpeg";

      try {
        // Optional native picker when the package is available in the build.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ImagePicker = require("expo-image-picker");
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (permission.granted === false && permission.status !== "granted") {
          throw new Error("gallery_denied");
        }
        const picked = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions?.Images || "images",
          quality: 0.8,
        });
        if (picked.canceled || !picked.assets?.[0]?.uri) {
          setLoading(false);
          return;
        }
        uri = picked.assets[0].uri;
        name = picked.assets[0].fileName || name;
        mimeType = picked.assets[0].mimeType || mimeType;
      } catch {
        const picked = await DocumentPicker.getDocumentAsync({
          type: ["image/*"],
          copyToCacheDirectory: true,
          multiple: false,
        });
        if (picked.canceled || !picked.assets?.[0]?.uri) {
          setLoading(false);
          return;
        }
        uri = picked.assets[0].uri;
        name = picked.assets[0].name || name;
        mimeType = picked.assets[0].mimeType || mimeType;
      }

      const form = new FormData();
      form.append("file", { uri, name, type: mimeType } as any);
      const response = await fetch(
        `${apiBaseUrl.replace(/\/$/, "")}/api/v1/grocery/ocr/parse-image?family_id=${encodeURIComponent(familyId)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "OCR image parse failed");
      setOcrPreview(data);
      onMessage(tm("ocrParsed"), true);
    } catch (error) {
      setOcrPreview(null);
      onMessage(error instanceof Error ? error.message : "OCR image parse failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function addOcrItems() {
    const rows = Array.isArray(ocrPreview?.suggestions)
      ? ocrPreview.suggestions
      : Array.isArray(ocrPreview?.items)
        ? ocrPreview.items
        : Array.isArray(ocrPreview)
          ? ocrPreview
          : [];
    if (!selectedListId) {
      onMessage(tm("selectListFirst"), false);
      return;
    }
    if (!rows.length) {
      onMessage(tm("noOcrItems"), false);
      return;
    }
    setLoading(true);
    try {
      for (const row of rows) {
        const name = String(row.name || row.item_name || "").trim();
        if (!name) continue;
        await apiPost(
          "/api/v1/grocery/items",
          {
            family_id: familyId,
            grocery_list_id: selectedListId,
            name,
            category: row.category || "GENERAL",
            quantity: Number(row.quantity || 1),
            unit: row.unit || "pcs",
            estimated_price: Number(row.estimated_price || row.price || 0),
          },
          token
        );
      }
      await afterWrite(`Added ${rows.length} OCR items`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "OCR add failed", false);
    } finally {
      setLoading(false);
    }
  }

  const selectedList = lists.find((list) => list.id === selectedListId);

  return (
    <View style={styles.panel}>
      <View style={styles.rowBetween}>
        <Text style={styles.panelTitle}>{tm("grocery")}</Text>
        <Pressable onPress={() => void load()} disabled={loading || sub === "OFFLINE"}>
          <Text style={styles.linkText}>{loading ? "..." : tm("refresh")}</Text>
        </Pressable>
      </View>

      <View style={styles.statusRow}>
        {(
          [
            ["LISTS", "lists"],
            ["ITEMS", "items"],
            ["VENDORS", "vendors"],
            ["SCAN", "scan"],
            ["COLLAB", "collab"],
            ["OFFLINE", "offline"],
          ] as const
        ).map(([id, key]) => (
          <Pressable key={id} onPress={() => setSub(id)}>
            <Text style={[styles.statusPill, sub === id ? styles.ok : null]}>{tm(key)}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.grid}>
        <Metric label="Lists" value={String(lists.length)} />
        <Metric label="Items" value={String(items.length)} />
        <Metric label="Vendors" value={String(vendors.length)} />
        <Metric label="Pending" value={String(collab?.pending_items ?? items.filter((i) => !i.is_bought).length)} />
      </View>

      {selectedList ? (
        <Text style={styles.muted}>
          Active list: {selectedList.title} · {selectedList.status}
        </Text>
      ) : (
        <Text style={styles.muted}>{tm("noListSelected")}</Text>
      )}

      {sub === "OFFLINE" ? offlineSlot || <Text style={styles.muted}>{tm("noOfflineQueue")}</Text> : null}

      {sub === "LISTS" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("createList")}</Text>
          <TextInput
            style={styles.input}
            placeholder={tm("listTitle")}
            placeholderTextColor="#8aa39a"
            value={listForm.title}
            onChangeText={(title) => setListForm((c) => ({ ...c, title }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("vendorName")}
            placeholderTextColor="#8aa39a"
            value={listForm.vendor_name}
            onChangeText={(vendor_name) => setListForm((c) => ({ ...c, vendor_name }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("budget")}
            placeholderTextColor="#8aa39a"
            keyboardType="decimal-pad"
            value={listForm.budget_amount}
            onChangeText={(budget_amount) => setListForm((c) => ({ ...c, budget_amount }))}
          />
          <Pressable style={styles.primaryButton} onPress={() => void createList()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("createListBtn")}</Text>
          </Pressable>
          <Text style={styles.sectionLabel}>Lists</Text>
          {lists.length === 0 ? <Text style={styles.muted}>{tm("noGroceryLists")}</Text> : null}
          {lists.map((list) => (
            <Pressable key={list.id} style={styles.listRow} onPress={() => void selectList(list.id)}>
              <Text style={styles.listTitle}>
                {selectedListId === list.id ? "● " : ""}
                {list.title}
              </Text>
              <Text style={styles.muted}>
                {list.status} · {list.vendor_name || "No vendor"} · budget {formatAmount(list.budget_amount, list.currency || currency)}
              </Text>
            </Pressable>
          ))}
        </>
      ) : null}

      {sub === "ITEMS" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("addItemActiveList")}</Text>
          <View style={styles.statusRow}>
            {lists.slice(0, 8).map((list) => (
              <Pressable key={list.id} onPress={() => void selectList(list.id)}>
                <Text style={[styles.statusPill, selectedListId === list.id ? styles.ok : null]}>{list.title}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder={tm("itemName")}
            placeholderTextColor="#8aa39a"
            value={itemForm.name}
            onChangeText={(name) => setItemForm((c) => ({ ...c, name }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("category")}
            placeholderTextColor="#8aa39a"
            value={itemForm.category}
            onChangeText={(category) => setItemForm((c) => ({ ...c, category }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("qty")}
            placeholderTextColor="#8aa39a"
            keyboardType="decimal-pad"
            value={itemForm.quantity}
            onChangeText={(quantity) => setItemForm((c) => ({ ...c, quantity }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("unit")}
            placeholderTextColor="#8aa39a"
            value={itemForm.unit}
            onChangeText={(unit) => setItemForm((c) => ({ ...c, unit }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("estimatedPrice")}
            placeholderTextColor="#8aa39a"
            keyboardType="decimal-pad"
            value={itemForm.estimated_price}
            onChangeText={(estimated_price) => setItemForm((c) => ({ ...c, estimated_price }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("vendorBarcode")}
            placeholderTextColor="#8aa39a"
            value={itemForm.vendor_name || itemForm.barcode}
            onChangeText={(value) => setItemForm((c) => ({ ...c, vendor_name: value, barcode: c.barcode || value }))}
          />
          <Pressable style={styles.primaryButton} onPress={() => void createItem()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("addItem")}</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>{tm("postExpenseWalletCategory") || "Post expense · wallet / category"}</Text>
          <View style={styles.statusRow}>
            {accounts.slice(0, 8).map((account) => (
              <Pressable key={account.id} onPress={() => setExpenseForm((c) => ({ ...c, account_id: account.id }))}>
                <Text style={[styles.statusPill, expenseForm.account_id === account.id ? styles.ok : null]}>{account.name}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.statusRow}>
            {expenseCategories.slice(0, 10).map((category) => (
              <Pressable key={category.id} onPress={() => setExpenseForm((c) => ({ ...c, category_id: category.id }))}>
                <Text style={[styles.statusPill, expenseForm.category_id === category.id ? styles.ok : null]}>
                  {category.name_en || category.name_bn || "Expense"}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Items</Text>
          {items.length === 0 ? <Text style={styles.muted}>{tm("noItemsInList")}</Text> : null}
          {items.map((item) => (
            <View style={styles.listRow} key={item.id}>
              <Text style={styles.listTitle}>{item.name}</Text>
              <Text style={styles.muted}>
                {item.category || "GENERAL"} · {item.quantity || "1"} {item.unit || "pcs"} ·{" "}
                {formatAmount(item.actual_price || item.estimated_price, currency)} · {item.is_bought ? "Bought" : "Pending"}
              </Text>
              <View style={styles.statusRow}>
                {!item.is_bought ? (
                  <Pressable onPress={() => void markBought(item)} disabled={loading}>
                    <Text style={[styles.statusPill, styles.ok]}>{tm("markBought")}</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => void postGroceryExpense(item)} disabled={loading}>
                    <Text style={[styles.statusPill, styles.ok]}>{tm("postExpense") || "Post expense"}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          ))}
        </>
      ) : null}

      {sub === "VENDORS" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("createVendor")}</Text>
          <TextInput
            style={styles.input}
            placeholder={tm("vendorName")}
            placeholderTextColor="#8aa39a"
            value={vendorForm.name}
            onChangeText={(name) => setVendorForm((c) => ({ ...c, name }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("phone")}
            placeholderTextColor="#8aa39a"
            value={vendorForm.phone}
            onChangeText={(phone) => setVendorForm((c) => ({ ...c, phone }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("address")}
            placeholderTextColor="#8aa39a"
            value={vendorForm.address}
            onChangeText={(address) => setVendorForm((c) => ({ ...c, address }))}
          />
          <Pressable style={styles.primaryButton} onPress={() => void createVendor()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("createVendorBtn")}</Text>
          </Pressable>
          <Text style={styles.sectionLabel}>Vendors</Text>
          {vendors.length === 0 ? <Text style={styles.muted}>{tm("noVendorsYet")}</Text> : null}
          {vendors.map((vendor) => (
            <Pressable
              key={vendor.id}
              style={styles.listRow}
              onPress={() => {
                setListForm((c) => ({ ...c, vendor_name: vendor.name }));
                setItemForm((c) => ({ ...c, vendor_name: vendor.name }));
                onMessage(`Vendor selected: ${vendor.name}`, true);
              }}
            >
              <Text style={styles.listTitle}>{vendor.name}</Text>
              <Text style={styles.muted}>
                {vendor.category || "GENERAL"} · {vendor.phone || "No phone"} · {vendor.address || "No address"}
              </Text>
            </Pressable>
          ))}
        </>
      ) : null}

      {sub === "SCAN" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("cameraBarcodeScan")}</Text>
          <Pressable style={styles.primaryButton} onPress={() => setScannerOpen(true)} disabled={loading}>
            <Text style={styles.primaryButtonText}>{tm("openCameraScanner")}</Text>
          </Pressable>
          <Text style={styles.muted}>Native camera on Android/iOS. Web uses BarcodeDetector when the browser supports it.</Text>

          <Text style={styles.sectionLabel}>{tm("barcodeLookup")}</Text>
          <TextInput
            style={styles.input}
            placeholder={tm("barcode")}
            placeholderTextColor="#8aa39a"
            value={scanForm.barcode}
            onChangeText={(barcode) => setScanForm((c) => ({ ...c, barcode }))}
          />
          <Pressable style={styles.secondaryButton} onPress={() => void lookupBarcode()} disabled={loading}>
            <Text style={styles.secondaryButtonText}>{tm("lookupBarcode")}</Text>
          </Pressable>
          {barcodeResult ? (
            <Text style={styles.muted}>
              {barcodeResult.barcode}:{" "}
              {barcodeResult.found
                ? `${barcodeResult.latest?.name || "match"} · ${formatAmount(
                    barcodeResult.latest?.actual_price || barcodeResult.latest?.estimated_price,
                    currency
                  )}`
                : "no match"}
            </Text>
          ) : null}
          {barcodeResult?.found ? (
            <Pressable style={styles.primaryButton} onPress={() => void createItem()} disabled={loading || !selectedListId}>
              <Text style={styles.primaryButtonText}>{tm("addMatchedItem")}</Text>
            </Pressable>
          ) : barcodeResult && !barcodeResult.found && itemForm.barcode ? (
            <Pressable
              style={styles.primaryButton}
              onPress={() => {
                if (!itemForm.name.trim()) {
                  onMessage("Enter item name for new barcode", false);
                  return;
                }
                void createItem();
              }}
              disabled={loading || !selectedListId}
            >
              <Text style={styles.primaryButtonText}>{tm("addNewBarcodeItem")}</Text>
            </Pressable>
          ) : null}

          <Text style={styles.sectionLabel}>{tm("ocrReceiptText")}</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder={"Paste receipt lines\ne.g. Milk 2 80\nRice 5kg 450"}
            placeholderTextColor="#8aa39a"
            multiline
            value={scanForm.raw_text}
            onChangeText={(raw_text) => setScanForm((c) => ({ ...c, raw_text }))}
          />
          <Pressable style={styles.secondaryButton} onPress={() => void parseOcr()} disabled={loading}>
            <Text style={styles.secondaryButtonText}>{tm("parseOcr")}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void parseOcrImage()} disabled={loading}>
            <Text style={styles.secondaryButtonText}>{tm("parseReceiptImage") || "Parse receipt image"}</Text>
          </Pressable>
          {ocrPreview ? (
            <Text style={styles.muted}>
              Parsed{" "}
              {Array.isArray(ocrPreview?.suggestions)
                ? ocrPreview.suggestions.length
                : Array.isArray(ocrPreview?.items)
                  ? ocrPreview.items.length
                  : Array.isArray(ocrPreview)
                    ? ocrPreview.length
                    : 0}{" "}
              lines
            </Text>
          ) : null}
          <Pressable style={styles.primaryButton} onPress={() => void addOcrItems()} disabled={loading || !ocrPreview}>
            <Text style={styles.primaryButtonText}>{tm("addOcrItems")}</Text>
          </Pressable>

          <GroceryBarcodeCamera
            lang={lang}
            visible={scannerOpen}
            onClose={() => setScannerOpen(false)}
            onScanned={(code) => {
              setScanForm((current) => ({ ...current, barcode: code }));
              void lookupBarcode(code);
            }}
          />
        </>
      ) : null}

      {sub === "COLLAB" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("collaborationStatus")}</Text>
          <View style={styles.grid}>
            <Metric label="Open lists" value={String(collab?.open_lists ?? 0)} />
            <Metric label="Pending" value={String(collab?.pending_items ?? 0)} />
            <Metric label="Activity" value={String(collab?.activity_count ?? 0)} />
          </View>
          <Text style={styles.muted}>
            Mode: {collab?.mode || "polling"} · realtime: {collab?.realtime_transport || "not_enabled"}
          </Text>
          <Text style={[styles.statusPill, wsState === "connected" ? styles.ok : null]}>WS {wsState}</Text>
          <Text style={styles.muted}>
            Path: {collab?.websocket_path || "/api/v1/grocery/ws/..."} · subs {String(collab?.subscribers ?? 0)}
          </Text>
          {lastWsEvent ? <Text style={styles.muted}>Last event: {lastWsEvent}</Text> : null}
          <Pressable style={styles.secondaryButton} onPress={() => void load()} disabled={loading}>
            <Text style={styles.secondaryButtonText}>{loading ? "Refreshing..." : "Refresh Collab Now"}</Text>
          </Pressable>
          <Text style={styles.sectionLabel}>{tm("recentGroceryActivity")}</Text>
          {activity.length === 0 ? <Text style={styles.muted}>{tm("noGroceryActivity")}</Text> : null}
          {activity.slice(0, 12).map((row, index) => (
            <View style={styles.listRow} key={row.id || `${row.title}-${index}`}>
              <Text style={styles.listTitle}>
                {row.action_type || "EVENT"} · {row.title || "Grocery"}
              </Text>
              <Text style={styles.muted}>
                {row.description || "-"} · {row.created_at ? String(row.created_at).slice(0, 19) : ""}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#ffffff", borderColor: "#dce7e3", borderWidth: 1, borderRadius: 24, padding: 16, gap: 12 },
  panelTitle: { color: "#17211e", fontSize: 20, fontWeight: "900" },
  muted: { color: "#6c7b76", fontSize: 13, lineHeight: 19 },
  input: {
    backgroundColor: "#f8fbfa",
    borderColor: "#dce7e3",
    borderWidth: 1,
    borderRadius: 16,
    color: "#17211e",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  multiline: { minHeight: 110, textAlignVertical: "top" },
  primaryButton: { backgroundColor: "#0f8f6f", borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  primaryButtonText: { color: "#ffffff", fontWeight: "900", fontSize: 15 },
  secondaryButton: { borderColor: "#20c997", borderWidth: 1, borderRadius: 16, paddingVertical: 12, alignItems: "center" },
  secondaryButtonText: { color: "#0f8f6f", fontWeight: "800" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  linkText: { color: "#0f8f6f", fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricCard: { flexGrow: 1, minWidth: "30%", backgroundColor: "#f8fbfa", borderRadius: 18, padding: 12 },
  metricLabel: { color: "#6c7b76", fontSize: 12, fontWeight: "700" },
  metricValue: { color: "#17211e", fontSize: 18, fontWeight: "900", marginTop: 6 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusPill: {
    color: "#0b6f58",
    backgroundColor: "#e0f4ed",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: "800",
  },
  ok: { backgroundColor: "#0f8f6f", color: "#ffffff" },
  listRow: { borderTopColor: "#dce7e3", borderTopWidth: 1, paddingTop: 10, gap: 4 },
  listTitle: { color: "#17211e", fontWeight: "900", fontSize: 15 },
  sectionLabel: { color: "#0b6f58", fontWeight: "900", marginTop: 6 },
});
