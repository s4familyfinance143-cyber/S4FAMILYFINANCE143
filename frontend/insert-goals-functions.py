from pathlib import Path

p = Path("src/App.jsx")
text = p.read_text(encoding="utf-8")

needle = "  async function createRecurring() {"

insert = r'''
  async function createGoal() {
    if (!goalForm.goal_name.trim()) {
      setMessage("Goal name required", "error");
      return;
    }

    if (!goalForm.target_amount || Number(goalForm.target_amount) <= 0) {
      setMessage("Valid target amount required", "error");
      return;
    }

    try {
      await apiPost(`/goals`, {
        family_id: FAMILY_ID,
        linked_savings_goal_id: null,
        goal_name: goalForm.goal_name.trim(),
        goal_type: goalForm.goal_type,
        target_amount: goalForm.target_amount,
        currency: goalForm.currency,
        target_date: goalForm.target_date || null,
        note: goalForm.note,
      });

      setGoalForm({
        goal_name: "",
        goal_type: "GENERAL",
        target_amount: "",
        currency: "BDT",
        target_date: "",
        note: "",
      });

      setMessage("Goal created", "success");
      refreshAll();
    } catch (err) {
      setMessage(err.message || "Goal create failed", "error");
    }
  }

  async function contributeGoal() {
    if (!goalContributionForm.goal_id) {
      setMessage("Goal required", "error");
      return;
    }

    if (!goalContributionForm.wallet_account_id) {
      setMessage("Wallet required", "error");
      return;
    }

    if (!goalContributionForm.amount || Number(goalContributionForm.amount) <= 0) {
      setMessage("Valid amount required", "error");
      return;
    }

    try {
      await apiPost(`/goals/contribute`, {
        family_id: FAMILY_ID,
        goal_id: goalContributionForm.goal_id,
        wallet_account_id: goalContributionForm.wallet_account_id,
        amount: goalContributionForm.amount,
        currency: goalContributionForm.currency,
        description: goalContributionForm.description,
      });

      setGoalContributionForm((prev) => ({
        ...prev,
        amount: "",
        description: "",
      }));

      setMessage("Goal contribution posted", "success");
      refreshAll();
    } catch (err) {
      setMessage(err.message || "Goal contribution failed", "error");
    }
  }

  async function withdrawGoal() {
    if (!goalContributionForm.goal_id) {
      setMessage("Goal required", "error");
      return;
    }

    if (!goalContributionForm.wallet_account_id) {
      setMessage("Wallet required", "error");
      return;
    }

    if (!goalContributionForm.amount || Number(goalContributionForm.amount) <= 0) {
      setMessage("Valid amount required", "error");
      return;
    }

    try {
      await apiPost(`/goals/withdraw`, {
        family_id: FAMILY_ID,
        goal_id: goalContributionForm.goal_id,
        wallet_account_id: goalContributionForm.wallet_account_id,
        amount: goalContributionForm.amount,
        currency: goalContributionForm.currency,
        description: goalContributionForm.description,
      });

      setGoalContributionForm((prev) => ({
        ...prev,
        amount: "",
        description: "",
      }));

      setMessage("Goal withdraw posted", "success");
      refreshAll();
    } catch (err) {
      setMessage(err.message || "Goal withdraw failed", "error");
    }
  }

  async function closeGoal(item) {
    const ok = window.confirm(`Close goal "${item.goal_name}"?`);
    if (!ok) return;

    try {
      await apiPost(`/goals/${item.id}/close`, {
        family_id: FAMILY_ID,
        reason: "Closed from frontend",
      });

      setMessage("Goal closed", "success");
      refreshAll();
    } catch (err) {
      setMessage(err.message || "Goal close failed", "error");
    }
  }

'''

if "async function createGoal()" in text:
    print("GOALS ACTION FUNCTIONS ALREADY EXIST")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("GOALS ACTION FUNCTIONS INSERTED OK")
else:
    raise SystemExit("ERROR: createRecurring function not found")
