import { api, ApiError, usingStubs } from "./api.js";
import { config, IMPLEMENTED } from "./config.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ── helpers ─────────────────────────────────────────────────

// Amounts are bigint minor units everywhere in chestbox. Divide only for
// display, never for arithmetic.
const money = (minor) =>
  (minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });

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

function stubBanner(area) {
  if (!usingStubs(area)) return null;
  const why = !config.live
    ? "Live mode is off."
    : `The ${area} endpoints are not shipped yet.`;
  return el("div", "banner banner-warn", `${why} Showing sample data.`);
}

// ── mode indicator ──────────────────────────────────────────

function refreshMode() {
  const pill = $("#mode-pill");
  const live = config.live;
  pill.textContent = live ? "live" : "stubbed";
  pill.className = `pill ${live ? "pill-live" : "pill-stub"}`;
}

// ── tabs ────────────────────────────────────────────────────

function activateTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
  $$(".panel").forEach((p) => p.classList.toggle("is-active", p.id === `tab-${name}`));
}

$$(".tab").forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));

// Jump to History pre-filled with a wallet id and load it — the "view this
// wallet's ledger" action every card offers, same as lighthouse's pool ledger
// and per-customer transaction table each being one click from their balance.
function goToHistory(walletId) {
  activateTab("history");
  $("#history-form").walletId.value = walletId;
  historyPanel.load(walletId);
}

// ── settings ────────────────────────────────────────────────

const dialog = $("#settings");

$("#open-settings").addEventListener("click", () => {
  const f = $("#settings-form");
  f.merchantId.value = config.merchantId;
  f.baseUrl.value = config.baseUrl;
  f.adminKey.value = config.adminKey;
  f.live.checked = config.live;
  f.proxy.checked = config.proxy;

  const status = $("#impl-status");
  status.replaceChildren(
    ...Object.entries(IMPLEMENTED).map(([area, done]) => {
      const row = el("div", "impl-row");
      row.append(el("span", null, area), el("span", null, done ? "live" : "stubbed"));
      return row;
    }),
  );
  dialog.showModal();
});

$("#settings-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const f = e.target;
  config.merchantId = f.merchantId.value.trim();
  config.baseUrl = f.baseUrl.value.trim().replace(/\/$/, "");
  config.adminKey = f.adminKey.value;
  config.live = f.live.checked;
  config.proxy = f.proxy.checked;
  refreshMode();
  toast("Settings saved");
});

// ── treasuries ──────────────────────────────────────────────

let treasuryCtx = { ownerId: null, campaignId: null, rows: [] };

// Guards against overlapping loads: renderTreasuries awaits a per-row balance
// fetch inside its loop, so two calls in flight at once (a fast double submit,
// or the boot-time renderTreasuries([]) racing the first real load) can finish
// out of order. Whichever call finishes last would otherwise win over whichever
// started last — bump this token per call and bail if a newer one has started.
let treasuriesToken = 0;

