const PHASE16_TABS = ["SUBSCRIPTION", "DOCUMENT", "PROPERTY"];

const SUB_TYPE_OPTIONS = {
  SUBSCRIPTION: ["STREAMING", "DOMAIN", "HOSTING", "SOFTWARE", "OTHER"],
  DOCUMENT: ["NID", "PASSPORT", "BIRTH_CERTIFICATE", "DEED", "OTHER"],
  PROPERTY: ["HOUSE", "LAND", "SHOP", "APARTMENT", "OTHER"],
};

function moduleLabel(moduleType, t) {
  const map = {
    SUBSCRIPTION: t("moduleSubscription"),
    DOCUMENT: t("moduleDocument"),
    PROPERTY: t("moduleProperty"),
  };
  return map[moduleType] || moduleType;
}

function formatBytes(size, digits) {
  const value = Number(size || 0);
  if (!value) return "";
  if (value < 1024) return `${digits(value)} B`;
  if (value < 1024 * 1024) return `${digits((value / 1024).toFixed(1))} KB`;
  return `${digits((value / (1024 * 1024)).toFixed(1))} MB`;
}

export function Phase16Panel({
  t,
  digits,
  money,
  phase16Summary,
  phase16Items,
  phase16Form,
  setPhase16Form,
  phase16ActiveTab,
  setPhase16ActiveTab,
  editingPhase16Id,
  governanceMembers,
  wallets,
  documentFile,
  setDocumentFile,
  onSave,
  onEdit,
  onCancelEdit,
  onClose,
  onRefresh,
  onUploadDocument,
  onDownloadDocument,
}) {
  const filteredItems = phase16Items.filter((item) => item.module_type === phase16ActiveTab);
  const activeModule = phase16ActiveTab;

  function switchTab(moduleType) {
    setPhase16ActiveTab(moduleType);
    setPhase16Form((prev) => ({ ...prev, module_type: moduleType }));
    setDocumentFile?.(null);
  }

  return (
    <section className="panel phase-module-panel">
      <h2>{t("subscriptionsDocumentsProperty")}</h2>

      <div className="phase-tab-row">
        {PHASE16_TABS.map((moduleType) => (
          <button
            key={moduleType}
            type="button"
            className={phase16ActiveTab === moduleType ? "phase-tab active" : "phase-tab"}
            onClick={() => switchTab(moduleType)}
          >
            {moduleLabel(moduleType, t)}
          </button>
        ))}
      </div>

      <div className="grid">
        {PHASE16_TABS.map((moduleType) => (
          <div className="card" key={moduleType}>
            <span>{moduleLabel(moduleType, t)}</span>
            <strong>{digits(phase16Summary?.modules?.[moduleType]?.active_count || 0)}</strong>
            <p>{money(phase16Summary?.modules?.[moduleType]?.total_amount || 0)}</p>
            {(phase16Summary?.modules?.[moduleType]?.due_soon_count || 0) > 0 ? (
              <small className="due-badge">{t("dueSoon")}: {digits(phase16Summary.modules[moduleType].due_soon_count)}</small>
            ) : null}
            {moduleType === "SUBSCRIPTION" && phase16Summary?.modules?.SUBSCRIPTION?.monthly_cost_total ? (
              <small>{t("monthlyCost")}: {money(phase16Summary.modules.SUBSCRIPTION.monthly_cost_total)}</small>
            ) : null}
          </div>
        ))}
      </div>

      <h3>{editingPhase16Id ? t("updateItem") : t("createSubscriptionDocumentPropertyItem")}</h3>
      <div className="savings-form">
        <select value={phase16Form.sub_type || ""} onChange={(e) => setPhase16Form({ ...phase16Form, sub_type: e.target.value })}>
          <option value="">{t("subType")}</option>
          {(SUB_TYPE_OPTIONS[activeModule] || []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <input placeholder={t("name")} value={phase16Form.name} onChange={(e) => setPhase16Form({ ...phase16Form, name: e.target.value })} />
        <input placeholder={t("category")} value={phase16Form.category} onChange={(e) => setPhase16Form({ ...phase16Form, category: e.target.value })} />
        <input placeholder={t("amount")} value={phase16Form.amount} onChange={(e) => setPhase16Form({ ...phase16Form, amount: e.target.value })} />

        {activeModule === "SUBSCRIPTION" ? (
          <>
            <select value={phase16Form.billing_cycle || "MONTHLY"} onChange={(e) => setPhase16Form({ ...phase16Form, billing_cycle: e.target.value })}>
              <option value="MONTHLY">{t("monthly")}</option>
              <option value="YEARLY">{t("yearly")}</option>
            </select>
            <input type="date" value={phase16Form.renewal_or_expiry_date || ""} onChange={(e) => setPhase16Form({ ...phase16Form, renewal_or_expiry_date: e.target.value })} />
            <select value={phase16Form.payment_account_id || ""} onChange={(e) => setPhase16Form({ ...phase16Form, payment_account_id: e.target.value })}>
              <option value="">{t("selectAccount")}</option>
              {wallets.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
              ))}
            </select>
          </>
        ) : null}

        {activeModule === "DOCUMENT" ? (
          <>
            <select value={phase16Form.member_id || ""} onChange={(e) => setPhase16Form({ ...phase16Form, member_id: e.target.value })}>
              <option value="">{t("selectMember")}</option>
              {governanceMembers.map((member) => (
                <option key={member.member_id || member.id} value={member.member_id || member.id}>
                  {member.display_name || member.relationship_display_label || member.name || member.user_email || member.member_id || member.id}
                </option>
              ))}
            </select>
            <input type="date" value={phase16Form.renewal_or_expiry_date || ""} onChange={(e) => setPhase16Form({ ...phase16Form, renewal_or_expiry_date: e.target.value })} />
            <input placeholder={t("reference")} value={phase16Form.reference || ""} onChange={(e) => setPhase16Form({ ...phase16Form, reference: e.target.value })} />
            <label className="file-picker-label">
              {editingPhase16Id ? t("replaceFile") : t("attachDocumentFile")}
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt,application/pdf,image/*"
                onChange={(e) => setDocumentFile?.(e.target.files?.[0] || null)}
              />
            </label>
            {documentFile ? <small>{documentFile.name}</small> : null}
          </>
        ) : null}

        {activeModule === "PROPERTY" ? (
          <>
            <input placeholder={t("location")} value={phase16Form.provider || ""} onChange={(e) => setPhase16Form({ ...phase16Form, provider: e.target.value })} />
            <input placeholder={t("valuation")} value={phase16Form.secondary_amount || ""} onChange={(e) => setPhase16Form({ ...phase16Form, secondary_amount: e.target.value })} />
            <input placeholder={t("rentalIncome")} value={phase16Form.amount || ""} onChange={(e) => setPhase16Form({ ...phase16Form, amount: e.target.value })} />
          </>
        ) : null}

        <input placeholder={t("note")} value={phase16Form.note || ""} onChange={(e) => setPhase16Form({ ...phase16Form, note: e.target.value })} />
        <button onClick={onSave}>{editingPhase16Id ? t("saveItem") : t("createItem")}</button>
        {editingPhase16Id ? <button onClick={onCancelEdit}>{t("cancelEdit")}</button> : null}
        <button onClick={onRefresh}>{t("refreshDocsProperty")}</button>
      </div>

      <h3>{t("subscriptionsDocumentsPropertyItems")} · {moduleLabel(activeModule, t)}</h3>
      {filteredItems.length === 0 ? (
        <p className="status">{t("noSubscriptionDocumentProperty")}</p>
      ) : (
        <div className="table">
          {filteredItems.map((item) => (
            <div className="row" key={item.id}>
              <span>{item.sub_type || item.category}</span>
              <span>{item.name}</span>
              <strong>{money(item.amount, item.currency)}</strong>
              <span>{item.renewal_or_expiry_date || t("noDate")}</span>
              <span>{item.reference || item.provider || t("noReference")}</span>
              <span>{item.status}</span>
              {activeModule === "DOCUMENT" ? (
                <span>
                  {item.has_file ? (
                    <>
                      {item.file_name || t("fileAttached")}
                      {item.file_size ? ` · ${formatBytes(item.file_size, digits)}` : ""}
                      {item.file_encrypted ? ` · ${t("encryptedAtRest")}` : ""}
                    </>
                  ) : (
                    t("noFileAttached")
                  )}
                </span>
              ) : null}
              {item.status === "ACTIVE" ? (
                <>
                  <button onClick={() => onEdit(item)}>{t("editItem")}</button>
                  {activeModule === "DOCUMENT" && item.has_file ? (
                    <button onClick={() => onDownloadDocument(item)}>{t("downloadFile")}</button>
                  ) : null}
                  {activeModule === "DOCUMENT" && !item.has_file ? (
                    <label className="file-picker-label inline">
                      {t("uploadFile")}
                      <input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt,application/pdf,image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) onUploadDocument(item, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  ) : null}
                  <button onClick={() => onClose(item)}>{t("close")}</button>
                </>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
