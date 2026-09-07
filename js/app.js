import { api, ApiError } from "./api.js";
import { config } from "./config.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ── helpers ─────────────────────────────────────────────────

// chestbox stores amounts as bigint minor units, and a "points" wallet counts
// whole points rather than hundredths. Showing the raw minor value with a
// thousands separator avoids implying a currency scale that may not apply.
const minor = (n) => Number(n).toLocaleString();

const when = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

let toastTimer;
function toast(msg, kind = "ok") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast toast-${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 4200);
}

function fail(e) {
  const msg = e instanceof ApiError ? `${e.status || ""} ${e.message}`.trim() : e.message;
  toast(msg, "err");
  console.error(e);
}

function emptyState(container, msg) {
  container.replaceChildren(el("div", "empty", msg));
}

// <input type="datetime-local"> has no timezone; chestbox wants RFC3339.
const toIso = (v) => (v ? new Date(v).toISOString() : undefined);
const localNow = (offsetMs = 0) => {
  const d = new Date(Date.now() + offsetMs - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

const freshKey = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ── health ──────────────────────────────────────────────────

async function checkHealth() {
  const pill = $("#health-pill");
  pill.textContent = "checking…";
  pill.className = "pill pill-stub";
  try {
    // Both health endpoints — the second is what proves the DB pool is alive.
    await api.health();
    await api.databaseHealth();
    pill.textContent = "chestbox + db ok";
    pill.className = "pill pill-live";
  } catch (e) {
    pill.textContent = e.status ? `unhealthy (${e.status})` : "unreachable";
    pill.className = "pill pill-stub";
  }
}

$("#health-pill").addEventListener("click", checkHealth);

// ── tabs ────────────────────────────────────────────────────

function activateTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
  $$(".panel").forEach((p) => p.classList.toggle("is-active", p.id === `tab-${name}`));
}
$$(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    activateTab(tab.dataset.tab);
    if (tab.dataset.tab === "history") loadTreasuryHistory();
  }),
);

// ── settings ────────────────────────────────────────────────

const dialog = $("#settings");

$("#open-settings").addEventListener("click", () => {
  const f = $("#settings-form");
  f.baseUrl.value = config.baseUrl;
  f.adminKey.value = config.adminKey;
  f.proxy.checked = config.proxy;
  dialog.showModal();
});

$("#settings-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const f = e.target;
  config.baseUrl = f.baseUrl.value.trim().replace(/\/$/, "");
  config.adminKey = f.adminKey.value;
  config.proxy = f.proxy.checked;
  toast("Settings saved");
  checkHealth();
});

// ── wallets ─────────────────────────────────────────────────

function statRow(container, stats) {
  container.replaceChildren();
  for (const [label, value] of stats) {
    const s = el("div", "stat");
    s.append(el("div", "stat-label", label), el("div", "stat-value", value));
    container.append(s);
  }
}

// ── customers ───────────────────────────────────────────────
//
// The main list: one GET /wallets?entityId= call. entityId scopes to that
// entity's customer wallets, so this is the customer roster without any
// per-row fetching. Balances are deliberately NOT loaded here — a row loads
// its own balance and history only when it is opened.
//
// The console is pointed at ONE merchant, so the entity is fixed here rather
// than chosen in the UI. Change it in this one place to repoint the board.
const ENTITY = { entityType: "merchant", entityId: "merchant-001" };
const CUSTOMER_PAGE_SIZE = 30;

// Keyset cursor stack: cursors[i] is the {before, beforeId} params to load page i.
// cursors[0] is always undefined — first page needs no cursor.
let customerCursors = [undefined];
let customerPage = 0;

// Selection state — cleared on every page navigation.
let selectedWalletIds = new Set();
let isSelectAll = false;

function updateBulkButtons() {
  const enabled = isSelectAll || selectedWalletIds.size > 0;
  $("#bulk-credit-btn").disabled = !enabled;
  $("#bulk-debit-btn").disabled = !enabled;
}

function clearSelection() {
  selectedWalletIds = new Set();
  isSelectAll = false;
  updateBulkButtons();
}