async function renderTreasuries(rows) {
  const token = ++treasuriesToken;
  const box = $("#treasury-list");
  box.replaceChildren();

  if (!config.live) {
    box.append(
      el(
        "div",
        "banner banner-warn",
        "Live mode is off — treasuries come from a running chestbox. Enable it in Settings.",
      ),
    );
  }
  const ledgerBanner = stubBanner("ledger");
  if (ledgerBanner) box.append(ledgerBanner);

  if (!rows.length) {
    box.append(el("div", "empty", "No treasuries for this merchant and campaign."));
    return;
  }

  const live = rows.filter((r) => !r.deletedAt);

  for (const w of rows) {
    if (token !== treasuriesToken) return;
    const card = el("div", `card${w.deletedAt ? " is-deleted" : ""}`);
    card.append(el("div", "rank", w.priority ?? "—"));

    const main = el("div", "card-main");
    main.append(el("div", "card-title", w.id));
    const meta = el("div", "card-meta");
    meta.append(
      el("span", `tag tag-${w.status}`, w.status),
      el("span", "tag", w.currency),
      el("span", "tag", w.walletType),
    );
    if (w.deletedAt) meta.append(el("span", "tag tag-closed", "deleted"));
    main.append(meta);
    card.append(main);

    // Balance, like lighthouse's pool-balance card — this is what the merchant
    // actually cares about, not just the treasury's config.
    if (!w.deletedAt) {
      const balance = await api.getBalance(w.id).catch(() => null);
      if (balance) main.append(el("div", "entry-amount", money(balance.availableMinor)));
    }

    if (!w.deletedAt) {
      const actions = el("div", "card-actions");
      const idx = live.findIndex((r) => r.id === w.id);

      const up = el("button", "btn btn-sm", "↑");
      up.disabled = idx <= 0;
      up.addEventListener("click", () => move(idx, idx - 1));

      const down = el("button", "btn btn-sm", "↓");
      down.disabled = idx === -1 || idx >= live.length - 1;
      down.addEventListener("click", () => move(idx, idx + 1));

      const hist = el("button", "btn btn-sm", "History");
      hist.addEventListener("click", () => goToHistory(w.id));

      const del = el("button", "btn btn-sm btn-danger", "Delete");
      del.addEventListener("click", () => removeTreasury(w.id));

      actions.append(up, down, hist, del);
      card.append(actions);
    }
    box.append(card);

    // Inline top-up — lighthouse's primary Home-tab action, so a treasury's
    // balance is one form away instead of a trip to the Customer tab.
    if (!w.deletedAt) {
      const topUp = el("form", "row");
      topUp.innerHTML = `
        <label>Top up<input name="amountMinor" type="number" min="1" value="1000" required /></label>
        <button class="btn btn-sm btn-primary">Add funds</button>
      `;
      topUp.addEventListener("submit", async (e) => {
        e.preventDefault();
        const amountMinor = Number(e.target.amountMinor.value);
        try {
          await api.grant({
            walletId: w.id,
            amountMinor,
            sourceType: "adjustment",
            actorId: "dashboard",
            reason: "treasury top-up",
            idempotencyKey: `dash_topup_${Date.now()}`,
          });
          toast(`Topped up ${money(amountMinor)}`);
          await loadTreasuries();
        } catch (err) {
          fail(err);
        }
      });
      box.append(topUp);
    }
  }
}

async function move(from, to) {
  const live = treasuryCtx.rows.filter((r) => !r.deletedAt);
  const order = live.map((r) => r.id);
  [order[from], order[to]] = [order[to], order[from]];
  try {
    // One call with the full new order — the reorder endpoint rejects partial
    // lists, and doing it as N single moves would collide on the unique index.
    await api.reorderPriorities(treasuryCtx.ownerId, treasuryCtx.campaignId, order);
    toast("Reordered");
    await loadTreasuries();
  } catch (e) {
    fail(e);
  }
}

async function removeTreasury(id) {
  if (!confirm("Soft-delete this treasury? It stops receiving awards but stays for audit.")) return;
  try {
    await api.deleteWallet(id);
    toast("Treasury deleted");
    await loadTreasuries();
  } catch (e) {
    fail(e);
  }
}

async function loadTreasuries() {
  const f = $("#treasury-filter");
  treasuryCtx.ownerId = config.merchantId;
  treasuryCtx.campaignId = f.campaignId.value.trim();
  try {
    const rows = await api.listWallets({
      ownerType: "merchant",
      ownerId: treasuryCtx.ownerId,
      campaignId: treasuryCtx.campaignId,
      includeDeleted: f.includeDeleted.checked || undefined,
    });
    treasuryCtx.rows = rows;
    await renderTreasuries(rows);
  } catch (e) {
    fail(e);
    emptyState($("#treasury-list"), "Could not load treasuries.");
  }
}

