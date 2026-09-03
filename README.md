# Chestboard

Operations console for [chestbox](../chestbox) — treasuries, customer wallets,
balances and ledger history.

Plain HTML, CSS and ES modules. No build step, no framework, no dependencies.

---

## Running it

**Standalone** — no backend, sample data throughout:

```bash
python3 -m http.server 4173
```

**Against a running chestbox:**

```bash
CHESTBOX_URL=http://localhost:3000 \
CHESTBOX_ADMIN_KEY=local-secret \
node dev-server.mjs
```

Then open <http://localhost:4173> and turn on **Live mode** in Settings.

`dev-server.mjs` serves the files *and* proxies `/api/chestbox/*` to chestbox,
mirroring the Vercel function. Use it rather than a plain static server — see
CORS below.

## Deploying

Push to Vercel as a static site. Set two environment variables:

| Variable | Example |
| --- | --- |
| `CHESTBOX_URL` | `https://chestbox.beta.internal` |
| `CHESTBOX_ADMIN_KEY` | the `SUPER_USER_KEY` value |

`api/chestbox/[...path].js` picks these up. Nothing else to configure.

---

## Why the proxy exists

Two reasons, and the second matters more:

**CORS.** chestbox sends no `Access-Control-Allow-Origin`, so a browser on a
different origin is blocked outright:

```
Access to fetch at 'http://localhost:3000/wallets' from origin
'http://localhost:4173' has been blocked by CORS policy
```

**The admin key.** Calling chestbox directly means `SUPER_USER_KEY` lives in
client-side JavaScript, readable by anyone who opens devtools. Behind the proxy
it stays a server-side environment variable and never reaches the browser.

Direct mode (proxy off in Settings) is still there for local debugging, but it
needs a CORS layer on chestbox and puts the key in `sessionStorage`. Use a
throwaway key if you do — never a production one.

---

## Plugging in endpoints as they ship

Everything goes through `js/api.js`. Each call checks whether its area is live,
and otherwise returns a stub from `js/stubs.js`. The stub shapes match the real
contract exactly, so turning one on is a one-line change in `js/config.js`:

```js
export const IMPLEMENTED = {
  wallets: true,   // shipped
  ledger: false,   // in review  <- flip when the ledger PR merges
  earn: false,     // not started
};
```

No component changes. The banners that read "showing sample data" disappear on
their own, because they key off the same flag.

Current state:

| Area | Endpoints | Status |
| --- | --- | --- |
| wallets | `POST/GET /wallets`, `PATCH /wallets/priority`, `DELETE /wallets/:id` | live |
| ledger | `/ledger/balance/*`, `/ledger/entries`, `/ledger/expired` | stubbed |
| earn | `POST /earn` | stubbed |

---

## What's here

**Treasuries** — list a campaign's treasuries in payout order, create one,
reorder with ↑/↓, soft-delete. Reordering sends the full new order in a single
`PATCH`, which is what the endpoint expects: partial lists are rejected, and
moving them one at a time would collide on the priority unique index.

**Customer** — look up a customer's wallets, see balances, grant or revoke.
Dashboard grants and revokes go in as `sourceType: "adjustment"`, which is why
the form requires an actor and a reason — the ledger enforces both for that
source type.

**History** — every ledger entry for one wallet, with available, redeemable and
expired totals. Works for a customer wallet or a treasury; both are wallets.

---

## Notes

- Amounts are **minor units** everywhere, matching chestbox. Division happens
  only at render time, never in arithmetic.
- Wallet ids are nanoids, not UUIDs.
- Settings live in `sessionStorage`, so they are per-tab and vanish when it
  closes. Nothing is committed to the repo.