function customerTable(rows) {
  const table = el("table", "data-table");

  // Build select-all checkbox first so row checkboxes can reference it.
  const selAll = document.createElement("input");
  selAll.type = "checkbox";
  selAll.title = "Select all (fetches every page)";
  selAll.checked = isSelectAll;

  const head = el("tr");
  const thCb = el("th");
  thCb.append(selAll);
  head.append(thCb);
  for (const h of ["Customer", "Wallet id", "Status", "Unit", "Currency", "Created", ""]) {
    head.append(el("th", null, h));
  }
  table.append(el("thead").appendChild(head).parentNode);

  const tbody = el("tbody");
  const rowCbs = [];

  for (const w of rows) {
    const tr = el("tr", "data-row");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "row-cb";
    cb.checked = selectedWalletIds.has(w.id);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        selectedWalletIds.add(w.id);
      } else {
        selectedWalletIds.delete(w.id);
      }
      isSelectAll = false;
      selAll.checked = false;
      updateBulkButtons();
    });
    rowCbs.push(cb);

    const tdCb = el("td");
    tdCb.append(cb);
    tr.append(tdCb);

    tr.append(
      el("td", "mono", w.customerId ?? "—"),
      el("td", "mono muted", w.id),
      el("td").appendChild(el("span", `tag tag-${w.status}`, w.status)).parentNode,
      el("td", null, w.walletType),
      el("td", null, w.currency),
      el("td", "muted", when(w.createdAt)),
    );

    const actions = el("td");
    const open = el("button", "btn btn-sm", "Open");
    open.addEventListener("click", () => loadCustomerDetail(w));
    actions.append(open);
    tr.append(actions);

    tbody.append(tr);
  }

  selAll.addEventListener("change", () => {
    isSelectAll = selAll.checked;
    selectedWalletIds.clear();
    rowCbs.forEach(cb => { cb.checked = selAll.checked; });
    updateBulkButtons();
  });

  table.append(tbody);
  return table;
}

// ── customer detail ─────────────────────────────────────────

const DETAIL_PAGE_SIZE = 20;
let detailCursor = { walletId: null, before: null, beforeId: null };

function appendDetailEntries(entries) {
  const listEl = $("#customer-detail-entries");
  for (const en of entries) {
    const row = el("div", "entry");
    const sign = en.direction === "credit" ? "+" : "−";
    row.append(el("div", `entry-amount entry-${en.direction}`, `${sign}${minor(en.amountMinor)}`));
    const body = el("div", "entry-body");
    body.append(el("div", "entry-src", en.sourceType ?? en.direction));
    const bits = [when(en.createdAt)];
    if (en.direction === "credit") {
      if (en.expiresAt) {
        const expired = new Date(en.expiresAt) < new Date();
        bits.push(expired ? `EXPIRED ${when(en.expiresAt)}` : `expires ${when(en.expiresAt)}`);
      } else {
        bits.push("never expires");
      }
    }
    body.append(el("div", "entry-sub", bits.join(" · ")));
    row.append(body);
    listEl.append(row);
  }
}

async function loadCustomerDetail(w) {
  detailCursor = { walletId: w.id, before: null, beforeId: null };
  $("#customer-detail-title").textContent = w.customerId ?? w.id;
  $("#customer-detail-balance").replaceChildren();
  $("#customer-detail-entries").replaceChildren(el("div", "muted", "loading…"));
  $("#customer-detail-more").classList.add("hidden");
  activateTab("customer");

  try {
    const [bal, entries] = await Promise.all([
      api.getBalance(w.id),
      api.listEntries({ walletId: w.id, limit: DETAIL_PAGE_SIZE }),
    ]);

    const pending = Number(bal.availableMinor) - Number(bal.redeemableMinor);
    statRow($("#customer-detail-balance"), [
      ["Available", minor(bal.availableMinor)],
      ["Redeemable", minor(bal.redeemableMinor)],
      ["Pending", minor(pending)],
    ]);

    $("#customer-detail-entries").replaceChildren();
    if (!entries.length) {
      emptyState($("#customer-detail-entries"), "No ledger activity for this wallet.");
    } else {
      appendDetailEntries(entries);
      if (entries.length === DETAIL_PAGE_SIZE) {
        const last = entries[entries.length - 1];
        detailCursor.before = last.createdAt;
        detailCursor.beforeId = last.id;
        $("#customer-detail-more").classList.remove("hidden");
      }
    }
  } catch (err) {
    emptyState($("#customer-detail-entries"), err.message);
    fail(err);
  }
}