$("#treasury-filter").addEventListener("submit", (e) => {
  e.preventDefault();
  loadTreasuries();
});

$("#treasury-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api.createWallet({
      ownerType: "merchant",
      ownerId: config.merchantId,
      campaignId: f.campaignId.value.trim(),
      priority: Number(f.priority.value),
      currency: f.currency.value,
      walletType: f.walletType.value,
    });
    toast("Treasury created");
    f.priority.value = Number(f.priority.value) + 1;
    await loadTreasuries();
  } catch (e) {
    fail(e);
  }
});

// ── customer ────────────────────────────────────────────────
//
// Two views, like lighthouse's Customers tab + per-customer page: browse
// every customer under an owner, click one to see their wallets, balances,
// grant/revoke, and full history — instead of requiring a customer id typed
// in up front.

let customerCtx = { ownerType: "shop", ownerId: null, customerId: null };

// The owner is only ever typed in for a shop — a merchant-owned customer
// wallet belongs to this merchant, same as everywhere else on this board.
function refreshCustomerOwnerField() {
  const f = $("#customer-lookup");
  const isShop = f.ownerType.value === "shop";
  $("#customer-owner-field").classList.toggle("hidden", !isShop);
  f.ownerId.required = isShop;
}
$("#customer-lookup").ownerType.addEventListener("change", refreshCustomerOwnerField);
refreshCustomerOwnerField();

function showCustomerBrowse() {
  $("#customer-browse").classList.remove("hidden");
  $("#customer-detail").classList.add("hidden");
}

function showCustomerDetail() {
  $("#customer-browse").classList.add("hidden");
  $("#customer-detail").classList.remove("hidden");
}

// Same overlapping-call hazard as renderTreasuries above.
let customerListToken = 0;

function renderCustomerList(wallets) {
  const token = ++customerListToken;
  const box = $("#customer-list");
  box.replaceChildren();

  const banner = stubBanner("wallets");
  if (banner) box.append(banner);

  // A customer can hold more than one wallet (points + cash, say) — group by
  // customerId so the browse list shows one row per customer, not per wallet.
  const byCustomer = new Map();
  for (const w of wallets) {
    if (!w.customerId) continue;
    if (!byCustomer.has(w.customerId)) byCustomer.set(w.customerId, []);
    byCustomer.get(w.customerId).push(w);
  }

  if (!byCustomer.size) {
    box.append(
      el(
        "div",
        "empty",
        config.live ? "No customers for this owner." : "Live mode is off — customers come from a running chestbox.",
      ),
    );
    return;
  }

  for (const [customerId, rows] of byCustomer) {
    if (token !== customerListToken) return;
    const card = el("div", "card");
    const main = el("div", "card-main");
    main.append(el("div", "card-title", customerId));
    const meta = el("div", "card-meta");
    for (const w of rows) meta.append(el("span", "tag", `${w.walletType} · ${w.currency}`));
    main.append(meta);
    card.append(main);

    const actions = el("div", "card-actions");
    const view = el("button", "btn btn-sm btn-primary", "View");
    view.addEventListener("click", () => openCustomer(customerId));
    actions.append(view);
    card.append(actions);

    box.append(card);
  }
}

async function loadCustomerList() {
  const f = $("#customer-lookup");
  const isShop = f.ownerType.value === "shop";
  customerCtx.ownerType = f.ownerType.value;
  customerCtx.ownerId = isShop ? f.ownerId.value.trim() : config.merchantId;
  try {
    const wallets = await api.listWallets({
      ownerType: customerCtx.ownerType,
      ownerId: customerCtx.ownerId,
    });
    renderCustomerList(wallets);
  } catch (e) {
    fail(e);
    emptyState($("#customer-list"), "Could not load customers.");
  }
}

$("#customer-lookup").addEventListener("submit", (e) => {
  e.preventDefault();
  loadCustomerList();
});

