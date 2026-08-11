import { useState } from "react";
import { MoneyPill, TypeChip } from "../ui/FinanceChips";
import { GroceryBarcodeCamera } from "./GroceryBarcodeCamera";

const GROCERY_TABS = ["lists", "scan", "vendors", "collab", "offline"];

function qtyLabel(quantity, unit, digits) {
  const n = Number(quantity);
  const q = Number.isFinite(n) ? digits(n % 1 === 0 ? String(Math.trunc(n)) : n.toFixed(2)) : digits(quantity || "0");
  return `${q} ${unit || "pcs"}`.trim();
}

export function GroceryPanel({
  t,
  digits,
  money,
  groceryTab,
  setGroceryTab,
  groceryLists,
  groceryItems,
  groceryVendors,
  groceryVendorSummary,
  groceryPriceHistory,
  groceryActivity,
  groceryCollaboration,
  groceryWsState = "off",
  groceryListForm,
  setGroceryListForm,
  groceryItemForm,
  setGroceryItemForm,
  groceryVendorForm,
  setGroceryVendorForm,
  groceryScanForm,
  setGroceryScanForm,
  groceryBarcodeLookup,
  groceryOcrPreview,
  groceryExpenseForm,
  setGroceryExpenseForm,
  activeGroceryListId,
  wallets,
  categories,
  onRefresh,
  onCreateList,
  onSelectList,
  onCreateItem,
  onCreateVendor,
  onLookupBarcode,
  onApplyBarcode,
  onParseOcr,
  onParseOcrImage,
  onAddOcrSuggestion,
  onAddAllOcrSuggestions,
  onMarkBought,
  onPostExpense,
  localOutboxPending = 0,
  groceryPendingRows = [],
  onReplayPendingSync,
  syncPushLoading = false,
}) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const boughtCount = groceryItems.filter((item) => item.is_bought).length;
  const pendingCount = groceryItems.length - boughtCount;
  const activeList = groceryLists.find((list) => list.id === activeGroceryListId);
  const wsConnected = groceryWsState === "connected";
  const syncMode = groceryCollaboration?.mode || "polling";
  const openLists = Number(groceryCollaboration?.open_lists || 0);

  return (
    <section className="panel settings-panel settings-smart finance-smart grocery-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("groceryTitle")}</p>
          <h2>{t("groceryTitle")}</h2>
        </div>
        <button type="button" className="btn" onClick={onRefresh}>
          {t("refresh")}
        </button>
      </div>

      <div className="settings-tabs" role="tablist">
        {GROCERY_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={groceryTab === tab}
            className={groceryTab === tab ? "settings-tab active" : "settings-tab"}
            onClick={() => setGroceryTab(tab)}
          >
            {t(`groceryTab_${tab}`)}
          </button>
        ))}
      </div>

      <div className="settings-identity grocery-identity">
        <div className={`sync-health ${pendingCount ? "warn" : "ok"}`}>
          <strong>{digits(pendingCount)}</strong>
          <span>{t("pending")}</span>
        </div>
        <div className="settings-identity-copy">
          <h3>{activeList?.title || t("selectListFirst")}</h3>
          <p className="budget-hero-sub">
            {activeGroceryListId
              ? `${t("activeList")}: ${activeList?.title || activeGroceryListId}`
              : t("selectListFirst")}
          </p>
          <div className="settings-badges">
            <TypeChip type={wsConnected ? "INCOME" : "WARN"}>WS: {groceryWsState}</TypeChip>
            <TypeChip type="TRANSFER">{syncMode}</TypeChip>
            <TypeChip type="SAVINGS">
              {digits(groceryLists.length)} {t("groceryLists")}
            </TypeChip>
          </div>
        </div>
      </div>

      <div className="settings-stat-row">
        <div className="settings-stat">
          <span>{t("groceryLists")}</span>
          <strong>{digits(groceryLists.length)}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("groceryItems")}</span>
          <strong>{digits(groceryItems.length)}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("bought")}</span>
          <strong>{digits(boughtCount)}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("pending")}</span>
          <strong>{digits(pendingCount)}</strong>
        </div>
      </div>

      {groceryTab === "lists" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("createGroceryList")}</h4>
            <div className="finance-form">
              <input
                placeholder={t("listTitle")}
                value={groceryListForm.title}
                onChange={(e) => setGroceryListForm({ ...groceryListForm, title: e.target.value })}
              />
              <input
                placeholder={t("budgetAmount")}
                value={groceryListForm.budget_amount}
                onChange={(e) => setGroceryListForm({ ...groceryListForm, budget_amount: e.target.value })}
              />
              <input
                placeholder={t("vendor")}
                value={groceryListForm.vendor_name}
                onChange={(e) => setGroceryListForm({ ...groceryListForm, vendor_name: e.target.value })}
              />
              <input
                type="date"
                value={groceryListForm.shopping_date}
                onChange={(e) => setGroceryListForm({ ...groceryListForm, shopping_date: e.target.value })}
              />
              <input
                placeholder={t("note")}
                value={groceryListForm.note}
                onChange={(e) => setGroceryListForm({ ...groceryListForm, note: e.target.value })}
              />
              <button type="button" className="btn btn-primary" onClick={onCreateList}>
                {t("createList")}
              </button>
            </div>
          </div>

          <div className="settings-block">
            <h4>{t("groceryLists")}</h4>
            {groceryLists.length === 0 ? (
              <p className="settings-empty">{t("noGroceryLists")}</p>
            ) : (
              <div className="finance-feed">
                {groceryLists.map((list) => {
                  const selected = activeGroceryListId === list.id;
                  return (
                    <div
                      className={`finance-card tx-card ${selected ? "is-savings" : "is-transfer"}`}
                      key={list.id}
                    >
                      <div className="tx-row">
                        <div className="tx-row-type budget-chip-col">
                          <TypeChip type={selected ? "SAVINGS" : "TRANSFER"}>{list.status || "OPEN"}</TypeChip>
                          <TypeChip type="LOAN">{list.vendor_name || t("noVendor")}</TypeChip>
                        </div>
                        <div className="tx-row-copy">
                          <strong>{list.title}</strong>
                          <span className="tx-row-sub">{money(list.budget_amount, list.currency)}</span>
                        </div>
                        <div className="tx-row-amount">
                          <button
                            type="button"
                            className={`btn ${selected ? "btn-primary" : ""}`}
                            onClick={() => onSelectList(list.id)}
                          >
                            {selected ? t("selected") : t("open")}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="settings-block">
            <h4>{t("addGroceryItem")}</h4>
            <div className="finance-form">
              <input
                placeholder={t("itemName")}
                value={groceryItemForm.name}
                onChange={(e) => setGroceryItemForm({ ...groceryItemForm, name: e.target.value })}
              />
              <input
                placeholder={t("category")}
                value={groceryItemForm.category}
                onChange={(e) => setGroceryItemForm({ ...groceryItemForm, category: e.target.value })}
              />
              <input
                placeholder={t("qty")}
                value={groceryItemForm.quantity}
                onChange={(e) => setGroceryItemForm({ ...groceryItemForm, quantity: e.target.value })}
              />
              <input
                placeholder={t("unit")}
                value={groceryItemForm.unit}
                onChange={(e) => setGroceryItemForm({ ...groceryItemForm, unit: e.target.value })}
              />
              <input
                placeholder={t("estimatedPrice")}
                value={groceryItemForm.estimated_price}
                onChange={(e) => setGroceryItemForm({ ...groceryItemForm, estimated_price: e.target.value })}
              />
              <input
                placeholder={t("actualPrice")}
                value={groceryItemForm.actual_price}
                onChange={(e) => setGroceryItemForm({ ...groceryItemForm, actual_price: e.target.value })}
              />
              <input
                placeholder={t("vendor")}
                value={groceryItemForm.vendor_name}
                onChange={(e) => setGroceryItemForm({ ...groceryItemForm, vendor_name: e.target.value })}
              />
              <input
                placeholder={t("barcode")}
                value={groceryItemForm.barcode}
                onChange={(e) => setGroceryItemForm({ ...groceryItemForm, barcode: e.target.value })}
              />
              <input
                placeholder={t("note")}
                value={groceryItemForm.note}
                onChange={(e) => setGroceryItemForm({ ...groceryItemForm, note: e.target.value })}
              />
              <button type="button" className="btn btn-primary" disabled={!activeGroceryListId} onClick={onCreateItem}>
                {t("addItem")}
              </button>
            </div>
          </div>

          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("groceryItems")}</h4>
                <p className="budget-hero-sub" style={{ margin: 0 }}>
                  {digits(boughtCount)} {t("bought")} · {digits(pendingCount)} {t("pending")}
                </p>
              </div>
            </div>
            <div className="finance-form" style={{ marginBottom: 12 }}>
              <select
                value={groceryExpenseForm.account_id}
                onChange={(e) => setGroceryExpenseForm({ ...groceryExpenseForm, account_id: e.target.value })}
              >
                <option value="">{t("selectPaymentWallet")}</option>
                {wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.name} — {money(wallet.current_balance ?? wallet.balance, wallet.currency)}
                  </option>
                ))}
              </select>
              <select
                value={groceryExpenseForm.category_id}
                onChange={(e) => setGroceryExpenseForm({ ...groceryExpenseForm, category_id: e.target.value })}
              >
                <option value="">{t("selectExpenseCategory")}</option>
                {categories
                  .filter((category) => category.category_type === "EXPENSE")
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
            </div>

            {groceryItems.length === 0 ? (
              <p className="settings-empty">{t("noGroceryItems")}</p>
            ) : (
              <div className="finance-feed">
                {groceryItems.map((item) => {
                  const bought = Boolean(item.is_bought);
                  return (
                    <div
                      className={`finance-card finance-card-stack budget-card ${bought ? "is-savings" : "is-loan"}`}
                      key={item.id}
                    >
                      <div className="tx-row budget-row-head">
                        <div className="tx-row-type">
                          <TypeChip type={bought ? "INCOME" : "WARN"}>
                            {bought ? t("bought") : t("pending")}
                          </TypeChip>
                        </div>
                        <div className="tx-row-copy">
                          <strong>{item.name}</strong>
                          <span className="tx-row-sub">
                            {qtyLabel(item.quantity, item.unit, digits)}
                            {item.barcode ? ` · ${item.barcode}` : ""}
                            {item.vendor_name ? ` · ${item.vendor_name}` : ""}
                          </span>
                        </div>
                        <div className="tx-row-amount">
                          <MoneyPill tone={bought ? "savings" : "loan"}>
                            {money(item.actual_price || item.estimated_price)}
                          </MoneyPill>
                        </div>
                      </div>
                      <div className="finance-actions">
                        {!bought ? (
                          <button type="button" className="btn btn-primary" onClick={() => onMarkBought(item)}>
                            {t("markBought")}
                          </button>
                        ) : null}
                        {bought && !item.posted_transaction_id ? (
                          <button type="button" className="btn" onClick={() => onPostExpense(item)}>
                            {t("postExpense")}
                          </button>
                        ) : null}
                        {item.posted_transaction_id ? (
                          <TypeChip type="INCOME">{t("expensePosted")}</TypeChip>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {groceryTab === "scan" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("barcodeLookup")}</h4>
            <div className="finance-form" style={{ marginBottom: 12 }}>
              <button type="button" className="btn btn-primary" onClick={() => setScannerOpen(true)}>
                {t("openCameraScanner") || "Open camera scanner"}
              </button>
            </div>
            <GroceryBarcodeCamera
              open={scannerOpen}
              onClose={() => setScannerOpen(false)}
              onScanned={(code) => {
                setGroceryScanForm({ ...groceryScanForm, barcode: code });
                setScannerOpen(false);
              }}
              t={t}
            />
            <div className="finance-form">
              <input
                placeholder={t("barcode")}
                value={groceryScanForm.barcode}
                onChange={(e) => setGroceryScanForm({ ...groceryScanForm, barcode: e.target.value })}
              />
              <button type="button" className="btn btn-primary" onClick={onLookupBarcode}>
                {t("lookupBarcode")}
              </button>
              {groceryBarcodeLookup?.found ? (
                <button type="button" className="btn" onClick={onApplyBarcode}>
                  {t("applyToItemForm")}
                </button>
              ) : null}
            </div>
            {groceryBarcodeLookup ? (
              <div className="finance-feed" style={{ marginTop: 12 }}>
                <div className={`finance-card tx-card ${groceryBarcodeLookup.found ? "is-savings" : "is-loan"}`}>
                  <div className="tx-row">
                    <div className="tx-row-type">
                      <TypeChip type={groceryBarcodeLookup.found ? "SAVINGS" : "WARN"}>
                        {groceryBarcodeLookup.found ? t("found") : t("noBarcodeMatch")}
                      </TypeChip>
                    </div>
                    <div className="tx-row-copy">
                      <strong>{groceryBarcodeLookup.barcode}</strong>
                      <span className="tx-row-sub">
                        {groceryBarcodeLookup.found
                          ? groceryBarcodeLookup.latest?.name || t("found")
                          : t("noBarcodeMatch")}
                      </span>
                    </div>
                    {groceryBarcodeLookup.found ? (
                      <div className="tx-row-amount">
                        <MoneyPill tone="savings">
                          {money(
                            groceryBarcodeLookup.latest?.actual_price ||
                              groceryBarcodeLookup.latest?.estimated_price
                          )}
                        </MoneyPill>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {groceryBarcodeLookup?.history?.length > 0 ? (
              <div className="finance-feed" style={{ marginTop: 10 }}>
                {groceryBarcodeLookup.history.slice(0, 5).map((row) => (
                  <div className="finance-card tx-card is-transfer" key={row.id}>
                    <div className="tx-row">
                      <div className="tx-row-type">
                        <TypeChip type="TRANSFER">{row.vendor_name || t("noVendor")}</TypeChip>
                      </div>
                      <div className="tx-row-copy">
                        <strong>{row.name}</strong>
                      </div>
                      <div className="tx-row-amount">
                        <MoneyPill>{money(row.actual_price || row.estimated_price)}</MoneyPill>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="settings-block">
            <h4>{t("ocrReceiptParse")}</h4>
            <div className="finance-form">
              <textarea
                placeholder={t("ocrPlaceholder")}
                value={groceryScanForm.raw_text}
                onChange={(e) => setGroceryScanForm({ ...groceryScanForm, raw_text: e.target.value })}
                style={{ gridColumn: "1 / -1", minHeight: 96 }}
              />
              <button type="button" className="btn btn-primary" onClick={onParseOcr}>
                {t("parseReceipt")}
              </button>
              <label className="btn settings-upload">
                {t("parseReceiptImage")}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onParseOcrImage?.(file);
                    e.target.value = "";
                  }}
                />
              </label>
              {groceryOcrPreview?.suggestions?.length > 0 ? (
                <button type="button" className="btn" disabled={!activeGroceryListId} onClick={onAddAllOcrSuggestions}>
                  {t("addAllToList")}
                </button>
              ) : null}
            </div>
            <p className="settings-help">{t("ocrImageHint")}</p>
            {groceryOcrPreview?.suggestions?.length > 0 ? (
              <div className="finance-feed" style={{ marginTop: 12 }}>
                {groceryOcrPreview.suggestions.slice(0, 10).map((suggestion) => (
                  <div className="finance-card tx-card is-savings" key={suggestion.raw_line}>
                    <div className="tx-row">
                      <div className="tx-row-type">
                        <TypeChip type="TRANSFER">
                          {qtyLabel(suggestion.quantity, suggestion.unit, digits)}
                        </TypeChip>
                      </div>
                      <div className="tx-row-copy">
                        <strong>{suggestion.name}</strong>
                      </div>
                      <div className="tx-row-amount" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <MoneyPill tone="savings">{money(suggestion.estimated_price)}</MoneyPill>
                        <button
                          type="button"
                          className="btn"
                          disabled={!activeGroceryListId}
                          onClick={() => onAddOcrSuggestion(suggestion)}
                        >
                          {t("addItem")}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="settings-empty">{t("noOcrSuggestions")}</p>
            )}
          </div>
        </div>
      ) : null}

      {groceryTab === "vendors" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("vendorMaster")}</h4>
            <div className="finance-form">
              <input
                placeholder={t("vendor")}
                value={groceryVendorForm.name}
                onChange={(e) => setGroceryVendorForm({ ...groceryVendorForm, name: e.target.value })}
              />
              <input
                placeholder={t("phone")}
                value={groceryVendorForm.phone}
                onChange={(e) => setGroceryVendorForm({ ...groceryVendorForm, phone: e.target.value })}
              />
              <input
                placeholder={t("address")}
                value={groceryVendorForm.address}
                onChange={(e) => setGroceryVendorForm({ ...groceryVendorForm, address: e.target.value })}
              />
              <input
                placeholder={t("category")}
                value={groceryVendorForm.category}
                onChange={(e) => setGroceryVendorForm({ ...groceryVendorForm, category: e.target.value })}
              />
              <input
                placeholder={t("note")}
                value={groceryVendorForm.note}
                onChange={(e) => setGroceryVendorForm({ ...groceryVendorForm, note: e.target.value })}
              />
              <button type="button" className="btn btn-primary" onClick={onCreateVendor}>
                {t("createVendor")}
              </button>
            </div>
            {groceryVendors.length === 0 ? (
              <p className="settings-empty">{t("noVendors")}</p>
            ) : (
              <div className="finance-feed" style={{ marginTop: 12 }}>
                {groceryVendors.map((vendor) => (
                  <div className="finance-card tx-card is-transfer" key={vendor.id}>
                    <div className="tx-row">
                      <div className="tx-row-type budget-chip-col">
                        <TypeChip type={vendor.is_active ? "INCOME" : "WARN"}>
                          {vendor.is_active ? t("active") : t("inactive")}
                        </TypeChip>
                        <TypeChip type="TRANSFER">{vendor.category}</TypeChip>
                      </div>
                      <div className="tx-row-copy">
                        <strong>{vendor.name}</strong>
                        <span className="tx-row-sub">{vendor.phone || t("noPhone")}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="settings-block">
            <h4>{t("vendorSummary")}</h4>
            {groceryVendorSummary.length === 0 ? (
              <p className="settings-empty">{t("noVendorSpending")}</p>
            ) : (
              <div className="finance-feed">
                {groceryVendorSummary.slice(0, 8).map((vendor) => (
                  <div className="finance-card tx-card is-loan" key={vendor.vendor_name}>
                    <div className="tx-row">
                      <div className="tx-row-type">
                        <TypeChip type="LOAN">
                          {digits(vendor.bought_count)} {t("bought")}
                        </TypeChip>
                      </div>
                      <div className="tx-row-copy">
                        <strong>{vendor.vendor_name}</strong>
                      </div>
                      <div className="tx-row-amount">
                        <MoneyPill tone="loan">{money(vendor.total_spent)}</MoneyPill>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="settings-block">
            <h4>{t("priceHistory")}</h4>
            {groceryPriceHistory.length === 0 ? (
              <p className="settings-empty">{t("noPriceHistory")}</p>
            ) : (
              <div className="finance-feed">
                {groceryPriceHistory.slice(0, 8).map((entry) => (
                  <div className="finance-card tx-card is-savings" key={entry.id}>
                    <div className="tx-row">
                      <div className="tx-row-type">
                        <TypeChip type="TRANSFER">{entry.vendor_name || t("noVendor")}</TypeChip>
                      </div>
                      <div className="tx-row-copy">
                        <strong>{entry.name}</strong>
                      </div>
                      <div className="tx-row-amount">
                        <MoneyPill tone="savings">{money(entry.actual_price)}</MoneyPill>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {groceryTab === "collab" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <div className="settings-stat-row" style={{ margin: 0 }}>
              <div className="settings-stat">
                <span>{t("syncMode")}</span>
                <strong>{syncMode}</strong>
                <small>
                  {t("realtime")}: {groceryCollaboration?.realtime_transport || "not_enabled"}
                </small>
              </div>
              <div className="settings-stat">
                <span>WebSocket</span>
                <strong>
                  <TypeChip type={wsConnected ? "INCOME" : "WARN"}>{groceryWsState}</TypeChip>
                </strong>
                <small>subs {digits(groceryCollaboration?.subscribers || 0)}</small>
              </div>
              <div className="settings-stat">
                <span>{t("openLists")}</span>
                <strong>{digits(openLists)}</strong>
                <small>
                  {t("pending")}: {digits(groceryCollaboration?.pending_items || 0)}
                </small>
              </div>
              <div className="settings-stat">
                <span>{t("activity")}</span>
                <strong>{digits(groceryActivity.length)}</strong>
                <small>
                  <button type="button" className="btn" onClick={onRefresh}>
                    {t("refresh")}
                  </button>
                </small>
              </div>
            </div>
            <p className="grocery-ws-path">
              {groceryCollaboration?.websocket_path || "/grocery/ws/{family_id}"}
            </p>
          </div>

          <div className="settings-block">
            <h4>{t("activity")}</h4>
            {groceryActivity.length === 0 ? (
              <p className="settings-empty">{t("noGroceryActivity")}</p>
            ) : (
              <div className="finance-feed">
                {groceryActivity.slice(0, 12).map((activity) => (
                  <div className="finance-card tx-card is-transfer" key={activity.id}>
                    <div className="tx-row">
                      <div className="tx-row-type budget-chip-col">
                        <TypeChip type="TRANSFER">{activity.action_type || "ACTION"}</TypeChip>
                        <TypeChip type="SAVINGS">{activity.entity_type || "ENTITY"}</TypeChip>
                      </div>
                      <div className="tx-row-copy">
                        <strong>{activity.title || t("activity")}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {groceryTab === "offline" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("groceryTab_offline") || "Offline"}</h4>
                <p>
                  {t("localPendingOutbox") || "Local pending"}: {digits(localOutboxPending)} ·{" "}
                  {t("groceryPendingSync") || "Grocery queue"}: {digits(groceryPendingRows.length)}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={syncPushLoading || !onReplayPendingSync}
                onClick={onReplayPendingSync}
              >
                {syncPushLoading
                  ? t("pushingOutbox") || "Pushing..."
                  : t("replayPendingSync") || "Replay pending sync"}
              </button>
            </div>
          </div>

          <div className="settings-block">
            <h4>{t("pendingGroceryOutbox") || "Pending grocery outbox"}</h4>
            {groceryPendingRows.length === 0 ? (
              <p className="settings-empty">{t("noOfflineQueue") || "No pending grocery sync rows"}</p>
            ) : (
              <div className="finance-feed">
                {groceryPendingRows.map((row) => (
                  <div className="finance-card tx-card is-transfer" key={row.id}>
                    <div className="tx-row">
                      <div className="tx-row-type budget-chip-col">
                        <TypeChip type="TRANSFER">{row.operation || "UPSERT"}</TypeChip>
                        <TypeChip type="SAVINGS">{row.entity_type || "grocery"}</TypeChip>
                      </div>
                      <div className="tx-row-copy">
                        <strong>{row.entity_id || row.client_change_id || row.id}</strong>
                        <span className="tx-row-sub">
                          {row.created_at || row.last_error || t("pending")}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