$("#customer-back").addEventListener("click", () => activateTab("wallets"));

$("#customer-detail-more").addEventListener("click", async () => {
  try {
    const entries = await api.listEntries({
      walletId: detailCursor.walletId,
      limit: DETAIL_PAGE_SIZE,
      before: detailCursor.before,
      beforeId: detailCursor.beforeId,
    });
    appendDetailEntries(entries);
    if (entries.length === DETAIL_PAGE_SIZE) {
      const last = entries[entries.length - 1];
      detailCursor.before = last.createdAt;
      detailCursor.beforeId = last.id;
    } else {
      $("#customer-detail-more").classList.add("hidden");
    }
  } catch (err) {
    fail(err);
  }
});

function updateCustomerPagination(hasPrev, hasNext) {
  $("#customer-prev").disabled = !hasPrev;
  $("#customer-next").disabled = !hasNext;
  $("#customer-page-info").textContent = `Page ${customerPage + 1}`;
  $("#customer-pagination").classList.toggle("hidden", !hasPrev && !hasNext);
}

async function loadCustomerPage() {
  clearSelection();
  const cursor = customerCursors[customerPage];
  const params = { ...ENTITY, limit: CUSTOMER_PAGE_SIZE, ...cursor };
  const host = $("#customer-table");
  try {
    const rows = await api.listWallets(params);
    if (!rows.length && customerPage === 0) {
      emptyState(host, `No customer wallets for ${ENTITY.entityType}:${ENTITY.entityId}`);
      updateCustomerPagination(false, false);
      return;
    }
    const hasNext = rows.length === CUSTOMER_PAGE_SIZE;
    // Cursor is derived from the last row in the API's natural order (newest-first)
    // before client-side sorting, so the (createdAt, id) pair is consistent with
    // what the backend expects.
    if (hasNext) {
      const last = rows[rows.length - 1];
      customerCursors[customerPage + 1] = { before: last.createdAt, beforeId: last.id };
    } else {
      customerCursors = customerCursors.slice(0, customerPage + 1);
    }
    const sorted = [...rows].sort((a, b) =>
      String(a.customerId ?? "").localeCompare(String(b.customerId ?? "")),
    );
    host.replaceChildren(customerTable(sorted));
    updateCustomerPagination(customerPage > 0, hasNext);
  } catch (err) {
    emptyState(host, err.message);
    fail(err);
    updateCustomerPagination(customerPage > 0, false);
  }
}

async function loadCustomers() {
  customerPage = 0;
  customerCursors = [undefined];
  await loadCustomerPage();
}


$("#customer-prev").addEventListener("click", async () => {
  if (customerPage <= 0) return;
  customerPage--;
  await loadCustomerPage();
});

$("#customer-next").addEventListener("click", async () => {
  if (!customerCursors[customerPage + 1]) return;
  customerPage++;
  await loadCustomerPage();
});

// ── bulk credit / debit ──────────────────────────────────────

async function fetchAllCustomerWallets() {
  const all = [];
  let cursor = {};
  while (true) {
    const rows = await api.listWallets({ ...ENTITY, limit: 200, ...cursor });
    all.push(...rows);
    if (rows.length < 200) break;
    const last = rows[rows.length - 1];
    cursor = { before: last.createdAt, beforeId: last.id };
  }
  return all;
}