$("#customer-back").addEventListener("click", () => {
  showCustomerBrowse();
});

// Same overlapping-call hazard as renderTreasuries above.
let customerWalletsToken = 0;

async function renderCustomerWallets(wallets) {
  const token = ++customerWalletsToken;
  const box = $("#customer-wallets");
  box.replaceChildren();

  const banner = stubBanner("ledger");
  if (banner) box.append(banner);

  if (!wallets.length) {
    box.append(el("div", "empty", "No wallets for this customer."));
    $("#customer-actions").classList.add("hidden");
    return;
  }

  const select = $("#grant-wallet");
  select.replaceChildren();

  for (const w of wallets) {
    if (token !== customerWalletsToken) return;
    const [balance, expired] = await Promise.all([
      api.getBalance(w.id).catch(() => null),
      api.getExpired(w.id).catch(() => null),
    ]);

    const card = el("div", "card");
    const main = el("div", "card-main");
    main.append(el("div", "card-title", w.id));
    const meta = el("div", "card-meta");
    meta.append(
      el("span", `tag tag-${w.status}`, w.status),
      el("span", "tag", w.currency),
      el("span", "tag", w.walletType),
    );
    if (expired && expired.expiredMinor > 0) {
      meta.append(el("span", "tag tag-warn", `${money(expired.expiredMinor)} expired`));
    }
    main.append(meta);
    card.append(main);

    if (balance) card.append(el("div", "entry-amount", money(balance.availableMinor)));

    const actions = el("div", "card-actions");
    const hist = el("button", "btn btn-sm", "History");
    hist.addEventListener("click", () => {
      select.value = w.id;
      customerHistoryPanel.load(w.id);
    });
    actions.append(hist);
    card.append(actions);

    box.append(card);

    const opt = el("option", null, `${w.walletType} · ${w.currency} · ${w.id.slice(0, 8)}…`);
    opt.value = w.id;
    select.append(opt);
  }
  $("#customer-actions").classList.remove("hidden");

  // Full history of the selected wallet is always on screen, like lighthouse's
  // per-customer transaction table — default to the first wallet.
  select.value = wallets[0].id;
  await customerHistoryPanel.load(wallets[0].id);
}

$("#grant-wallet").addEventListener("change", (e) => {
  if (e.target.value) customerHistoryPanel.load(e.target.value);
});

async function openCustomer(customerId) {
  customerCtx.customerId = customerId;
  showCustomerDetail();
  $("#customer-detail-title").textContent = `Customer ${customerId}`;
  try {
    const wallets = await api.listWallets({
      ownerType: customerCtx.ownerType,
      ownerId: customerCtx.ownerId,
      customerId,
    });
    await renderCustomerWallets(wallets);
  } catch (e) {
    fail(e);
  }
}

$("#grant-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const op = e.submitter?.value ?? "grant";
  const payload = {
    walletId: f.walletId.value,
    amountMinor: Number(f.amountMinor.value),
    // Manual dashboard actions are adjustments; the ledger requires actorId and
    // reason for this sourceType.
    sourceType: "adjustment",
    actorId: f.actorId.value.trim(),
    reason: f.reason.value.trim(),
    idempotencyKey: `dash_${op}_${Date.now()}`,
  };
  // Expiry only applies to a grant (credit); the ledger forbids it on a debit.
  // <input type="date"> gives a bare date — anchor it to end-of-day UTC so the
  // grant is redeemable through the whole day it names.
  if (op === "grant" && f.expiresAt.value) {
    payload.expiresAt = new Date(`${f.expiresAt.value}T23:59:59Z`).toISOString();
  }
  try {
    await (op === "grant" ? api.grant(payload) : api.revoke(payload));
    toast(`${op === "grant" ? "Granted" : "Revoked"} ${money(payload.amountMinor)}`);
    if (customerCtx.customerId) await openCustomer(customerCtx.customerId);
  } catch (e) {
    fail(e);
  }
});

