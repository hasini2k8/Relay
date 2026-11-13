// Family Care Pot: a shared Stellar account that family members abroad pay into for a
// parent's care. Nobody can spend it alone:
//   - each member is a signer (weight 1) and the pot's own key is disabled (master weight 0)
//   - every threshold equals the number of approvals the family chose (e.g. 2 of 3)
// so any payment out needs that many members' signatures. The Stellar network enforces this.
// The pot's name and members' names are stored on the account itself (manageData), so
// every member's app sees the same thing with no server.
//
// Spending works by proposal: a member builds and signs the payment, then shares it as a
// link. Each member who opens it sees the amount, payee, purpose and who has approved, and
// adds their signature. When enough have signed, the app submits it.
import { Asset, BASE_FEE, Horizon, Keypair, Memo, Operation, StrKey, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';

export type Net = { server: Horizon.Server; passphrase: string };
export type Member = { address: string; name: string };

const NAME_KEY = 'relay:pot';
const memberKey = (address: string) => `n:${address}`;
const PROPOSAL_DAYS = 7;
const fmt = (n: number) => n.toFixed(7).replace(/\.?0+$/, '');

export class PotError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function explain(e: any): PotError {
  if (e instanceof PotError) return e;
  const codes = e?.response?.data?.extras?.result_codes;
  if (codes) {
    const all = [codes.transaction, ...(codes.operations ?? [])].join(', ');
    if (codes.transaction === 'tx_bad_auth') return new PotError('not_enough', 'Not enough family members have approved yet.');
    if (codes.transaction === 'tx_bad_seq') return new PotError('stale', 'Another payment from this pot went through first. Please make a new request.');
    if (codes.transaction === 'tx_too_late') return new PotError('expired', 'This request has expired. Please make a new one.');
    if (all.includes('op_underfunded')) return new PotError('underfunded', 'The pot does not have enough money for this.');
    if (all.includes('tx_insufficient_balance')) return new PotError('underfunded', 'The pot does not have enough money for this.');
    return new PotError('tx_failed', `Stellar rejected it (${all}).`);
  }
  if (e?.response?.status === 404) return new PotError('not_found', 'This pot does not exist.');
  return new PotError('network', 'Could not reach the Stellar network. Check your connection and try again.');
}

/** Stellar text memos are at most 28 bytes; cut on a character boundary (Hindi is 3 bytes per letter). */
export function memoText(s: string) {
  const enc = new TextEncoder();
  let out = '';
  for (const ch of s.trim()) {
    if (enc.encode(out + ch).length > 28) break;
    out += ch;
  }
  return out;
}

/** Text memo as a string; the SDK may hand back raw UTF-8 bytes. */
const memoOf = (tx: Transaction) => {
  if (tx.memo.type !== 'text') return '';
  const v: any = tx.memo.value;
  return typeof v === 'string' ? v : new TextDecoder().decode(Uint8Array.from(v));
};

const decode = (b64?: string) => {
  if (!b64) return '';
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

// Reserve: 2 base + one per signer + one per data entry, at 0.5 XLM each, plus 1 XLM for the pot's own fees.
export const potReserve = (memberCount: number) => (2 + memberCount + (memberCount + 1)) * 0.5 + 1;

export async function createPot(net: Net, creator: Keypair, name: string, members: Member[], approvals: number) {
  if (members.length < 2) throw new PotError('members', 'A pot needs at least 2 family members.');
  if (approvals < 1 || approvals > members.length) throw new PotError('approvals', 'Approvals must be between 1 and the number of members.');
  if (!members.some((m) => m.address === creator.publicKey())) throw new PotError('members', 'You must be a member of your pot.');
  const pot = Keypair.random();
  try {
    const account = await net.server.loadAccount(creator.publicKey());
    let b = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: net.passphrase })
      .addOperation(Operation.createAccount({ destination: pot.publicKey(), startingBalance: fmt(potReserve(members.length)) }))
      .addOperation(Operation.manageData({ source: pot.publicKey(), name: NAME_KEY, value: memoText(name) || 'Family pot' }));
    for (const m of members) {
      b = b
        .addOperation(Operation.manageData({ source: pot.publicKey(), name: memberKey(m.address), value: (m.name.trim() || 'Member').slice(0, 32) }))
        .addOperation(Operation.setOptions({ source: pot.publicKey(), signer: { ed25519PublicKey: m.address, weight: 1 } }));
    }
    // Last: disable the pot's own key and require `approvals` signatures for everything.
    b = b.addOperation(
      Operation.setOptions({ source: pot.publicKey(), masterWeight: 0, lowThreshold: approvals, medThreshold: approvals, highThreshold: approvals }),
    );
    const tx = b.setTimeout(60).build();
    tx.sign(creator, pot);
    const res = await net.server.submitTransaction(tx);
    return { potId: pot.publicKey(), hash: res.hash as string };
  } catch (e) {
    throw explain(e);
  }
}

