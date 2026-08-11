from pathlib import Path

p = Path("src/App.jsx")
text = p.read_text(encoding="utf-8")

needle = '        {activeMenu === "reports" && ('

insert = r'''
        {activeMenu === "goals" && (
          <section className="panel">
            <h2>Goals</h2>

            <div className="grid">
              <div className="card">
                <span>Total Goals</span>
                <strong>{goalSummary?.total_goals || 0}</strong>
              </div>

              <div className="card">
                <span>Active Goals</span>
                <strong>{goalSummary?.active_count || 0}</strong>
              </div>

              <div className="card">
                <span>Target Amount</span>
                <strong>{goalSummary?.active_target_amount || "0.0000"} BDT</strong>
              </div>

              <div className="card">
                <span>Saved Amount</span>
                <strong>{goalSummary?.active_current_amount || "0.0000"} BDT</strong>
              </div>
            </div>

            <h3>Create Goal</h3>
            <div className="savings-form">
              <input placeholder="Goal name" value={goalForm.goal_name} onChange={(e) => setGoalForm({ ...goalForm, goal_name: e.target.value })} />
              <input placeholder="Goal type" value={goalForm.goal_type} onChange={(e) => setGoalForm({ ...goalForm, goal_type: e.target.value })} />
              <input placeholder="Target amount" value={goalForm.target_amount} onChange={(e) => setGoalForm({ ...goalForm, target_amount: e.target.value })} />
              <input type="date" value={goalForm.target_date} onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })} />
              <input placeholder="Note" value={goalForm.note} onChange={(e) => setGoalForm({ ...goalForm, note: e.target.value })} />
              <button onClick={createGoal}>Create Goal</button>
            </div>

            <h3>Contribute / Withdraw</h3>
            <div className="savings-form">
              <select value={goalContributionForm.goal_id} onChange={(e) => setGoalContributionForm({ ...goalContributionForm, goal_id: e.target.value })}>
                <option value="">Select goal</option>
                {goals.filter((goal) => goal.status !== "CLOSED").map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.goal_name} - {goal.current_amount}/{goal.target_amount}
                  </option>
                ))}
              </select>

              <select value={goalContributionForm.wallet_account_id} onChange={(e) => setGoalContributionForm({ ...goalContributionForm, wallet_account_id: e.target.value })}>
                <option value="">Select wallet</option>
                {wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                ))}
              </select>

              <input placeholder="Amount" value={goalContributionForm.amount} onChange={(e) => setGoalContributionForm({ ...goalContributionForm, amount: e.target.value })} />
              <input placeholder="Description" value={goalContributionForm.description} onChange={(e) => setGoalContributionForm({ ...goalContributionForm, description: e.target.value })} />

              <button onClick={contributeGoal}>Contribute</button>
              <button onClick={withdrawGoal}>Withdraw</button>
              <button onClick={loadGoals}>Refresh Goals</button>
            </div>

            <div>
              {goals.map((goal) => {
                const progressValue = Math.min(Number(goal.progress_percent || 0), 100);

                return (
                  <div className="savings-card" key={goal.id}>
                    <div className="savings-header">
                      <div>
                        <div className="savings-title">{goal.goal_name}</div>
                        <div className="savings-note">
                          {goal.goal_type} · Target Date: {goal.target_date || "No date"} · {goal.note || "No note"}
                        </div>
                      </div>

                      <div className={`savings-status ${goal.status === "ACTIVE" ? "savings-active" : "savings-closed"}`}>
                        {goal.status}
                      </div>
                    </div>

                    <div className="progress-wrapper">
                      <div className="progress-fill" style={{ width: `${progressValue}%` }} />
                    </div>

                    <div className="savings-meta">
                      <span>Saved: {goal.current_amount} {goal.currency}</span>
                      <span>Target: {goal.target_amount} {goal.currency}</span>
                      <span>Remaining: {goal.remaining_amount} {goal.currency}</span>
                      <strong>{goal.progress_percent}%</strong>
                      <span>Monthly Need: {goal.recommended_monthly_saving} {goal.currency}</span>
                    </div>

                    <div className="savings-actions">
                      {goal.status !== "CLOSED" && (
                        <button className="close-btn" onClick={() => closeGoal(goal)}>Close</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

'''

if '{activeMenu === "goals" && (' in text:
    print("GOALS UI ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("GOALS UI INSERTED OK")
else:
    raise SystemExit("ERROR: Reports section not found")
