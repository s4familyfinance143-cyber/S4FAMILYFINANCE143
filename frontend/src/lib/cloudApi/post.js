import {
  normalizeMemberRole,
  resolveFamilyOwnerUid,
  relationshipFromMember,
  newId,
  stripQuery,
  queryParam,
  readList,
  writeList,
  readDoc,
  writeDoc,
  readBudgets,
  writeBudgets,
  appendAudit,
  normalizeAuditRow,
  buildAuditSummary,
  txType,
  activeWallets,
  activeTransactions,
  buildFinancialSummary,
  buildWalletSummary,
  buildAccountLedger,
  buildExtraReport,
  rateToBase,
  buildCurrencyFamilySummary,
  appendNotification,
  appendGroceryActivity,
  recomputeGroceryVendorSummary,
  memberMatchKey,
  cloudMemberToLocal,
  mergeLocalAndCloudMembers,
  mapFamilyMemberPermissions,
  loadPermissionMembers,
  findCurrentMember,
  lifeModuleKey,
  buildLifePhaseSummary,
  normalizeLifeWriteRow
} from "./_core.js";

export async function cloudApiPost({ familyId, path, body, currentUser, onAfterWrite }) {
  if (!familyId) return { handled: false };
  const clean = stripQuery(path);
  const parts = clean.replace(/^\//, "").split("/").filter(Boolean);
  const after = typeof onAfterWrite === "function" ? onAfterWrite : async () => {};

  // Planner
  if (parts[0] === "accounts" && !parts[1]) {
    const rows = await readList(familyId, "finance", "wallets");
    const row = {
      id: newId("wal"),
      family_id: familyId,
      name: String(body?.name || "").trim() || "Wallet",
      account_type: body?.account_type || "CASH",
      currency: body?.currency || "BDT",
      balance: Number(body?.opening_balance || 0),
      current_balance: Number(body?.opening_balance || 0),
      opening_balance: Number(body?.opening_balance || 0),
      is_shared_family: body?.is_shared_family !== false,
      is_owner_wallet: Boolean(body?.is_owner_wallet),
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "finance", "wallets", [row, ...rows]);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "budgets" && !parts[1]) {
    const existing = await readBudgets(familyId);
    const cats = await readList(familyId, "finance", "categories");
    const form = {
      category_id: body?.category_id,
      name: body?.name,
      budget_amount: body?.budget_amount,
      period_type: body?.period_type || "MONTHLY",
      note: body?.note || "",
    };
    const dupKey = budgetDuplicateKey(form);
    const dup = existing.find(
      (b) => String(b.status || "").toUpperCase() === "ACTIVE" && budgetDuplicateKey(b) === dupKey,
    );
    if (dup) {
      return {
        handled: true,
        data: { ok: false, detail: "Duplicate active budget for category/period" },
        error: "Duplicate active budget for category/period",
      };
    }
    const cat = cats.find((c) => String(c.id) === String(form.category_id));
    const row = buildLocalBudget({
      familyId,
      form,
      currency: body?.currency || "BDT",
      categoryName: cat?.name_en || cat?.name || "",
    });
    await writeBudgets(familyId, [row, ...existing]);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "budgets" && parts[1] && parts[2] === "close") {
    const existing = await readBudgets(familyId);
    const next = existing.map((b) =>
      String(b.id) === String(parts[1])
        ? { ...b, status: "CLOSED", updated_at: new Date().toISOString() }
        : b,
    );
    await writeBudgets(familyId, next);
    await after();
    return { handled: true, data: { ok: true, id: parts[1] } };
  }

  if (parts[0] === "savings" && !parts[1]) {
    const existing = normalizeSavingsList(await readList(familyId, "finance", "savings"));
    const row = buildLocalSavingsGoal({
      familyId,
      form: body || {},
      currency: body?.currency || "BDT",
    });
    const txs = await readList(familyId, "finance", "transactions");
    const next = recomputeSavingsFromLedger([row, ...existing], txs);
    await writeList(familyId, "finance", "savings", next);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "savings" && (parts[1] === "deposit" || parts[1] === "withdraw")) {
    const action = parts[1] === "withdraw" ? "WITHDRAW" : "DEPOSIT";
    const existingSav = normalizeSavingsList(await readList(familyId, "finance", "savings"));
    const existingTx = await readList(familyId, "finance", "transactions");
    const existingWallets = await readList(familyId, "finance", "wallets");
    const goalId = body?.savings_goal_id;
    const walletId = body?.from_account_id || body?.to_account_id || body?.wallet_account_id;
    const amount = Number(body?.amount || 0);
    const goal = existingSav.find((g) => String(g.id) === String(goalId));
    if (!goal) return { handled: true, data: { ok: false, detail: "goal not found" }, error: "goal not found" };
    const movement = buildSavingsMovementTx({
      familyId,
      goal,
      walletId,
      amount,
      currency: body?.currency || "BDT",
      action,
      description: body?.description || "",
    });
    const nextTx = sortTransactionsNewestFirst([movement, ...existingTx]);
    const nextWallets = recomputeWalletBalancesFromLedger(existingWallets, nextTx);
    const nextSav = recomputeSavingsFromLedger(existingSav, nextTx);
    await writeList(familyId, "finance", "transactions", nextTx);
    await writeList(familyId, "finance", "wallets", nextWallets);
    await writeList(familyId, "finance", "savings", nextSav);
    await after();
    return { handled: true, data: { ok: true, movement, goal: nextSav.find((g) => String(g.id) === String(goalId)) } };
  }

  if (parts[0] === "savings" && parts[1] && parts[2] === "close") {
    const existing = normalizeSavingsList(await readList(familyId, "finance", "savings"));
    const goal = existing.find((g) => String(g.id) === String(parts[1]));
    if (goal && Number(goal.current_amount || 0) > 0.0001) {
      return {
        handled: true,
        data: { ok: false, detail: "Withdraw remaining balance before closing" },
        error: "Withdraw remaining balance before closing",
      };
    }
    const next = existing.map((g) =>
      String(g.id) === String(parts[1])
        ? { ...g, status: "CLOSED", updated_at: new Date().toISOString() }
        : g,
    );
    await writeList(familyId, "finance", "savings", next);
    await after();
    return { handled: true, data: { ok: true, id: parts[1] } };
  }

  // Loans create / payment / close
  if (parts[0] === "loans" && !parts[1]) {
    const row = buildLocalLoan({
      familyId,
      form: {
        wallet_account_id: body?.wallet_account_id,
        loan_type: body?.loan_type,
        person_name: body?.person_name,
        principal_amount: body?.principal_amount,
        note: body?.note,
        interest_rate: body?.interest_rate,
        interest_type: body?.interest_type,
        installment_count: body?.installment_count,
        start_date: body?.start_date,
      },
      currency: body?.currency || "BDT",
    });
    const principal = Number(row.principal_amount) || 0;
    const wallets = await readList(familyId, "finance", "wallets");
    const wallet = wallets.find((w) => String(w.id) === String(row.wallet_account_id));
    if (!wallet || wallet.deleted_at || wallet.is_active === false) {
      return { handled: true, data: { ok: false, detail: "Wallet required" }, error: "Wallet required" };
    }
    if (String(row.loan_type).toUpperCase() === "GIVEN" && walletBalance(wallet) < principal) {
      return {
        handled: true,
        data: { ok: false, detail: "Insufficient wallet balance" },
        error: "Insufficient wallet balance",
      };
    }
    const txs = await readList(familyId, "finance", "transactions");
    const loans = await readList(familyId, "finance", "loans");
    const movement = buildLoanMovementTx({
      familyId,
      loan: row,
      walletId: row.wallet_account_id,
      amount: principal,
      currency: row.currency,
      kind: "DISBURSE",
      description: row.note,
    });
    const nextTx = sortTransactionsNewestFirst([movement, ...txs]);
    const nextWallets = recomputeWalletBalancesFromLedger(wallets, nextTx);
    const nextLoans = [row, ...loans];
    await writeList(familyId, "finance", "transactions", nextTx);
    await writeList(familyId, "finance", "wallets", nextWallets);
    await writeList(familyId, "finance", "loans", nextLoans);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "loans" && parts[1] === "payment") {
    const loanId = body?.loan_id;
    const amount = Number(body?.amount || 0);
    const walletId = body?.wallet_account_id;
    const loans = await readList(familyId, "finance", "loans");
    const loan = loans.find((l) => String(l.id) === String(loanId));
    if (!loan || String(loan.status || "").toUpperCase() !== "ACTIVE") {
      return { handled: true, data: { ok: false, detail: "Loan required" }, error: "Loan required" };
    }
    if (amount <= 0 || amount > Number(loan.remaining_amount || 0) + 0.0001) {
      return {
        handled: true,
        data: { ok: false, detail: "Valid payment amount required" },
        error: "Valid payment amount required",
      };
    }
    const wallets = await readList(familyId, "finance", "wallets");
    const wallet = wallets.find((w) => String(w.id) === String(walletId));
    if (!wallet || wallet.deleted_at || wallet.is_active === false) {
      return { handled: true, data: { ok: false, detail: "Wallet required" }, error: "Wallet required" };
    }
    if (String(loan.loan_type || "").toUpperCase() === "TAKEN" && walletBalance(wallet) < amount) {
      return {
        handled: true,
        data: { ok: false, detail: "Insufficient wallet balance" },
        error: "Insufficient wallet balance",
      };
    }
    const txs = await readList(familyId, "finance", "transactions");
    const updated = applyLoanPayment(loan, amount);
    const movement = buildLoanMovementTx({
      familyId,
      loan,
      walletId,
      amount,
      currency: body?.currency || loan.currency,
      kind: "REPAYMENT",
      description: body?.description || "",
    });
    const nextTx = sortTransactionsNewestFirst([movement, ...txs]);
    const nextWallets = recomputeWalletBalancesFromLedger(wallets, nextTx);
    const nextLoans = loans.map((l) => (String(l.id) === String(loanId) ? updated : l));
    await writeList(familyId, "finance", "transactions", nextTx);
    await writeList(familyId, "finance", "wallets", nextWallets);
    await writeList(familyId, "finance", "loans", nextLoans);
    await after();
    return { handled: true, data: updated };
  }

  if (parts[0] === "loans" && parts[1] && parts[2] === "close") {
    const loans = await readList(familyId, "finance", "loans");
    const loan = loans.find((l) => String(l.id) === String(parts[1]));
    if (loan && Number(loan.remaining_amount || 0) > 0.0001) {
      return {
        handled: true,
        data: { ok: false, detail: "Pay remaining balance before closing" },
        error: "Pay remaining balance before closing",
      };
    }
    const next = loans.map((l) =>
      String(l.id) === String(parts[1])
        ? { ...l, status: "CLOSED", updated_at: new Date().toISOString() }
        : l,
    );
    await writeList(familyId, "finance", "loans", next);
    await after();
    return { handled: true, data: { ok: true, id: parts[1] } };
  }

  // Goals create / contribute / withdraw / close
  if (parts[0] === "goals" && !parts[1]) {
    const row = enrichGoals([
      buildLocalGoal({
        familyId,
        form: {
          goal_name: body?.goal_name,
          goal_type: body?.goal_type,
          target_amount: body?.target_amount,
          target_date: body?.target_date,
          note: body?.note,
        },
        currency: body?.currency || "BDT",
      }),
    ])[0];
    const existing = await readList(familyId, "finance", "goals");
    const next = enrichGoals([row, ...existing]);
    await writeList(familyId, "finance", "goals", next);
    await writeDoc(familyId, "finance", "goalSummary", buildGoalSummary(next));
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "goals" && (parts[1] === "contribute" || parts[1] === "withdraw")) {
    const kind = parts[1] === "withdraw" ? "WITHDRAW" : "CONTRIBUTE";
    const goalId = body?.goal_id;
    const amount = Number(body?.amount || 0);
    const walletId = body?.wallet_account_id;
    const goals = await readList(familyId, "finance", "goals");
    const goal = goals.find((g) => String(g.id) === String(goalId));
    if (!goal || String(goal.status || "").toUpperCase() === "CLOSED") {
      return { handled: true, data: { ok: false, detail: "Goal required" }, error: "Goal required" };
    }
    if (amount <= 0) {
      return {
        handled: true,
        data: { ok: false, detail: "Valid amount required" },
        error: "Valid amount required",
      };
    }
    if (kind === "WITHDRAW" && amount > Number(goal.current_amount || 0) + 0.0001) {
      return {
        handled: true,
        data: { ok: false, detail: "Valid amount required" },
        error: "Valid amount required",
      };
    }
    const wallets = await readList(familyId, "finance", "wallets");
    const wallet = wallets.find((w) => String(w.id) === String(walletId));
    if (!wallet || wallet.deleted_at || wallet.is_active === false) {
      return { handled: true, data: { ok: false, detail: "Wallet required" }, error: "Wallet required" };
    }
    if (kind === "CONTRIBUTE" && walletBalance(wallet) < amount) {
      return {
        handled: true,
        data: { ok: false, detail: "Insufficient wallet balance" },
        error: "Insufficient wallet balance",
      };
    }
    const txs = await readList(familyId, "finance", "transactions");
    const movement = buildGoalMovementTx({
      familyId,
      goal,
      walletId,
      amount,
      currency: body?.currency || goal.currency,
      kind,
      description: body?.description || "",
    });
    const nextTx = sortTransactionsNewestFirst([movement, ...txs]);
    const nextWallets = recomputeWalletBalancesFromLedger(wallets, nextTx);
    const nextGoals = recomputeGoalsFromLedger(goals, nextTx);
    await writeList(familyId, "finance", "transactions", nextTx);
    await writeList(familyId, "finance", "wallets", nextWallets);
    await writeList(familyId, "finance", "goals", nextGoals);
    await writeDoc(familyId, "finance", "goalSummary", buildGoalSummary(nextGoals));
    await after();
    return { handled: true, data: nextGoals.find((g) => String(g.id) === String(goalId)) };
  }

  if (parts[0] === "goals" && parts[1] && parts[2] === "close") {
    const goals = await readList(familyId, "finance", "goals");
    const next = enrichGoals(
      goals.map((g) =>
        String(g.id) === String(parts[1])
          ? { ...g, status: "CLOSED", updated_at: new Date().toISOString() }
          : g,
      ),
    );
    await writeList(familyId, "finance", "goals", next);
    await writeDoc(familyId, "finance", "goalSummary", buildGoalSummary(next));
    await after();
    return { handled: true, data: { ok: true, id: parts[1] } };
  }

  // Recurring create / post / pause / resume / close
  if (parts[0] === "recurring" && !parts[1]) {
    const row = buildLocalRecurring({
      familyId,
      form: {
        account_id: body?.account_id,
        category_id: body?.category_id,
        title: body?.title,
        transaction_type: body?.transaction_type,
        amount: body?.amount,
        frequency: body?.frequency,
        start_date: body?.start_date,
        end_date: body?.end_date,
        description: body?.description,
      },
      currency: body?.currency || "BDT",
    });
    const existing = await readList(familyId, "finance", "recurring");
    await writeList(familyId, "finance", "recurring", [row, ...existing]);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "recurring" && parts[1] && parts[2] === "post") {
    const list = await readList(familyId, "finance", "recurring");
    const item = list.find((r) => String(r.id) === String(parts[1]));
    if (!item || String(item.status || "").toUpperCase() !== "ACTIVE") {
      return { handled: true, data: { ok: false, detail: "Recurring not active" }, error: "Recurring not active" };
    }
    const amount = Number(item.amount) || 0;
    const wallets = await readList(familyId, "finance", "wallets");
    const wallet = wallets.find((w) => String(w.id) === String(item.account_id));
    if (!wallet || wallet.deleted_at || wallet.is_active === false) {
      return { handled: true, data: { ok: false, detail: "Wallet required" }, error: "Wallet required" };
    }
    const isExpense = !String(item.transaction_type || "").toUpperCase().includes("INCOME");
    if (isExpense && walletBalance(wallet) < amount) {
      return {
        handled: true,
        data: { ok: false, detail: "Insufficient wallet balance" },
        error: "Insufficient wallet balance",
      };
    }
    const txs = await readList(familyId, "finance", "transactions");
    const movement = buildRecurringPostTx({ familyId, item, currency: item.currency });
    const nextTx = sortTransactionsNewestFirst([movement, ...txs]);
    const nextWallets = recomputeWalletBalancesFromLedger(wallets, nextTx);
    const nextRec = list.map((r) =>
      String(r.id) === String(parts[1]) ? advanceRecurringAfterPost(r) : r,
    );
    await writeList(familyId, "finance", "transactions", nextTx);
    await writeList(familyId, "finance", "wallets", nextWallets);
    await writeList(familyId, "finance", "recurring", nextRec);
    await after();
    return { handled: true, data: nextRec.find((r) => String(r.id) === String(parts[1])) };
  }

  if (parts[0] === "recurring" && parts[1] && ["pause", "resume", "close"].includes(parts[2])) {
    const statusMap = { pause: "PAUSED", resume: "ACTIVE", close: "CLOSED" };
    const list = await readList(familyId, "finance", "recurring");
    const next = list.map((r) =>
      String(r.id) === String(parts[1])
        ? { ...r, status: statusMap[parts[2]], updated_at: new Date().toISOString() }
        : r,
    );
    await writeList(familyId, "finance", "recurring", next);
    await after();
    return { handled: true, data: { ok: true, id: parts[1], status: statusMap[parts[2]] } };
  }

  // Transactions (income / expense / transfer / void)
  if (parts[0] === "transactions" && ["income", "expense", "transfer"].includes(parts[1])) {
    const kind = parts[1].toUpperCase();
    const amount = Number(body?.amount || 0);
    const now = new Date().toISOString();
    const row = {
      id: newId("tx"),
      family_id: familyId,
      account_id: body?.account_id || body?.from_account_id || null,
      from_account_id: body?.from_account_id || body?.account_id || null,
      to_account_id: body?.to_account_id || null,
      category_id: body?.category_id || null,
      type: kind,
      transaction_type: kind,
      amount,
      currency: body?.currency || "BDT",
      description: body?.description || "",
      transaction_date: now.slice(0, 10),
      created_at: now,
      updated_at: now,
      status: "POSTED",
      source: "cloud_local",
    };
    const txs = await readList(familyId, "finance", "transactions");
    await writeList(familyId, "finance", "transactions", [row, ...txs]);
    const wallets = await readList(familyId, "finance", "wallets");
    const nextWallets = wallets.map((w) => {
      let bal = Number(w.balance ?? w.current_balance ?? 0);
      if (kind === "INCOME" && w.id === row.account_id) bal += amount;
      if (kind === "EXPENSE" && w.id === row.account_id) bal -= amount;
      if (kind === "TRANSFER") {
        if (w.id === row.from_account_id) bal -= amount;
        if (w.id === row.to_account_id) bal += amount;
      }
      return { ...w, balance: bal, current_balance: bal, updated_at: now };
    });
    await writeList(familyId, "finance", "wallets", nextWallets);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "transactions" && parts[1] && parts[2] === "void") {
    const txId = parts[1];
    const txs = await readList(familyId, "finance", "transactions");
    const target = txs.find((t) => String(t.id) === String(txId));
    if (!target) return { handled: true, data: { ok: false, detail: "not found" } };
    const now = new Date().toISOString();
    const amount = Number(target.amount || 0);
    const kind = String(target.transaction_type || target.type || "").toUpperCase();
    const nextTx = txs.map((t) =>
      String(t.id) === String(txId)
        ? { ...t, status: "VOID", voided_at: now, updated_at: now, void_reason: body?.reason || "VOID" }
        : t,
    );
    await writeList(familyId, "finance", "transactions", nextTx);
    const wallets = await readList(familyId, "finance", "wallets");
    const fromId = target.from_account_id || target.account_id;
    const nextWallets = wallets.map((w) => {
      let bal = Number(w.balance ?? w.current_balance ?? 0);
      if (kind.includes("INCOME") && w.id === target.account_id) bal -= amount;
      else if (kind.includes("EXPENSE") && w.id === (target.account_id || fromId)) bal += amount;
      else if (kind.includes("TRANSFER")) {
        if (w.id === fromId) bal += amount;
        if (w.id === target.to_account_id) bal -= amount;
      }
      return { ...w, balance: bal, current_balance: bal, updated_at: now };
    });
    await writeList(familyId, "finance", "wallets", nextWallets);
    await after();
    return { handled: true, data: { ok: true, id: txId, status: "VOID" } };
  }

  if (parts[0] === "expenses" && parts[1] === "ocr" && parts[2] === "parse") {
    const text = String(body?.raw_text || "");
    const nums = [...text.matchAll(/(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1])).filter((n) => n > 0);
    const total = nums.length ? nums.reduce((a, b) => a + b, 0) : 0;
    return {
      handled: true,
      data: {
        suggested_total: total || null,
        line_count: text.split(/\n/).filter(Boolean).length,
        engine: "cloud_local_regex",
        raw_text: text,
        lines: text.split(/\n/).filter(Boolean).slice(0, 8).map((line) => ({ description: line.trim() })),
        source: "cloud_local",
      },
    };
  }

  // Planner
  if (parts[0] === "tasks" && !parts[1]) {
    const title = String(body?.title || "").trim();
    if (!title) {
      return { handled: true, data: { ok: false, detail: "Title required" }, error: "Title required" };
    }
    const rows = await readList(familyId, "planner", "tasks");
    const row = {
      id: newId("task"),
      family_id: familyId,
      title,
      description: String(body?.description || "").trim() || "",
      due_date: body?.due_date || null,
      priority: String(body?.priority || "MEDIUM").toUpperCase(),
      status: "OPEN",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "planner", "tasks", [row, ...rows]);
    await appendAudit(familyId, { action: "task.create", title: row.title });
    await after();
    return { handled: true, data: row };
  }

  // Complete task
  if (parts[0] === "tasks" && parts[1] && parts[2] === "complete") {
    const taskId = String(parts[1]);
    const rows = await readList(familyId, "planner", "tasks");
    const hit = rows.find((r) => String(r.id) === taskId);
    if (!hit) {
      return { handled: true, data: { ok: false, detail: "Task not found" }, error: "Task not found" };
    }
    const now = new Date().toISOString();
    const next = rows.map((r) =>
      String(r.id) === taskId
        ? { ...r, status: "DONE", completed_at: now, updated_at: now }
        : r,
    );
    await writeList(familyId, "planner", "tasks", next);
    await appendAudit(familyId, { action: "task.complete", title: hit.title || taskId });
    await after();
    return { handled: true, data: next.find((r) => String(r.id) === taskId) || { ok: true } };
  }

  if (parts[0] === "calendar" && !parts[1]) {
    const title = String(body?.title || "").trim();
    if (!title) {
      return { handled: true, data: { ok: false, detail: "Title required" }, error: "Title required" };
    }
    if (!body?.event_date) {
      return { handled: true, data: { ok: false, detail: "Event date required" }, error: "Event date required" };
    }
    const start = String(body?.start_time || "").trim();
    const end = String(body?.end_time || "").trim();
    if (start && end && end < start) {
      return {
        handled: true,
        data: { ok: false, detail: "End time must be after start time" },
        error: "End time must be after start time",
      };
    }
    const rows = await readList(familyId, "planner", "events");
    const row = {
      id: newId("evt"),
      family_id: familyId,
      title,
      description: String(body?.description || "").trim() || "",
      event_date: body.event_date,
      start_time: start || null,
      end_time: end || null,
      event_type: String(body?.event_type || "GENERAL").toUpperCase(),
      status: "SCHEDULED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "planner", "events", [row, ...rows]);
    await appendAudit(familyId, { action: "calendar.create", title: row.title });
    await after();
    return { handled: true, data: row };
  }

  // Grocery lists / vendors / items
  if (parts[0] === "grocery" && parts[1] === "lists" && !parts[2]) {
    const title = String(body?.title || "").trim() || "List";
    const rows = await readList(familyId, "grocery", "lists");
    const row = {
      id: newId("glist"),
      family_id: familyId,
      title,
      budget_amount: Number(body?.budget_amount || 0),
      currency: body?.currency || "BDT",
      vendor_name: body?.vendor_name || null,
      shopping_date: body?.shopping_date || null,
      note: body?.note || "",
      status: "OPEN",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "grocery", "lists", [row, ...rows]);
    await appendAudit(familyId, { action: "grocery.list.create", title: row.title });
    await appendGroceryActivity(familyId, {
      action_type: "CREATE",
      entity_type: "grocery_lists",
      title: row.title,
    });
    await appendNotification(familyId, { title: "Grocery list created", body: row.title, type: "GROCERY" });
    await after();
    return { handled: true, data: row };
  }
  if (parts[0] === "grocery" && parts[1] === "vendors" && !parts[2]) {
    const name = String(body?.name || body?.vendor_name || "").trim();
    if (!name) {
      return { handled: true, data: { ok: false, detail: "Vendor name required" }, error: "Vendor name required" };
    }
    const rows = await readList(familyId, "grocery", "vendors");
    const row = {
      id: newId("gven"),
      family_id: familyId,
      name,
      phone: body?.phone || "",
      address: body?.address || "",
      category: body?.category || "GENERAL",
      note: body?.note || "",
      is_active: body?.is_active !== false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "grocery", "vendors", [row, ...rows]);
    await appendGroceryActivity(familyId, {
      action_type: "CREATE",
      entity_type: "grocery_vendors",
      title: row.name,
    });
    await after();
    return { handled: true, data: row };
  }
  if (parts[0] === "grocery" && parts[1] === "items" && !parts[2]) {
    const name = String(body?.name || body?.item_name || "").trim();
    if (!name) {
      return { handled: true, data: { ok: false, detail: "Item name required" }, error: "Item name required" };
    }
    const listId = body?.list_id || body?.grocery_list_id;
    if (!listId) {
      return { handled: true, data: { ok: false, detail: "List required" }, error: "List required" };
    }
    const rows = await readList(familyId, "grocery", "items");
    const row = {
      id: newId("gitem"),
      family_id: familyId,
      list_id: listId,
      grocery_list_id: listId,
      name,
      category: body?.category || "GENERAL",
      quantity: Number(body?.quantity || 1) || 1,
      unit: body?.unit || "pcs",
      estimated_price: Number(body?.estimated_price || body?.price || 0) || 0,
      actual_price: Number(body?.actual_price || 0) || 0,
      vendor_name: body?.vendor_name || null,
      barcode: body?.barcode || null,
      note: body?.note || "",
      is_bought: false,
      bought: false,
      posted_transaction_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "grocery", "items", [row, ...rows]);
    await appendGroceryActivity(familyId, {
      action_type: "CREATE",
      entity_type: "grocery_items",
      title: row.name,
    });
    await after();
    return { handled: true, data: row };
  }

  // Post grocery item as expense → wallet debit + link tx id
  if (parts[0] === "grocery" && parts[1] === "items" && parts[2] && parts[3] === "post-expense") {
    const itemId = String(parts[2]);
    const items = await readList(familyId, "grocery", "items");
    const item = items.find((r) => String(r.id) === itemId);
    if (!item) {
      return { handled: true, data: { ok: false, detail: "Item not found" }, error: "Item not found" };
    }
    if (!item.is_bought) {
      return {
        handled: true,
        data: { ok: false, detail: "Mark item bought before posting expense" },
        error: "Mark item bought before posting expense",
      };
    }
    if (item.posted_transaction_id) {
      return {
        handled: true,
        data: {
          ok: true,
          transaction_id: item.posted_transaction_id,
          grocery_item: item,
          already_posted: true,
        },
      };
    }
    const accountId = String(body?.account_id || "").trim();
    const categoryId = String(body?.category_id || "").trim();
    const amount = Number(body?.amount ?? item.actual_price ?? item.estimated_price ?? 0);
    if (!accountId || !categoryId) {
      return {
        handled: true,
        data: { ok: false, detail: "Wallet and category required" },
        error: "Wallet and category required",
      };
    }
    if (!(amount > 0)) {
      return { handled: true, data: { ok: false, detail: "Amount required" }, error: "Amount required" };
    }
    const now = new Date().toISOString();
    const tx = {
      id: newId("tx"),
      family_id: familyId,
      account_id: accountId,
      from_account_id: accountId,
      category_id: categoryId,
      type: "EXPENSE",
      transaction_type: "EXPENSE",
      amount,
      currency: body?.currency || "BDT",
      description: body?.description || `Grocery expense: ${item.name}`,
      transaction_date: now.slice(0, 10),
      created_at: now,
      updated_at: now,
      status: "POSTED",
      grocery_item_id: itemId,
      source: "grocery_post_expense",
    };
    const txs = await readList(familyId, "finance", "transactions");
    await writeList(familyId, "finance", "transactions", [tx, ...txs]);
    const wallets = await readList(familyId, "finance", "wallets");
    const nextWallets = wallets.map((w) => {
      if (String(w.id) !== accountId) return w;
      const bal = Number(w.balance ?? w.current_balance ?? 0) - amount;
      return { ...w, balance: bal, current_balance: bal, updated_at: now };
    });
    await writeList(familyId, "finance", "wallets", nextWallets);
    const nextItems = items.map((r) =>
      String(r.id) === itemId
        ? { ...r, posted_transaction_id: tx.id, updated_at: now }
        : r,
    );
    await writeList(familyId, "grocery", "items", nextItems);
    await appendGroceryActivity(familyId, {
      action_type: "POST_EXPENSE",
      entity_type: "grocery_items",
      title: item.name,
    });
    await after();
    const wallet = nextWallets.find((w) => String(w.id) === accountId);
    return {
      handled: true,
      data: {
        ok: true,
        transaction_id: tx.id,
        grocery_item: nextItems.find((r) => String(r.id) === itemId),
        wallet_balance: wallet?.balance ?? wallet?.current_balance ?? null,
      },
    };
  }

  if (parts[0] === "grocery" && parts[1] === "ocr" && parts[2] === "parse") {
    const text = String(body?.raw_text || "");
    const lines = text
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const suggestions = lines.slice(0, 40).map((line, idx) => {
      const priceMatch = line.match(/(\d+(?:\.\d{1,2})?)\s*$/);
      const amount = priceMatch ? Number(priceMatch[1]) : 0;
      const name = priceMatch ? line.slice(0, priceMatch.index).trim() : line;
      return {
        id: `ocr_${idx}`,
        name: name || `Item ${idx + 1}`,
        estimated_price: amount || 0,
        quantity: 1,
        unit: "pcs",
        category: "GENERAL",
        raw_line: line,
      };
    });
    return {
      handled: true,
      data: {
        suggestions,
        suggestion_count: suggestions.length,
        engine: "cloud_local_regex",
        raw_text: text,
        source: "cloud_local",
      },
    };
  }

  // Life module create: /investments, /health-expenses, ...
  const lifeKey = lifeModuleKey(parts[0]);
  if (lifeKey && !parts[1]) {
    const phase = ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"].includes(lifeKey) ? "phase15" : "phase16";
    const bag = await readDoc(familyId, "life", phase, { items: [], summary: null });
    const items = Array.isArray(bag.items) ? bag.items : [];
    const row = {
      ...normalizeLifeWriteRow(lifeKey, body),
      family_id: familyId,
      created_at: new Date().toISOString(),
      status: "ACTIVE",
      source: "cloud_local",
    };
    const nextItems = [row, ...items];
    await writeDoc(familyId, "life", phase, {
      items: nextItems,
      summary: buildLifePhaseSummary(nextItems),
    });
    await appendAudit(familyId, { action: `life.${lifeKey}.create`, title: row.name });
    await after();
    return { handled: true, data: row };
  }

  // Life module close via POST (matches backend)
  if (lifeKey && parts[1] && parts[2] === "close") {
    const phase = ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"].includes(lifeKey) ? "phase15" : "phase16";
    const bag = await readDoc(familyId, "life", phase, { items: [] });
    const items = Array.isArray(bag.items) ? bag.items : [];
    const itemId = String(parts[1]);
    const nextItems = items.map((r) =>
      String(r.id) === itemId
        ? {
            ...r,
            status: "CLOSED",
            updated_at: new Date().toISOString(),
            close_reason: body?.reason || null,
          }
        : r,
    );
    await writeDoc(familyId, "life", phase, {
      items: nextItems,
      summary: buildLifePhaseSummary(nextItems),
    });
    await after();
    return { handled: true, data: nextItems.find((r) => String(r.id) === itemId) || { ok: true } };
  }

  if (parts[0] === "zakat" && (parts[1] === "calculate" || !parts[1])) {
    const rows = await readList(familyId, "zakat", "main");
    const rates = await readDoc(familyId, "zakat", "metalRates", {
      GOLD: 12000,
      SILVER: 150,
    });
    const goldRate = Number(rates.GOLD || 0);
    const silverRate = Number(rates.SILVER || 0);
    const goldGrams = Number(body.gold_grams || 0);
    const silverGrams = Number(body.silver_grams || 0);
    const cash = Number(body.cash_amount || 0);
    let gold = Number(body.gold_value || 0);
    let silver = Number(body.silver_value || 0);
    if (goldGrams > 0 && goldRate > 0) gold = goldGrams * goldRate;
    if (silverGrams > 0 && silverRate > 0) silver = silverGrams * silverRate;
    const invest = Number(body.investment_value || 0);
    const business = Number(body.business_assets || 0);
    const recv = Number(body.receivables || 0);
    const debts = Number(body.deductible_debts || 0);
    const zakatable = Math.max(0, cash + gold + silver + invest + business + recv - debts);

    const metal = String(body.nisab_metal || "SILVER").toUpperCase();
    const grams = metal === "GOLD" ? 87.48 : 612.36;
    const metalRate = metal === "GOLD" ? goldRate : silverRate;
    let nisab = Number(body.nisab_amount);
    if (!(nisab > 0) && metalRate > 0) {
      nisab = Math.round(metalRate * grams * 100) / 100;
    }
    if (!(nisab > 0)) nisab = 0;

    const isDue = zakatable >= nisab && nisab > 0;
    const due = isDue ? Number((zakatable * 0.025).toFixed(2)) : 0;
    const year = Number(body.calculation_year || new Date().getFullYear());
    const now = new Date().toISOString();
    const row = {
      id: newId("zakat"),
      family_id: familyId,
      calculation_year: year,
      cash_amount: cash,
      gold_value: gold,
      silver_value: silver,
      gold_grams: goldGrams || null,
      silver_grams: silverGrams || null,
      investment_value: invest,
      business_assets: business,
      receivables: recv,
      deductible_debts: debts,
      nisab_amount: nisab,
      nisab_metal: metal,
      note: body.note || "",
      currency: body.currency || "BDT",
      zakatable_amount: zakatable,
      zakat_due: due,
      is_zakat_due: isDue,
      created_at: now,
      updated_at: now,
      source: "cloud_local",
    };
    // Upsert by calculation year
    const withoutYear = rows.filter((r) => Number(r.calculation_year) !== year);
    const next = [row, ...withoutYear];
    await writeList(familyId, "zakat", "main", next);
    await appendAudit(familyId, { action: "zakat.create", title: String(year) });
    await appendNotification(familyId, {
      title: "Zakat calculated",
      body: isDue ? `Due: ${due}` : "Below nisab — not due",
      type: "ZAKAT",
    });
    await after();
    return { handled: true, data: row };
  }

  // Invites (cloud-local codes + Firestore global registry for multi-account join)
  if (parts[0] === "invites" && (parts[1] === "generate" || parts[1] === "email" || parts[1] === "link")) {
    const invites = await readList(familyId, "family", "invites");
    const code = `S4-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const inviteId = newId("inv");
    const row = {
      id: inviteId,
      invite_id: inviteId,
      family_id: familyId,
      code,
      invite_code: code,
      invite_link: `s4familyfinance://join?code=${code}`,
      invitee_email: body.invitee_email || null,
      expires_in_days: Number(body.expires_in_days || 7),
      max_uses: Number(body.max_uses || 1),
      uses: 0,
      status: "ACTIVE",
      email_sent: false,
      email_reason: body.send_email
        ? "Cloud mode does not send SMTP email — share the invite code manually"
        : "code_only",
      email_requested: Boolean(body.send_email && body.invitee_email),
      created_at: new Date().toISOString(),
      created_by: currentUser?.email || "owner",
      source: "cloud_local",
    };
    await writeList(familyId, "family", "invites", [row, ...invites]);
    await appendAudit(familyId, { action: "invite.create", title: code });
    await appendNotification(familyId, {
      title: "Invite created",
      body: code,
      type: "FAMILY",
    });
    // Publish to Firestore so another account can join
    try {
      const { publishFamilyInvite } = await import("../../firebase/familyCloud");
      const uid = currentUser?.firebase_uid || currentUser?.uid || body.owner_uid;
      if (!uid) {
        row.cloud_published = false;
        row.cloud_publish_error = "missing_firebase_uid";
      } else {
        await publishFamilyInvite({
          code,
          familyId,
          ownerUid: uid,
          inviteeEmail: body.invitee_email || null,
          expiresInDays: Number(body.expires_in_days || 7),
          maxUses: Number(body.max_uses || 1),
          email: currentUser?.email || null,
          displayName: currentUser?.full_name || currentUser?.displayName || null,
        });
        row.cloud_published = true;
      }
    } catch (err) {
      row.cloud_published = false;
      row.cloud_publish_error = err?.code || err?.message || "publish_failed";
    }
    // Persist publish flags on the invite row
    await writeList(familyId, "family", "invites", [row, ...invites]);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "invites" && parts[1] === "join") {
    const code = String(body.invite_code || body.code || "").trim().toUpperCase();
    // Prefer cross-account Firestore join when firebase uid present
    const uid = currentUser?.firebase_uid || currentUser?.uid || body.uid;
    if (uid) {
      try {
        const { joinFamilyByInviteCode } = await import("../../firebase/familyCloud");
        const result = await joinFamilyByInviteCode({
          code,
          uid,
          email: body.email || currentUser?.email || "",
          displayName: body.full_name || currentUser?.full_name || "Member",
          relationshipType: body.relationship_type || "Relative",
        });
        await after();
        return {
          handled: true,
          data: {
            ...result,
            family_id: result.familyId,
            switched: true,
            source: "firestore_invite",
          },
        };
      } catch (err) {
        const msg = String(err?.message || "");
        // Only fall through to local invite list for "not in registry" style failures
        if (/Invalid|expired|used|not found/i.test(msg) && familyId) {
          /* try local below */
        } else {
          throw err;
        }
      }
    }

    const invites = await readList(familyId, "family", "invites");
    const hit = invites.find((i) => String(i.code || i.invite_code || "").toUpperCase() === code);
    if (!hit || hit.status !== "ACTIVE") {
      throw new Error("Invalid or expired invite code");
    }
    const members = await readList(familyId, "family", "members");
    const member = {
      id: newId("mem"),
      member_id: newId("mem"),
      family_id: familyId,
      full_name: body.full_name || currentUser?.full_name || "Member",
      email: body.email || currentUser?.email || "",
      role: "MEMBER",
      relationship_type: body.relationship_type || "Relative",
      status: "ACTIVE",
      joined_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "family", "members", [...members, member]);
    hit.uses = Number(hit.uses || 0) + 1;
    if (hit.uses >= Number(hit.max_uses || 1)) hit.status = "USED";
    await writeList(
      familyId,
      "family",
      "invites",
      invites.map((i) => (i.id === hit.id ? hit : i)),
    );
    await after();
    return { handled: true, data: { member, invite: hit } };
  }

  if (parts[0] === "invites" && parts[2] === "revoke") {
    const invites = await readList(familyId, "family", "invites");
    const key = String(parts[1] || "").trim();
    const target = invites.find(
      (i) =>
        String(i.id) === key ||
        String(i.invite_id || "") === key ||
        String(i.code || i.invite_code || "").toUpperCase() === key.toUpperCase(),
    );
    if (!target) {
      return { handled: true, data: { ok: false, detail: "Invite not found" }, error: "Invite not found" };
    }
    const next = invites.map((i) =>
      String(i.id) === String(target.id) ? { ...i, status: "REVOKED", updated_at: new Date().toISOString() } : i,
    );
    await writeList(familyId, "family", "invites", next);
    if (target?.code || target?.invite_code) {
      try {
        const { revokeFamilyInvite } = await import("../../firebase/familyCloud");
        await revokeFamilyInvite(target.code || target.invite_code);
      } catch {
        /* ignore offline / already revoked */
      }
    }
    await after();
    return { handled: true, data: { ok: true, invite_id: target.id } };
  }

  // Join-request approve / reject (Owner governance)
  if (parts[0] === "join-requests" && parts[1] && parts[2] === "decision") {
    const requestId = String(parts[1] || "").trim();
    const decision = String(body?.decision || body?.action || "")
      .trim()
      .toUpperCase();
    if (!requestId) {
      return { handled: true, data: { ok: false, detail: "request id required" }, error: "request id required" };
    }
    if (!["APPROVE", "REJECT", "APPROVED", "REJECTED"].includes(decision)) {
      return {
        handled: true,
        data: { ok: false, detail: "decision must be APPROVE or REJECT" },
        error: "decision must be APPROVE or REJECT",
      };
    }
    const approved = decision === "APPROVE" || decision === "APPROVED";
    const requests = await readList(familyId, "family", "joinRequests");
    const hit = requests.find((r) => String(r.id) === requestId);
    if (!hit) {
      return { handled: true, data: { ok: false, detail: "Join request not found" }, error: "Join request not found" };
    }
    const now = new Date().toISOString();
    const nextStatus = approved ? "APPROVED" : "REJECTED";
    const nextRequests = requests.map((r) =>
      String(r.id) === requestId
        ? {
            ...r,
            status: nextStatus,
            decision: nextStatus,
            decided_at: now,
            updated_at: now,
            note: body?.note || body?.reason || r.note || null,
          }
        : r,
    );
    await writeList(familyId, "family", "joinRequests", nextRequests);

    if (approved) {
      const members = await readList(familyId, "family", "members");
      const memberKey = String(
        hit.uid || hit.user_id || hit.member_id || hit.email || hit.id || "",
      ).trim();
      const already = members.some((m) => {
        const ids = [m.member_id, m.id, m.uid, m.user_id, m.email]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase());
        return memberKey && ids.includes(memberKey.toLowerCase());
      });
      if (!already && memberKey) {
        const mid = String(hit.uid || hit.user_id || hit.member_id || newId("mem"));
        const member = {
          id: mid,
          member_id: mid,
          user_id: mid,
          uid: hit.uid || mid,
          full_name: hit.full_name || hit.display_name || hit.email || "Member",
          email: hit.email || "",
          role: "MEMBER",
          normalized_role: "MEMBER",
          relationship: hit.relationship_type || hit.relationship || "",
          relationship_type: hit.relationship_type || hit.relationship || "",
          status: "ACTIVE",
          overrides: [],
          joined_at: now,
          source: "join_request_approve",
        };
        await writeList(familyId, "family", "members", [member, ...members]);
      }
    }

    await appendAudit(familyId, {
      action: approved ? "JOIN_APPROVE" : "JOIN_REJECT",
      request_id: requestId,
    });
    await after();
    return {
      handled: true,
      data: { ok: true, id: requestId, status: nextStatus, decision: nextStatus },
    };
  }

  // Soft-archive family (Owner)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "deactivate") {
    const pendingTransfers = (await readList(familyId, "family", "ownershipTransfers")).filter((r) =>
      ["PENDING", "PENDING_ADMIN", "PENDING_ACCEPT"].includes(String(r.status || "").toUpperCase()),
    );
    if (pendingTransfers.length) {
      return {
        handled: true,
        data: { ok: false, detail: "Cancel pending ownership transfer first" },
        error: "Cancel pending ownership transfer first",
      };
    }
    const profile = await readDoc(familyId, "system", "familyProfile", { id: familyId });
    const now = new Date().toISOString();
    await writeDoc(familyId, "system", "familyProfile", {
      ...profile,
      id: familyId,
      status: "ARCHIVED",
      is_active: false,
      deactivated_at: now,
      updated_at: now,
      source: "cloud_local",
    });
    await appendAudit(familyId, { action: "FAMILY_DEACTIVATE" });
    await after();
    return { handled: true, data: { ok: true, status: "ARCHIVED", family_id: familyId } };
  }

  // Tags
  if (parts[0] === "tags" && !parts[1]) {
    const cleaned = String(body?.name || body?.name_en || "").trim();
    if (!cleaned) {
      return { handled: true, data: { ok: false, detail: "Tag name required" }, error: "Tag name required" };
    }
    const rows = await readList(familyId, "finance", "tags");
    if (rows.some((r) => String(r.name || "").trim().toLowerCase() === cleaned.toLowerCase())) {
      return { handled: true, data: { ok: false, detail: "Tag already exists" }, error: "Tag already exists" };
    }
    const row = {
      id: newId("tag"),
      family_id: familyId,
      name: cleaned,
      name_en: cleaned,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "finance", "tags", [row, ...rows]);
    await after();
    return { handled: true, data: row };
  }
  if (parts[0] === "transaction-tags" && !parts[1]) {
    const txId = body?.transaction_id;
    const tagId = body?.tag_id;
    if (!txId || !tagId) {
      return {
        handled: true,
        data: { ok: false, detail: "Transaction and tag required" },
        error: "Transaction and tag required",
      };
    }
    const rows = await readList(familyId, "finance", "transactionTags");
    if (
      rows.some(
        (r) => String(r.transaction_id) === String(txId) && String(r.tag_id) === String(tagId),
      )
    ) {
      return {
        handled: true,
        data: { ok: false, detail: "Tag already attached" },
        error: "Tag already attached",
      };
    }
    const tags = await readList(familyId, "finance", "tags");
    if (!tags.some((t) => String(t.id) === String(tagId))) {
      return { handled: true, data: { ok: false, detail: "Tag required" }, error: "Tag required" };
    }
    const row = {
      id: newId("ttag"),
      family_id: familyId,
      transaction_id: txId,
      tag_id: tagId,
      created_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "finance", "transactionTags", [row, ...rows]);
    await after();
    return { handled: true, data: row };
  }

  // Currency rates / base
  if (parts[0] === "currency" && (parts[1] === "rates" || parts[1] === "rate")) {
    const bag = await readDoc(familyId, "system", "currency", {
      currencies: [],
      exchangeRates: [],
      code: "BDT",
    });
    const rates = Array.isArray(bag.exchangeRates) ? bag.exchangeRates : [];
    const row = {
      from_currency: body.from_currency || body.from || "USD",
      to_currency: body.to_currency || body.to || "BDT",
      rate: Number(body.rate || 0),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    const next = [
      row,
      ...rates.filter(
        (r) =>
          !(
            r.from_currency === row.from_currency && r.to_currency === row.to_currency
          ),
      ),
    ];
    await writeDoc(familyId, "system", "currency", { ...bag, exchangeRates: next });
    await after();
    return { handled: true, data: row };
  }
  if (parts[0] === "currency" && !parts[1]) {
    const bag = await readDoc(familyId, "system", "currency", {
      currencies: [],
      exchangeRates: [],
      code: "BDT",
    });
    const currencies = Array.isArray(bag.currencies) ? bag.currencies : [];
    const row = {
      code: body.code || "BDT",
      name: body.name || body.code || "Currency",
      symbol: body.symbol || body.code || "",
      is_base: Boolean(body.is_base),
      source: "cloud_local",
    };
    const next = [row, ...currencies.filter((c) => c.code !== row.code)];
    await writeDoc(familyId, "system", "currency", {
      ...bag,
      currencies: next,
      code: row.is_base ? row.code : bag.code || row.code,
      symbol: row.is_base ? row.symbol : bag.symbol || row.symbol,
    });
    await after();
    return { handled: true, data: row };
  }

  // Metal rates
  if (parts[0] === "zakat" && parts[1] === "metal-rates") {
    const prev = await readDoc(familyId, "zakat", "metalRates", {});
    const next = {
      ...prev,
      [String(body.metal || "GOLD").toUpperCase()]: Number(body.rate_bdt || body.rate || 0),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeDoc(familyId, "zakat", "metalRates", next);
    await after();
    return { handled: true, data: next };
  }

  // Split expense → linked share rows; wallet debit = sum of shares via ledger
  if (parts[0] === "expenses" && parts[1] === "split") {
    const amount = Number(body.amount || 0);
    const splits = Array.isArray(body.splits) ? body.splits : [];
    if (!body?.account_id) {
      return { handled: true, data: { ok: false, detail: "Wallet required" }, error: "Wallet required" };
    }
    if (!amount || amount <= 0) {
      return {
        handled: true,
        data: { ok: false, detail: "Valid amount required" },
        error: "Valid amount required",
      };
    }
    if (splits.length < 2) {
      return {
        handled: true,
        data: { ok: false, detail: "Select both members for split expense" },
        error: "Select both members for split expense",
      };
    }
    const memberIds = splits.map((s) => String(s.member_id || ""));
    if (memberIds[0] && memberIds[1] && memberIds[0] === memberIds[1]) {
      return {
        handled: true,
        data: { ok: false, detail: "Split members must be different" },
        error: "Split members must be different",
      };
    }
    const { loadOfflineSnapshot, saveOfflineSnapshot } = await import("../offlineCache");
    const { recomputeWalletBalancesFromLedger, walletBalance } = await import("../cloudLocalFinance");
    const cached = await loadOfflineSnapshot(familyId, "finance", "transactions").catch(() => null);
    const txs = Array.isArray(cached?.data) ? cached.data : [];
    const walCached = await loadOfflineSnapshot(familyId, "finance", "wallets").catch(() => null);
    const wallets = Array.isArray(walCached?.data) ? walCached.data : [];
    const wallet = wallets.find((w) => String(w.id) === String(body.account_id));
    if (!wallet || wallet.deleted_at || wallet.is_active === false) {
      return { handled: true, data: { ok: false, detail: "Wallet required" }, error: "Wallet required" };
    }
    if (walletBalance(wallet) < amount) {
      return {
        handled: true,
        data: { ok: false, detail: "Insufficient wallet balance" },
        error: "Insufficient wallet balance",
      };
    }
    const now = new Date().toISOString();
    const baseId = newId("tx");
    const created = splits.map((s, idx) => ({
      id: `${baseId}_${idx}`,
      family_id: familyId,
      account_id: body.account_id,
      from_account_id: body.account_id,
      category_id: body.category_id || null,
      type: "EXPENSE",
      transaction_type: "EXPENSE",
      amount: Number(s.share_amount || 0),
      currency: body.currency || "BDT",
      description: `${body.description || "Split"} (${s.member_id || idx})`,
      member_id: s.member_id || null,
      split_group_id: baseId,
      status: "POSTED",
      is_split: true,
      transaction_date: now.slice(0, 10),
      created_at: now,
      updated_at: now,
      source: "cloud_local",
    }));
    const nextTx = [...created, ...txs];
    await saveOfflineSnapshot(familyId, "finance", "transactions", nextTx);
    const nextWallets = recomputeWalletBalancesFromLedger(wallets, nextTx);
    await saveOfflineSnapshot(familyId, "finance", "wallets", nextWallets);
    await appendAudit(familyId, { action: "expense.split", title: body.description || baseId });
    await after();
    return { handled: true, data: { id: baseId, amount, splits: created, source: "cloud_local" } };
  }

  // Notification test endpoints — in-app + browser Notification API
  if (parts[0] === "notifications" && parts[1] === "test-email") {
    await appendNotification(familyId, {
      title: "Test notification",
      body: "Saved in-app. Email SMTP is optional; invite codes work without SMTP.",
      type: "TEST",
      notification_type: "TEST",
      severity: "LOW",
    });
    await after();
    return { handled: true, data: { sent: true, channel: "in_app", reason: "cloud_in_app" } };
  }
  if (parts[0] === "notifications" && parts[1] === "test-push") {
    const title = "S4 Family Finance 143";
    const bodyText = "Push test — browser/local notification";
    await appendNotification(familyId, {
      title,
      body: bodyText,
      type: "TEST",
      notification_type: "TEST",
      severity: "MEDIUM",
    });
    let pushShown = false;
    let pushReason = "browser_unavailable";
    try {
      if (typeof Notification !== "undefined") {
        if (Notification.permission === "granted") {
          new Notification(title, { body: bodyText, icon: "/icon-192.png" });
          pushShown = true;
          pushReason = "browser_notification";
        } else if (Notification.permission !== "denied") {
          const perm = await Notification.requestPermission();
          if (perm === "granted") {
            new Notification(title, { body: bodyText, icon: "/icon-192.png" });
            pushShown = true;
            pushReason = "browser_notification";
          } else {
            pushReason = "permission_not_granted";
          }
        } else {
          pushReason = "permission_denied";
        }
      }
    } catch (err) {
      console.error("[S4 Notify] test-push failed", err);
      pushReason = err?.message || "notification_error";
    }
    await after();
    return {
      handled: true,
      data: {
        sent: true,
        sent_count: pushShown ? 1 : 0,
        channel: pushShown ? "browser_notification" : "in_app_only",
        reason: pushReason,
      },
    };
  }

  if (parts[0] === "notifications" && parts[1] === "devices" && parts[2] === familyId) {
    const devices = await readList(familyId, "system", "pushDevices", []);
    const token = String(body?.token || "").trim();
    if (token.length < 8) {
      return { handled: true, data: { ok: false, reason: "token_too_short" } };
    }
    const existing = devices.find((d) => d.token === token);
    const row = {
      id: existing?.id || newId("dev"),
      token,
      platform: body?.platform || "WEB",
      provider: body?.provider || "FCM",
      device_label: body?.device_label || "web-browser",
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_active: true,
    };
    const next = existing
      ? devices.map((d) => (d.token === token ? row : d))
      : [row, ...devices].slice(0, 20);
    await writeList(familyId, "system", "pushDevices", next);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "notifications" && parts[1] === "scan" && parts[2] === familyId) {
    const created = await appendNotification(familyId, {
      title: "Activity check",
      body: "Cloud scan complete — review family alerts in the inbox.",
      type: "SCAN",
      notification_type: "SCAN",
      severity: "LOW",
    });
    await after();
    return {
      handled: true,
      data: { created_notifications: 1, unread_notifications: created.filter((r) => !r.read).length },
    };
  }

  // Ownership transfer — Owner creates PENDING_ACCEPT (2-person families have no third Admin)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "ownership-transfer") {
    const rows = await readList(familyId, "family", "ownershipTransfers");
    const actorUid = String(
      currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "",
    ).trim();
    if (!parts[3]) {
      const toId = String(body?.to_member_id || body?.member_id || "").trim();
      if (!toId) {
        return {
          handled: true,
          data: { ok: false, detail: "to_member_id required" },
          error: "to_member_id required",
        };
      }
      const pending = rows.filter((r) =>
        ["PENDING", "PENDING_ADMIN", "PENDING_ACCEPT"].includes(String(r.status || "").toUpperCase()),
      );
      if (pending.length) {
        return {
          handled: true,
          data: { ok: false, detail: "A transfer is already pending" },
          error: "A transfer is already pending",
        };
      }
      const row = {
        id: newId("otr"),
        family_id: familyId,
        from_member_id: String(body?.from_member_id || actorUid || "").trim(),
        to_member_id: toId,
        note: body?.note || null,
        status: "PENDING_ACCEPT",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: actorUid || currentUser?.email || "",
        source: "cloud_local",
      };
      await writeList(familyId, "family", "ownershipTransfers", [row, ...rows]);
      await after();
      return { handled: true, data: row };
    }
    const requestId = parts[3];
    const action = parts[4]; // accept | admin-approve | cancel
    const nextStatus =
      action === "accept"
        ? "ACCEPTED"
        : action === "admin-approve"
          ? "PENDING_ACCEPT"
          : action === "cancel"
            ? "CANCELLED"
            : null;
    if (nextStatus) {
      const target = rows.find((r) => String(r.id) === String(requestId));
      if (!target) {
        return {
          handled: true,
          data: { ok: false, detail: "Transfer not found" },
          error: "Transfer not found",
        };
      }
      const next = rows.map((r) =>
        String(r.id) === String(requestId)
          ? { ...r, status: nextStatus, updated_at: new Date().toISOString() }
          : r,
      );
      await writeList(familyId, "family", "ownershipTransfers", next);

      if (action === "accept" && target?.to_member_id) {
        const toId = String(target.to_member_id);
        const fromId = String(target.from_member_id || "").trim();
        const members = await readList(familyId, "family", "members");
        const matches = (raw, id) =>
          [raw.member_id, raw.id, raw.uid, raw.user_id].filter(Boolean).map(String).includes(String(id));
        const nextMembers = members.map((raw) => {
          const role = String(raw.role || raw.normalized_role || "").toUpperCase();
          if (matches(raw, toId)) {
            return {
              ...raw,
              role: "OWNER",
              normalized_role: "OWNER",
              member_role: "OWNER",
              updated_at: new Date().toISOString(),
            };
          }
          if (role === "OWNER" || (fromId && matches(raw, fromId))) {
            return {
              ...raw,
              role: "ADMIN",
              normalized_role: "ADMIN",
              member_role: "ADMIN",
              updated_at: new Date().toISOString(),
            };
          }
          return raw;
        });
        await writeList(familyId, "family", "members", nextMembers);

        const profile = await readDoc(familyId, "system", "familyProfile", { id: familyId });
        await writeDoc(familyId, "system", "familyProfile", {
          ...profile,
          id: familyId,
          owner_uid: toId,
          owner_id: toId,
          updated_at: new Date().toISOString(),
        });

        let ownershipCloudWarning = null;
        try {
          const { acceptOwnershipTransferCloud } = await import("../../firebase/familyCloud");
          await acceptOwnershipTransferCloud({
            familyId,
            toUid: toId,
            fromUid: fromId || actorUid,
          });
        } catch (err) {
          ownershipCloudWarning = `Ownership updated locally — cloud sync failed: ${String(err?.message || err)}`;
        }
        await appendAudit(familyId, {
          action: "OWNERSHIP_TRANSFER_ACCEPT",
          to_member_id: toId,
          from_member_id: fromId,
        });
        await after();
        return {
          handled: true,
          data: {
            ...(next.find((r) => String(r.id) === String(requestId)) || { ok: true }),
            cloud_synced: !ownershipCloudWarning,
            cloud_sync_warning: ownershipCloudWarning,
          },
        };
      }

      await after();
      return { handled: true, data: next.find((r) => String(r.id) === String(requestId)) || { ok: true } };
    }
  }

  return { handled: false };
}

