// Canned responses for endpoints that don't exist yet.
//
// Shapes match the real contract exactly (types/wallet.yaml and the ledger
// types), so swapping IMPLEMENTED.ledger to true changes where the data comes
// from and nothing else.

const now = () => new Date().toISOString();
const daysFromNow = (d) => new Date(Date.now() + d * 864e5).toISOString();

let seq = 0;
const nid = () => `stub_${(seq++).toString().padStart(4, "0")}`;

// Mutable so the page behaves like a real system within a session: grant and
// revoke actually move these numbers.
const state = {
  balances: {},
  entries: {},
};

function ensure(walletId) {
  if (!state.balances[walletId]) {
    state.balances[walletId] = { availableMinor: 250000, redeemableMinor: 250000 };
    state.entries[walletId] = [
      {
        id: nid(),
        walletId,
        amountMinor: 200000,
        direction: "credit",
        sourceType: "rule",
        expiresAt: daysFromNow(60),
        createdAt: daysFromNow(-12),
      },
      {
        id: nid(),
        walletId,
        amountMinor: 100000,
        direction: "credit",
        sourceType: "referral",
        expiresAt: daysFromNow(30),
        createdAt: daysFromNow(-8),
      },
      {
        id: nid(),
        walletId,
        amountMinor: 50000,
        direction: "debit",
        sourceType: "redemption",
        expiresAt: null,
        createdAt: daysFromNow(-3),
      },
    ];
  }
}

export const stubs = {
  getBalance(walletId) {
    ensure(walletId);
    return { walletId, ...state.balances[walletId] };
  },

  listEntries(walletId) {
    ensure(walletId);
    return [...state.entries[walletId]].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  },

  getExpired(walletId) {
    ensure(walletId);
    const expired = state.entries[walletId]
      .filter((e) => e.direction === "credit" && e.expiresAt && e.expiresAt < now())
      .reduce((sum, e) => sum + e.amountMinor, 0);
    return { walletId, expiredMinor: expired };
  },

  credit(walletId, amountMinor, sourceType, reason) {
    ensure(walletId);
    state.balances[walletId].availableMinor += amountMinor;
    state.balances[walletId].redeemableMinor += amountMinor;
    const entry = {
      id: nid(),
      walletId,
      amountMinor,
      direction: "credit",
      sourceType,
      reason: reason || null,
      expiresAt: daysFromNow(90),
      createdAt: now(),
    };
    state.entries[walletId].push(entry);
    return entry;
  },

  debit(walletId, amountMinor, sourceType, reason) {
    ensure(walletId);
    if (state.balances[walletId].availableMinor < amountMinor) {
      const err = new Error("insufficient balance");
      err.status = 422;
      throw err;
    }
    state.balances[walletId].availableMinor -= amountMinor;
    state.balances[walletId].redeemableMinor -= amountMinor;
    const entry = {
      id: nid(),
      walletId,
      amountMinor,
      direction: "debit",
      sourceType,
      reason: reason || null,
      expiresAt: null,
      createdAt: now(),
    };
    state.entries[walletId].push(entry);
    return entry;
  },
};
