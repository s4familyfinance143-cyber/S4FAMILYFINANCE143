import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tMobile, type MobileLang } from "../../i18n";

type Props = {
  token: string;
  familyId: string;
  currency?: string;
  lang?: MobileLang;
  apiGet: (path: string, authToken?: string) => Promise<any>;
  formatAmount: (value?: string | number | null, currency?: string) => string;
  onMessage: (message: string, ok?: boolean) => void;
};

export function MobileCurrencyPanel({
  token,
  familyId,
  currency = "BDT",
  lang = "bn",
  apiGet,
  formatAmount,
  onMessage,
}: Props) {
  const tm = (key: string) => tMobile(lang, key);
  const [loading, setLoading] = useState(false);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);

  const load = useCallback(async () => {
    if (!token || !familyId) return;
    setLoading(true);
    try {
      const [currencyList, rateList, familySummary] = await Promise.all([
        apiGet("/api/v1/currency/", token),
        apiGet("/api/v1/currency/rates", token),
        apiGet(`/api/v1/currency/family-summary/${familyId}`, token),
      ]);
      setCurrencies(Array.isArray(currencyList) ? currencyList : currencyList?.currencies || []);
      setRates(Array.isArray(rateList) ? rateList : rateList?.rates || []);
      setSummary(familySummary);
      onMessage(tMobile(lang, "currencyLoaded"), true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Currency load failed", false);
      setCurrencies([]);
      setRates([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [apiGet, familyId, lang, onMessage, token]);

  useEffect(() => {
    load();
  }, [load]);

  const base = summary?.base_currency || currency;

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{tm("currencyCenter")}</Text>
      <Text style={styles.sub}>{tm("currencyHint")}</Text>

      <View style={styles.row}>
        <View style={styles.card}>
          <Text style={styles.label}>{tm("baseCurrency")}</Text>
          <Text style={styles.value}>{base}</Text>
          <Text style={styles.muted}>
            {String(summary?.wallet_count || 0)} {tm("walletBalancesIncluded")}
          </Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>{tm("totalConvertedBalance")}</Text>
          <Text style={styles.value}>{formatAmount(summary?.total_converted_balance, base)}</Text>
          <Text style={styles.muted}>{tm("convertedIntoBase")}</Text>
        </View>
      </View>

      <Pressable style={styles.secondaryButton} onPress={load} disabled={loading}>
        <Text style={styles.secondaryButtonText}>{loading ? tm("loading") : tm("refreshCurrency")}</Text>
      </Pressable>

      <Text style={styles.section}>{tm("walletCurrencyExposure")}</Text>
      {(summary?.wallets || []).length === 0 ? (
        <Text style={styles.muted}>{tm("noWalletReport")}</Text>
      ) : (
        (summary.wallets || []).map((wallet: any) => (
          <View style={styles.fileCard} key={wallet.wallet_id || wallet.wallet_name}>
            <Text style={styles.fileName}>{wallet.wallet_name || tm("wallets")}</Text>
            <Text style={styles.muted}>
              {wallet.wallet_currency} · {tm("balance")}: {formatAmount(wallet.balance, wallet.wallet_currency)}
            </Text>
            <Text style={styles.value}>{formatAmount(wallet.converted_balance, base)}</Text>
          </View>
        ))
      )}

      <Text style={styles.section}>{tm("latestExchangeRates")}</Text>
      {rates.length === 0 ? (
        <Text style={styles.muted}>{tm("noExchangeRatesFound")}</Text>
      ) : (
        rates.slice(0, 20).map((rate) => (
          <View style={styles.fileCard} key={rate.id || `${rate.from_currency}-${rate.to_currency}-${rate.rate_date}`}>
            <Text style={styles.fileName}>
              {rate.from_currency} → {rate.to_currency}
            </Text>
            <Text style={styles.value}>{String(rate.rate)}</Text>
            <Text style={styles.muted}>
              {rate.rate_date || "—"} · {rate.source || "Manual"} · {rate.is_active ? tm("active") : tm("inactive")}
            </Text>
          </View>
        ))
      )}

      <Text style={styles.section}>{tm("activeCurrencies")}</Text>
      <View style={styles.chipRow}>
        {currencies.length === 0 ? (
          <Text style={styles.muted}>{tm("noCurrenciesFound")}</Text>
        ) : (
          currencies.slice(0, 24).map((item) => (
            <View style={styles.chip} key={item.id || item.code}>
              <Text style={styles.chipText}>
                {item.code} {item.symbol ? `(${item.symbol})` : ""}
              </Text>
            </View>
          ))
        )}
      </View>
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
  value: { color: "#0f8f6f", fontSize: 16, fontWeight: "900" },
  muted: { color: "#7a8f88", fontSize: 12, lineHeight: 17 },
  section: { fontSize: 15, fontWeight: "800", color: "#17211e", marginTop: 4 },
  fileCard: { backgroundColor: "#f5faf8", borderRadius: 14, padding: 12, gap: 4 },
  fileName: { color: "#17211e", fontWeight: "800", fontSize: 13 },
  secondaryButton: { borderWidth: 1, borderColor: "#c9dbd4", borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, backgroundColor: "#ffffff" },
  secondaryButtonText: { color: "#0b6f58", fontWeight: "800", textAlign: "center" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: "#eef8f4", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { color: "#0b6f58", fontWeight: "700", fontSize: 12 },
});
