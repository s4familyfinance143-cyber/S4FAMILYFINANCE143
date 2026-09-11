import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { tMobile, type MobileLang } from "../../i18n";
import { loadModuleSnapshot, saveModuleSnapshot } from "../../lib/offlineSnapshots";

type ZakatRecord = {
  id: string;
  calculation_year: string;
  currency: string;
  cash_amount?: string;
  gold_value?: string;
  silver_value?: string;
  investment_value?: string;
  business_assets?: string;
  receivables?: string;
  deductible_debts?: string;
  nisab_amount?: string;
  zakatable_amount?: string;
  zakat_due?: string;
  is_zakat_due?: boolean;
  status?: string;
  note?: string | null;
  created_at?: string;
};

type Props = {
  token: string;
  familyId: string;
  currency: string;
  lang?: MobileLang;
  apiGet: (path: string, authToken?: string) => Promise<any>;
  apiPost: (path: string, body: object, authToken?: string) => Promise<any>;
  formatAmount: (value?: string | number | null, currency?: string) => string;
  onMessage: (message: string, ok?: boolean) => void;
  onQueueOffline?: (entityType: string, action: string, payload: object) => Promise<void>;
};

export function MobileZakatPanel({
  token,
  familyId,
  currency,
  lang = "bn",
  apiGet,
  apiPost,
  formatAmount,
  onMessage,
  onQueueOffline,
}: Props) {
  const tm = (key: string) => tMobile(lang, key);
  const year = String(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [records, setRecords] = useState<ZakatRecord[]>([]);
  const [form, setForm] = useState({
    calculation_year: year,
    currency,
    cash_amount: "0",
    gold_value: "0",
    silver_value: "0",
    investment_value: "0",
    business_assets: "0",
    receivables: "0",
    deductible_debts: "0",
    nisab_amount: "85000",
    note: "",
  });

  const load = useCallback(async () => {
    if (!token || !familyId) return;
    setLoading(true);
    try {
      const [sum, list] = await Promise.all([
        apiGet(`/api/v1/zakat/summary/${familyId}`, token),
        apiGet(`/api/v1/zakat/${familyId}`, token),
      ]);
      setSummary(sum);
      setRecords(Array.isArray(list) ? list : []);
      await saveModuleSnapshot(familyId, "zakat", { summary: sum, records: Array.isArray(list) ? list : [] });
      onMessage(tm("zakatLoaded").replace("{n}", String(Array.isArray(list) ? list.length : 0)), true);
    } catch (error) {
      const cached = await loadModuleSnapshot<{ summary: any; records: ZakatRecord[] }>(familyId, "zakat");
      if (cached) {
        setSummary(cached.summary || null);
        setRecords(Array.isArray(cached.records) ? cached.records : []);
        onMessage("Offline zakat cache loaded", true);
      } else {
        onMessage(error instanceof Error ? error.message : tm("zakatLoadFailed"), false);
        setRecords([]);
      }
    } finally {
      setLoading(false);
    }
  }, [apiGet, familyId, lang, onMessage, token]);

  useEffect(() => {
    setForm((prev) => ({ ...prev, currency }));
    load();
  }, [currency, load]);

  async function calculate() {
    const nisab = Number(form.nisab_amount || 0);
    if (!(nisab > 0)) {
      onMessage(tm("nisabMustBePositive"), false);
      return;
    }
    setLoading(true);
    const payload = {
      family_id: familyId,
      calculation_year: form.calculation_year.trim() || year,
      currency: (form.currency || currency).toUpperCase(),
      cash_amount: form.cash_amount || "0",
      gold_value: form.gold_value || "0",
      silver_value: form.silver_value || "0",
      investment_value: form.investment_value || "0",
      business_assets: form.business_assets || "0",
      receivables: form.receivables || "0",
      deductible_debts: form.deductible_debts || "0",
      nisab_amount: form.nisab_amount,
      note: form.note || null,
      client_request_id: `mobile-zakat-${Date.now()}`,
    };
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    if (!online && onQueueOffline) {
      await onQueueOffline("zakat_records", "CREATE", payload);
      onMessage("Zakat calculation queued offline", true);
      setLoading(false);
      return;
    }
    try {
      const result = await apiPost("/api/v1/zakat/calculate", payload, token);
      onMessage(
        result?.is_zakat_due
          ? tm("zakatDueAmount").replace("{amount}", formatAmount(result.zakat_due, result.currency))
          : tm("belowNisabZakatable").replace("{amount}", formatAmount(result.zakatable_amount, result.currency)),
        true
      );
      await load();
    } catch (error) {
      const msg = error instanceof Error ? error.message : tm("zakatLoadFailed");
      if (onQueueOffline && /failed to fetch|network|offline/i.test(msg)) {
        await onQueueOffline("zakat_records", "CREATE", payload);
        onMessage("Zakat calculation queued offline", true);
        setLoading(false);
        return;
      }
      onMessage(msg, false);
      setLoading(false);
    }
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{tm("zakat")}</Text>
      <Text style={styles.muted}>{tm("zakatSubtitle")}</Text>

      <View style={styles.grid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>{tm("records")}</Text>
          <Text style={styles.metricValue}>{String(summary?.record_count ?? summary?.total_records ?? records.length)}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>{tm("totalDue")}</Text>
          <Text style={styles.metricValue}>{formatAmount(summary?.total_zakat_due || 0, currency)}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>{tm("latest")}</Text>
          <Text style={styles.metricValue}>
            {summary?.latest
              ? `${summary.latest.calculation_year || "—"} · ${summary.latest.is_zakat_due ? tm("due") : "OK"}`
              : "—"}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>{tm("calculate")}</Text>
      <TextInput style={styles.input} placeholder={tm("yearPlaceholder")} placeholderTextColor="#8aa39a" value={form.calculation_year} onChangeText={(calculation_year) => setForm((c) => ({ ...c, calculation_year }))} />
      <TextInput style={styles.input} placeholder={tm("currency")} placeholderTextColor="#8aa39a" autoCapitalize="characters" value={form.currency} onChangeText={(value) => setForm((c) => ({ ...c, currency: value }))} />
      <TextInput style={styles.input} placeholder={tm("cashAmountPlaceholder")} placeholderTextColor="#8aa39a" keyboardType="decimal-pad" value={form.cash_amount} onChangeText={(cash_amount) => setForm((c) => ({ ...c, cash_amount }))} />
      <TextInput style={styles.input} placeholder={tm("goldValuePlaceholder")} placeholderTextColor="#8aa39a" keyboardType="decimal-pad" value={form.gold_value} onChangeText={(gold_value) => setForm((c) => ({ ...c, gold_value }))} />
      <TextInput style={styles.input} placeholder={tm("silverValue")} placeholderTextColor="#8aa39a" keyboardType="decimal-pad" value={form.silver_value} onChangeText={(silver_value) => setForm((c) => ({ ...c, silver_value }))} />
      <TextInput style={styles.input} placeholder={tm("investments")} placeholderTextColor="#8aa39a" keyboardType="decimal-pad" value={form.investment_value} onChangeText={(investment_value) => setForm((c) => ({ ...c, investment_value }))} />
      <TextInput style={styles.input} placeholder={tm("businessAssets")} placeholderTextColor="#8aa39a" keyboardType="decimal-pad" value={form.business_assets} onChangeText={(business_assets) => setForm((c) => ({ ...c, business_assets }))} />
      <TextInput style={styles.input} placeholder={tm("receivables")} placeholderTextColor="#8aa39a" keyboardType="decimal-pad" value={form.receivables} onChangeText={(receivables) => setForm((c) => ({ ...c, receivables }))} />
      <TextInput style={styles.input} placeholder={tm("deductibleDebts")} placeholderTextColor="#8aa39a" keyboardType="decimal-pad" value={form.deductible_debts} onChangeText={(deductible_debts) => setForm((c) => ({ ...c, deductible_debts }))} />
      <TextInput style={styles.input} placeholder={tm("nisabAmountPlaceholder")} placeholderTextColor="#8aa39a" keyboardType="decimal-pad" value={form.nisab_amount} onChangeText={(nisab_amount) => setForm((c) => ({ ...c, nisab_amount }))} />
      <TextInput style={styles.input} placeholder={tm("note")} placeholderTextColor="#8aa39a" value={form.note} onChangeText={(note) => setForm((c) => ({ ...c, note }))} />

      <Pressable style={styles.primaryButton} onPress={calculate} disabled={loading}>
        <Text style={styles.primaryButtonText}>{loading ? tm("calculating") : tm("calculateSave")}</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={load} disabled={loading}>
        <Text style={styles.secondaryButtonText}>{tm("refreshZakat")}</Text>
      </Pressable>

      <Text style={styles.sectionLabel}>{tm("history")}</Text>
      {records.length === 0 ? <Text style={styles.muted}>{tm("noZakatRecords")}</Text> : null}
      {records.slice(0, 20).map((record) => (
        <View style={styles.listRow} key={record.id}>
          <Text style={styles.listTitle}>
            {record.calculation_year} · {record.currency}
          </Text>
          <Text style={styles.muted}>
            {tm("zakatable")} {formatAmount(record.zakatable_amount, record.currency)} · {tm("due")}{" "}
            {formatAmount(record.zakat_due, record.currency)}
          </Text>
          <Text style={styles.muted}>
            {record.is_zakat_due ? tm("zakatDue") : tm("belowNisab")} · {tm("nisabAmountPlaceholder")}{" "}
            {formatAmount(record.nisab_amount, record.currency)}
          </Text>
          {record.created_at ? (
            <Text style={styles.muted}>{String(record.created_at).slice(0, 19).replace("T", " ")}</Text>
          ) : null}
        </View>
      ))}
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
  primaryButton: { backgroundColor: "#0f8f6f", borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  primaryButtonText: { color: "#ffffff", fontWeight: "900", fontSize: 15 },
  secondaryButton: { borderColor: "#20c997", borderWidth: 1, borderRadius: 16, paddingVertical: 12, alignItems: "center" },
  secondaryButtonText: { color: "#0f8f6f", fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricCard: { flexGrow: 1, minWidth: "45%", backgroundColor: "#f8fbfa", borderRadius: 18, padding: 12 },
  metricLabel: { color: "#6c7b76", fontSize: 12, fontWeight: "700" },
  metricValue: { color: "#17211e", fontSize: 16, fontWeight: "900", marginTop: 6 },
  sectionLabel: { color: "#0b6f58", fontWeight: "900", marginTop: 6 },
  listRow: { borderTopColor: "#dce7e3", borderTopWidth: 1, paddingTop: 10, gap: 2 },
  listTitle: { color: "#17211e", fontWeight: "900", fontSize: 15 },
});
