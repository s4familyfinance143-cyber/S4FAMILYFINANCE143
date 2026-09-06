import { useEffect, useMemo, useState } from "react";

/** Family tags + transaction tag links (cloud/local IndexedDB). */
export function TagsPanel({
  t,
  money,
  amount,
  apiGet,
  apiPost,
  apiDelete,
  activeFamilyId,
  transactions = [],
  onMessage,
}) {
  const [tags, setTags] = useState([]);
  const [links, setLinks] = useState([]);
  const [name, setName] = useState("");
  const [txId, setTxId] = useState("");
  const [tagId, setTagId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const liveTx = useMemo(
    () =>
      (transactions || []).filter((tx) => String(tx.status || "").toUpperCase() !== "VOID").slice(0, 50),
    [transactions],
  );

  const tagMap = useMemo(() => {
    const map = new Map();
    for (const tag of tags) map.set(String(tag.id), tag);
    return map;
  }, [tags]);

  const txMap = useMemo(() => {
    const map = new Map();
    for (const tx of transactions || []) map.set(String(tx.id), tx);
    return map;
  }, [transactions]);

  function notify(msg, type = "success") {
    if (type === "error") setError(msg);
    else {
      setError("");
      setOkMsg(msg);
    }
    if (typeof onMessage === "function") onMessage(msg, type);
  }

  async function load() {
    if (!activeFamilyId || !apiGet) return;
    try {
      const [tagData, linkData] = await Promise.all([
        apiGet(`/tags/${encodeURIComponent(activeFamilyId)}`),
        apiGet(`/transaction-tags`),
      ]);
      const nextTags = Array.isArray(tagData) ? tagData : tagData?.items || tagData?.tags || [];
      const nextLinks = Array.isArray(linkData)
        ? linkData
        : linkData?.items || linkData?.links || [];
      setTags(nextTags);
      setLinks(nextLinks);
      setError("");
      if (!tagId && nextTags[0]?.id) setTagId(String(nextTags[0].id));
    } catch (err) {
      notify(err.message || t("tagLoadFailed") || "Failed to load tags", "error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId]);

  useEffect(() => {
    if (!txId && liveTx[0]?.id) setTxId(String(liveTx[0].id));
  }, [liveTx, txId]);

  useEffect(() => {
    if (!tagId && tags[0]?.id) setTagId(String(tags[0].id));
  }, [tags, tagId]);

  async function createTag() {
    const cleaned = name.trim();
    if (!cleaned) {
      notify(t("tagNameRequired") || "Tag name required", "error");
      return;
    }
    if (tags.some((tag) => String(tag.name || "").trim().toLowerCase() === cleaned.toLowerCase())) {
      notify(t("tagDuplicate") || "Tag already exists", "error");
      return;
    }
    setBusy(true);
    try {
      await apiPost("/tags", { family_id: activeFamilyId, name: cleaned });
      setName("");
      await load();
      notify(t("tagCreated") || "Tag created", "success");
    } catch (err) {
      notify(err.message || t("tagCreateFailed") || "Create failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function attachTag() {
    if (!txId) {
      notify(t("transactionRequired") || "Transaction required", "error");
      return;
    }
    if (!tagId) {
      notify(t("tagRequired") || "Tag required", "error");
      return;
    }
    const dup = links.some(
      (link) => String(link.transaction_id) === String(txId) && String(link.tag_id) === String(tagId),
    );
    if (dup) {
      notify(t("tagAlreadyAttached") || "Tag already attached", "error");
      return;
    }
    setBusy(true);
    try {
      await apiPost("/transaction-tags", {
        family_id: activeFamilyId,
        transaction_id: txId,
        tag_id: tagId,
      });
      await load();
      notify(t("tagAttached") || "Tag attached", "success");
    } catch (err) {
      notify(err.message || t("tagAttachFailed") || "Attach failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function detachLink(link) {
    if (!apiDelete || !link?.id) return;
    const ok = window.confirm(t("confirmDetachTag") || "Detach this tag?");
    if (!ok) return;
    setBusy(true);
    try {
      await apiDelete(`/transaction-tags/${encodeURIComponent(link.id)}`);
      await load();
      notify(t("tagDetached") || "Tag detached", "success");
    } catch (err) {
      notify(err.message || t("tagDetachFailed") || "Detach failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTag(tag) {
    if (!apiDelete || !tag?.id) return;
    const ok = window.confirm(t("confirmDeleteTag") || `Delete tag "${tag.name}"?`);
    if (!ok) return;
    setBusy(true);
    try {
      await apiDelete(`/tags/${encodeURIComponent(tag.id)}?family_id=${encodeURIComponent(activeFamilyId)}`);
      if (String(tagId) === String(tag.id)) setTagId("");
      await load();
      notify(t("tagDeleted") || "Tag deleted", "success");
    } catch (err) {
      notify(err.message || t("tagDeleteFailed") || "Delete failed", "error");
    } finally {
      setBusy(false);
    }
  }

  function txLabel(tx) {
    if (!tx) return t("transaction") || "Transaction";
    const type = String(tx.transaction_type || tx.type || "TX").slice(0, 12);
    const amt = typeof amount === "function" ? amount(tx.amount) : tx.amount;
    const desc = String(tx.description || "").slice(0, 28);
    return `${type} · ${amt}${desc ? ` · ${desc}` : ""}`;
  }

  return (
    <section className="panel settings-panel settings-smart finance-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("tags")}</p>
          <h2>{t("tags")}</h2>
        </div>
        <button type="button" className="btn" onClick={load} disabled={busy}>
          {t("refresh")}
        </button>
      </div>

      <div className="summary-metric-grid" role="group" aria-label={t("tags")}>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("tags")}</span>
          <strong className="summary-metric-value">{tags.length}</strong>
        </div>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("tagAttachments")}</span>
          <strong className="summary-metric-value">{links.length}</strong>
        </div>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("transactions")}</span>
          <strong className="summary-metric-value">{liveTx.length}</strong>
        </div>
      </div>

      <div className="settings-stack">
        <div className="settings-block">
          <h4>{t("createTag")}</h4>
          <div className="finance-form">
            <input
              placeholder={t("tagName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createTag();
              }}
            />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={createTag}>
              {t("create")}
            </button>
          </div>
        </div>

        <div className="settings-block">
          <h4>{t("attachTagToTransaction")}</h4>
          <div className="finance-form">
            <select value={txId} onChange={(e) => setTxId(e.target.value)}>
              <option value="">{t("selectTransaction")}</option>
              {liveTx.map((tx) => (
                <option key={tx.id} value={tx.id}>
                  {txLabel(tx)}
                </option>
              ))}
            </select>
            <select value={tagId} onChange={(e) => setTagId(e.target.value)}>
              <option value="">{t("selectTag")}</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name || tag.name_en || tag.id}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={attachTag}>
              {t("attach")}
            </button>
          </div>
          {liveTx.length === 0 ? (
            <p className="settings-empty">{t("noTransactionsForTags")}</p>
          ) : null}
          {tags.length === 0 ? <p className="settings-empty">{t("noTagsYet")}</p> : null}
        </div>

        {error ? <p className="settings-empty">{error}</p> : null}
        {okMsg && !error ? <p className="status">{okMsg}</p> : null}

        <div className="settings-block">
          <h4>
            {t("allTags")} ({tags.length})
          </h4>
          {tags.length === 0 ? (
            <p className="settings-empty">{t("noTagsYet")}</p>
          ) : (
            <div className="finance-feed">
              {tags.map((tag) => {
                const count = links.filter((link) => String(link.tag_id) === String(tag.id)).length;
                return (
                  <div className="finance-card finance-card-stack" key={tag.id}>
                    <div className="tx-row budget-row-head">
                      <div className="tx-row-copy">
                        <strong>{tag.name || tag.name_en}</strong>
                        <span className="tx-row-sub">
                          {t("tagAttachments")}: {count}
                        </span>
                      </div>
                    </div>
                    <div className="finance-actions">
                      {apiDelete ? (
                        <button type="button" className="btn" disabled={busy} onClick={() => deleteTag(tag)}>
                          {t("delete")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="settings-block">
          <h4>
            {t("tagAttachments")} ({links.length})
          </h4>
          {links.length === 0 ? (
            <p className="settings-empty">{t("noTagAttachments")}</p>
          ) : (
            <div className="finance-feed">
              {links.map((link) => {
                const tag = tagMap.get(String(link.tag_id));
                const tx = txMap.get(String(link.transaction_id));
                return (
                  <div className="finance-card finance-card-stack" key={link.id}>
                    <div className="tx-row budget-row-head">
                      <div className="tx-row-copy">
                        <strong>{tag?.name || tag?.name_en || link.tag_id}</strong>
                        <span className="tx-row-sub">{txLabel(tx)}</span>
                      </div>
                      <div className="tx-row-amount">
                        {tx && typeof money === "function" ? (
                          <strong>{money(tx.amount, tx.currency)}</strong>
                        ) : null}
                      </div>
                    </div>
                    <div className="finance-actions">
                      {apiDelete ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => detachLink(link)}
                        >
                          {t("detach")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
