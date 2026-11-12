// Cash in / cash out through a Stellar anchor, using the standard protocols every
// anchor implements:
//   SEP-1  stellar.toml discovery (where the anchor's servers are, who signs for it)
//   SEP-10 proving wallet ownership by signing the anchor's challenge -> session token
//   SEP-24 interactive deposit/withdraw: the anchor hosts the KYC + bank/cash details
//          page, then tells the wallet where to send the money (cash out) or sends
//          money to the wallet (cash in).
// The anchor is a licensed business that holds the bank/cash side. RELAY never sees
// bank details; they go straight from the user to the anchor's page.
import { Keypair, StellarToml, WebAuth } from '@stellar/stellar-sdk';

export type AnchorInfo = {
  domain: string;
  name: string;
  signingKey: string;
  authEndpoint: string;
  sep24: string;
  deposit: { enabled: boolean; min?: number; max?: number; fee?: string };
  withdraw: { enabled: boolean; min?: number; max?: number; fee?: string };
};

export type AnchorTxStatus =
  | 'incomplete'
  | 'pending_user_transfer_start'
  | 'pending_user_transfer_complete'
  | 'pending_external'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_trust'
  | 'pending_user'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'no_market'
  | 'too_small'
  | 'too_large'
  | 'error';

export type AnchorTx = {
  id: string;
  kind: 'deposit' | 'withdrawal';
  status: AnchorTxStatus;
  moreInfoUrl?: string;
  amountIn?: number;
  amountOut?: number;
  /** What the payout is in, e.g. "USD" or "XLM" (from SEP-38 asset ids like iso4217:USD). */
  amountOutAsset?: string;
  fee?: number;
  feeAsset?: string;
  withdrawAccount?: string;
  memo?: string;
  memoType?: 'text' | 'id' | 'hash';
  stellarTxId?: string;
  message?: string;
  startedAt?: string;
};

export const DONE: AnchorTxStatus[] = ['completed', 'refunded', 'expired', 'error', 'no_market', 'too_small', 'too_large'];

export class AnchorError extends Error {}

async function json(r: Response) {
  const text = await r.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 200) };
  }
  if (!r.ok) throw new AnchorError(body?.error ?? `Anchor returned ${r.status}`);
  return body;
}

export async function discover(domain: string, assetCode = 'native'): Promise<AnchorInfo> {
  let toml: any;
  try {
    toml = await StellarToml.Resolver.resolve(domain);
  } catch {
    throw new AnchorError(`Could not reach ${domain}.`);
  }
  if (!toml.TRANSFER_SERVER_SEP0024 || !toml.WEB_AUTH_ENDPOINT || !toml.SIGNING_KEY)
    throw new AnchorError(`${domain} does not support wallet cash in / cash out (SEP-24).`);
  const info = await json(await fetch(`${toml.TRANSFER_SERVER_SEP0024}/info`));
  const pick = (side: any) => {
    const a = side?.[assetCode];
    return a
      ? { enabled: !!a.enabled, min: a.min_amount, max: a.max_amount, fee: a.fee_fixed != null ? String(a.fee_fixed) : undefined }
      : { enabled: false };
  };
  return {
    domain,
    name: toml.DOCUMENTATION?.ORG_NAME ?? domain,
    signingKey: toml.SIGNING_KEY,
    authEndpoint: toml.WEB_AUTH_ENDPOINT,
    sep24: toml.TRANSFER_SERVER_SEP0024,
    deposit: pick(info.deposit),
    withdraw: pick(info.withdraw),
  };
}

/** SEP-10: get the anchor's challenge, check it really came from the anchor, sign it, trade it for a token. */
export async function authenticate(anchor: AnchorInfo, wallet: Keypair, passphrase: string): Promise<string> {
  const c = await json(await fetch(`${anchor.authEndpoint}?account=${wallet.publicKey()}&home_domain=${encodeURIComponent(anchor.domain)}`));
  const authHost = new URL(anchor.authEndpoint).host;
  // Throws if the challenge is not signed by the anchor's published key, is for another
  // account, or contains anything other than the expected manage_data ops.
  const { tx } = WebAuth.readChallengeTx(c.transaction, anchor.signingKey, c.network_passphrase ?? passphrase, anchor.domain, authHost);
  tx.sign(wallet);
  const r = await json(
    await fetch(anchor.authEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: tx.toXDR() }),
    }),
  );
  if (!r.token) throw new AnchorError('The anchor did not accept the sign-in.');
  return r.token;
}

/** SEP-24: start a cash in / cash out. Returns the anchor's page the user must complete. */
export async function startInteractive(
  anchor: AnchorInfo,
  token: string,
  kind: 'deposit' | 'withdraw',
  opts: { account: string; amount?: number; lang?: string; assetCode?: string },
): Promise<{ id: string; url: string }> {
  const body: Record<string, string> = { asset_code: opts.assetCode ?? 'native', account: opts.account };
  if (opts.amount) body.amount = String(opts.amount);
  if (opts.lang) body.lang = opts.lang;
  const r = await json(
    await fetch(`${anchor.sep24}/transactions/${kind}/interactive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  );
  if (!r.url || !r.id) throw new AnchorError('The anchor did not return a page to continue.');
  return { id: r.id, url: r.url };
}

/** "iso4217:USD" -> "USD", "stellar:native" -> "XLM", "stellar:USDC:G…" -> "USDC". */
export function assetLabel(id?: string): string | undefined {
  if (!id) return undefined;
  const [scheme, code] = id.split(':');
  if (scheme === 'stellar') return code === 'native' ? 'XLM' : code;
  return code ?? id;
}

export const formatAmount = (n: number, asset = 'XLM') => `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${asset}`;

export async function getTransaction(anchor: AnchorInfo, token: string, id: string): Promise<AnchorTx> {
  const r = await json(await fetch(`${anchor.sep24}/transaction?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } }));
  const t = r.transaction;
  const num = (v: any) => (v == null || v === '' ? undefined : Number(v));
  return {
    id: t.id,
    kind: t.kind,
    status: t.status,
    moreInfoUrl: t.more_info_url,
    amountIn: num(t.amount_in),
    amountOut: num(t.amount_out),
    amountOutAsset: assetLabel(t.amount_out_asset),
    fee: num(t.fee_details?.total ?? t.amount_fee),
    feeAsset: assetLabel(t.fee_details?.asset ?? t.amount_fee_asset ?? t.amount_in_asset),
    withdrawAccount: t.withdraw_anchor_account,
    memo: t.withdraw_memo,
    memoType: t.withdraw_memo_type,
    stellarTxId: t.stellar_transaction_id,
    message: t.message,
    startedAt: t.started_at,
  };
}