async function runBulk(direction) {
  if (!treasuryWalletId) return toast("Create a treasury first", "err");
  const amount = Number($("#bulk-amount").value);
  if (!amount || amount < 1) return toast("Enter a valid amount", "err");

  const btns = [$("#bulk-credit-btn"), $("#bulk-debit-btn")];
  btns.forEach(b => { b.disabled = true; });

  const activeAt = toIso($("#bulk-active-at").value);
  if (!activeAt) return toast("Set an active-from date", "err");

  try {
    const customers = isSelectAll
      ? await fetchAllCustomerWallets()
      : [...selectedWalletIds].map(id => ({ id }));
    if (!customers.length) return toast("No customer wallets found", "err");

    const runId = freshKey("bulk");
    const batchTag = runId;

    const results = await Promise.allSettled(customers.map(async (cw) => {
      const key = `${runId}-${cw.id}`;
      if (direction === "credit") {
        // Debit treasury first — if this fails the customer never gets credited.
        await api.debit({
          walletId: treasuryWalletId,
          amountMinor: amount,
          sourceType: "manual",
          idempotencyKey: `debit-treasury-${key}`,
          actorId: "dashboard",
          reason: runId,
        });
        await api.credit({
          walletId: cw.id,
          amountMinor: amount,
          sourceType: "manual",
          idempotencyKey: `credit-${key}`,
          actorId: "dashboard",
          reason: "bulk distribute",
          ruleId: batchTag,
          activeAt,
        });
      } else {
        // Debit customer first — if this fails the treasury is untouched.
        await api.debit({
          walletId: cw.id,
          amountMinor: amount,
          sourceType: "manual",
          idempotencyKey: `debit-${key}`,
          actorId: "dashboard",
          reason: runId,
        });
        await api.credit({
          walletId: treasuryWalletId,
          amountMinor: amount,
          sourceType: "manual",
          idempotencyKey: `credit-treasury-${key}`,
          actorId: "dashboard",
          reason: runId,
          activeAt,
        });
      }
    }));

    const failed = results.filter(r => r.status === "rejected").length;
    const ok = results.length - failed;

    toast(
      failed === 0
        ? `${direction === "credit" ? "Credited" : "Debited"} ${ok} wallets`
        : `${ok} succeeded, ${failed} failed`,
      failed === 0 ? "ok" : "err",
    );
    await loadTreasuryBalance();
  } catch (err) {
    fail(err);
  } finally {
    btns.forEach(b => { b.disabled = false; });
  }
}

$("#bulk-credit-btn").addEventListener("click", () => runBulk("credit"));
$("#bulk-debit-btn").addEventListener("click", () => runBulk("debit"));

const treasuryCreditDialog = $("#treasury-credit-dialog");

$("#open-treasury-credit").addEventListener("click", () => {
  const f = $("#treasury-credit-form");
  f.reset();
  f.activeAt.value = localNow();
  treasuryCreditDialog.showModal();
});

$("#treasury-credit-form").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "credit") return;
  if (!treasuryWalletId) return toast("No treasury wallet yet", "err");
  const f = e.target;
  const amount = Number(f.amount.value);
  const activeAt = toIso(f.activeAt.value);
  try {
    await api.credit({
      walletId: treasuryWalletId,
      amountMinor: amount,
      sourceType: "manual",
      idempotencyKey: freshKey("treasury-credit"),
      actorId: "dashboard",
      reason: "manual top-up",
      activeAt,
    });
    toast(`Treasury credited ${minor(amount)}`);
    await loadTreasuryBalance();
  } catch (err) {
    fail(err);
  }
});

const createWalletDialog = $("#create-wallet-dialog");

let treasuryWalletId = null;

async function loadTreasuryBalance() {
  const el = $("#treasury-amount");
  if (!treasuryWalletId) { el.textContent = "0"; return; }
  try {
    const bal = await api.getBalance(treasuryWalletId);
    el.textContent = minor(bal.availableMinor);
  } catch {
    el.textContent = "—";
  }
}

async function checkTreasury() {
  try {
    const wallets = await api.listWallets({ entityType: ENTITY.entityType, limit: 200 });
    const treasury = wallets.find(w => w.entityId === ENTITY.entityId && w.campaignId);
    if (treasury) treasuryWalletId = treasury.id;
    $("#open-create-wallet").classList.toggle("hidden", !!treasury);
  } catch {
    // leave button visible if the check fails
  }
  await loadTreasuryBalance();
}

$("#open-create-wallet").addEventListener("click", () => {
  $("#wallet-create").reset();
  createWalletDialog.showModal();
});