export type PotInfo = {
  id: string;
  name: string;
  members: Member[];
  approvals: number;
  balance: number;
  spendable: number;
  sequence: string;
};

export async function getPot(net: Net, potId: string): Promise<PotInfo> {
  try {
    const a: any = await net.server.loadAccount(potId);
    const data = a.data_attr ?? {};
    if (!data[NAME_KEY]) throw new PotError('not_pot', 'This is not a RELAY family pot.');
    const signers = (a.signers as any[]).filter((s) => s.weight > 0 && s.key !== potId && s.type === 'ed25519_public_key');
    const members = signers.map((s) => ({ address: s.key, name: decode(data[memberKey(s.key)]) || `${s.key.slice(0, 4)}…${s.key.slice(-4)}` }));
    const native = a.balances.find((x: any) => x.asset_type === 'native');
    const balance = Number(native?.balance ?? 0);
    const reserved = (2 + a.subentry_count) * 0.5;
    return {
      id: potId,
      name: decode(data[NAME_KEY]),
      members,
      approvals: a.thresholds.med_threshold,
      balance,
      // Keep the 1 XLM fee buffer added at creation out of what the family sees as spendable.
      spendable: Math.max(0, balance - reserved - 1),
      sequence: a.sequence,
    };
  } catch (e) {
    throw explain(e);
  }
}

/** Pots this wallet can approve for, found from the network (no server, no invite needed). */
export async function myPots(net: Net, address: string): Promise<string[]> {
  try {
    const r = await net.server.accounts().forSigner(address).limit(50).call();
    return r.records.filter((a: any) => a.id !== address && a.data_attr?.[NAME_KEY]).map((a: any) => a.id);
  } catch (e) {
    throw explain(e);
  }
}

export async function contribute(net: Net, from: Keypair, potId: string, amount: number) {
  try {
    const account = await net.server.loadAccount(from.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: net.passphrase })
      .addOperation(Operation.payment({ destination: potId, asset: Asset.native(), amount: fmt(amount) }))
      .addMemo(Memo.text('pot contribution'))
      .setTimeout(60)
      .build();
    tx.sign(from);
    return (await net.server.submitTransaction(tx)).hash as string;
  } catch (e) {
    throw explain(e);
  }
}

// ---------- Proposals (multisig spending) ----------

