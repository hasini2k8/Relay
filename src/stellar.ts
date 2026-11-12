// RELAY's Stellar layer. Every function here submits or reads real transactions
// on the configured Stellar network; nothing is simulated.
//
// Two ways to send, both reversible until the recipient takes the money:
//  1. Protected send (recipient has a Stellar address): the money goes into a
//     claimable balance. The recipient can claim it until the deadline; the sender
//     can take it back at any time before they do. The protocol enforces this.
//  2. Invite send (recipient has no wallet yet): RELAY opens a new Stellar account
//     holding the money and adds the sender as a co-signer. The recipient gets a
//     claim code (the new account's key). Claiming removes the sender's signer, so
//     the money becomes theirs; until then the sender can merge it back.
import {
  Asset,
  BASE_FEE,
  Claimant,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

export type NetworkName = 'testnet' | 'public';

const NETWORKS: Record<NetworkName, { horizon: string; passphrase: string; friendbot?: string }> = {
  testnet: {
    horizon: 'https://horizon-testnet.stellar.org',
    passphrase: Networks.TESTNET,
    friendbot: 'https://friendbot.stellar.org',
  },
  public: {
    horizon: 'https://horizon.stellar.org',
    passphrase: Networks.PUBLIC,
  },
};

export const NETWORK = 'testnet' as NetworkName;
const net = NETWORKS[NETWORK];
export const server = new Horizon.Server(net.horizon);
export const passphrase = net.passphrase;
export const canUseFriendbot = Boolean(net.friendbot);

// Base reserve is 0.5 XLM: an account needs 2 reserves, plus 1 per signer.
// An invite account carries the sender as an extra signer until it is claimed.
export const INVITE_RESERVE = 1.5;
export const PROTECTED_DAYS = 30;

export const isValidAddress = (a: string) => StrKey.isValidEd25519PublicKey(a.trim());
export const isValidSecret = (s: string) => StrKey.isValidEd25519SecretSeed(s.trim());
export const newKeypair = () => Keypair.random();
export const keypairFromSecret = (s: string) => Keypair.fromSecret(s.trim());

const fmt = (n: number) => n.toFixed(7).replace(/\.?0+$/, '');

export class RelayError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function explain(e: any): RelayError {
  const codes = e?.response?.data?.extras?.result_codes;
  if (codes) {
    const op: string[] = codes.operations ?? [];
    if (op.includes('op_underfunded') || codes.transaction === 'tx_insufficient_balance')
      return new RelayError('underfunded', 'Not enough money in your wallet.');
    if (op.includes('op_no_destination') || op.includes('op_no_account'))
      return new RelayError('no_account', 'That wallet does not exist on Stellar yet.');
    if (op.includes('op_does_not_exist') || op.includes('op_bad_auth') || codes.transaction === 'tx_bad_auth')
      return new RelayError('gone', 'This money was already received or taken back.');
    if (op.includes('op_cannot_claim'))
      return new RelayError('cannot_claim', 'This payment cannot be received right now. It may still be on a safety hold, or it has expired.');
    return new RelayError('tx_failed', `Stellar rejected the payment (${[codes.transaction, ...op].join(', ')}).`);
  }
  if (e?.response?.status === 404) return new RelayError('no_account', 'That wallet does not exist on Stellar yet.');
  if (e instanceof RelayError) return e;
  return new RelayError('network', 'Could not reach the Stellar network. Check your connection and try again.');
}

async function submit(build: () => Promise<any>) {
  try {
    const tx = await build();
    const res = await server.submitTransaction(tx);
    return { hash: res.hash as string, tx };
  } catch (e) {
    throw explain(e);
  }
}

async function builder(sourcePublic: string) {
  const account = await server.loadAccount(sourcePublic);
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: net.passphrase });
}

// ---------- Wallet ----------

