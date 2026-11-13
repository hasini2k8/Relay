// RELAY web — Stellar layer for Family Care Pots.
// A browser port of the mobile app's src/pot.ts (same on-chain format, so pots made in
// the phone app open here and vice versa). Every call is a real Stellar testnet
// transaction; nothing is simulated.
//
//  - A pot is a Stellar account whose own key is disabled (master weight 0).
//  - Every family member is a signer (weight 1); all thresholds = approvals needed.
//  - So any payment out needs that many members' signatures. The network enforces it.
//  - Names live on the account (manageData), so there is no RELAY server.

const SDK = window.StellarSdk;
const { Asset, BASE_FEE, Horizon, Keypair, Memo, Networks, Operation, StrKey, Transaction, TransactionBuilder } = SDK;

export const NETWORK = 'testnet';
export const server = new Horizon.Server('https://horizon-testnet.stellar.org');
export const passphrase = Networks.TESTNET;
const FRIENDBOT = 'https://friendbot.stellar.org';

const NAME_KEY = 'relay:pot';
const memberKey = (a) => `n:${a}`;
const PROPOSAL_DAYS = 7;
const fmt = (n) => Number(n).toFixed(7).replace(/\.?0+$/, '');

export class RelayError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function explain(e) {
  if (e instanceof RelayError) return e;
  const codes = e?.response?.data?.extras?.result_codes;
  if (codes) {
    const all = [codes.transaction, ...(codes.operations ?? [])].join(', ');
    if (codes.transaction === 'tx_bad_auth') return new RelayError('not_enough', 'Not enough family members have approved yet.');
    if (codes.transaction === 'tx_bad_seq') return new RelayError('stale', 'Another payment from this pot went through first. Please make a new request.');
    if (codes.transaction === 'tx_too_late') return new RelayError('expired', 'This request has expired. Please make a new one.');
    if (all.includes('underfunded') || all.includes('insufficient_balance')) return new RelayError('underfunded', 'There is not enough money for this.');
    return new RelayError('tx_failed', `Stellar rejected it (${all}).`);
  }
  if (e?.response?.status === 404) return new RelayError('not_found', 'That account does not exist on Stellar yet.');
  return new RelayError('network', 'Could not reach the Stellar network. Check your connection and try again.');
}

export const isValidAddress = (a) => StrKey.isValidEd25519PublicKey(String(a).trim());
export const isValidSecret = (s) => StrKey.isValidEd25519SecretSeed(String(s).trim());
export const newKeypair = () => Keypair.random();
export const fromSecret = (s) => Keypair.fromSecret(String(s).trim());
export const explorerTx = (h) => `https://stellar.expert/explorer/testnet/tx/${h}`;
export const explorerAccount = (a) => `https://stellar.expert/explorer/testnet/account/${a}`;

/** Stellar text memos are at most 28 bytes; cut on a character boundary. */
export function memoText(s) {
  const enc = new TextEncoder();
  let out = '';
  for (const ch of String(s).trim()) {
    if (enc.encode(out + ch).length > 28) break;
    out += ch;
  }
  return out;
}

const memoOf = (tx) => {
  if (tx.memo.type !== 'text') return '';
  const v = tx.memo.value;
  return typeof v === 'string' ? v : new TextDecoder().decode(Uint8Array.from(v));
};

