# RELAY: Family Care Pots for parents back home

A mobile wallet (iOS, Android, web) on the **Stellar** network for brothers and sisters living in different countries who share the cost of caring for their parents in India. Every payment is a real Stellar transaction. Nothing is simulated.

**The niche: Family Care Pot.** Siblings in Toronto, Dubai and London pay into one pot for Amma. **No one can spend it alone:** every payment out (medicine, hospital, rent) needs the number of family approvals they agreed on, such as 2 of 3, and the Stellar network enforces that rule. Everyone sees who paid in, what was spent, on what, and who approved it, so there are no more "who paid for what" arguments, and no single person (or scammer) can drain the parents' money. A request travels as a link on WhatsApp; the second approval pays the pharmacy directly.

**Also built in:** *Scam Shield*. Payments to someone new wait in a safety hold that the Stellar network itself enforces: the recipient can't take the money until the hold ends, and you can take it back any time until they do. No company or support ticket is involved. A plain-language check in Hindi or English lengthens the hold if anything looks like a scam. See **[REPORT.md](REPORT.md)** for the comparison with Remitly, Western Union, Wise, banks/UPI, Valora and LOBSTR.

**Live (Stellar testnet):** [hasini2k8.github.io/Relay](https://hasini2k8.github.io/Relay/) · [relay-wallet.vercel.app](https://relay-wallet.vercel.app)

**Report:** [REPORT.md](REPORT.md) covers the problem, a comparison with current remittance apps, what is unique, test results and limits.

## The problem

People sending money home, such as migrant workers, students and caregivers, run into three problems:

1. **Money gets lost.** One wrong digit in an account number, a recipient who can't collect, or a closed wallet means the money is stuck or gone. Most apps have no "undo"; recovering it takes weeks of support tickets, if it works at all.
2. **It is expensive and slow.** The global average cost of sending $200 is around 6% (World Bank, Remittance Prices Worldwide). Transfers take days.
3. **Apps shut people out.** Many recipients are elderly, read poorly, use screen readers, or don't speak English, and they don't have a bank app.

## How RELAY solves it

| Problem | RELAY | Stellar feature that enforces it |
|---|---|---|
| Siblings abroad share a parent's costs; it is unclear who paid what, and one person (or a scammer talking to them) can misuse the money | **Family Care Pot.** One shared pot; payments out need *M of N* family approvals; contributions, spending, purposes and approvers are visible to everyone; bills can go straight to a pharmacy or hospital | Multisig account: each member is a signer, the pot's own key is disabled (master weight 0), and all thresholds equal *M*. Names are stored on-chain (manageData); pots are found with `accounts?signer=`; requests are signed transactions shared as links |
| Money sent to the wrong person is lost | **Protected send.** The money waits for the recipient to accept it. Until they do, the sender can **take it back** with one tap. After 30 days only the sender can claim it. | Claimable balances with predicates: the recipient can claim *before* the deadline, and the sender can always claim. The network enforces this, not a RELAY server. |
| Recipient has no wallet or bank app | **Claim code.** The sender gets a link, QR code and code to share by WhatsApp or SMS. Opening it creates the recipient's wallet with the money already in it. The sender can still take it back until it is claimed. | A new account is created and funded in one transaction, with the sender added as a co-signer. Claiming removes the sender's signature, so only the recipient controls the money. |
| High fees, slow transfers | The network fee is 0.00001 XLM (a tiny fraction of a cent). Payments settle in about 5 seconds. | Stellar consensus |
| Money must end up as cash or in a bank | **Cash out to bank / Add money from bank** through a licensed Stellar **anchor**. The anchor's own page collects KYC and bank details (RELAY never sees them). RELAY then sends the money to the anchor with the memo it asked for, and tracks the payout until it is done. | SEP-1 (anchor discovery), SEP-10 (signing in by signing the anchor's challenge), SEP-24 (interactive deposit and withdrawal) |
| Scams push people to send fast | **Scam Shield**: the first payment to a new person gets a 4-question check (read aloud) and a safety hold (24 h, or 3 days if anything looks wrong). The recipient sees when it unlocks; the sender can cancel during the hold. Saved people get no hold. | Claimable-balance predicate `and(not(before releaseAt), before deadline)` for the recipient; `unconditional` for the sender |
| Hard to use | Large buttons, plain language, Hindi and English, three text sizes, **Read aloud**, full screen-reader labels, and a check-before-sending screen | — |
| "Did it really go through?" | Every history item links to the public transaction on stellar.expert. | Public ledger |

