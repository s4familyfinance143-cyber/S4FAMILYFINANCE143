from pathlib import Path

p = Path("src/App.jsx")
text = p.read_text(encoding="utf-8")

needle = '''  async function loadRecurring() {
    if (!token) return;

    try {
      const data = await apiGet(`/recurring/${FAMILY_ID}`);
      setRecurringItems(data);
    } catch {
      setMessage("Recurring load failed", "error");
    }
  }
'''

insert = '''
  async function loadGoals() {
    if (!token) return;

    try {
      const data = await apiGet(`/goals/${FAMILY_ID}`);
      setGoals(data);

      if (data.length && !goalContributionForm.goal_id) {
        setGoalContributionForm((prev) => ({
          ...prev,
          goal_id: data[0].id,
        }));
      }
    } catch {
      setMessage("Goals load failed", "error");
    }

    try {
      const summary = await apiGet(`/goals/summary/${FAMILY_ID}`);
      setGoalSummary(summary);
    } catch {
      setGoalSummary(null);
    }
  }
'''

if "async function loadGoals()" in text:
    print("GOALS LOAD FUNCTION ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, needle + insert, 1)
    p.write_text(text, encoding="utf-8")
    print("GOALS LOAD FUNCTION INSERTED OK")
else:
    raise SystemExit("ERROR: loadRecurring block not found")