const decode = (b64) => {
  if (!b64) return '';
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// ---------- Wallet ----------

export async function fund(publicKey) {
  const r = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(publicKey)}`);
  if (!r.ok && r.status !== 400) throw new RelayError('network', 'Could not get free test money right now. Try again.');
}

export async function getWallet(publicKey) {
  try {
    const a = await server.loadAccount(publicKey);
    const native = a.balances.find((b) => b.asset_type === 'native');
    const balance = Number(native?.balance ?? 0);
    const reserved = (2 + a.subentry_count + Number(a.num_sponsoring ?? 0) - Number(a.num_sponsored ?? 0)) * 0.5;
    return { exists: true, balance, spendable: Math.max(0, balance - reserved - Number(native?.selling_liabilities ?? 0)) };
  } catch (e) {
    if (e?.response?.status === 404) return { exists: false, balance: 0, spendable: 0 };
    throw explain(e);
  }
}

// ---------- Pots ----------

export const potReserve = (n) => (2 + n + (n + 1)) * 0.5 + 1;

export async function createPot(creator, name, members, approvals) {
  if (members.length < 2) throw new RelayError('members', 'A pot needs at least 2 family members.');
  if (approvals < 1 || approvals > members.length) throw new RelayError('approvals', 'Approvals must be between 1 and the number of members.');
  if (!members.some((m) => m.address === creator.publicKey())) throw new RelayError('members', 'You must be a member of your pot.');
  const pot = Keypair.random();
  try {
    const account = await server.loadAccount(creator.publicKey());
    let b = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: passphrase })
      .addOperation(Operation.createAccount({ destination: pot.publicKey(), startingBalance: fmt(potReserve(members.length)) }))
      .addOperation(Operation.manageData({ source: pot.publicKey(), name: NAME_KEY, value: memoText(name) || 'Family pot' }));
    for (const m of members) {
      b = b
        .addOperation(Operation.manageData({ source: pot.publicKey(), name: memberKey(m.address), value: (m.name.trim() || 'Member').slice(0, 32) }))
        .addOperation(Operation.setOptions({ source: pot.publicKey(), signer: { ed25519PublicKey: m.address, weight: 1 } }));
    }
    b = b.addOperation(Operation.setOptions({ source: pot.publicKey(), masterWeight: 0, lowThreshold: approvals, medThreshold: approvals, highThreshold: approvals }));
    const tx = b.setTimeout(60).build();
    tx.sign(creator, pot);
    const res = await server.submitTransaction(tx);
    return { potId: pot.publicKey(), hash: res.hash };
  } catch (e) {
    throw explain(e);
  }
}

export async function getPot(potId) {
  try {
    const a = await server.loadAccount(potId);
    const data = a.data_attr ?? {};
    if (!data[NAME_KEY]) throw new RelayError('not_pot', 'This is not a RELAY family pot.');
    const signers = a.signers.filter((s) => s.weight > 0 && s.key !== potId && s.type === 'ed25519_public_key');
    const members = signers.map((s) => ({ address: s.key, name: decode(data[memberKey(s.key)]) || `${s.key.slice(0, 4)}…${s.key.slice(-4)}` }));
    const balance = Number(a.balances.find((x) => x.asset_type === 'native')?.balance ?? 0);
    const reserved = (2 + a.subentry_count) * 0.5;
    return { id: potId, name: decode(data[NAME_KEY]), members, approvals: a.thresholds.med_threshold, balance, spendable: Math.max(0, balance - reserved - 1), sequence: a.sequence };
  } catch (e) {
    throw explain(e);
  }
}

export async function myPots(address) {
  try {
    const r = await server.accounts().forSigner(address).limit(50).call();
    return r.records.filter((a) => a.id !== address && a.data_attr?.[NAME_KEY]).map((a) => a.id);
  } catch (e) {
    throw explain(e);
  }
}

export async function contribute(from, potId, amount) {
  try {
    const account = await server.loadAccount(from.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: passphrase })
      .addOperation(Operation.payment({ destination: potId, asset: Asset.native(), amount: fmt(amount) }))
      .addMemo(Memo.text('pot contribution'))
      .setTimeout(60)
      .build();
    tx.sign(from);
    return (await server.submitTransaction(tx)).hash;
  } catch (e) {
    throw explain(e);
  }
}

// ---------- Requests (multisig spending) ----------

export async function proposeSpend(proposer, potId, to, amount, purpose) {
  if (!isValidAddress(to)) throw new RelayError('address', 'That address is not right.');
  try {
    const pot = await server.loadAccount(potId);
    let toExists = true;
    try {
      await server.loadAccount(to);
    } catch (e) {
      if (e?.response?.status === 404) toExists = false;
      else throw e;
    }
    if (!toExists && amount < 1) throw new RelayError('min', 'To pay a brand-new wallet, send at least 1 XLM.');
    const op = toExists
      ? Operation.payment({ destination: to, asset: Asset.native(), amount: fmt(amount) })
      : Operation.createAccount({ destination: to, startingBalance: fmt(amount) });
    const tx = new TransactionBuilder(pot, { fee: BASE_FEE, networkPassphrase: passphrase })
      .addOperation(op)
      .addMemo(Memo.text(memoText(purpose) || 'family care'))
      .setTimeout(PROPOSAL_DAYS * 86400)
      .build();
    tx.sign(proposer);
    return tx.toXDR();
  } catch (e) {
    throw explain(e);
  }
}

function approvers(tx, members) {
  const h = tx.hash();
  const raw = (sig) => (typeof sig.signature === 'function' ? sig.signature() : sig.signature);
  return members.filter((m) => tx.signatures.some((sig) => Keypair.fromPublicKey(m.address).verify(h, raw(sig))));
}

function parseTx(xdr) {
  try {
    const tx = TransactionBuilder.fromXDR(xdr, passphrase);
    if (!(tx instanceof Transaction) || tx.operations.length !== 1) throw new Error();
    return tx;
  } catch {
    throw new RelayError('bad_link', 'This approval link is damaged or not from RELAY.');
  }
}

export async function inspectProposal(xdr) {
  const tx = parseTx(xdr);
  const op = tx.operations[0];
  if (op.type !== 'payment' && op.type !== 'createAccount') throw new RelayError('bad_link', 'This approval link is not a pot payment.');
  const pot = await getPot(tx.source);
  const approvedBy = approvers(tx, pot.members);
  const expiresAt = tx.timeBounds?.maxTime ? Number(tx.timeBounds.maxTime) : undefined;
  const status =
    BigInt(pot.sequence) >= BigInt(tx.sequence) ? 'stale' : expiresAt && expiresAt < Date.now() / 1000 ? 'expired' : approvedBy.length >= pot.approvals ? 'ready' : 'waiting';
  return { xdr, potId: tx.source, pot, to: op.destination, amount: Number(op.amount ?? op.startingBalance), purpose: memoOf(tx), approvedBy, needed: pot.approvals, expiresAt, status, hash: hex(tx.hash()) };
}

/** Add this member's signature; submits automatically once enough members have approved. */
export async function approveProposal(member, xdr) {
  const tx = parseTx(xdr);
  const before = await inspectProposal(xdr);
  if (!before.pot.members.some((m) => m.address === member.publicKey())) throw new RelayError('not_member', 'Only family members of this pot can approve.');
  if (before.status === 'stale') throw new RelayError('stale', 'Another payment from this pot went through first. Please make a new request.');
  if (before.status === 'expired') throw new RelayError('expired', 'This request has expired. Please make a new one.');
  if (!before.approvedBy.some((m) => m.address === member.publicKey())) tx.sign(member);
  const signed = tx.toXDR();
  const proposal = await inspectProposal(signed);
  if (proposal.status !== 'ready') return { xdr: signed, proposal };
  try {
    const res = await server.submitTransaction(tx);
    return { xdr: signed, submittedHash: res.hash, proposal };
  } catch (e) {
    throw explain(e);
  }
}

export async function submitProposal(xdr) {
  try {
    return (await server.submitTransaction(parseTx(xdr))).hash;
  } catch (e) {
    throw explain(e);
  }
}

/** Who paid in, what was spent and on what, who approved each payment. Read from the public ledger. */
export async function ledger(pot) {
  try {
    const r = await server.transactions().forAccount(pot.id).order('desc').limit(100).call();
    const totals = new Map();
    const out = { contributions: [], spent: [], incoming: [], setup: null };
    for (const t of r.records) {
      const tx = TransactionBuilder.fromXDR(t.envelope_xdr, passphrase);
      for (const raw of tx.operations) {
        const src = raw.source ?? tx.source;
        if (raw.type === 'createAccount' && raw.destination === pot.id) {
          out.setup = { by: src, amount: Number(raw.startingBalance), at: t.created_at, hash: t.hash };
        } else if (raw.type === 'payment' && raw.destination === pot.id && raw.asset.isNative()) {
          totals.set(src, (totals.get(src) ?? 0) + Number(raw.amount));
          out.incoming.push({ from: src, amount: Number(raw.amount), at: t.created_at, hash: t.hash });
        } else if ((raw.type === 'payment' || raw.type === 'createAccount') && src === pot.id) {
          out.spent.push({ to: raw.destination, amount: Number(raw.amount ?? raw.startingBalance), purpose: memoOf(tx), approvedBy: approvers(tx, pot.members).map((m) => m.address), at: t.created_at, hash: t.hash });
        }
      }
    }
    out.contributions = [...totals.entries()].map(([member, total]) => ({ member, total }));
    return out;
  } catch (e) {
    throw explain(e);
  }
}

// ---------- Prices ----------

export async function fetchPrices() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=inr,usd,cad,gbp,aed');
    const s = (await r.json())?.stellar ?? {};
    return { INR: s.inr, USD: s.usd, CAD: s.cad, GBP: s.gbp, AED: s.aed };
  } catch {
    return {};
  }
}
