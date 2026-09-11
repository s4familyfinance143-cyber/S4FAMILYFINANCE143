import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export type HomeDashboardSummary = {
  total_wallet_balance?: string | number;
  total_income?: string | number;
  total_expense?: string | number;
  net_income_expense?: string | number;
  loan_taken_remaining?: string | number;
  loan_given_remaining?: string | number;
  savings_current?: string | number;
  wallet_count?: string | number;
};

export type HomeAccount = {
  id: string;
  name: string;
  account_type?: string;
  current_balance?: string | number;
  currency?: string;
};

export type HomeBudget = {
  id: string;
  name?: string;
  title?: string;
  budget_amount?: string | number;
  amount?: string | number;
  spent_amount?: string | number;
  status?: string;
};

export type HomeTransaction = {
  id: string;
  transaction_type: string;
  amount: string | number;
  currency?: string;
  description?: string;
  created_at?: string;
};

type ModuleShortcut = {
  id: string;
  label: string;
  hint: string;
  icon: string;
  onPress: () => void;
};

type Props = {
  currency: string;
  familyName?: string;
  dashboard: HomeDashboardSummary | null;
  accounts: HomeAccount[];
  budgets: HomeBudget[];
  transactions: HomeTransaction[];
  pendingSync: number;
  conflictSync: number;
  failedSync: number;
  money: (value?: string | number | null, currency?: string) => string;
  t: (key: string) => string;
  onOpenFinance: () => void;
  onOpenFinanceSub?: (sub: string) => void;
  onOpenReports: () => void;
  onOpenFamily: () => void;
  onOpenGrocery: () => void;
  onOpenLife: () => void;
  onOpenLifeModule?: (moduleType: string) => void;
  onOpenZakat: () => void;
  onOpenAlerts: () => void;
  onOpenAudit: () => void;
  onOpenSettings: () => void;
  onOpenSync: () => void;
  onOpenBackup: () => void;
  onOpenCurrency: () => void;
  onRefresh: () => void;
  loading?: boolean;
  lang?: string;
};

function pct(spent: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((spent / limit) * 100));
}

function num(value?: string | number | null) {
  return Number(value || 0);
}

const BN_MONTHS = ["জানু", "ফেব্রু", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্ট", "অক্টো", "নভে", "ডিসে"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabels(lang: string) {
  if (lang === "bn") return BN_MONTHS;
  return EN_MONTHS;
}

function buildMonthSeries(transactions: HomeTransaction[] | undefined, lang = "bn") {
  const months: { key: string; label: string; income: number; expense: number }[] = [];
  const labels = monthLabels(lang);
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: labels[d.getMonth()] || d.toLocaleString(undefined, { month: "short" }),
      income: 0,
      expense: 0,
    });
  }
  const index = Object.fromEntries(months.map((m, i) => [m.key, i]));
  for (const tx of transactions || []) {
    const raw = tx.created_at;
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const slot = index[key];
    if (slot == null) continue;
    const amount = Number(tx.amount || 0);
    if (String(tx.transaction_type).toUpperCase() === "INCOME") months[slot].income += amount;
    if (String(tx.transaction_type).toUpperCase() === "EXPENSE") months[slot].expense += amount;
  }
  return months;
}

