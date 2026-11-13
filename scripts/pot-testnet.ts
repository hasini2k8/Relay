// Live check of Family Care Pot on testnet. Run: node scripts/pot-testnet.ts
import { Horizon, Networks, TransactionBuilder, Transaction } from '@stellar/stellar-sdk';
import * as P from '../src/pot.ts';
import * as S from '../src/stellar.ts';

const net: P.Net = { server: new Horizon.Server('https://horizon-testnet.stellar.org'), passphrase: Networks.TESTNET };
const ok = (c: boolean, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ✓', m); };
const priya = S.newKeypair(), arjun = S.newKeypair(), meera = S.newKeypair();
const pharmacy = S.newKeypair().publicKey(); // a provider with no wallet yet
await Promise.all([priya, arjun, meera].map((k) => S.fundWithFriendbot(k.publicKey())));

console.log('1. Create a 2-of-3 pot for Amma');
const { potId } = await P.createPot(net, priya, "Amma's care", [
  { address: priya.publicKey(), name: 'Priya (Toronto)' },
  { address: arjun.publicKey(), name: 'Arjun (Dubai)' },
  { address: meera.publicKey(), name: 'Meera (London)' },
], 2);
let pot = await P.getPot(net, potId);
ok(pot.name === "Amma's care" && pot.approvals === 2 && pot.members.length === 3, `pot "${pot.name}", ${pot.approvals} of ${pot.members.length} approvals`);
ok(pot.members.some((m) => m.name === 'Arjun (Dubai)'), 'member names stored on-chain');
ok((await P.myPots(net, meera.publicKey())).includes(potId), 'Meera finds the pot from the network alone');

console.log('2. Contributions');
await P.contribute(net, priya, potId, 300);
await P.contribute(net, arjun, potId, 200);
await P.contribute(net, arjun, potId, 50);
pot = await P.getPot(net, potId);
ok(pot.spendable >= 549, `pot holds ${pot.balance} XLM (${pot.spendable} spendable)`);

console.log('3. One sibling cannot spend alone');
const xdr1 = await P.proposeSpend(net, priya, potId, pharmacy, 120, 'Amma BP medicine Nov');
const p1 = await P.inspectProposal(net, xdr1);
ok(p1.status === 'waiting' && p1.approvedBy.length === 1 && p1.purpose === 'Amma BP medicine Nov', `proposal: ${p1.amount} XLM for "${p1.purpose}", 1 of 2 approvals`);
try { await P.submitProposal(net, xdr1); ok(false, 'single-signature payment should fail'); }
catch (e: any) { ok(e.code === 'not_enough', 'network rejects it with one approval: ' + e.message); }

console.log('4. Second sibling approves via the shared link -> paid');
const r = await P.approveProposal(net, arjun, xdr1);
ok(!!r.submittedHash, 'second approval submits automatically: ' + S.explorerTx(r.submittedHash!));
const ph = await S.getWallet(pharmacy);
ok(ph.exists && ph.balance === 120, 'pharmacy (new wallet) received 120 XLM');

console.log('5. Non-member and stale/forged links are refused');
const xdr2 = await P.proposeSpend(net, meera, potId, pharmacy, 10, 'test');
try { await P.approveProposal(net, S.newKeypair(), xdr2); ok(false, 'outsider approved'); }
catch (e: any) { ok(e.code === 'not_member', 'outsider cannot approve'); }
const xdr3 = await P.proposeSpend(net, priya, potId, pharmacy, 5, 'second request');
await P.approveProposal(net, meera, xdr3);              // 3 goes through first...
try { await P.approveProposal(net, arjun, xdr2); ok(false, 'stale accepted'); }
catch (e: any) { ok(e.code === 'stale', '...so the older request is reported out of date'); }
try { await P.inspectProposal(net, xdr2.slice(0, 60) + '!!' + xdr2.slice(62)); ok(false, 'corrupted accepted'); }
catch (e: any) { ok(e.code === 'bad_link', 'corrupted link refused'); }
const outsider = S.newKeypair();
const forged = await P.proposeSpend(net, outsider, potId, outsider.publicKey(), 100, 'send me money');
const pf = await P.inspectProposal(net, forged);
ok(pf.approvedBy.length === 0, 'request signed by an outsider shows 0 family approvals');
try { await P.submitProposal(net, forged); ok(false, 'forged paid'); }
catch (e: any) { ok(e.code === 'not_enough', 'network refuses to pay it'); }

console.log('6. Transparent ledger');
pot = await P.getPot(net, potId);
const L = await P.ledger(net, pot);
const arjunTotal = L.contributions.find((c) => c.member === arjun.publicKey())?.total;
ok(arjunTotal === 250 && L.contributions[0].member === priya.publicKey(), `contributions: Priya 300, Arjun ${arjunTotal}, Meera 0`);
ok(L.spent.length === 2, `${L.spent.length} payments out`);
const med = L.spent.find((s) => s.purpose === 'Amma BP medicine Nov')!;
ok(med.approvedBy.includes(priya.publicKey()) && med.approvedBy.includes(arjun.publicKey()), 'medicine payment shows Priya + Arjun approved');
console.log('\nFamily Care Pot checks passed. Pot:', S.explorerAccount(potId));
