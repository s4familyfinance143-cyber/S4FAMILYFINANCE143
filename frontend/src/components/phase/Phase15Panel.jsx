const PHASE15_TABS = ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"];

const SUB_TYPE_OPTIONS = {
  INVESTMENT: ["STOCK", "MUTUAL_FUND", "FIXED_DEPOSIT", "GOLD", "DPS", "FDR", "SHARES", "SAVINGS_CERTIFICATE", "OTHER"],
  HEALTH: ["DOCTOR", "MEDICINE", "HOSPITAL", "TEST", "CHECKUP", "INSURANCE", "OTHER"],
  VEHICLE: ["FUEL", "SERVICE", "TAX", "INSURANCE", "CAR", "BIKE", "OTHER"],
  EDUCATION: ["SCHOOL_FEE", "COACHING", "BOOKS", "SUPPLIES", "TUITION", "COURSE", "OTHER"],
};

function moduleLabel(moduleType, t) {
  const map = {
    INVESTMENT: t("moduleInvestment"),
    HEALTH: t("moduleHealth"),
    VEHICLE: t("moduleVehicle"),
    EDUCATION: t("moduleEducation"),
  };
  return map[moduleType] || moduleType;
}

export function Phase15Panel({
  t,
  digits,
  money,
  phase15Summary,
  phase15Items,
  phase15Form,
  setPhase15Form,
  phase15ActiveTab,
  setPhase15ActiveTab,
  editingPhase15Id,
  governanceMembers,
  onSave,
  onEdit,
  onCancelEdit,
  onClose,
  onRefresh,
}) {
  const filteredItems = phase15Items.filter((item) => item.module_type === phase15ActiveTab);
  const activeModule = phase15ActiveTab;

  function switchTab(moduleType) {
    setPhase15ActiveTab(moduleType);
    setPhase15Form((prev) => ({ ...prev, module_type: moduleType }));
  }

  return (
    <section className="panel phase-module-panel">
      <h2>{t("familyAssetsLifeFunds")}</h2>

      <div className="phase-tab-row">
        {PHASE15_TABS.map((moduleType) => (
          <button
            key={moduleType}
            type="button"
            className={phase15ActiveTab === moduleType ? "phase-tab active" : "phase-tab"}
            onClick={() => switchTab(moduleType)}
          >
            {moduleLabel(moduleType, t)}
          </button>
        ))}
      </div>

      <div className="grid">
        {PHASE15_TABS.map((moduleType) => (
          <div className="card" key={moduleType}>
            <span>{moduleLabel(moduleType, t)}</span>
            <strong>{digits(phase15Summary?.modules?.[moduleType]?.active_count || 0)}</strong>
            <p>{money(phase15Summary?.modules?.[moduleType]?.total_amount || 0)}</p>
            {(phase15Summary?.modules?.[moduleType]?.due_soon_count || 0) > 0 ? (
              <small className="due-badge">{t("dueSoon")}: {digits(phase15Summary.modules[moduleType].due_soon_count)}</small>
            ) : null}
          </div>
        ))}
      </div>

      <h3>{editingPhase15Id ? t("updateItem") : t("createAssetFundItem")}</h3>
      <div className="savings-form">
        <select value={phase15Form.sub_type || ""} onChange={(e) => setPhase15Form({ ...phase15Form, sub_type: e.target.value })}>
          <option value="">{t("subType")}</option>
          {(SUB_TYPE_OPTIONS[activeModule] || []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <input placeholder={t("name")} value={phase15Form.name} onChange={(e) => setPhase15Form({ ...phase15Form, name: e.target.value })} />
        <input placeholder={t("category")} value={phase15Form.category} onChange={(e) => setPhase15Form({ ...phase15Form, category: e.target.value })} />
        <input placeholder={t("amount")} value={phase15Form.amount} onChange={(e) => setPhase15Form({ ...phase15Form, amount: e.target.value })} />

        {activeModule === "INVESTMENT" ? (
          <>
            <input type="date" placeholder={t("maturityDate")} value={phase15Form.secondary_date || ""} onChange={(e) => setPhase15Form({ ...phase15Form, secondary_date: e.target.value })} />
            <input placeholder={t("returnRate")} value={phase15Form.secondary_amount || ""} onChange={(e) => setPhase15Form({ ...phase15Form, secondary_amount: e.target.value })} />
          </>
        ) : null}

        {activeModule === "HEALTH" || activeModule === "EDUCATION" ? (
          <>
            <select value={phase15Form.member_id || ""} onChange={(e) => setPhase15Form({ ...phase15Form, member_id: e.target.value })}>
              <option value="">{t("selectMember")}</option>
              {governanceMembers.map((member) => (
                <option key={member.member_id || member.id} value={member.member_id || member.id}>
                  {member.display_name || member.relationship_display_label || member.name || member.user_email || member.member_id || member.id}
                </option>
              ))}
            </select>
            <input placeholder={t("provider")} value={phase15Form.provider || ""} onChange={(e) => setPhase15Form({ ...phase15Form, provider: e.target.value })} />
          </>
        ) : null}

        {activeModule === "VEHICLE" ? (
          <>
            <input placeholder={t("vehiclePlate")} value={phase15Form.provider || ""} onChange={(e) => setPhase15Form({ ...phase15Form, provider: e.target.value })} />
            <input placeholder={t("mileage")} value={phase15Form.secondary_amount || ""} onChange={(e) => setPhase15Form({ ...phase15Form, secondary_amount: e.target.value })} />
            <input type="date" placeholder={t("serviceDueDate")} value={phase15Form.secondary_date || ""} onChange={(e) => setPhase15Form({ ...phase15Form, secondary_date: e.target.value })} />
          </>
        ) : null}

        {activeModule === "EDUCATION" ? (
          <input placeholder={t("monthlyTarget")} value={phase15Form.secondary_amount || ""} onChange={(e) => setPhase15Form({ ...phase15Form, secondary_amount: e.target.value })} />
        ) : null}

        <input type="date" value={phase15Form.target_date || ""} onChange={(e) => setPhase15Form({ ...phase15Form, target_date: e.target.value })} />
        <input placeholder={t("note")} value={phase15Form.note || ""} onChange={(e) => setPhase15Form({ ...phase15Form, note: e.target.value })} />
        <button onClick={onSave}>{editingPhase15Id ? t("saveItem") : t("createItem")}</button>
        {editingPhase15Id ? <button onClick={onCancelEdit}>{t("cancelEdit")}</button> : null}
        <button onClick={onRefresh}>{t("refreshAssetsFunds")}</button>
      </div>

      <h3>{t("assetsFundsItems")} · {moduleLabel(activeModule, t)}</h3>
      {filteredItems.length === 0 ? (
        <p className="status">{t("noAssetsFunds")}</p>
      ) : (
        <div className="table">
          {filteredItems.map((item) => (
            <div className="row" key={item.id}>
              <span>{item.sub_type || item.category}</span>
              <span>{item.name}</span>
              <span>{item.provider || t("noReference")}</span>
              <strong>{money(item.amount, item.currency)}</strong>
              <span>{item.target_date || item.secondary_date || t("noDate")}</span>
              <span>{item.status}</span>
              {item.status === "ACTIVE" ? (
                <>
                  <button onClick={() => onEdit(item)}>{t("editItem")}</button>
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