export function MobileHomeDashboard({
  currency,
  familyName,
  dashboard,
  accounts,
  budgets,
  transactions,
  pendingSync,
  conflictSync,
  failedSync,
  money,
  t,
  onOpenFinance,
  onOpenFinanceSub,
  onOpenReports,
  onOpenFamily,
  onOpenGrocery,
  onOpenLife,
  onOpenLifeModule,
  onOpenZakat,
  onOpenAlerts,
  onOpenAudit,
  onOpenSettings,
  onOpenSync,
  onOpenBackup,
  onOpenCurrency,
  onRefresh,
  loading,
  lang = "bn",
}: Props) {
  const wallet = num(dashboard?.total_wallet_balance);
  const income = num(dashboard?.total_income);
  const expense = num(dashboard?.total_expense);
  const loanTaken = num(dashboard?.loan_taken_remaining);
  const loanGiven = num(dashboard?.loan_given_remaining);
  const savings = num(dashboard?.savings_current);
  const netWorth = wallet + savings + loanGiven - loanTaken;
  const syncHealth = Math.max(0, Math.min(100, 100 - pendingSync * 4 - conflictSync * 10 - failedSync * 8));
  const monthSeries = buildMonthSeries(transactions, lang);
  const chartMax = Math.max(...monthSeries.flatMap((m) => [m.income, m.expense]), 1);

  const kpis = [
    { label: t("netWorth"), value: money(netWorth, currency), tip: t("walletBalance"), icon: "⌁", down: false },
    { label: t("monthlyIncome"), value: money(income, currency), tip: "↗", icon: "↙", down: false },
    { label: t("monthlyExpense"), value: money(expense, currency), tip: "↘", icon: "↗", down: true },
    { label: t("walletBalance"), value: money(wallet, currency), tip: `${accounts.length}`, icon: "💳", down: false },
    { label: t("outstandingLoan"), value: money(loanTaken, currency), tip: loanTaken > 0 ? "!" : "OK", icon: "💸", down: loanTaken > 0 },
    { label: t("savings"), value: money(savings, currency), tip: "•", icon: "🏛", down: false },
  ];

  const budgetRows = (budgets || [])
    .filter((b) => String(b.status || "ACTIVE").toUpperCase() === "ACTIVE")
    .slice(0, 4)
    .map((b) => {
      const limit = num(b.budget_amount || b.amount);
      const spent = num(b.spent_amount);
      const used = pct(spent, limit);
      return { id: b.id, name: b.name || b.title || t("budgetStatus"), spent, limit, used, warn: used >= 75 && used < 90, danger: used >= 90 };
    });

  const recent = (transactions || []).slice(0, 5);
  const walletRows = (accounts || [])
    .slice()
    .sort((a, b) => num(b.current_balance) - num(a.current_balance))
    .slice(0, 6);
  const walletTotal = walletRows.reduce((sum, row) => sum + Math.max(0, num(row.current_balance)), 0) || wallet;

  const modules: ModuleShortcut[] = [
    { id: "wallets", label: t("wallets"), hint: t("modHint_finance"), icon: "◇", onPress: () => (onOpenFinanceSub ? onOpenFinanceSub("WALLETS") : onOpenFinance()) },
    { id: "tx", label: t("tx"), hint: t("modHint_finance"), icon: "↕", onPress: () => (onOpenFinanceSub ? onOpenFinanceSub("TX") : onOpenFinance()) },
    { id: "budgets", label: t("budgets"), hint: t("modHint_finance"), icon: "◷", onPress: () => (onOpenFinanceSub ? onOpenFinanceSub("BUDGET") : onOpenFinance()) },
    { id: "savings", label: t("savings"), hint: t("modHint_finance"), icon: "◎", onPress: () => (onOpenFinanceSub ? onOpenFinanceSub("SAVINGS") : onOpenFinance()) },
    { id: "loans", label: t("loans"), hint: t("modHint_finance"), icon: "⇄", onPress: () => (onOpenFinanceSub ? onOpenFinanceSub("LOANS") : onOpenFinance()) },
    { id: "goals", label: t("goals"), hint: t("modHint_finance"), icon: "★", onPress: () => (onOpenFinanceSub ? onOpenFinanceSub("GOALS") : onOpenFinance()) },
    { id: "recurring", label: t("recurring"), hint: t("modHint_finance"), icon: "↻", onPress: () => (onOpenFinanceSub ? onOpenFinanceSub("RECURRING") : onOpenFinance()) },
    { id: "grocery", label: t("tab_grocery"), hint: t("modHint_grocery"), icon: "🛒", onPress: onOpenGrocery },
    { id: "health", label: t("enum_HEALTH") || "Health", hint: t("modHint_life"), icon: "❤", onPress: () => (onOpenLifeModule ? onOpenLifeModule("HEALTH") : onOpenLife()) },
    { id: "invest", label: t("investments") || "Investments", hint: t("modHint_life"), icon: "◈", onPress: () => (onOpenLifeModule ? onOpenLifeModule("INVESTMENT") : onOpenLife()) },
    { id: "subs", label: t("enum_SUBSCRIPTION") || "Subscriptions", hint: t("modHint_life"), icon: "🔁", onPress: () => (onOpenLifeModule ? onOpenLifeModule("SUBSCRIPTION") : onOpenLife()) },
    { id: "family", label: t("tab_family"), hint: t("modHint_family"), icon: "👥", onPress: onOpenFamily },
    { id: "zakat", label: t("tab_zakat"), hint: t("modHint_zakat"), icon: "🕌", onPress: onOpenZakat },
    { id: "reports", label: t("tab_reports"), hint: t("modHint_reports"), icon: "▥", onPress: onOpenReports },
    { id: "alerts", label: t("tab_alerts"), hint: t("modHint_alerts"), icon: "🔔", onPress: onOpenAlerts },
    { id: "audit", label: t("tab_audit"), hint: t("modHint_audit"), icon: "🧾", onPress: onOpenAudit },
    { id: "currency", label: t("tab_currency"), hint: t("modHint_currency"), icon: "¤", onPress: onOpenCurrency },
    { id: "backup", label: t("tab_backup"), hint: t("modHint_backup"), icon: "☁", onPress: onOpenBackup },
    { id: "sync", label: t("tab_sync"), hint: t("modHint_sync"), icon: "⟳", onPress: onOpenSync },
    { id: "settings", label: t("tab_settings"), hint: t("modHint_settings"), icon: "⚙", onPress: onOpenSettings },
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.pageHead}>
        <Text style={styles.kicker}>{t("executiveOverview")}</Text>
        <Text style={styles.title}>{t("familyFinancialPicture")}</Text>
        <Text style={styles.sub}>
          {t("appSubtitle")}
          {familyName ? ` · ${familyName}` : ""}
        </Text>
        <View style={styles.headActions}>
          <Pressable style={styles.btn} onPress={onOpenReports}>
            <Text style={styles.btnText}>⇩ {t("tab_reports")}</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onOpenFinance}>
            <Text style={[styles.btnText, styles.btnPrimaryText]}>＋ {t("tab_finance")}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.notice}>
        <Text style={styles.noticeText}>✓ {t("offlineSync")} · {t("mobileModulesHint")}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kpiRow}>
        {kpis.map((kpi) => (
          <View style={styles.kpi} key={kpi.label}>
            <View style={styles.kpiTop}>
              <View style={styles.kpiIcon}><Text>{kpi.icon}</Text></View>
              <Text style={[styles.kpiChange, kpi.down ? styles.kpiDown : null]}>{kpi.tip}</Text>
            </View>
            <Text style={styles.kpiValue}>{kpi.value}</Text>
            <Text style={styles.kpiLabel}>{kpi.label}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View>
            <Text style={styles.cardTitle}>{t("allModules")}</Text>
            <Text style={styles.cardSub}>{t("allModulesHint")}</Text>
          </View>
        </View>
        <View style={styles.moduleGrid}>
          {modules.map((item) => (
            <Pressable key={item.id} style={styles.moduleTile} onPress={item.onPress}>
              <Text style={styles.moduleIcon}>{item.icon}</Text>
              <Text style={styles.moduleLabel} numberOfLines={1}>{item.label}</Text>
              <Text style={styles.moduleHint} numberOfLines={2}>{item.hint}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.refreshBtn} onPress={onRefresh} disabled={loading}>
          <Text style={styles.cardLink}>{loading ? t("saving") : `↻ ${t("refresh")}`}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View>
            <Text style={styles.cardTitle}>{t("quickWork")}</Text>
            <Text style={styles.cardSub}>{t("controlCenter")}</Text>
          </View>
        </View>
        <View style={styles.quickGrid}>
          {[
            { label: t("income"), icon: "↙", onPress: onOpenFinance },
            { label: t("expense"), icon: "↗", onPress: onOpenFinance },
            { label: t("transfer"), icon: "⇄", onPress: onOpenFinance },
            { label: t("invite"), icon: "👤＋", onPress: onOpenFamily },
          ].map((item) => (
            <Pressable key={item.label} style={styles.quick} onPress={item.onPress}>
              <Text style={styles.quickIcon}>{item.icon}</Text>
              <Text style={styles.quickLabel}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View>
            <Text style={styles.cardTitle}>{t("incomeVsExpense") || "Income vs Expense"}</Text>
            <Text style={styles.cardSub}>{t("last7MonthsTrend") || "Last 7 months"}</Text>
          </View>
        </View>
        <View style={styles.chartRow}>
          {monthSeries.map((month) => (
            <View key={month.key} style={styles.chartCol}>
              <View style={styles.chartBars}>
                <View style={[styles.chartBar, styles.chartIncome, { height: Math.max(4, Math.round((month.income / chartMax) * 72)) }]} />
                <View style={[styles.chartBar, styles.chartExpense, { height: Math.max(4, Math.round((month.expense / chartMax) * 72)) }]} />
              </View>
              <Text style={styles.chartLabel}>{month.label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.tagRow}>
          <Text style={styles.tag}>{t("income")}</Text>
          <Text style={styles.tag}>{t("expense")}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View>
            <Text style={styles.cardTitle}>{t("budgetStatus")}</Text>
            <Text style={styles.cardSub}>{t("controlCenter")}</Text>
          </View>
          <Pressable onPress={onOpenFinance}><Text style={styles.cardLink}>{t("details")}</Text></Pressable>
        </View>
        {budgetRows.length === 0 ? (
          <Text style={styles.empty}>{t("noBudgetsYet")}</Text>
        ) : (
          budgetRows.map((row) => (
            <View key={row.id} style={styles.budgetBlock}>
              <View style={styles.budgetTop}>
                <Text style={styles.budgetName}>{row.name}</Text>
                <Text style={styles.budgetAmount}>{money(row.spent, currency)} / {money(row.limit, currency)}</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, row.danger ? styles.progressDanger : row.warn ? styles.progressWarn : null, { width: `${row.used}%` }]} />
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View>
            <Text style={styles.cardTitle}>{t("offlineSync")}</Text>
            <Text style={styles.cardSub}>{t("syncTitle")}</Text>
          </View>
          <Pressable onPress={onOpenSync}><Text style={styles.cardLink}>{t("openSync")}</Text></Pressable>
        </View>
        <View style={styles.syncRow}>
          <View style={styles.syncRing}>
            <Text style={styles.syncPct}>{syncHealth}%</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.syncTitle}>{pendingSync || conflictSync || failedSync ? t("pendingSync") : t("synced")}</Text>
            <View style={styles.tagRow}>
              <Text style={styles.tag}>{t("pending")} {pendingSync}</Text>
              <Text style={styles.tag}>{t("failed")} {failedSync}</Text>
              <Text style={styles.tag}>{t("conflict")} {conflictSync}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View>
            <Text style={styles.cardTitle}>{t("recentTransactions")}</Text>
            <Text style={styles.cardSub}>{t("controlCenter")}</Text>
          </View>
          <Pressable onPress={onOpenFinance}><Text style={styles.cardLink}>{t("openFinance")}</Text></Pressable>
        </View>
        {recent.length === 0 ? (
          <Text style={styles.empty}>{t("noTransactionsYet")}</Text>
        ) : (
          recent.map((tx) => {
            const type = String(tx.transaction_type || "").toUpperCase();
            const plus = type === "INCOME";
            const minus = type === "EXPENSE";
            return (
              <View key={tx.id} style={styles.txRow}>
                <View style={styles.txIcon}><Text>{plus ? "↙" : minus ? "↗" : "⇄"}</Text></View>
                <View style={styles.flex}>
                  <Text style={styles.txName} numberOfLines={1}>{tx.description || type}</Text>
                  <Text style={styles.cardSub}>{String(tx.created_at || "").slice(0, 10) || "—"}</Text>
                </View>
                <Text style={[styles.txAmount, plus ? styles.plus : minus ? styles.minus : null]}>
                  {plus ? "+" : minus ? "-" : ""}{money(tx.amount, tx.currency || currency)}
                </Text>
              </View>
            );
          })
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View>
            <Text style={styles.cardTitle}>{t("wallets")}</Text>
            <Text style={styles.cardSub}>{t("cashBank")}</Text>
          </View>
          <Pressable onPress={onOpenFinance}><Text style={styles.cardLink}>{t("openFinance")}</Text></Pressable>
        </View>
        {walletRows.length === 0 ? (
          <Text style={styles.empty}>{t("noWalletsYet")}</Text>
        ) : (
          walletRows.map((row) => {
            const bal = Math.max(0, num(row.current_balance));
            const share = walletTotal > 0 ? Math.round((bal / walletTotal) * 100) : 0;
            return (
              <View key={row.id} style={styles.budgetBlock}>
                <View style={styles.budgetTop}>
                  <Text style={styles.budgetName} numberOfLines={1}>{row.name}</Text>
                  <Text style={styles.budgetAmount}>{money(bal, row.currency || currency)} · {share}%</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${share}%` }]} />
                </View>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  pageHead: { gap: 4 },
  kicker: { color: "#0f8f6f", fontSize: 9, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  title: { color: "#17211e", fontSize: 22, fontWeight: "900", lineHeight: 28 },
  sub: { color: "#6c7b76", fontSize: 11, lineHeight: 17, marginTop: 2 },
  headActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  btn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dce7e3",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: { backgroundColor: "#0f8f6f", borderColor: "#0f8f6f" },
  btnText: { color: "#17211e", fontWeight: "800", fontSize: 12 },
  btnPrimaryText: { color: "#ffffff" },
  notice: {
    borderWidth: 1,
    borderColor: "#c7e8dd",
    backgroundColor: "#e0f4ed",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  noticeText: { color: "#0b6f58", fontSize: 10.5, lineHeight: 16, fontWeight: "700" },
  kpiRow: { gap: 10, paddingBottom: 4 },
  kpi: {
    width: 168,
    backgroundColor: "#ffffff",
    borderColor: "#dce7e3",
    borderWidth: 1,
    borderRadius: 19,
    padding: 14,
  },
  kpiTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kpiIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#e0f4ed",
    alignItems: "center",
    justifyContent: "center",
  },
  kpiChange: {
    fontSize: 10,
    fontWeight: "800",
    color: "#0b6f58",
    backgroundColor: "#e0f4ed",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
  },
  kpiDown: { color: "#dc2626", backgroundColor: "#fee9e9" },
  kpiValue: { color: "#17211e", fontSize: 18, fontWeight: "900", marginTop: 10 },
  kpiLabel: { color: "#6c7b76", fontSize: 10, marginTop: 4 },
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#dce7e3",
    borderWidth: 1,
    borderRadius: 20,
    padding: 15,
    gap: 10,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  cardTitle: { color: "#17211e", fontSize: 13, fontWeight: "900" },
  cardSub: { color: "#6c7b76", fontSize: 10, marginTop: 2 },
  cardLink: { color: "#0f8f6f", fontSize: 10.5, fontWeight: "800" },
  moduleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  moduleTile: {
    width: "47%",
    flexGrow: 1,
    minWidth: 140,
    borderWidth: 1,
    borderColor: "#dce7e3",
    backgroundColor: "#f8fbfa",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 2,
  },
  moduleIcon: { fontSize: 18 },
  moduleLabel: { color: "#17211e", fontSize: 12, fontWeight: "900", marginTop: 4 },
  moduleHint: { color: "#6c7b76", fontSize: 10, lineHeight: 14 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  quick: {
    width: "23%",
    minWidth: 70,
    flexGrow: 1,
    borderWidth: 1,
    borderColor: "#dce7e3",
    backgroundColor: "#f8fbfa",
    borderRadius: 15,
    paddingVertical: 11,
    alignItems: "center",
  },
  quickIcon: { fontSize: 18 },
  quickLabel: { fontSize: 9, fontWeight: "800", color: "#17211e", marginTop: 4 },
  budgetBlock: { gap: 6 },
  chartRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 4, minHeight: 96 },
  chartCol: { flex: 1, alignItems: "center", gap: 6 },
  chartBars: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 76 },
  chartBar: { width: 6, borderRadius: 4, minHeight: 4 },
  chartIncome: { backgroundColor: "#0f8f6f" },
  chartExpense: { backgroundColor: "#dc2626" },
  chartLabel: { color: "#6c7b76", fontSize: 8, fontWeight: "700" },
  budgetTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  budgetName: { color: "#17211e", fontSize: 11, fontWeight: "800", flex: 1 },
  budgetAmount: { color: "#6c7b76", fontSize: 10 },
  progressTrack: { height: 8, borderRadius: 99, backgroundColor: "#edf7f3", overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 99, backgroundColor: "#0f8f6f" },
  progressWarn: { backgroundColor: "#d97706" },
  progressDanger: { backgroundColor: "#dc2626" },
  syncRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  syncRing: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 6,
    borderColor: "#0f8f6f",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  syncPct: { fontSize: 11, fontWeight: "900", color: "#17211e" },
  syncTitle: { fontSize: 12, fontWeight: "900", color: "#17211e" },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  tag: { fontSize: 8, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 7, backgroundColor: "#edf7f3", color: "#6c7b76", fontWeight: "700", overflow: "hidden" },
  txRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 6 },
  txIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: "#edf7f3",
    alignItems: "center",
    justifyContent: "center",
  },
  txName: { color: "#17211e", fontSize: 11, fontWeight: "800" },
  txAmount: { fontSize: 11, fontWeight: "900", color: "#17211e" },
  plus: { color: "#0f8f6f" },
  minus: { color: "#dc2626" },
  empty: { color: "#6c7b76", fontSize: 12, textAlign: "center", paddingVertical: 16 },
  refreshBtn: { alignItems: "center", paddingTop: 4 },
});
