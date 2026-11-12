// Live check of Scam Shield (safety hold) on testnet. Run: node scripts/scam-shield-testnet.ts
import * as S from '../src/stellar.ts';

const ok = (c: boolean, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ✓', m); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sender = S.newKeypair(), recipient = S.newKeypair();
await Promise.all([S.fundWithFriendbot(sender.publicKey()), S.fundWithFriendbot(recipient.publicKey())]);

console.log('1. Held payment: recipient blocked during the hold, allowed after');
const p = await S.protectedSend(sender, recipient.publicKey(), 30, { holdSeconds: 20 });
const [inc] = await S.incoming(recipient.publicKey());
ok(inc?.releaseAt === p.releaseAt && inc?.deadline === p.deadline, `recipient sees release time ${new Date(p.releaseAt! * 1000).toISOString()}`);
try { await S.claim(recipient, p.balanceId); ok(false, 'claim during hold should fail'); }
catch (e: any) { ok(e.code === 'cannot_claim', 'claim during hold rejected by the network'); }
await sleep(26000);
const r0 = (await S.getWallet(recipient.publicKey())).balance;
await S.claim(recipient, p.balanceId);
ok((await S.getWallet(recipient.publicKey())).balance - r0 > 29.99, 'claim after hold succeeds');

console.log('2. Scam caught during the hold: sender takes it back');
const q = await S.protectedSend(sender, recipient.publicKey(), 40, { holdSeconds: 3600 });
const s0 = (await S.getWallet(sender.publicKey())).balance;
await S.claim(sender, q.balanceId);
ok((await S.getWallet(sender.publicKey())).balance - s0 > 39.99, 'sender recovered 40 XLM during the hold');
try { await S.claim(recipient, q.balanceId); ok(false, 'should be gone'); }
catch (e: any) { ok(e.code === 'gone', 'recipient can no longer claim it'); }

console.log('3. No hold for trusted people');
const n = await S.protectedSend(sender, recipient.publicKey(), 5);
const [i2] = await S.incoming(recipient.publicKey());
ok(i2.releaseAt === undefined, 'no release time');
await S.claim(recipient, n.balanceId);
ok(true, 'received immediately');
console.log('\nScam Shield checks passed.');
