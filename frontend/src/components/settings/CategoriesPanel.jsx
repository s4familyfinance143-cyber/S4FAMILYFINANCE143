import { useState } from "react";

const EMPTY_FORM = { name_en: "", name_bn: "", category_type: "EXPENSE", icon: "", color: "#0f8f6f" };

function groupByType(categories) {
  const income = [];
  const expense = [];
  for (const category of categories || []) {
    const type = String(category.category_type || "").toUpperCase();
    if (type.includes("INCOME")) income.push(category);
    else expense.push(category);
  }
  return { income, expense };
}

export function CategoriesPanel({
  t,
  categories = [],
  loading = false,
  saving = false,
  deletingId = "",
  canManage = false,
  onCreate,
  onDelete,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const { income, expense } = groupByType(categories);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!onCreate) return;
    const ok = await onCreate(form);
    if (ok) setForm(EMPTY_FORM);
  }

  function handleDelete(category) {
    if (!onDelete) return;
    const label = category.name_en || category.name_bn || "";
    if (!window.confirm(t("confirmDeleteCategory") || `Delete category "${label}"?`)) return;
    onDelete(category.id);
  }

  function renderRow(category) {
    const isSystem = Boolean(category.is_system);
    const isDeleting = deletingId === category.id;
    return (
      <div className="category-row" key={category.id}>
        <span className="category-swatch" style={{ background: category.color || "#64748B" }} aria-hidden="true" />
        <div className="category-row-copy">
          <strong>{category.name_en}</strong>
          <span className="hint">{category.name_bn}</span>
        </div>
        {isSystem ? (
          <span className="perm-access-badge neutral">{t("categoryDefault") || "Default"}</span>
        ) : canManage ? (
          <button
            type="button"
            className="btn"
            disabled={isDeleting}
            onClick={() => handleDelete(category)}
          >
            {isDeleting ? t("deleting") || "…" : t("delete") || "Delete"}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="settings-stack settings-categories">
      <div className="settings-block category-create-card">
        <div className="settings-block-head">
          <div>
            <h4>{t("addCustomCategory") || "Add custom category"}</h4>
            <p>{t("addCustomCategoryHint") || "Create a category that fits your family's spending, beyond the defaults."}</p>
          </div>
        </div>

        {!canManage ? (
          <p className="settings-empty">{t("ownerOnlyUnavailable")}</p>
        ) : (
          <form className="category-create-form" onSubmit={handleSubmit}>
            <div className="family-settings-grid">
              <div className="family-field">
                <label className="family-field-label" htmlFor="category-name-en">
                  {t("categoryNameEn") || "Name (English)"}
                </label>
                <input
                  id="category-name-en"
                  value={form.name_en}
                  maxLength={120}
                  placeholder={t("categoryNameEnPlaceholder") || "e.g. Pet Care"}
                  onChange={(e) => setForm((prev) => ({ ...prev, name_en: e.target.value }))}
                  required
                />
              </div>
              <div className="family-field">
                <label className="family-field-label" htmlFor="category-name-bn">
                  {t("categoryNameBn") || "Name (Bangla)"}
                </label>
                <input
                  id="category-name-bn"
                  value={form.name_bn}
                  maxLength={120}
                  placeholder={t("categoryNameBnPlaceholder") || "যেমন: পোষা প্রাণী"}
                  onChange={(e) => setForm((prev) => ({ ...prev, name_bn: e.target.value }))}
                  required
                />
              </div>
              <div className="family-field">
                <label className="family-field-label" htmlFor="category-type">
                  {t("categoryType") || "Type"}
                </label>
                <select
                  id="category-type"
                  value={form.category_type}
                  onChange={(e) => setForm((prev) => ({ ...prev, category_type: e.target.value }))}
                >
                  <option value="EXPENSE">{t("expense") || "Expense"}</option>
                  <option value="INCOME">{t("income") || "Income"}</option>
                </select>
              </div>
              <div className="family-field">
                <label className="family-field-label" htmlFor="category-color">
                  {t("categoryColor") || "Color"}
                </label>
                <input
                  id="category-color"
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm((prev) => ({ ...prev, color: e.target.value }))}
                  style={{ height: 42, padding: 4, width: "100%" }}
                />
              </div>
            </div>
            <div className="family-settings-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? t("saving") || "Saving…" : t("addCategory") || "Add category"}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="settings-block">
        <div className="settings-block-head">
          <div>
            <h4>{t("income") || "Income"}</h4>
          </div>
        </div>
        {loading && income.length === 0 ? (
          <p className="settings-empty">{t("loading") || "Loading…"}</p>
        ) : income.length === 0 ? (
          <p className="settings-empty">{t("noCategoriesYet") || "No categories yet"}</p>
        ) : (
          <div className="category-list">{income.map(renderRow)}</div>
        )}
      </div>

      <div className="settings-block">
        <div className="settings-block-head">
          <div>
            <h4>{t("expense") || "Expense"}</h4>
          </div>
        </div>
        {loading && expense.length === 0 ? (
          <p className="settings-empty">{t("loading") || "Loading…"}</p>
        ) : expense.length === 0 ? (
          <p className="settings-empty">{t("noCategoriesYet") || "No categories yet"}</p>
        ) : (
          <div className="category-list">{expense.map(renderRow)}</div>
        )}
      </div>
    </div>
  );
}