export async function fundWithFriendbot(publicKey: string) {
  if (!net.friendbot) throw new RelayError('mainnet', 'Free test money is only available on testnet.');
  const r = await fetch(`${net.friendbot}?addr=${encodeURIComponent(publicKey)}`);
  if (!r.ok && r.status !== 400) throw new RelayError('network', 'Could not set up your wallet. Try again.');
}

export type WalletState = { exists: boolean; balance: number; spendable: number; signers: string[] };

export async function getWallet(publicKey: string): Promise<WalletState> {
  try {
    const a = await server.loadAccount(publicKey);
    const native = a.balances.find((b: any) => b.asset_type === 'native') as any;
    const balance = Number(native?.balance ?? 0);
    const reserved = (2 + a.subentry_count + Number((a as any).num_sponsoring ?? 0) - Number((a as any).num_sponsored ?? 0)) * 0.5;
    const locked = Number(native?.selling_liabilities ?? 0);
    return {
      exists: true,
      balance,
      spendable: Math.max(0, balance - reserved - locked),
      signers: a.signers.map((s: any) => s.key),
    };
  } catch (e: any) {
    if (e?.response?.status === 404) return { exists: false, balance: 0, spendable: 0, signers: [] };
    throw explain(e);
  }
}

export async function accountExists(publicKey: string) {
  return (await getWallet(publicKey)).exists;
}

// ---------- Protected send (claimable balance) ----------

// Scam Shield: an optional safety hold. During the hold the recipient cannot claim
// (predicate: NOT before releaseAt), while the sender can still take the money back.
// Scams depend on speed; this gives the sender, or family they call, time to notice.
export async function protectedSend(
  sender: Keypair,
  to: string,
  amount: number,
  { holdSeconds = 0, days = PROTECTED_DAYS }: { holdSeconds?: number; days?: number } = {},
) {
  if (to === sender.publicKey()) throw new RelayError('self', 'You cannot send money to yourself.');
  const now = Math.floor(Date.now() / 1000);
  const deadline = now + days * 86400;
  const releaseAt = holdSeconds > 0 ? now + holdSeconds : undefined;
  const beforeDeadline = Claimant.predicateBeforeAbsoluteTime(String(deadline));
  const recipientRule = releaseAt
    ? Claimant.predicateAnd(Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(String(releaseAt))), beforeDeadline)
    : beforeDeadline;
  const { hash, tx } = await submit(async () => {
    const tx = (await builder(sender.publicKey()))
      .addOperation(
        Operation.createClaimableBalance({
          asset: Asset.native(),
          amount: fmt(amount),
          claimants: [
            new Claimant(to, recipientRule),
            new Claimant(sender.publicKey(), Claimant.predicateUnconditional()),
          ],
        }),
      )
      .setTimeout(60)
      .build();
    tx.sign(sender);
    return tx;
  });
  return { hash, balanceId: tx.getClaimableBalanceId(0) as string, deadline, releaseAt };
}

export type PendingBalance = {
  id: string;
  amount: number;
  from: string;
  to: string;
  createdAt: string;
  deadline?: number;
  /** Safety hold: the recipient can receive only from this time. */
  releaseAt?: number;
};

const epoch = (p: any): number | undefined => {
  const v = p?.abs_before_epoch ?? p?.abs_before;
  if (v == null) return undefined;
  return /^\d+$/.test(String(v)) ? Number(v) : Math.floor(Date.parse(v) / 1000);
};

/** Reads RELAY's predicate shapes: before(deadline) or and(not(before(release)), before(deadline)). */
type Rule = { deadline?: number; releaseAt?: number };
function readRule(p: any): Rule {
  if (!p) return {};
  if (Array.isArray(p.and)) {
    const out: Rule = {};
    for (const part of p.and as any[]) Object.assign(out, readRule(part));
    return out;
  }
  if (p.not) return { releaseAt: epoch(p.not) };
  return { deadline: epoch(p) };
}

function toPending(r: any, sender?: string): PendingBalance {
  const other = r.claimants.find((c: any) => c.destination !== r.sponsor);
  const rule = readRule(other?.predicate);
  return {
    id: r.id,
    amount: Number(r.amount),
    from: r.sponsor ?? sender ?? '',
    to: other?.destination ?? '',
    createdAt: r.last_modified_time ?? '',
    deadline: rule.deadline,
    releaseAt: rule.releaseAt,
  };
}

