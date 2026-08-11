from pathlib import Path

p = Path("src/App.jsx")
text = p.read_text(encoding="utf-8")

needle = '''  const [recurringHistoryModal, setRecurringHistoryModal] = useState({
    open: false,
    loading: false,
    item: null,
    history: [],
  });
'''

insert = '''
  const [goalEditModal, setGoalEditModal] = useState({
    open: false,
    goal: null,
    goal_name: "",
    goal_type: "GENERAL",
    target_amount: "",
    target_date: "",
    note: "",
  });

  const [goalHistoryModal, setGoalHistoryModal] = useState({
    open: false,
    loading: false,
    goal: null,
    history: [],
  });
'''

if "const [goalEditModal" in text:
    print("GOAL MODAL STATES ALREADY EXIST")
elif needle in text:
    text = text.replace(needle, needle + insert, 1)
    p.write_text(text, encoding="utf-8")
    print("GOAL MODAL STATES INSERTED OK")
else:
    raise SystemExit("ERROR: recurringHistoryModal block not found")
