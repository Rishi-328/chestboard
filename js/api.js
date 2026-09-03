// Every call to chestbox goes through here.
//
// The single swap point: each function checks whether its endpoint is live
// (config.live AND IMPLEMENTED.<area>) and either issues a real fetch or returns
// a stub. Plugging in a newly-shipped endpoint means flipping one flag in
// config.js — no component changes.

import { config, IMPLEMENTED } from "./config.js";
import { stubs } from "./stubs.js";

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const isLive = (area) => config.live && IMPLEMENTED[area];

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
      ? "is the proxy deployed and CHESTBOX_URL set?"
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
  return parsed;
}

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  // ---- wallets & treasuries: shipped ----

  listWallets(filters = {}) {
    if (!isLive("wallets")) return Promise.resolve([]);
    return request("GET", `/wallets${qs(filters)}`);
  },

  getWallet(id) {
    if (!isLive("wallets")) return Promise.resolve(null);
    return request("GET", `/wallets/${encodeURIComponent(id)}`);
  },

  createWallet(payload) {
    if (!isLive("wallets")) {
      return Promise.reject(
        new ApiError("Live mode is off — enable it in Settings", 0, null),
      );
    }
    return request("POST", "/wallets", payload);
  },

  reorderPriorities(ownerId, campaignId, order) {
    if (!isLive("wallets")) {
      return Promise.reject(
        new ApiError("Live mode is off — enable it in Settings", 0, null),
      );
    }
    return request("PATCH", "/wallets/priority", { ownerId, campaignId, order });
  },

  deleteWallet(id) {
    if (!isLive("wallets")) {
      return Promise.reject(
        new ApiError("Live mode is off — enable it in Settings", 0, null),
      );
    }
    return request("DELETE", `/wallets/${encodeURIComponent(id)}`);
  },

  setStatus(id, status) {
    if (!isLive("wallets")) {
      return Promise.reject(
        new ApiError("Live mode is off — enable it in Settings", 0, null),
      );
    }
    const action = { active: "activate", frozen: "freeze", closed: "close" }[status];
    return request("POST", `/wallets/${encodeURIComponent(id)}/${action}`);
  },

  // ---- ledger: in review, stubbed until IMPLEMENTED.ledger flips ----

  getBalance(walletId) {
    if (!isLive("ledger")) return Promise.resolve(stubs.getBalance(walletId));
    return request("GET", `/ledger/balance/${encodeURIComponent(walletId)}`);
  },

  // limit/before/beforeId drive keyset pagination — before/beforeId are the
  // (createdAt, groupId) of the last row already shown, from the previous
  // page's last entry. Omit both for the first page.
  listEntries(walletId, { limit, before, beforeId } = {}) {
    if (!isLive("ledger")) return Promise.resolve(stubs.listEntries(walletId));
    return request("GET", `/ledger/entries${qs({ walletId, limit, before, beforeId })}`);
  },

  getExpired(walletId) {
    if (!isLive("ledger")) return Promise.resolve(stubs.getExpired(walletId));
    return request("GET", `/ledger/expired${qs({ walletId })}`);
  },

  // expiresAt is optional — omit it for points that never expire, or pass an
  // ISO string for a fixed expiry date.
  grant({ walletId, amountMinor, sourceType, actorId, reason, idempotencyKey, expiresAt }) {
    if (!isLive("ledger")) {
      return Promise.resolve(stubs.credit(walletId, amountMinor, sourceType, reason));
    }
    return request("POST", "/ledger/balance/credit", {
      walletId,
      amountMinor,
      sourceType,
      actorId,
      reason,
      idempotencyKey,
      activeAt: new Date().toISOString(),
      expiresAt: expiresAt || undefined,
    });
  },

  revoke({ walletId, amountMinor, sourceType, actorId, reason, idempotencyKey }) {
    if (!isLive("ledger")) {
      return Promise.resolve(stubs.debit(walletId, amountMinor, sourceType, reason));
    }
    return request("POST", "/ledger/balance/debit", {
      walletId,
      amountMinor,
      sourceType,
      actorId,
      reason,
      idempotencyKey,
    });
  },
};

export const usingStubs = (area) => !isLive(area);