/** Money waiting for this wallet to receive. */
export async function incoming(publicKey: string): Promise<PendingBalance[]> {
  try {
    const r = await server.claimableBalances().claimant(publicKey).asset(Asset.native()).limit(50).call();
    const now = Date.now() / 1000;
    return r.records
      .filter((b: any) => b.sponsor !== publicKey)
      .map((b: any) => toPending(b))
      .filter((p) => !p.deadline || p.deadline > now);
  } catch (e) {
    throw explain(e);
  }
}

/** Money this wallet sent that has not been received yet (can still be taken back). */
export async function outgoing(publicKey: string): Promise<PendingBalance[]> {
  try {
    const r = await server.claimableBalances().sponsor(publicKey).asset(Asset.native()).limit(50).call();
    return r.records.map((b: any) => toPending(b, publicKey));
  } catch (e) {
    throw explain(e);
  }
}

/** Receive incoming money, or take back money you sent. Same operation on Stellar. */
export async function claim(wallet: Keypair, balanceId: string) {
  return submit(async () => {
    const tx = (await builder(wallet.publicKey()))
      .addOperation(Operation.claimClaimableBalance({ balanceId }))
      .setTimeout(60)
      .build();
    tx.sign(wallet);
    return tx;
  });
}

// ---------- Invite send (new account co-signed by sender) ----------

export async function inviteSend(sender: Keypair, amount: number) {
  const invite = Keypair.random();
  const { hash } = await submit(async () => {
    const tx = (await builder(sender.publicKey()))
      .addOperation(
        Operation.createAccount({ destination: invite.publicKey(), startingBalance: fmt(amount + INVITE_RESERVE) }),
      )
      .addOperation(
        Operation.setOptions({ source: invite.publicKey(), signer: { ed25519PublicKey: sender.publicKey(), weight: 1 } }),
      )
      .setTimeout(60)
      .build();
    tx.sign(sender, invite);
    return tx;
  });
  return { hash, inviteSecret: invite.secret(), invitePublic: invite.publicKey() };
}

export type InviteStatus = 'waiting' | 'received' | 'returned';

export async function inviteStatus(senderPublic: string, invitePublic: string): Promise<{ status: InviteStatus; amount: number }> {
  const w = await getWallet(invitePublic);
  if (!w.exists) return { status: 'returned', amount: 0 };
  if (w.signers.includes(senderPublic)) return { status: 'waiting', amount: Math.max(0, w.balance - INVITE_RESERVE) };
  return { status: 'received', amount: 0 };
}

/** Sender takes invite money back: drop own signer, merge the account into the sender. */
export async function cancelInvite(sender: Keypair, invitePublic: string) {
  return submit(async () => {
    const tx = (await builder(sender.publicKey()))
      .addOperation(Operation.setOptions({ source: invitePublic, signer: { ed25519PublicKey: sender.publicKey(), weight: 0 } }))
      .addOperation(Operation.accountMerge({ source: invitePublic, destination: sender.publicKey() }))
      .setTimeout(60)
      .build();
    tx.sign(sender);
    return tx;
  });
}

/** What a claim code holds, and who can still take it back. */
export async function inspectInvite(inviteSecret: string) {
  const kp = keypairFromSecret(inviteSecret);
  const w = await getWallet(kp.publicKey());
  if (!w.exists) throw new RelayError('gone', 'This money was already received or taken back.');
  const coSigners = w.signers.filter((s) => s !== kp.publicKey());
  return { keypair: kp, wallet: w, amount: w.balance, sender: coSigners[0], claimed: coSigners.length === 0 };
}

/**
 * Recipient receives invite money.
 * - Into an existing wallet: remove the sender's signer and merge everything into it.
 * - No wallet yet: remove the sender's signer; the invite account becomes their wallet.
 */