$("#wallet-create").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "create") return;
  const f = e.target;
  const campaignId = f.campaignId.value.trim();
  const amount = Number(f.amount.value);

  try {
    const w = await api.createWallet({
      entityType: ENTITY.entityType,
      entityId: ENTITY.entityId,
      currency: "INR",
      walletType: "points",
      campaignId,
      priority: 1,
    });
    await api.credit({
      walletId: w.id,
      amountMinor: amount,
      sourceType: "manual",
      idempotencyKey: `treasury-seed-${w.id}`,
      actorId: "dashboard",
      reason: "treasury creation",
      activeAt: new Date().toISOString(),
    });
    toast(`Treasury created`);
    treasuryWalletId = w.id;
    $("#open-create-wallet").classList.add("hidden");
    await Promise.all([loadTreasuryBalance(), loadCustomers()]);
  } catch (err) {
    fail(err);
  }
});

// ── ledger history ──────────────────────────────────────────

const HISTORY_PAGE_SIZE = 20;
let historyEntries = [];

// Only group entries whose reason is a bulk runId (bulk_<base36><random>)
const isBulkRunId = (r) => typeof r === "string" && /^bulk_[0-9a-z]+$/.test(r);

function groupHistoryEntries(entries) {
  const seen = new Map(); // runId -> group index
  const groups = [];

  for (const en of entries) {
    const key = isBulkRunId(en.reason) ? en.reason : null;
    if (key && seen.has(key)) {
      const g = groups[seen.get(key)];
      g._count++;
      g._total += Number(en.amountMinor);
    } else {
      const idx = groups.length;
      groups.push({ ...en, _count: 1, _total: Number(en.amountMinor) });
      if (key) seen.set(key, idx);
    }
  }
  return groups;
}

function renderHistoryList() {
  const listEl = $("#history-list");
  listEl.replaceChildren();
  for (const en of groupHistoryEntries(historyEntries)) {
    const row = el("div", "entry");
    const sign = en.direction === "credit" ? "+" : "−";
    const displayAmount = en._count > 1 ? en._total : Number(en.amountMinor);
    row.append(el("div", `entry-amount entry-${en.direction}`, `${sign}${minor(displayAmount)}`));
    const body = el("div", "entry-body");
    const label = en._count > 1
      ? `${en.sourceType ?? en.direction} · ${en._count} entries × ${minor(en.amountMinor)}`
      : (en.sourceType ?? en.direction);
    body.append(el("div", "entry-src", label));
    const bits = [when(en.createdAt)];
    if (en.direction === "credit") {
      if (en.expiresAt) {
        const expired = new Date(en.expiresAt) < new Date();
        bits.push(expired ? `EXPIRED ${when(en.expiresAt)}` : `expires ${when(en.expiresAt)}`);
      } else {
        bits.push("never expires");
      }
    }
    body.append(el("div", "entry-sub", bits.join(" · ")));
    row.append(body);
    listEl.append(row);
  }
}

async function loadTreasuryHistory() {
  const listEl = $("#history-list");
  const summaryEl = $("#history-summary");

  if (!treasuryWalletId) {
    emptyState(listEl, "No treasury wallet — create one first.");
    return;
  }

  historyEntries = [];
  listEl.replaceChildren(el("div", "muted", "loading…"));
  summaryEl.replaceChildren();

  try {
    const balance = await api.getBalance(treasuryWalletId);
    const pending = Number(balance.availableMinor) - Number(balance.redeemableMinor);
    statRow(summaryEl, [
      ["Available", minor(balance.availableMinor)],
      ["Redeemable", minor(balance.redeemableMinor)],
      ["Pending", minor(pending)],
    ]);

    // Fetch all pages so grouping sees the complete set at once
    let cursor = { before: null, beforeId: null };
    while (true) {
      const entries = await api.listEntries({
        walletId: treasuryWalletId,
        limit: HISTORY_PAGE_SIZE,
        before: cursor.before,
        beforeId: cursor.beforeId,
      });
      historyEntries.push(...entries);
      if (entries.length < HISTORY_PAGE_SIZE) break;
      const last = entries[entries.length - 1];
      cursor = { before: last.createdAt, beforeId: last.id };
    }

    if (!historyEntries.length) {
      emptyState(listEl, "No ledger entries for this treasury.");
      return;
    }

    renderHistoryList();
  } catch (err) {
    fail(err);
    emptyState(listEl, "Could not load history.");
  }
}

// ── boot ────────────────────────────────────────────────────

$("#bulk-active-at").value = localNow();
checkHealth();
checkTreasury();
loadCustomers();
