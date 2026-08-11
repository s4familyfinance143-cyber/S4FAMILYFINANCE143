from pathlib import Path

p = Path("src/App.jsx")
text = p.read_text(encoding="utf-8")

start = text.find("      {goalEditModal.open && (")
second = text.find("      {goalHistoryModal.open && (", start)

if start == -1 or second == -1:
    raise SystemExit("ERROR: goal modal blocks not found")

# find end after history modal before aside
end = text.find("      <aside className=\"sidebar\">", second)
if end == -1:
    raise SystemExit("ERROR: aside marker not found")

new_modal = r'''      {goalEditModal.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ width: "min(700px, 95vw)", maxHeight: "85vh", overflowY: "auto", background: "#0b1f45", border: "1px solid #23497d", borderRadius: 24, padding: 24, color: "#ffffff" }}>
            <h2 style={{ color: "#ffd42a", marginBottom: 16 }}>Edit Goal</h2>

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} placeholder="Goal name" value={goalEditModal.goal_name} onChange={(e) => setGoalEditModal({ ...goalEditModal, goal_name: e.target.value })} />

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} placeholder="Goal type" value={goalEditModal.goal_type} onChange={(e) => setGoalEditModal({ ...goalEditModal, goal_type: e.target.value })} />

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} placeholder="Target amount" value={goalEditModal.target_amount} onChange={(e) => setGoalEditModal({ ...goalEditModal, target_amount: e.target.value })} />

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} type="date" value={goalEditModal.target_date || ""} onChange={(e) => setGoalEditModal({ ...goalEditModal, target_date: e.target.value })} />

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} placeholder="Note" value={goalEditModal.note} onChange={(e) => setGoalEditModal({ ...goalEditModal, note: e.target.value })} />

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button onClick={saveGoalEdit} style={{ background: "#2563eb", color: "white", borderRadius: 12, padding: "12px 18px", fontWeight: 800 }}>Save</button>
              <button onClick={closeGoalEdit} style={{ background: "#dc2626", color: "white", borderRadius: 12, padding: "12px 18px", fontWeight: 800 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {goalHistoryModal.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ width: "min(900px, 95vw)", maxHeight: "85vh", overflowY: "auto", background: "#0b1f45", border: "1px solid #23497d", borderRadius: 24, padding: 24, color: "#ffffff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ color: "#ffd42a", marginBottom: 6 }}>Goal History</h2>
                <p style={{ color: "#8ab7ff" }}>{goalHistoryModal.goal?.goal_name || "Goal"}</p>
              </div>

              <button onClick={closeGoalHistory} style={{ background: "#dc2626", color: "white", borderRadius: 12, padding: "12px 18px", fontWeight: 800 }}>Close</button>
            </div>

            {goalHistoryModal.loading && <p className="status">Loading history...</p>}

            {!goalHistoryModal.loading && goalHistoryModal.history.length === 0 && (
              <p className="status">No goal history found</p>
            )}

            {!goalHistoryModal.loading && goalHistoryModal.history.length > 0 && (
              <div className="table">
                {goalHistoryModal.history.map((item) => (
                  <div className="row" key={item.id}>
                    <span>{item.transaction_type}</span>
                    <span>{item.description || "No description"}</span>
                    <strong>{item.amount} {item.currency}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

'''

text = text[:start] + new_modal + text[end:]
p.write_text(text, encoding="utf-8")
print("GOAL MODALS FINAL FIX OK")
