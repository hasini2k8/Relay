# RELAY: what makes it different

*Report, November 2026. RELAY runs on the Stellar test network. Every claim marked "tested" was checked with live transactions (`scripts/*.ts`) and in the app.*

## 0. The niche: Family Care Pot

**Who it is for:** brothers and sisters who live in different countries and share the cost of caring for a parent in India. A typical family has one sibling in Toronto, one in Dubai and one in London, with Amma at home in Pune.

**The problem today:**
- Each sibling sends money separately, so nobody has one picture of what was paid, by whom, and for what. Elder-care guides for NRI families recommend keeping a written role map and a shared care log so money stays visible to every sibling ([Samarth](https://care.samarth.community/?p=131462)), which shows the gap in the tools families have.
- Whoever holds the money can spend it alone, and so can anyone who talks them into it.
- Existing "shared money" products don't fit a family spread across countries:
  - NRI joint accounts: the resident joint holder can operate the account only if the NRI holder dies ([ICICI](https://www.icici.bank.in/nri-banking/nriedge/nri-articles/managing-your-familys-banking-and-financial-needs-while-you-are-abroad)).
  - Revolut joint accounts: two people at most, and both must be registered in the same country ([Revolut terms](https://www.revolut.com/legal/joint-accounts/)).
  - Revolut Group Vaults: support more people but are not bank accounts you can pay from ([Fintech Compass](https://fintechcompass.net/personal-bank-accounts/revolut/revolut-joint-accounts/)).
  - Splitwise-style apps: only track who owes whom; they don't hold or move money.

**What RELAY does:**
1. **One pot, many countries.** Any number of family members, wherever they live, are co-owners of one Stellar account.
2. **No one spends alone.** The family chooses the rule, for example *2 of 3 must approve*. The pot's own key is disabled, so the network rejects any payment without that many member signatures.
3. **Every rupee visible.** The app reads the ledger straight from Stellar: who paid in and how much, every payment out with its purpose ("Medicine"), the payee, and exactly who approved it.
4. **Pay the provider directly.** Money can go straight to a pharmacy or hospital wallet, even one that has no wallet yet, instead of passing through a person.
5. **Approval by WhatsApp link.** A request is a signed Stellar transaction shared as a link or QR code. Each sibling opens it, sees the amount, payee, purpose and approvals so far, and adds a signature. The approval that completes the count pays it immediately.
6. **No server.** Pot names and member names are stored on the account itself, and each member's app finds its pots on the network (`accounts?signer=`).

> **We found no remittance or family-finance product that lets relatives in different countries pool money for a parent in one fund, require an agreed number of family approvals for every payment out (enforced by the payment network, not by a company), and show every contribution, purpose and approver to the whole family.**

**Tested on live testnet (`scripts/pot-testnet.ts`, all passing):**
- Created a 2-of-3 pot, "Amma's care", for Priya (Toronto), Arjun (Dubai) and Meera (London). The names are stored on-chain, and Meera found the pot from the network alone.
- Priya put in 300 XLM and Arjun put in 250.
- Priya asked to pay 120 XLM to a pharmacy for "Amma BP medicine Nov". **With only her signature, the network rejected the payment.**
- Arjun approved, and the payment went through immediately. The pharmacy, which had no wallet before, received 120 XLM.
- The following were all refused:
  - an outsider trying to approve;
  - a request that went out of date because another payment went first;
  - a corrupted link;
  - a request built by an outsider, which showed 0 family approvals and was rejected by the network.
- The ledger showed: Priya 300, Arjun 250, Meera 0. It listed two payments out, and the medicine payment was marked "approved by Priya + Arjun".

**Tested in the app:** I created the pot, added 300 XLM, and requested 80 XLM to "Apollo Pharmacy" for "Medicine" (1 of 2 approvals). I then opened the link as Arjun and tapped *Approve and sign*, and the app showed "Paid. 80 XLM went to Apollo Pharmacy." The pharmacy's balance on-chain was exactly 80 XLM. The pot showed "Approved by Priya (Toronto), Arjun (Dubai)".

**Limits of the pot:** requests expire after 7 days. If two requests are made at once, only the first one paid stays valid, and the app asks for a new one. Membership can't be changed after creation yet. On mainnet, paying a pharmacy in rupees still needs a licensed anchor.

## 1. The problem

Sending money home has three failures that existing apps only partly solve:

1. **Cost.** In Q1 2025 the global average cost of sending $200 was **6.49%**, against a G20 target of 3% by 2030 ([World Bank, Remittance Prices Worldwide, Issue 53](https://remittanceprices.worldbank.org/sites/default/files/rpw_main_report_and_annex_q125_1_0.pdf)).
2. **Scams.** Fraud aimed at senders, especially older and less digitally confident people, is now big enough that regulators are trying to slow payments down:
   - The UK lets payment providers hold a suspicious outbound payment for up to **4 business days**, and since October 2024 has required banks to reimburse victims of authorised push payment fraud ([FCA FG24/6](https://fca.org.uk/publication/finalised-guidance/fg24-6.pdf); [PSR](https://www.psr.org.uk/information-for-consumers/app-fraud-reimbursement-protections)).
   - India has discussed a **4-hour reversal window** for the first payment over ₹2,000 between two people ([Deccan Herald, 2023](https://www.deccanherald.com/amp/story/india%2Fgovt-in-talks-to-impose-4-hour-delay-for-first-upi-transfer-over-rs-2000-to-curb-digital-payment-fraud-report-2787840)).
   - The RBI has proposed a **cooling-off period of up to one hour** for high-value person-to-person transfers ([Yahoo Finance / Reuters](https://finance.yahoo.com/economy/policy/articles/indian-central-bank-proposes-transaction-070430526.html)).
   - Neither Indian proposal is confirmed as in force.
3. **Lost or stuck money.** Wrong details, or recipients who cannot collect. Undoing a payment usually depends on reaching the company in time.

## 2. What exists today

| | How "undo" works | Scam friction | Recipient with no account | Non-custodial | Language and accessibility |
|---|---|---|---|---|---|
| **Remitly, Western Union, MoneyGram, Wise** (custodial remittance) | Cancel before the money is delivered or picked up; the company refunds it ([Remitly terms](https://www.remitly.com/ca/en/home/errors)) | Company-side fraud screening; the sender doesn't choose a delay | Cash pickup at an agent | No: the company holds the money | Varies; many languages |
| **Banks, UPI** | Generally irreversible once sent; reimbursement after fraud in the UK | Bank decides whether to hold, up to 4 business days in the UK; India proposals pending | No | No | Varies |
| **Valora** (Celo wallet) | "Live Link": send to someone with no wallet, reclaim if unclaimed ([Valora](https://support.valoraapp.com/hc/en-us/articles/25792776151181)) | None | Yes, by link | Yes | English-first |
| **LOBSTR** (Stellar wallet) | "Pending payments" (claimable balances) with time limits; sender listed as a claimant ([LOBSTR](https://lobstr.freshdesk.com/support/solutions/articles/151000001595-sending-pending-payments-claimable-balances-with-lobstr)) | None automatic: a power-user setting | No | Yes | Crypto-literate users |
| **MoneyGram Access via Stellar wallets** | Standard SEP-24 cash in and cash out | Anchor-side KYC | Cash pickup | Partly | Varies |
| **RELAY** | Take back any time until received; enforced by Stellar rules, no support ticket | **Scam Shield: automatic safety hold for new recipients, red-flag check, longer hold if a flag is raised**, enforced on-chain | Claim code or link that creates their wallet | Yes: keys stay on the phone | Hindi and English, read aloud, 3 text sizes, screen-reader labels, 56dp+ buttons |

**To be clear:** each building block exists somewhere. Remitly lets you cancel before delivery. Valora reclaims unclaimed links. LOBSTR exposes time-limited claimable balances. Regulators are designing cooling-off periods. RELAY's contribution is putting them together, below.

## 3. Also unique: Scam Shield on every send

> **RELAY is the first remittance app we found that gives an automatic, risk-based cooling-off period on every payment to a new recipient, where the sender keeps an unconditional undo and no company is involved. The Stellar network itself enforces both the hold and the undo.**

How that differs from each group:

- **Custodial apps (Remitly, Western Union, Wise):** the undo is a request to the company, it works only until they pay out, and the company holds your money while you wait. In RELAY the sender's right to take the money back is written into the payment (a claimable balance with the sender as an unconditional claimant). It works at 3 a.m., if the company is gone, and without a support agent.
- **Bank and UPI cooling-off (UK holds, RBI proposals):** the bank decides whether and when to delay, and the sender cannot shorten or extend it. In RELAY the sender sees the hold, can lengthen it, and can cancel during it. The recipient sees exactly when the money unlocks.
- **Crypto wallets (LOBSTR, Valora):** the same primitives exist, but the user has to know what a "claimable balance with predicates" is. RELAY applies them automatically from plain-language questions ("Were you promised a prize, a job, a loan, or investment profits?"), in Hindi or English, with read-aloud.
- **Everyone:** RELAY combines on one screen flow (a) safety hold plus undo, (b) claim codes for recipients with no wallet, and (c) cash-out to a bank through any SEP-24 anchor. All of it is non-custodial, with fees of about 0.00001 XLM per transaction.

### How Scam Shield works (tested)

1. **First payment to someone not in your saved people** → a 4-question safety check, which can be read aloud:
   - Did someone you met only online or by phone ask for this money?
   - Are you being told to hurry, or to keep it secret?
   - Did someone claim to be from the police, a bank, customs, or the government?
   - Were you promised a prize, a job, a loan, or investment profits?
2. **All "No"** → the default hold is **24 hours**. **Any "Yes"** → a red warning, a "Stop. I will talk to someone first" button, and the default hold becomes **3 days**.
3. **The hold is on-chain.** The recipient's claim rule is `NOT before(releaseAt) AND before(deadline)`; the sender's rule is `unconditional`. During the hold the network rejects the recipient's claim, and the sender can take the money back with one tap.
4. **Saved people** get no hold by default, so regular family payments stay instant.

Live testnet results (`scripts/scam-shield-testnet.ts`, all passing):
- The recipient sees the release time; a claim during the hold is **rejected by the network**.
- A claim after the hold succeeds.
- The sender recovers the money during a 1-hour hold, and the recipient can no longer claim it.
- With no hold, the money can be received immediately.

In-app test: a 100 XLM payment to a new "Investment Agent" contact, with one red flag, was held for 3 days. The recipient's app showed "Safety hold: you can receive it from 15 Nov 2026" with the button disabled. The sender took it back and their balance returned to the starting amount.

## 4. Everything RELAY does, and how it was tested

| Feature | Stellar mechanism | Tested |
|---|---|---|
| Family Care Pot: pooled fund, M-of-N approvals, open ledger | Multisig account (master weight 0, thresholds = M), manageData names, signed-transaction links | `pot-testnet.ts`, in-app (two members) |
| Protected send, take back until received | Claimable balance, sender unconditional | `e2e-testnet.ts`, in-app |
| Scam Shield safety hold | `and(not(before T), before deadline)` predicate | `scam-shield-testnet.ts`, in-app |
| Claim code for someone without a wallet | New account with the sender as co-signer, removed on claim | `e2e-testnet.ts`, in-app (two browsers) |
| Cash out to bank, add money from bank | SEP-1, SEP-10, SEP-24 | `anchor-testnet.ts`; full in-app cash-out against `testanchor.stellar.org` to *completed* |
| Proof of every transaction | Public ledger links (stellar.expert) | in-app |
| Accessibility | Hindi and English, read aloud, text scaling, ARIA and native roles, 7:1 contrast, 56dp+ targets | in-app (web) |

## 5. Limits, stated plainly

- **Testnet only.** Mainnet use needs a licensed anchor that pays out in the target currency (most pay out USDC, and INR payout coverage on Stellar is limited), plus legal review for the target countries.
- **A hold protects only if the sender acts.** It gives time to notice; it cannot stop someone who is determined to send. The red-flag answers depend on honesty.
- **Claim codes are bearer secrets.** Anyone holding the code can claim until the sender cancels.
- **Key backup** is a raw secret key today; social or cloud recovery is not built.
- **Web version** stores the key in browser storage; the phone app uses the secure keychain.
- **"First we found"** is based on public documentation and help pages for the apps listed (searched November 2026), not an exhaustive market survey.