export async function proposeSpend(net: Net, proposer: Keypair, potId: string, to: string, amount: number, purpose: string) {
  if (!StrKey.isValidEd25519PublicKey(to)) throw new PotError('address', 'That address is not right.');
  try {
    const pot = await net.server.loadAccount(potId);
    let toExists = true;
    try {
      await net.server.loadAccount(to);
    } catch (e: any) {
      if (e?.response?.status === 404) toExists = false;
      else throw e;
    }
    if (!toExists && amount < 1) throw new PotError('min', 'To pay a brand-new wallet, send at least 1 XLM.');
    const op = toExists
      ? Operation.payment({ destination: to, asset: Asset.native(), amount: fmt(amount) })
      : Operation.createAccount({ destination: to, startingBalance: fmt(amount) });
    const tx = new TransactionBuilder(pot, { fee: BASE_FEE, networkPassphrase: net.passphrase })
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

export type Proposal = {
  potId: string;
  pot: PotInfo;
  to: string;
  amount: number;
  purpose: string;
  approvedBy: Member[];
  needed: number;
  expiresAt?: number;
  status: 'waiting' | 'ready' | 'stale' | 'expired';
  hash: string;
};

function approvers(tx: Transaction, members: Member[]) {
  const h = tx.hash();
  // Newer SDKs expose `signature` as a field; older ones as an XDR accessor method.
  const raw = (sig: any) => (typeof sig.signature === 'function' ? sig.signature() : sig.signature);
  return members.filter((m) => tx.signatures.some((sig) => Keypair.fromPublicKey(m.address).verify(h, raw(sig))));
}

function parseTx(net: Net, xdr: string): Transaction {
  try {
    const tx = TransactionBuilder.fromXDR(xdr, net.passphrase);
    if (!(tx instanceof Transaction) || tx.operations.length !== 1) throw new Error();
    return tx;
  } catch {
    throw new PotError('bad_link', 'This approval link is damaged or not from RELAY.');
  }
}

export async function inspectProposal(net: Net, xdr: string): Promise<Proposal> {
  const tx = parseTx(net, xdr);
  const op: any = tx.operations[0];
  if (op.type !== 'payment' && op.type !== 'createAccount') throw new PotError('bad_link', 'This approval link is not a pot payment.');
  const pot = await getPot(net, tx.source);
  const approvedBy = approvers(tx, pot.members);
  const expiresAt = tx.timeBounds?.maxTime ? Number(tx.timeBounds.maxTime) : undefined;
  const status =
    BigInt(pot.sequence) >= BigInt(tx.sequence)
      ? 'stale'
      : expiresAt && expiresAt < Date.now() / 1000
        ? 'expired'
        : approvedBy.length >= pot.approvals
          ? 'ready'
          : 'waiting';
  return {
    potId: tx.source,
    pot,
    to: op.destination,
    amount: Number(op.amount ?? op.startingBalance),
    purpose: memoOf(tx),
    approvedBy,
    needed: pot.approvals,
    expiresAt,
    status,
    hash: hex(tx.hash()),
  };
}

/** Add this member's approval. Submits automatically once enough members have approved. */
export async function approveProposal(net: Net, member: Keypair, xdr: string): Promise<{ xdr: string; submittedHash?: string; proposal: Proposal }> {
  const tx = parseTx(net, xdr);
  const before = await inspectProposal(net, xdr);
  if (!before.pot.members.some((m) => m.address === member.publicKey())) throw new PotError('not_member', 'Only family members of this pot can approve.');
  if (before.status === 'stale' || before.status === 'expired') throw new PotError(before.status, before.status === 'stale' ? 'Another payment from this pot went through first. Please make a new request.' : 'This request has expired. Please make a new one.');
  if (!before.approvedBy.some((m) => m.address === member.publicKey())) tx.sign(member);
  const signed = tx.toXDR();
  const proposal = await inspectProposal(net, signed);
  if (proposal.status !== 'ready') return { xdr: signed, proposal };
  try {
    const res = await net.server.submitTransaction(tx);
    return { xdr: signed, submittedHash: res.hash as string, proposal };
  } catch (e) {
    throw explain(e);
  }
}

/** Submit a fully-approved proposal that someone else signed last (e.g. opened from a link). */
export async function submitProposal(net: Net, xdr: string) {
  try {
    return (await net.server.submitTransaction(parseTx(net, xdr))).hash as string;
  } catch (e) {
    throw explain(e);
  }
}

// ---------- Ledger: who paid in, what was spent, who approved ----------

export type PotLedger = {
  contributions: { member: string; total: number }[];
  setup?: { by: string; amount: number };
  spent: { to: string; amount: number; purpose: string; approvedBy: string[]; at: string; hash: string }[];
  incoming: { from: string; amount: number; at: string; hash: string }[];
};

export async function ledger(net: Net, pot: PotInfo): Promise<PotLedger> {
  try {
    const r = await net.server.transactions().forAccount(pot.id).order('desc').limit(100).call();
    const totals = new Map<string, number>();
    const out: PotLedger = { contributions: [], spent: [], incoming: [] };
    for (const t of r.records as any[]) {
      const tx = TransactionBuilder.fromXDR(t.envelope_xdr, net.passphrase) as Transaction;
      for (const raw of tx.operations as any[]) {
        const opSource = raw.source ?? tx.source;
        if (raw.type === 'createAccount' && raw.destination === pot.id) {
          out.setup = { by: opSource, amount: Number(raw.startingBalance) };
        } else if (raw.type === 'payment' && raw.destination === pot.id && raw.asset.isNative()) {
          totals.set(opSource, (totals.get(opSource) ?? 0) + Number(raw.amount));
          out.incoming.push({ from: opSource, amount: Number(raw.amount), at: t.created_at, hash: t.hash });
        } else if ((raw.type === 'payment' || raw.type === 'createAccount') && opSource === pot.id) {
          out.spent.push({
            to: raw.destination,
            amount: Number(raw.amount ?? raw.startingBalance),
            purpose: memoOf(tx),
            approvedBy: approvers(tx, pot.members).map((m) => m.address),
            at: t.created_at,
            hash: t.hash,
          });
        }
      }
    }
    out.contributions = [...totals.entries()].map(([member, total]) => ({ member, total })).sort((a, b) => b.total - a.total);
    return out;
  } catch (e) {
    throw explain(e);
  }
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