There is no RELAY server. The wallet key is stored in the phone's secure keychain, and the app talks directly to Stellar Horizon.

## Run it

```bash
npm install
npx expo start
```

- **On your phone:** install **Expo Go** and scan the QR code shown in the terminal.
- **In a browser:** press `w`, or run `npm run web` and open http://localhost:8081.

To try both sides on one computer, open `http://localhost:8081` and `http://127.0.0.1:8081`. They are separate origins, so each one acts as a separate phone with its own wallet.

### Demo (2 minutes)
1. Phone A: **Create my wallet**. On testnet it is funded with 10,000 practice XLM.
2. **Send money → They do not have RELAY**, enter 50, then check and send. Share the claim code.
3. Phone B: open the link, or choose **I got a claim code**. You see 50 XLM from the sender. Tap **Receive and create my wallet**.
4. Phone B: **Send money** to Phone A's address (Phone A → **Receive** shows a QR code and the address). The payment is protected.
5. Phone A sees **Money is waiting for you**. Either Phone A receives it, or Phone B taps **Take it back**.
6. Tap any history item to see the transaction on stellar.expert.

### Cash out (anchor)
On testnet RELAY uses SDF's reference anchor, `testanchor.stellar.org`, which is a real SEP-24 server. **Cash out to bank** → amount (1–10 XLM) → the anchor's page opens; fill in its test form → back in RELAY, confirm **Send … to Stellar Development Foundation** → RELAY follows the status until it says *completed*. To use another anchor, set its domain in **Settings → Money transfer partner**. Unfinished cash-outs appear on Home under *In progress with your bank*.

### Verify the Stellar flows from the command line
```bash
node scripts/e2e-testnet.ts
```
```bash
node scripts/anchor-testnet.ts
node scripts/scam-shield-testnet.ts
node scripts/pot-testnet.ts
```
Against the live testnet anchor, this checks discovery, SEP-10 sign-in, rejection of a challenge signed by the wrong key, and starting both a deposit and a withdrawal.

The first script creates fresh testnet wallets and runs every flow against the live network: protected send and receive, take-back from a wrong address, double-take-back rejection, claim code undo, claim code into a new wallet, claim code into an existing wallet, and history.

## Code

| File | What it does |
|---|---|
| `src/stellar.ts` | All Stellar logic: wallet, protected send, claim and take-back, claim codes, history, error messages in plain words |
| `src/pot.ts` | Family Care Pot: create a multisig pot, contribute, propose / approve / submit spending, ledger of contributions and approvals |
| `src/screens/Pots.tsx` | Pot screens: create, pot view, ask to pay, approve from a link |
| `src/anchor.ts` | Anchor client: stellar.toml discovery, SEP-10 challenge check and signing, SEP-24 start and status |
| `src/screens/CashOut.tsx` | Cash out / add money: amount → anchor page → confirm send → processing → done, resumable |
| `src/state.tsx` | Wallet, settings, contacts, outstanding claim codes, 15-second refresh, deep links (`relay://claim?code=…`, `/?claim=…`) |
| `src/ui.tsx` | Accessible components: 56dp+ touch targets, contrast of at least 7:1, roles, labels, live regions, text scaling |
| `src/i18n.ts` | English and Hindi strings |
| `src/screens/` | Welcome, Home, Send (who → amount → check → done), Receive, Claim, Settings |
| `scripts/e2e-testnet.ts` | Live testnet test |

## Going to mainnet: what's real and what isn't yet

- **Real now:** Stellar transactions, the claimable balance and co-signer protection, keys in the keychain, live XLM price for the approximate ₹/CA$/US$ display.
- **Testnet:** The app runs on Stellar **testnet** (practice money, shown in a banner). To switch, change `NETWORK` in `src/stellar.ts` to `'public'`. Friendbot funding is hidden automatically, and users fund their wallet by sending XLM to their address.
- **Cash out on mainnet:** set the network to `'public'` and set **Settings → Money transfer partner** to a mainnet anchor that pays out in the currency you need. The testnet anchor pays out XLM in test mode; most mainnet anchors cash out **USDC**, so you would add a USDC trustline and a swap step (Stellar path payment). Check which anchors serve India before launching; INR payout coverage on Stellar is limited.
- **Not built yet:** Key backup is a raw secret key today; a production version should add an encrypted cloud backup or social recovery.
- **Claim codes are bearer secrets:** anyone holding the code can claim the money. The sender can take the money back until it is claimed, and the app tells people to share the code only with the recipient.