// ── history ─────────────────────────────────────────────────
//
// One factory so the standalone History tab (any wallet id, pasted in) and
// the customer detail view's embedded "full history of the selected wallet"
// section — lighthouse's per-customer transaction table — share the exact
// same keyset-pagination logic instead of drifting apart.

const HISTORY_PAGE_SIZE = 20;

function makeHistoryPanel({ summaryEl, listEl, loadMoreEl }) {
  let cursor = { walletId: null, before: null, beforeId: null, exhausted: false };

  function appendEntryRows(entries) {
    for (const en of entries) {
      const row = el("div", "entry");
      const sign = en.direction === "credit" ? "+" : "−";
      row.append(el("div", `entry-amount entry-${en.direction}`, `${sign}${money(en.amountMinor)}`));
      const body = el("div", "entry-body");
      body.append(el("div", "entry-src", en.sourceType ?? en.direction));
      const bits = [when(en.createdAt)];
      if (en.expiresAt) bits.push(`expires ${when(en.expiresAt)}`);
      if (en.reason) bits.push(en.reason);
      body.append(el("div", "entry-sub", bits.join(" · ")));
      row.append(body);
      listEl.append(row);
    }
  }

  async function load(walletId, { append = false } = {}) {
    if (!append) {
      cursor = { walletId, before: null, beforeId: null, exhausted: false };
      listEl.replaceChildren();
      const banner = stubBanner("ledger");
      if (banner) listEl.append(banner);
    }

    try {
      const [balance, expired, entries] = await Promise.all([
        append ? null : api.getBalance(walletId),
        append ? null : api.getExpired(walletId),
        api.listEntries(walletId, {
          limit: HISTORY_PAGE_SIZE,
          before: cursor.before,
          beforeId: cursor.beforeId,
        }),
      ]);

      if (!append) {
        summaryEl.replaceChildren();
        const stats = [
          ["Available", money(balance.availableMinor)],
          ["Redeemable", money(balance.redeemableMinor)],
          ["Expired", money(expired.expiredMinor)],
        ];
        for (const [label, value] of stats) {
          const s = el("div", "stat");
          s.append(el("div", "stat-label", label), el("div", "stat-value", value));
          summaryEl.append(s);
        }
      }

      if (!append && !entries.length) {
        listEl.append(el("div", "empty", "No ledger entries for this wallet."));
        loadMoreEl.classList.add("hidden");
        return;
      }

      appendEntryRows(entries);

      // A page shorter than the page size means there's nothing left — stop
      // offering "load more" rather than issuing a request that returns empty.
      cursor.exhausted = entries.length < HISTORY_PAGE_SIZE;
      if (entries.length) {
        const last = entries[entries.length - 1];
        cursor.before = last.createdAt;
        cursor.beforeId = last.id;
      }
      loadMoreEl.classList.toggle("hidden", cursor.exhausted);
    } catch (e) {
      fail(e);
      if (!append) {
        summaryEl.replaceChildren();
        emptyState(listEl, "Could not load history.");
      }
    }
  }

  loadMoreEl.addEventListener("click", () => {
    if (cursor.walletId) load(cursor.walletId, { append: true });
  });

  return { load };
}

const historyPanel = makeHistoryPanel({
  summaryEl: $("#history-summary"),
  listEl: $("#history-list"),
  loadMoreEl: $("#history-load-more"),
});

const customerHistoryPanel = makeHistoryPanel({
  summaryEl: $("#customer-history-summary"),
  listEl: $("#customer-history-list"),
  loadMoreEl: $("#customer-history-load-more"),
});

$("#history-form").addEventListener("submit", (e) => {
  e.preventDefault();
  historyPanel.load(e.target.walletId.value.trim());
});

// ── boot ────────────────────────────────────────────────────

refreshMode();
renderTreasuries([]);
