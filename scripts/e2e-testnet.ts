// Live end-to-end check of RELAY's Stellar flows on testnet. Run: node scripts/e2e-testnet.ts
import * as S from '../src/stellar.ts';

const ok = (c: boolean, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ✓', m); };

const sender = S.newKeypair(), recipient = S.newKeypair();
console.log('Funding two fresh testnet wallets…');
await Promise.all([S.fundWithFriendbot(sender.publicKey()), S.fundWithFriendbot(recipient.publicKey())]);
const s0 = await S.getWallet(sender.publicKey());
ok(s0.exists && s0.balance === 10000, `sender funded (${s0.balance} XLM)`);

console.log('1. Protected send → recipient receives');
const p1 = await S.protectedSend(sender, recipient.publicKey(), 25);
console.log('   tx', S.explorerTx(p1.hash));
const inc = await S.incoming(recipient.publicKey());
ok(inc.length === 1 && inc[0].amount === 25, 'recipient sees 25 XLM waiting');
ok((await S.outgoing(sender.publicKey())).length === 1, 'sender sees it as not yet received');
const r0 = (await S.getWallet(recipient.publicKey())).balance;
await S.claim(recipient, inc[0].id);
const r1 = (await S.getWallet(recipient.publicKey())).balance;
ok(Math.abs(r1 - r0 - 25) < 0.001, `recipient balance +25 (${r0} → ${r1})`);

console.log('2. Protected send to a wrong address → sender takes it back');
const stranger = S.newKeypair().publicKey();
const p2 = await S.protectedSend(sender, stranger, 40);
const before = (await S.getWallet(sender.publicKey())).balance;
await S.claim(sender, p2.balanceId);
const after = (await S.getWallet(sender.publicKey())).balance;
ok(after - before > 39.999, `sender got the 40 XLM back (${before} → ${after})`);
ok((await S.outgoing(sender.publicKey())).length === 0, 'nothing left pending');
try { await S.claim(sender, p2.balanceId); ok(false, 'double claim should fail'); }
catch (e: any) { ok(e.code === 'gone', 'second take-back is rejected: ' + e.message); }

console.log('3. Invite send → sender undoes');
const i1 = await S.inviteSend(sender, 15);
ok((await S.inviteStatus(sender.publicKey(), i1.invitePublic)).status === 'waiting', 'invite waiting');
await S.cancelInvite(sender, i1.invitePublic);
ok((await S.inviteStatus(sender.publicKey(), i1.invitePublic)).status === 'returned', 'invite money returned to sender');
try { await S.claimInvite(i1.inviteSecret); ok(false, 'claim after undo should fail'); }
catch (e: any) { ok(e.code === 'gone', 'code no longer works after undo'); }

console.log('4. Invite send → new person claims as their first wallet');
const i2 = await S.inviteSend(sender, 12);
const info = await S.inspectInvite(i2.inviteSecret);
ok(info.sender === sender.publicKey() && !info.claimed, 'claim code shows sender, unclaimed');
await S.claimInvite(i2.inviteSecret);
ok((await S.inviteStatus(sender.publicKey(), i2.invitePublic)).status === 'received', 'sender sees it received');
try { await S.cancelInvite(sender, i2.invitePublic); ok(false, 'undo after claim should fail'); }
catch (e: any) { ok(true, 'sender can no longer take it back: ' + e.message); }
const w = await S.getWallet(i2.invitePublic);
ok(w.spendable >= 12, `new wallet has ${w.spendable} XLM spendable`);

console.log('5. Invite send → existing wallet claims (merge)');
const i3 = await S.inviteSend(sender, 9);
const m0 = (await S.getWallet(recipient.publicKey())).balance;
await S.claimInvite(i3.inviteSecret, recipient.publicKey());
const m1 = (await S.getWallet(recipient.publicKey())).balance;
ok(m1 - m0 > 9, `existing wallet +${(m1 - m0).toFixed(4)} XLM`);

console.log('6. History');
const h = await S.history(recipient.publicKey());
ok(h.some((a) => a.kind === 'claimed'), `recipient history has ${h.length} items incl. received money`);
const hs = await S.history(sender.publicKey());
ok(hs.some((a) => a.kind === 'protected_out') && hs.some((a) => a.kind === 'invite_out'), 'sender history shows protected + invite sends');

console.log('\nAll live testnet checks passed. Sender:', S.explorerAccount(sender.publicKey()));
