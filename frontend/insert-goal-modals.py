from pathlib import Path

p = Path("src/App.jsx")
text = p.read_text(encoding="utf-8")

needle = "</main>"

insert = r'''
      {goalEditModal.open && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Edit Goal</h3>

            <input
              placeholder="Goal Name"
              value={goalEditModal.goal_name}
              onChange={(e) =>
                setGoalEditModal({
                  ...goalEditModal,
                  goal_name: e.target.value,
                })
              }
            />

            <input
              placeholder="Goal Type"
              value={goalEditModal.goal_type}
              onChange={(e) =>
                setGoalEditModal({
                  ...goalEditModal,
                  goal_type: e.target.value,
                })
              }
            />

            <input
              placeholder="Target Amount"
              value={goalEditModal.target_amount}
              onChange={(e) =>
                setGoalEditModal({
                  ...goalEditModal,
                  target_amount: e.target.value,
                })
              }
            />

            <input
              type="date"
              value={goalEditModal.target_date || ""}
              onChange={(e) =>
                setGoalEditModal({
                  ...goalEditModal,
                  target_date: e.target.value,
                })
              }
            />

            <textarea
              placeholder="Note"
              value={goalEditModal.note}
              onChange={(e) =>
                setGoalEditModal({
                  ...goalEditModal,
                  note: e.target.value,
                })
              }
            />

            <div className="modal-actions">
              <button onClick={saveGoalEdit}>Save</button>
              <button onClick={closeGoalEdit}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {goalHistoryModal.open && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>
              Goal History - {goalHistoryModal.goal?.goal_name}
            </h3>

            {goalHistoryModal.loading ? (
              <p>Loading...</p>
            ) : (
              <>
                {goalHistoryModal.history.length === 0 ? (
                  <p>No history found</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {goalHistoryModal.history.map((row) => (
                        <tr key={row.id}>
                          <td>{row.transaction_type}</td>
                          <td>{row.amount}</td>
                          <td>{row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            <div className="modal-actions">
              <button onClick={closeGoalHistory}>Close</button>
            </div>
          </div>
        </div>
      )}
'''

if "goalHistoryModal.open && (" in text:
    print("GOAL MODALS ALREADY EXIST")
elif needle in text:
    text = text.replace(needle, insert + "\n" + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("GOAL MODALS INSERTED OK")
else:
    raise SystemExit("ERROR: </main> not found")
