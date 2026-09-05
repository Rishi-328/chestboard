// Runtime config. Nothing here is baked into the build — the base URL and the
// admin key are entered in the UI and kept in sessionStorage, so no credential
// is ever committed or shipped in the bundle.

const KEY_BASE_URL = "chestboard.baseUrl";
const KEY_ADMIN_KEY = "chestboard.adminKey";
const KEY_PROXY = "chestboard.proxy";
const KEY_BOOK = "chestboard.walletBook";

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

  // Proxy mode routes through /api/chestbox (the Vercel function, or
  // dev-server.mjs locally), which holds the admin key server-side and sidesteps
  // CORS. Direct mode calls chestbox from the browser, which needs a CORS layer
  // on chestbox and puts the key in client JS — only sensible for local work.
  get proxy() {
    return read(KEY_PROXY, "true") === "true";
  },
  set proxy(v) {
    write(KEY_PROXY, v ? "true" : "false");
  },
};

// The board still pins the wallets created or looked up in this tab: GET /wallets
// lists an entity's CUSTOMER wallets only, so entity-level rows and treasuries
// have no listing and this is the only way to keep one on screen. A local
// convenience, never a source of truth: every card is re-fetched before shown.
export const book = {
  all() {
    try {
      return JSON.parse(read(KEY_BOOK, "[]"));
    } catch {
      return [];
    }
  },
  add(id) {
    if (!id) return;
    const ids = book.all().filter((x) => x !== id);
    ids.unshift(id);
    write(KEY_BOOK, JSON.stringify(ids.slice(0, 50)));
  },
  remove(id) {
    write(KEY_BOOK, JSON.stringify(book.all().filter((x) => x !== id)));
  },
  clear() {
    write(KEY_BOOK, "[]");
  },
};
