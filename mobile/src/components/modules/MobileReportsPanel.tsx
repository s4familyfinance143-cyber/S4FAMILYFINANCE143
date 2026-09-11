import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { tMobile, type MobileLang } from "../../i18n";
import { loadModuleSnapshot, saveModuleSnapshot } from "../../lib/offlineSnapshots";
import { cacheMobileFile, getCachedMobileFile } from "../../lib/offlineFileQueue";
import { Chart } from "../ui/Chart";

type ReportTab = "OVERVIEW" | "LEDGER" | "NETWORTH" | "CATEGORIES" | "BUDGET" | "LOANS" | "EXPORT";

type Props = {
  token: string;
  familyId: string;
  currency: string;
  apiBaseUrl: string;
  apiGet: (path: string, authToken?: string) => Promise<any>;
  formatAmount: (value?: string | number | null, currency?: string) => string;
  onMessage: (message: string, ok?: boolean) => void;
  lang?: MobileLang;
};

async function downloadExportBlob(
  apiBaseUrl: string,
  path: string,
  token: string,
  filename: string
): Promise<{ bytes: number; contentType: string; shared: boolean; uri?: string }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (apiBaseUrl.includes("loca.lt")) headers["bypass-tunnel-reminder"] = "true";
  const response = await fetch(`${apiBaseUrl}${path}`, { headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === "object" ? JSON.stringify(data.detail) : data.detail || `Export failed (${response.status})`);
  }
  const blob = await response.blob();
  const contentType = response.headers.get("content-type") || blob.type || "application/octet-stream";

  if (Platform.OS === "web" && typeof document !== "undefined") {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return { bytes: blob.size, contentType, shared: false };
  }

  // Native: write cache file and open share sheet when available
  try {
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
    const uri = `${directory}${filename}`;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: contentType, dialogTitle: filename });
      return { bytes: blob.size, contentType, shared: true, uri };
    }
    return { bytes: blob.size, contentType, shared: false, uri };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Native share unavailable — install expo-file-system + expo-sharing");
  }
}

