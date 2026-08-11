from pathlib import Path

p = Path("src/App.jsx")
text = p.read_text(encoding="utf-8")

needle = '  const [recurringItems, setRecurringItems] = useState([]);'

insert = '''  const [goals, setGoals] = useState([]);
  const [goalSummary, setGoalSummary] = useState(null);

  const [goalForm, setGoalForm] = useState({
    goal_name: "",
    goal_type: "GENERAL",
    target_amount: "",
    currency: "BDT",
    target_date: "",
    note: "",
  });

  const [goalContributionForm, setGoalContributionForm] = useState({
    goal_id: "",
    wallet_account_id: "",
    amount: "",
    currency: "BDT",
    description: "",
  });
'''

if insert.strip() in text:
    print("GOALS STATE ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, needle + "\n" + insert, 1)
    p.write_text(text, encoding="utf-8")
    print("GOALS STATE INSERTED OK")
else:
    raise SystemExit("ERROR: recurringItems line not found")

