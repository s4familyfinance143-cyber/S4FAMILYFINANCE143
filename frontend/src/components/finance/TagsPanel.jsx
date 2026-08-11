import { useEffect, useState } from "react";

/** PC Tags + transaction_tags wiring (architecture DB feature). */
export function TagsPanel({ t, apiGet, apiPost, apiDelete, activeFamilyId, transactions = [] }) {
  const [tags, setTags] = useState([]);
  const [name, setName] = useState("");
  const [txId, setTxId] = useState("");
  const [tagId, setTagId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!activeFamilyId || !apiGet) return;
    try {
      const data = await apiGet(`/tags/${encodeURIComponent(activeFamilyId)}`);
      setTags(Array.isArray(data) ? data : data?.items || data?.tags || []);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load tags");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId]);

  async function createTag() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiPost("/tags", { family_id: activeFamilyId, name: name.trim() });
      setName("");
      await load();
    } catch (err) {
      setError(err.message || "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function attachTag() {
    if (!txId || !tagId) return;
    setBusy(true);
    try {
      await apiPost("/transaction-tags", {
        family_id: activeFamilyId,
        transaction_id: txId,
        tag_id: tagId,
      });
      setError("");
    } catch (err) {
      setError(err.message || "Attach failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-panel settings-smart finance-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">Tags</p>
          <h2>{t("tags") || "Tags"}</h2>
        </div>
        <button type="button" className="btn" onClick={load}>
          {t("refresh")}
        </button>
      </div>

      <div className="settings-stack">
        <div className="settings-block">
          <h4>Create tag</h4>
          <div className="finance-form">
            <input placeholder="Tag name" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={createTag}>
              Create
            </button>
          </div>
        </div>

        <div className="settings-block">
          <h4>Attach tag to transaction</h4>
          <div className="finance-form">
            <select value={txId} onChange={(e) => setTxId(e.target.value)}>
              <option value="">Transaction</option>
              {transactions.slice(0, 40).map((tx) => (
                <option key={tx.id} value={tx.id}>
                  {(tx.transaction_type || "TX").slice(0, 12)} · {tx.amount} · {(tx.description || "").slice(0, 24)}
                </option>
              ))}
            </select>
            <select value={tagId} onChange={(e) => setTagId(e.target.value)}>
              <option value="">Tag</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name || tag.name_en || tag.id}
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={busy} onClick={attachTag}>
              Attach
            </button>
          </div>
        </div>

        {error ? <p className="settings-empty">{error}</p> : null}

        <div className="settings-block">
          <h4>All tags ({tags.length})</h4>
          <div className="finance-feed">
            {tags.map((tag) => (
              <div className="finance-card" key={tag.id}>
                <strong>{tag.name || tag.name_en}</strong>
                <span className="tx-row-sub">{tag.id}</span>
                {apiDelete ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      try {
                        await apiDelete(`/tags/${tag.id}?family_id=${encodeURIComponent(activeFamilyId)}`);
                        await load();
                      } catch (err) {
                        setError(err.message || "Delete failed");
                      }
                    }}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