export function MobileReportsPanel({
  token,
  familyId,
  currency,
  apiBaseUrl,
  apiGet,
  formatAmount,
  onMessage,
  lang = "bn",
}: Props) {
  const tm = (key: string) => tMobile(lang, key);
  const [tab, setTab] = useState<ReportTab>("OVERVIEW");
  const [loading, setLoading] = useState(false);
  const [financial, setFinancial] = useState<any>(null);
  const [wallets, setWallets] = useState<any>(null);
  const [cashflow, setCashflow] = useState<any>(null);
  const [dashboard, setDashboard] = useState<any>(null);
  const [netWorth, setNetWorth] = useState<any>(null);
  const [categories, setCategories] = useState<any>(null);
  const [budget, setBudget] = useState<any>(null);
  const [loans, setLoans] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [ledgerAccountId, setLedgerAccountId] = useState("");
  const [exportBusy, setExportBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token || !familyId) return;
    setLoading(true);
    try {
      if (tab === "OVERVIEW") {
        const [fin, wal, cash] = await Promise.all([
          apiGet(`/families/${familyId}/reports/financial-summary`, token),
          apiGet(`/api/v1/reports/wallets/${familyId}`, token),
          apiGet(`/api/v1/reports/cashflow/${familyId}`, token),
        ]);
        setFinancial(fin);
        setWallets(wal);
        setCashflow(cash);
        await saveModuleSnapshot(familyId, "reports:OVERVIEW", { financial: fin, wallets: wal, cashflow: cash });
      } else if (tab === "NETWORTH") {
        const [dash, nw] = await Promise.all([
          apiGet(`/api/v1/reports/dashboard/${familyId}`, token),
          apiGet(`/api/v1/reports/net-worth/${familyId}`, token),
        ]);
        setDashboard(dash);
        setNetWorth(nw);
        await saveModuleSnapshot(familyId, "reports:NETWORTH", { dashboard: dash, netWorth: nw });
      } else if (tab === "CATEGORIES") {
        const data = await apiGet(`/api/v1/reports/categories/${familyId}`, token);
        setCategories(data);
        await saveModuleSnapshot(familyId, "reports:CATEGORIES", data);
      } else if (tab === "BUDGET") {
        const data = await apiGet(`/api/v1/reports/budget/${familyId}`, token);
        setBudget(data);
        await saveModuleSnapshot(familyId, "reports:BUDGET", data);
      } else if (tab === "LOANS") {
        const data = await apiGet(`/api/v1/reports/loans/${familyId}`, token);
        setLoans(data);
        await saveModuleSnapshot(familyId, "reports:LOANS", data);
      } else if (tab === "LEDGER") {
        const wal = wallets || (await apiGet(`/api/v1/reports/wallets/${familyId}`, token));
        if (!wallets) setWallets(wal);
        const accountId =
          ledgerAccountId ||
          wal?.wallets?.[0]?.id ||
          wal?.wallets?.[0]?.wallet_id ||
          wal?.wallets?.[0]?.account_id ||
          "";
        if (accountId && accountId !== ledgerAccountId) setLedgerAccountId(accountId);
        if (!accountId) {
          setLedger({ rows: [] });
        } else {
          const data = await apiGet(
            `/families/${familyId}/reports/account-ledger?account_id=${encodeURIComponent(accountId)}&limit=25`,
            token
          );
          setLedger(data);
          await saveModuleSnapshot(familyId, "reports:LEDGER", data);
        }
      }
      onMessage(tm("reportsLoaded").replace("{tab}", tab), true);
    } catch (error) {
      const cached = await loadModuleSnapshot<any>(familyId, `reports:${tab}`);
      if (cached) {
        if (tab === "OVERVIEW") {
          setFinancial(cached.financial || null);
          setWallets(cached.wallets || null);
          setCashflow(cached.cashflow || null);
        } else if (tab === "NETWORTH") {
          setDashboard(cached.dashboard || null);
          setNetWorth(cached.netWorth || null);
        } else if (tab === "CATEGORIES") setCategories(cached);
        else if (tab === "BUDGET") setBudget(cached);
        else if (tab === "LOANS") setLoans(cached);
        else if (tab === "LEDGER") setLedger(cached);
        onMessage("Offline reports cache loaded", true);
      } else {
        onMessage(error instanceof Error ? error.message : "Reports load failed", false);
      }
    } finally {
      setLoading(false);
    }
  }, [apiGet, familyId, ledgerAccountId, onMessage, tab, token, lang]);

  useEffect(() => {
    if (tab !== "EXPORT") load();
  }, [load, tab]);

  async function runExport(kind: "cashflow-pdf" | "cashflow-excel" | "transactions-pdf" | "transactions-excel") {
    setExportBusy(true);
    const map = {
      "cashflow-pdf": { path: `/api/v1/reports/cashflow/${familyId}/export/pdf`, file: `cashflow-${familyId}.pdf`, kind: "export:cashflow-pdf" },
      "cashflow-excel": { path: `/api/v1/reports/cashflow/${familyId}/export/excel`, file: `cashflow-${familyId}.xlsx`, kind: "export:cashflow-excel" },
      "transactions-pdf": { path: `/api/v1/reports/transactions/${familyId}/export/pdf`, file: `transactions-${familyId}.pdf`, kind: "export:transactions-pdf" },
      "transactions-excel": { path: `/api/v1/reports/transactions/${familyId}/export/excel`, file: `transactions-${familyId}.xlsx`, kind: "export:transactions-excel" },
    } as const;
    const selected = map[kind];
    try {
      const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
      if (!online) {
        const cached = await getCachedMobileFile(familyId, selected.kind);
        if (!cached?.file_uri) throw new Error("No offline export yet — export once while online");
        if (Platform.OS !== "web") {
          const Sharing = await import("expo-sharing");
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(cached.file_uri, {
              mimeType: cached.mime_type || "application/octet-stream",
              dialogTitle: cached.file_name,
            });
          }
        }
        onMessage(`Opened offline export: ${cached.file_name}`, true);
        return;
      }

      const result = await downloadExportBlob(apiBaseUrl, selected.path, token, selected.file);
      if (result.uri) {
        await cacheMobileFile({
          familyId,
          kind: selected.kind,
          fileUri: result.uri,
          fileName: selected.file,
          mimeType: result.contentType,
        });
      }
      if (Platform.OS === "web") {
        onMessage(`Downloaded ${selected.file} (${result.bytes} bytes)`, true);
      } else if (result.shared) {
        onMessage(`Shared ${selected.file} (${result.bytes} bytes) via system share sheet`, true);
      } else {
        onMessage(`Export saved to cache (${result.bytes} bytes). Share sheet unavailable on this device.`, true);
      }
    } catch (error) {
      try {
        const cached = await getCachedMobileFile(familyId, selected.kind);
        if (cached?.file_uri && Platform.OS !== "web") {
          const Sharing = await import("expo-sharing");
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(cached.file_uri, {
              mimeType: cached.mime_type || "application/octet-stream",
              dialogTitle: cached.file_name,
            });
          }
          onMessage(`Opened offline export: ${cached.file_name}`, true);
          return;
        }
      } catch {
        /* ignore */
      }
      onMessage(error instanceof Error ? error.message : "Export failed", false);
    } finally {
      setExportBusy(false);
    }
  }

  const summary = financial?.summary || financial || {};
  const walletRows = wallets?.wallets || wallets?.items || (Array.isArray(wallets) ? wallets : []);
  const monthly = cashflow?.monthly_cashflow || [];
  const netCash = cashflow?.summary?.net_cashflow;
  const walletCount = wallets?.summary?.wallet_count || wallets?.wallet_count || walletRows.length || 0;
  const dash = dashboard?.dashboard || dashboard || {};
  const nw = netWorth?.summary || netWorth || {};
  const catSummary = categories?.summary || {};
  const incomeCats = categories?.income_categories || [];
  const expenseCats = categories?.expense_categories || [];
  const budgetRows =
    budget?.active_budgets ||
    budget?.budgets ||
    budget?.items ||
    budget?.rows ||
    (Array.isArray(budget) ? budget : []);
  const budgetSummary = budget?.summary || {};
  const loanRows = loans?.loans || loans?.items || loans?.rows || (Array.isArray(loans) ? loans : []);
  const loanSummary = loans?.summary || {};

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{tm("reports")}</Text>
      <Text style={styles.muted}>Overview · net worth · categories · budget · loans · export — live API</Text>

      <View style={styles.statusRow}>
        {(
          [
            ["OVERVIEW", "overview"],
            ["LEDGER", "ledger"],
            ["NETWORTH", "netWorthReport"],
            ["CATEGORIES", "categories"],
            ["BUDGET", "budget"],
            ["LOANS", "loans"],
            ["EXPORT", "export"],
          ] as const
        ).map(([id, label]) => (
          <Pressable key={id} onPress={() => setTab(id)}>
            <Text style={[styles.statusPill, tab === id ? styles.ok : null]}>{tm(label)}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "OVERVIEW" ? (
        <>
          <View style={styles.grid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("debit")}</Text>
              <Text style={styles.metricValue}>{formatAmount(summary.total_debit || summary.total_expense || 0, currency)}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("credit")}</Text>
              <Text style={styles.metricValue}>{formatAmount(summary.total_credit || summary.total_income || 0, currency)}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("netCashflow")}</Text>
              <Text style={styles.metricValue}>{formatAmount(netCash ?? summary.net_income_expense ?? 0, currency)}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("wallets")}</Text>
              <Text style={styles.metricValue}>{String(walletCount)}</Text>
            </View>
          </View>

          <Chart
            title={tm("cashflow") || "Cashflow"}
            data={[
              { label: "In", value: Number(summary.total_credit || summary.total_income || 0) },
              { label: "Out", value: Number(summary.total_debit || summary.total_expense || 0) },
              { label: "Net", value: Math.abs(Number(netCash ?? summary.net_income_expense ?? 0)) },
            ]}
          />

          <Pressable style={styles.secondaryButton} onPress={load} disabled={loading}>
            <Text style={styles.secondaryButtonText}>{loading ? "Refreshing..." : "Refresh overview"}</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>{tm("walletSummary")}</Text>
          {walletRows.length === 0 ? <Text style={styles.muted}>{tm("noWalletRows")}</Text> : null}
          {walletRows.slice(0, 8).map((wallet: any) => (
            <View style={styles.listRow} key={wallet.wallet_id || wallet.id || wallet.account_id || wallet.name}>
              <Text style={styles.listTitle}>{wallet.wallet_name || wallet.name || wallet.account_name || "Wallet"}</Text>
              <Text style={styles.muted}>
                {wallet.wallet_type || wallet.account_type || wallet.type || "ACCOUNT"} · {formatAmount(wallet.balance || wallet.current_balance || 0, wallet.currency || currency)}
              </Text>
            </View>
          ))}

          <Text style={styles.sectionLabel}>{tm("monthlyCashflow")}</Text>
          {monthly.length === 0 ? <Text style={styles.muted}>{tm("noMonthlyCashflow")}</Text> : null}
          {monthly.slice(0, 8).map((row: any, index: number) => (
            <View style={styles.listRow} key={`${row.month || row.label || index}`}>
              <Text style={styles.listTitle}>{row.month || row.label || `Month ${index + 1}`}</Text>
              <Text style={styles.muted}>
                In {formatAmount(row.inflow || row.income || 0, currency)} · Out {formatAmount(row.outflow || row.expense || 0, currency)} · Net {formatAmount(row.net || row.net_cashflow || row.cashflow || 0, currency)}
              </Text>
            </View>
          ))}
        </>
      ) : null}

      {tab === "LEDGER" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("ledger")}</Text>
          <View style={styles.statusRow}>
            {(wallets?.wallets || []).slice(0, 8).map((wallet: any) => {
              const id = wallet.id || wallet.wallet_id || wallet.account_id;
              return (
                <Pressable
                  key={id}
                  onPress={() => {
                    setLedgerAccountId(id);
                  }}
                >
                  <Text style={[styles.statusPill, ledgerAccountId === id ? styles.ok : null]}>
                    {wallet.name || wallet.wallet_name || "Wallet"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable style={styles.secondaryButton} onPress={load} disabled={loading}>
            <Text style={styles.secondaryButtonText}>{loading ? "Refreshing..." : tm("refresh")}</Text>
          </Pressable>
          {(ledger?.rows || []).length === 0 ? <Text style={styles.muted}>{tm("noLedgerRows") || "No ledger rows"}</Text> : null}
          {(ledger?.rows || []).map((row: any, index: number) => (
            <View style={styles.listRow} key={row.transaction_id || index}>
              <Text style={styles.listTitle}>{row.description || row.transaction_id || "TX"}</Text>
              <Text style={styles.muted}>
                Dr {formatAmount(row.debit || 0, currency)} · Cr {formatAmount(row.credit || 0, currency)} · Bal{" "}
                {formatAmount(row.running_balance || 0, currency)}
              </Text>
            </View>
          ))}
        </>
      ) : null}

      {tab === "NETWORTH" ? (
        <>
          <View style={styles.grid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("netWorthReport")}</Text>
              <Text style={styles.metricValue}>{formatAmount(nw.net_worth || dash.net_worth || 0, currency)}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("wallets")}</Text>
              <Text style={styles.metricValue}>{formatAmount(nw.wallet_balance || dash.wallet_balance || 0, currency)}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("savings")}</Text>
              <Text style={styles.metricValue}>{formatAmount(nw.savings_amount || dash.total_savings || 0, currency)}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("loansLeft")}</Text>
              <Text style={styles.metricValue}>{formatAmount(nw.loan_remaining || dash.loan_remaining || 0, currency)}</Text>
            </View>
          </View>
          <Text style={styles.muted}>
            Income {formatAmount(dash.total_income || 0, currency)} · Expense {formatAmount(dash.total_expense || 0, currency)} · Cashflow {formatAmount(dash.cashflow || 0, currency)}
          </Text>
          <Text style={styles.muted}>Assets {formatAmount(nw.total_assets || 0, currency)} · Goals saved {formatAmount(nw.goal_saved_amount || dash.goal_saved || 0, currency)}</Text>
          <Pressable style={styles.secondaryButton} onPress={load} disabled={loading}>
            <Text style={styles.secondaryButtonText}>{loading ? "Refreshing..." : "Refresh net worth"}</Text>
          </Pressable>
        </>
      ) : null}

      {tab === "CATEGORIES" ? (
        <>
          <View style={styles.grid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("income")}</Text>
              <Text style={styles.metricValue}>{formatAmount(catSummary.total_income || 0, currency)}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("expense")}</Text>
              <Text style={styles.metricValue}>{formatAmount(catSummary.total_expense || 0, currency)}</Text>
            </View>
          </View>
          <Text style={styles.sectionLabel}>{tm("topExpenseCategories")}</Text>
          {expenseCats.length === 0 ? <Text style={styles.muted}>{tm("noExpenseCategories")}</Text> : null}
          {expenseCats.slice(0, 8).map((row: any, index: number) => (
            <View style={styles.listRow} key={`exp-${row.category?.id || index}`}>
              <Text style={styles.listTitle}>{row.category?.name_en || row.category?.name_bn || row.category?.name || "Category"}</Text>
              <Text style={styles.muted}>{formatAmount(row.amount || 0, currency)} · {row.percent || "0"}%</Text>
            </View>
          ))}
          <Text style={styles.sectionLabel}>{tm("topIncomeCategories")}</Text>
          {incomeCats.length === 0 ? <Text style={styles.muted}>{tm("noIncomeCategories")}</Text> : null}
          {incomeCats.slice(0, 8).map((row: any, index: number) => (
            <View style={styles.listRow} key={`inc-${row.category?.id || index}`}>
              <Text style={styles.listTitle}>{row.category?.name_en || row.category?.name_bn || row.category?.name || "Category"}</Text>
              <Text style={styles.muted}>{formatAmount(row.amount || 0, currency)} · {row.percent || "0"}%</Text>
            </View>
          ))}
          <Pressable style={styles.secondaryButton} onPress={load} disabled={loading}>
            <Text style={styles.secondaryButtonText}>{loading ? "Refreshing..." : "Refresh categories"}</Text>
          </Pressable>
        </>
      ) : null}

      {tab === "BUDGET" ? (
        <>
          <View style={styles.grid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("budgets")}</Text>
              <Text style={styles.metricValue}>{String(budgetSummary.active_budget_count || budgetSummary.budget_count || budgetRows.length || 0)}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("allocated")}</Text>
              <Text style={styles.metricValue}>{formatAmount(budgetSummary.active_total_budget || budgetSummary.total_budget || budgetSummary.total_allocated || 0, currency)}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("spent")}</Text>
              <Text style={styles.metricValue}>{formatAmount(budgetSummary.active_total_spent || budgetSummary.total_spent || 0, currency)}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("remaining")}</Text>
              <Text style={styles.metricValue}>{formatAmount(budgetSummary.active_total_remaining || budgetSummary.total_remaining || 0, currency)}</Text>
            </View>
          </View>
          {budgetRows.length === 0 ? <Text style={styles.muted}>{tm("noBudgetRows")}</Text> : null}
          {budgetRows.slice(0, 10).map((row: any) => (
            <View style={styles.listRow} key={row.id || row.budget_id || row.name || row.budget_name}>
              <Text style={styles.listTitle}>{row.budget_name || row.name || row.title || "Budget"}</Text>
              <Text style={styles.muted}>
                {formatAmount(row.spent_amount || row.spent || 0, row.currency || currency)} / {formatAmount(row.budget_amount || row.amount || 0, row.currency || currency)} · {row.status || row.period_type || ""}
              </Text>
            </View>
          ))}
          <Pressable style={styles.secondaryButton} onPress={load} disabled={loading}>
            <Text style={styles.secondaryButtonText}>{loading ? "Refreshing..." : "Refresh budget report"}</Text>
          </Pressable>
        </>
      ) : null}

      {tab === "LOANS" ? (
        <>
          <View style={styles.grid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("loans")}</Text>
              <Text style={styles.metricValue}>{String(loanSummary.total_loans || loanSummary.loan_count || loanRows.length || 0)}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{tm("remaining")}</Text>
              <Text style={styles.metricValue}>{formatAmount(loanSummary.total_remaining_amount || loanSummary.total_remaining || loanSummary.remaining_amount || 0, currency)}</Text>
            </View>
          </View>
          {loanRows.length === 0 ? <Text style={styles.muted}>{tm("noLoanRows")}</Text> : null}
          {loanRows.slice(0, 10).map((row: any) => (
            <View style={styles.listRow} key={row.id || row.loan_id || row.name || row.person_name}>
              <Text style={styles.listTitle}>{row.person_name || row.name || row.title || row.counterparty || "Loan"}</Text>
              <Text style={styles.muted}>
                {row.loan_type || row.type || "LOAN"} · left {formatAmount(row.remaining_amount || row.remaining || 0, row.currency || currency)} · {row.status || ""}
              </Text>
            </View>
          ))}
          <Pressable style={styles.secondaryButton} onPress={load} disabled={loading}>
            <Text style={styles.secondaryButtonText}>{loading ? "Refreshing..." : "Refresh loans report"}</Text>
          </Pressable>
        </>
      ) : null}

      {tab === "EXPORT" ? (
        <>
          <Text style={styles.muted}>
            Auth-protected PDF/Excel export. On web the file downloads directly; on native the payload is fetched (save from web/PC for best result).
          </Text>
          <Pressable style={styles.primaryButton} onPress={() => runExport("cashflow-pdf")} disabled={exportBusy}>
            <Text style={styles.primaryButtonText}>{exportBusy ? "Exporting..." : "Cashflow PDF"}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => runExport("cashflow-excel")} disabled={exportBusy}>
            <Text style={styles.secondaryButtonText}>{tm("cashflowExcel")}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => runExport("transactions-pdf")} disabled={exportBusy}>
            <Text style={styles.secondaryButtonText}>{tm("transactionsPdf")}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => runExport("transactions-excel")} disabled={exportBusy}>
            <Text style={styles.secondaryButtonText}>{tm("transactionsExcel")}</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#ffffff", borderColor: "#dce7e3", borderWidth: 1, borderRadius: 24, padding: 16, gap: 12 },
  panelTitle: { color: "#17211e", fontSize: 20, fontWeight: "900" },
  muted: { color: "#6c7b76", fontSize: 13, lineHeight: 19 },
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
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusPill: { color: "#0b6f58", backgroundColor: "#e0f4ed", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: "800" },
  ok: { backgroundColor: "#0f8f6f", color: "#ffffff" },
});
