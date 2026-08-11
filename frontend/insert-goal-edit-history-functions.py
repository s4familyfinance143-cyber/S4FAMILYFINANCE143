from pathlib import Path

p = Path("src/App.jsx")
text = p.read_text(encoding="utf-8")

needle = "  async function closeGoal(item) {"

insert = r'''
  function openGoalEdit(item) {
    if (item.status !== "ACTIVE") {
      setMessage("Only active goal can be edited", "error");
      return;
    }

    setGoalEditModal({
      open: true,
      goal: item,
      goal_name: item.goal_name || "",
      goal_type: item.goal_type || "GENERAL",
      target_amount: item.target_amount || "",
      target_date: item.target_date || "",
      note: item.note || "",
    });
  }

  function closeGoalEdit() {
    setGoalEditModal({
      open: false,
      goal: null,
      goal_name: "",
      goal_type: "GENERAL",
      target_amount: "",
      target_date: "",
      note: "",
    });
  }

  async function saveGoalEdit() {
    if (!goalEditModal.goal) return;

    if (!goalEditModal.goal_name.trim()) {
      setMessage("Goal name required", "error");
      return;
    }

    if (!goalEditModal.target_amount || Number(goalEditModal.target_amount) <= 0) {
      setMessage("Valid target amount required", "error");
      return;
    }

    try {
      await apiPatch(`/goals/${goalEditModal.goal.id}`, {
        family_id: FAMILY_ID,
        goal_name: goalEditModal.goal_name.trim(),
        goal_type: goalEditModal.goal_type,
        target_amount: goalEditModal.target_amount,
        target_date: goalEditModal.target_date || null,
        note: goalEditModal.note,
      });

      closeGoalEdit();
      setMessage("Goal updated", "success");
      refreshAll();
    } catch (err) {
      setMessage(err.message || "Goal update failed", "error");
    }
  }

  async function openGoalHistory(item) {
    setGoalHistoryModal({
      open: true,
      loading: true,
      goal: item,
      history: [],
    });

    try {
      const data = await apiGet(`/goals/${item.id}/history/${FAMILY_ID}`);

      setGoalHistoryModal({
        open: true,
        loading: false,
        goal: data.goal || item,
        history: data.history || [],
      });

      setMessage("Goal history loaded", "success");
    } catch (err) {
      setGoalHistoryModal({
        open: true,
        loading: false,
        goal: item,
        history: [],
      });

      setMessage(err.message || "Goal history load failed", "error");
    }
  }

  function closeGoalHistory() {
    setGoalHistoryModal({
      open: false,
      loading: false,
      goal: null,
      history: [],
    });
  }

'''

if "function openGoalEdit" in text:
    print("GOAL EDIT/HISTORY FUNCTIONS ALREADY EXIST")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("GOAL EDIT/HISTORY FUNCTIONS INSERTED OK")
else:
    raise SystemExit("ERROR: closeGoal function not found")
