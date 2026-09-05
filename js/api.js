// Every call to chestbox goes through here.
//
// This file mirrors chestbox's router exactly — 11 endpoints, nothing more.
// If a function does not exist here, chestbox does not serve it.
//
//   GET  /health                          health()
//   GET  /health/database                 databaseHealth()
//   POST /wallets                         createWallet()
//   GET  /wallets                         listWallets()
//   GET  /wallets/{id}                    getWallet()
//   POST /wallets/{id}/freeze             setStatus(id, "frozen")
//   POST /wallets/{id}/close              setStatus(id, "closed")
//   POST /wallets/{id}/activate           setStatus(id, "active")
//   POST /ledger/balance/credit           credit()
//   POST /ledger/balance/debit            debit()
//   GET  /ledger/balance/{walletId}       getBalance()
//   GET  /ledger/entries                  listEntries()

import { config } from "./config.js";

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body) {
  // In proxy mode the serverless function supplies the key; the browser never
  // sees it. In direct mode the page must carry it itself.
  if (!config.proxy && !config.adminKey) {
    throw new ApiError("No admin key set — open Settings", 401, null);
  }

  const url = config.proxy ? `/api/chestbox${path}` : `${config.baseUrl}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (!config.proxy) headers["x-admin-api-key"] = config.adminKey;

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((e) => {
    // fetch rejects on network failure and on CORS rejection alike; the browser
    // deliberately doesn't tell us which.
    const where = config.proxy ? "/api/chestbox" : config.baseUrl;
    const hint = config.proxy
      ? "is the proxy running and CHESTBOX_URL set?"
      : "server down, or chestbox has no CORS layer";
    throw new ApiError(`Cannot reach ${where} — ${hint} (${e.message})`, 0, null);
  });

  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const msg =
      (parsed && (parsed.message || parsed.error)) ||
      (typeof parsed === "string" && parsed) ||
      res.statusText;
    throw new ApiError(msg, res.status, parsed);
  }
  // Status is surfaced so the UI can distinguish 201 (created) from 200
  // (idempotent replay) — the whole point of the idempotency key.
  return { data: parsed, status: res.status };
}

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
};

const body = (r) => r.data;

export const api = {
  // ---- health ----

  health: () => request("GET", "/health").then(body),
  databaseHealth: () => request("GET", "/health/database").then(body),

  // ---- wallets ----

  // chestbox upserts on (entityType, entityId, customerId?, currency, walletType),
  // so calling this twice with the same identity returns the original wallet
  // rather than creating a second one.
  createWallet: (payload) => request("POST", "/wallets", payload).then(body),

  // entityId scopes to that entity's CUSTOMER wallets — entity-level rows and
  // treasuries are excluded, so this is exactly the customer list the board
  // wants. Treasuries come back via campaignId instead. Default limit is 50,
  // max 200; before+beforeId are keyset pagination, both or neither.
  listWallets: ({ entityType, entityId, customerId, campaignId, includeDeleted, limit, before, beforeId } = {}) =>
    request(
      "GET",
      `/wallets${qs({ entityType, entityId, customerId, campaignId, includeDeleted, limit, before, beforeId })}`,
    ).then(body),

  getWallet: (id) => request("GET", `/wallets/${encodeURIComponent(id)}`).then(body),

  setStatus(id, status) {
    const action = { active: "activate", frozen: "freeze", closed: "close" }[status];
    if (!action) throw new ApiError(`Unknown status ${status}`, 0, null);
    return request("POST", `/wallets/${encodeURIComponent(id)}/${action}`).then(body);
  },

  // ---- ledger ----

  // availableMinor counts every unexpired credit; redeemableMinor counts only
  // those already past their activeAt. A future-dated grant shows in the first
  // and not the second.
  getBalance: (walletId) =>
    request("GET", `/ledger/balance/${encodeURIComponent(walletId)}`).then(body),

  // Exactly one of walletId / campaignId. before+beforeId are the (createdAt,
  // id) of the last row already shown — keyset pagination, both or neither.
  listEntries: ({ walletId, campaignId, limit, before, beforeId } = {}) =>
    request("GET", `/ledger/entries${qs({ walletId, campaignId, limit, before, beforeId })}`).then(
      body,
    ),

  // activeAt is required on a credit; expiresAt is optional (omit = never
  // expires) but must be after activeAt. Returns {data, status} so the caller
  // can tell a fresh 201 from a 200 replay.
  credit: (payload) => request("POST", "/ledger/balance/credit", payload),

  // activeAt/expiresAt are rejected on a debit — the service derives each debit
  // row's expiry from the credit lot it draws from.
  debit: (payload) => request("POST", "/ledger/balance/debit", payload),
};
