// Live check of the anchor integration against SDF's testnet reference anchor.
// Run: node scripts/anchor-testnet.ts
import * as S from '../src/stellar.ts';
import * as A from '../src/anchor.ts';

const ok = (c: boolean, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ✓', m); };
const wallet = S.newKeypair();
await S.fundWithFriendbot(wallet.publicKey());

const anchor = await A.discover('testanchor.stellar.org');
ok(anchor.withdraw.enabled && anchor.deposit.enabled, `discovered ${anchor.name}: withdraw ${anchor.withdraw.min}-${anchor.withdraw.max} XLM`);

const token = await A.authenticate(anchor, wallet, S.passphrase);
ok(token.split('.').length === 3, 'SEP-10 sign-in returned a session token');

const w = await A.startInteractive(anchor, token, 'withdraw', { account: wallet.publicKey(), amount: 5, lang: 'en' });
ok(w.url.startsWith('https://'), 'SEP-24 withdrawal started: ' + w.url.slice(0, 60) + '…');
const t = await A.getTransaction(anchor, token, w.id);
ok(t.kind === 'withdrawal' && t.status === 'incomplete', `status is "${t.status}" until the user finishes the anchor page`);

try { await A.authenticate({ ...anchor, signingKey: S.newKeypair().publicKey() }, wallet, S.passphrase); ok(false, 'forged key accepted'); }
catch (e: any) { ok(true, 'challenge from the wrong signer is rejected'); }

const d = await A.startInteractive(anchor, token, 'deposit', { account: wallet.publicKey(), amount: 5 });
ok(!!d.url, 'SEP-24 deposit started');
console.log('\nOpen to finish the withdrawal by hand:', w.url, '\nwallet secret (testnet):', wallet.secret(), '\ntx id:', w.id);