export async function claimInvite(inviteSecret: string, intoWallet?: string) {
  const { keypair, wallet } = await inspectInvite(inviteSecret);
  const others = wallet.signers.filter((s) => s !== keypair.publicKey());
  return submit(async () => {
    let b = await builder(keypair.publicKey());
    for (const s of others) b = b.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: s, weight: 0 } }));
    if (intoWallet) b = b.addOperation(Operation.accountMerge({ destination: intoWallet }));
    const tx = b.setTimeout(60).build();
    tx.sign(keypair);
    return tx;
  });
}

// ---------- Plain payment with memo (used to send cash-out money to an anchor) ----------

export async function payWithMemo(
  sender: Keypair,
  to: string,
  amount: number,
  memo?: { type: 'text' | 'id' | 'hash'; value: string },
) {
  return submit(async () => {
    let b = (await builder(sender.publicKey())).addOperation(
      Operation.payment({ destination: to, asset: Asset.native(), amount: fmt(amount) }),
    );
    if (memo?.type === 'text') b = b.addMemo(Memo.text(memo.value));
    else if (memo?.type === 'id') b = b.addMemo(Memo.id(memo.value));
    else if (memo?.type === 'hash') b = b.addMemo(Memo.hash(base64ToHex(memo.value)));
    const tx = b.setTimeout(60).build();
    tx.sign(sender);
    return tx;
  });
}

// ---------- History ----------

export type Activity = {
  id: string;
  kind: 'in' | 'out' | 'protected_out' | 'invite_out' | 'claimed' | 'setup';
  amount: number;
  counterparty?: string;
  at: string;
  hash: string;
};

export async function history(publicKey: string): Promise<Activity[]> {
  try {
    const r = await server.operations().forAccount(publicKey).order('desc').limit(30).call();
    const out: Activity[] = [];
    for (const op of r.records as any[]) {
      const base = { id: op.id, at: op.created_at, hash: op.transaction_hash };
      if (op.type === 'payment' && op.asset_type === 'native') {
        const mine = op.from === publicKey;
        out.push({ ...base, kind: mine ? 'out' : 'in', amount: Number(op.amount), counterparty: mine ? op.to : op.from });
      } else if (op.type === 'create_account') {
        if (op.account === publicKey) out.push({ ...base, kind: 'setup', amount: Number(op.starting_balance), counterparty: op.funder });
        else out.push({ ...base, kind: 'invite_out', amount: Number(op.starting_balance), counterparty: op.account });
      } else if (op.type === 'create_claimable_balance') {
        const to = op.claimants?.find((c: any) => c.destination !== publicKey)?.destination;
        out.push({ ...base, kind: 'protected_out', amount: Number(op.amount), counterparty: to });
      } else if (op.type === 'claim_claimable_balance' && op.claimant === publicKey) {
        const fx = await server.effects().forOperation(op.id).call();
        const credit = (fx.records as any[]).find((e) => e.type === 'account_credited');
        out.push({ ...base, kind: 'claimed', amount: Number(credit?.amount ?? 0) });
      } else if (op.type === 'account_merge' && op.into === publicKey) {
        const fx = await server.effects().forOperation(op.id).call();
        const credit = (fx.records as any[]).find((e) => e.type === 'account_credited' && e.account === publicKey);
        out.push({ ...base, kind: 'claimed', amount: Number(credit?.amount ?? 0), counterparty: op.account });
      }
    }
    return out;
  } catch (e: any) {
    if (e?.response?.status === 404) return [];
    throw explain(e);
  }
}

export const explorerTx = (hash: string) =>
  `https://stellar.expert/explorer/${NETWORK === 'public' ? 'public' : 'testnet'}/tx/${hash}`;
export const explorerAccount = (pk: string) =>
  `https://stellar.expert/explorer/${NETWORK === 'public' ? 'public' : 'testnet'}/account/${pk}`;

function base64ToHex(b64: string) {
  const bin = atob(b64);
  let hex = '';
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return hex;
}
