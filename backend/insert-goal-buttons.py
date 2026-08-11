from pathlib import Path

p = Path("src/App.jsx")
text = p.read_text(encoding="utf-8")

old = '''                    <div className="savings-actions">
                      {goal.status !== "CLOSED" && (
                        <button className="close-btn" onClick={() => closeGoal(goal)}>Close</button>
                      )}
                    </div>'''

new = '''                    <div className="savings-actions">
                      {goal.status === "ACTIVE" && (
                        <button className="edit-btn" onClick={() => openGoalEdit(goal)}>Edit</button>
                      )}

                      <button className="history-btn" onClick={() => openGoalHistory(goal)}>History</button>

                      {goal.status !== "CLOSED" && (
                        <button className="close-btn" onClick={() => closeGoal(goal)}>Close</button>
                      )}
                    </div>'''

if 'onClick={() => openGoalEdit(goal)}' in text:
    print("GOAL BUTTONS ALREADY EXIST")
elif old in text:
    text = text.replace(old, new, 1)
    p.write_text(text, encoding="utf-8")
    print("GOAL EDIT/HISTORY BUTTONS INSERTED OK")
else:
    raise SystemExit("ERROR: goal actions block not found")
