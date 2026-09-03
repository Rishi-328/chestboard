// Runtime config. Nothing here is baked into the build — the base URL and the
// admin key are entered in the UI and kept in sessionStorage, so no credential
// is ever committed or shipped in the bundle.

const KEY_BASE_URL = "chestboard.baseUrl";
const KEY_ADMIN_KEY = "chestboard.adminKey";
const KEY_LIVE = "chestboard.live";
const KEY_PROXY = "chestboard.proxy";
const KEY_MERCHANT_ID = "chestboard.merchantId";

function read(key, fallback) {
  try {
    const v = sessionStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback; // private mode / storage disabled
  }
}

function write(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* non-fatal: config just won't survive a reload */
  }
}

export const config = {
  get baseUrl() {
    return read(KEY_BASE_URL, "http://localhost:3000");
  },
  set baseUrl(v) {
    write(KEY_BASE_URL, v);
  },

  get adminKey() {
    return read(KEY_ADMIN_KEY, "");
  },
  set adminKey(v) {
    write(KEY_ADMIN_KEY, v);
  },

  // Live mode talks to a running chestbox. Off by default so the page is
  // useful standalone (e.g. on Vercel) with no backend reachable.
  get live() {
    return read(KEY_LIVE, "false") === "true";
  },
  set live(v) {
    write(KEY_LIVE, v ? "true" : "false");
  },

  // Proxy mode routes through /api/chestbox (the Vercel function), which holds
  // the admin key server-side and sidesteps CORS. Direct mode calls chestbox
  // from the browser, which needs a CORS layer on chestbox and puts the key in
  // client JS — only sensible for local development.
  get proxy() {
    return read(KEY_PROXY, "true") === "true";
  },
  set proxy(v) {
    write(KEY_PROXY, v ? "true" : "false");
  },

  // This board is scoped to one merchant — like lighthouse, which never asks
  // the merchant to type their own id. Set once in Settings, used everywhere
  // a form used to have its own "Merchant" field.
  get merchantId() {
    return read(KEY_MERCHANT_ID, "M1");
  },
  set merchantId(v) {
    write(KEY_MERCHANT_ID, v);
  },
};

// Which parts of the API exist today. Flip to true as each ships; api.js falls
// back to stubs for anything still false, even in live mode.
export const IMPLEMENTED = {
  wallets: true, // POST/GET/PATCH/DELETE /wallets              — shipped
  ledger: true, // /ledger/{balance,entries,expired,...}         — shipped
  earn: true, // POST /earn — shipped, not called from this UI yet
};
