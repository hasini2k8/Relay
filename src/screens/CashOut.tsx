// Cash out to a bank (SEP-24 withdraw) or add money from a bank (SEP-24 deposit),
// through the anchor set in Settings. Steps the user sees:
//   amount → anchor's own page (KYC + bank details) → [cash out: confirm send] → processing → done
import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as S from '../stellar';
import * as A from '../anchor';
import { useApp } from '../state';
import { fiat, xlm } from '../price';
import { Button, C, Card, Field, Notice, Screen, Txt } from '../ui';
import { View } from 'react-native';
import { useBusy } from '../helpers';

// One session token per anchor for as long as the app is open.
const tokens: Record<string, string> = {};

const PROCESSING: A.AnchorTxStatus[] = ['pending_user_transfer_complete', 'pending_external', 'pending_anchor', 'pending_stellar', 'pending_trust', 'pending_user'];

async function openPage(url: string) {
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
  else await WebBrowser.openBrowserAsync(url);
}

export function CashOut({ kind, resumeId }: { kind: 'deposit' | 'withdraw'; resumeId?: string }) {
  const { t, keypair, wallet, settings, prices, back, saveAnchorTx, refresh, announce } = useApp();
  const [anchor, setAnchor] = useState<A.AnchorInfo | null>(null);
  const [amountText, setAmountText] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [txId, setTxId] = useState<string | undefined>(resumeId);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [tx, setTx] = useState<A.AnchorTx | null>(null);
  const { busy, err, run } = useBusy();
  const announced = useRef<string>('');
  const domain = settings.anchorDomain.trim();
  const side = kind === 'withdraw' ? anchor?.withdraw : anchor?.deposit;
  const name = anchor?.name ?? domain;

  const token = async (a: A.AnchorInfo, fresh = false) => {
    if (!tokens[a.domain] || fresh) tokens[a.domain] = await A.authenticate(a, keypair!, S.passphrase);
    return tokens[a.domain];
  };

  useEffect(() => {
    if (!domain) return;
    run(async () => setAnchor(await A.discover(domain)));
  }, [domain]);

  // Follow the transaction while this screen is open.
  useEffect(() => {
    if (!anchor || !txId) return;
    let stop = false;
    const poll = async () => {
      try {
        let tk = await token(anchor);
        let next: A.AnchorTx;
        try {
          next = await A.getTransaction(anchor, tk, txId);
        } catch {
          tk = await token(anchor, true);
          next = await A.getTransaction(anchor, tk, txId);
        }
        if (stop) return;
        setTx(next);
        saveAnchorTx({ id: next.id, kind, domain: anchor.domain, amount: next.amountIn, status: next.status, createdAt: Date.now() });
        if (announced.current !== next.status) {
          announced.current = next.status;
          if (next.status === 'completed') {
            announce(kind === 'withdraw' ? t('step_doneOut', { amount: payout(next) }) : t('step_doneIn', { amount: payout(next) }));
            refresh();
          }
        }
      } catch {}
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [anchor, txId]);

  const amount = Number(amountText.replace(',', '.'));

  const start = () =>
    run(async () => {
      if (!anchor || !side) return;
      if (!amount || (side.min && amount < side.min) || (side.max && amount > side.max))
        return setAmountError(t('outsideLimits', { min: xlm(side.min ?? 0), max: xlm(side.max ?? amount) }));
      if (kind === 'withdraw' && amount > (wallet?.spendable ?? 0) - 0.01) return setAmountError(t('tooMuch'));
      const r = await A.startInteractive(anchor, await token(anchor), kind, { account: keypair!.publicKey(), amount, lang: settings.lang });
      saveAnchorTx({ id: r.id, kind, domain: anchor.domain, amount, status: 'incomplete', createdAt: Date.now() });
      setPageUrl(r.url);
      setTxId(r.id);
      await openPage(r.url);
    });

  const pay = () =>
    run(async () => {
      if (!tx?.withdrawAccount || !tx.amountIn) return;
      const memo = tx.memo ? { type: tx.memoType ?? 'text', value: tx.memo } : undefined;
      const { hash } = await S.payWithMemo(keypair!, tx.withdrawAccount, tx.amountIn, memo);
      saveAnchorTx({ id: tx.id, kind, domain: anchor!.domain, amount: tx.amountIn, status: 'pending_stellar', paidHash: hash, createdAt: Date.now() });
      setTx({ ...tx, status: 'pending_stellar' });
      refresh();
    });

  const title = kind === 'withdraw' ? t('cashOut') : t('cashIn');

  if (!domain) {
    return (
      <Screen title={title} onBack={back}>
        <Notice tone="warn" icon="information-circle" title={t('anchorMissing')} />
      </Screen>
    );
  }

  const status = tx?.status;
  const feeText = tx?.fee ? A.formatAmount(tx.fee, tx.feeAsset ?? 'XLM') : null;
  const money = (n?: number) => (n != null ? xlm(n) : '');
  const approx = (n?: number) => (n != null ? fiat(n, settings.fiat, prices) : null);

  return (
    <Screen title={title} onBack={back}>
      {anchor ? (
        <Card>
          <Txt bold>{t('partner', { name, domain: anchor.domain })}</Txt>
          <Txt color={C.muted}>{t('partnerPrivacy', { name })}</Txt>
        </Card>
      ) : null}
      {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : null}

      {!txId ? (
        anchor && side ? (
          <>
            <Field
              label={`${t('amount')} (XLM)`}
              value={amountText}
              onChangeText={(v) => { setAmountText(v.replace(/[^0-9.,]/g, '')); setAmountError(null); }}
              keyboardType="decimal-pad"
              placeholder="0"
              error={amountError}
            />
            {amount > 0 && approx(amount) ? <Txt accessibilityLiveRegion="polite">{t('approx', { v: approx(amount)! })}</Txt> : null}
            {side.min != null && side.max != null ? <Txt color={C.muted}>{t('limits', { min: xlm(side.min), max: xlm(side.max) })}</Txt> : null}
            <Button label={busy ? t('connecting', { name }) : t('continueTo', { name })} icon="open-outline" busy={busy} disabled={!side.enabled} onPress={start} />
          </>
        ) : (
          <Txt color={C.muted}>{busy ? t('connecting', { name }) : ''}</Txt>
        )
      ) : !status || status === 'incomplete' ? (
        <>
          <Notice tone="warn" icon="create" title={t('step_details', { name })} body={t('step_detailsHelp', { name })} />
          {pageUrl || tx?.moreInfoUrl ? <Button label={t('openPageAgain')} icon="open-outline" kind="secondary" onPress={() => openPage(pageUrl ?? tx!.moreInfoUrl!)} /> : null}
        </>
      ) : status === 'pending_user_transfer_start' && kind === 'withdraw' ? (
        <>
          <Notice tone="success" icon="checkmark-circle" title={t('step_send', { amount: money(tx!.amountIn), name })} body={t('step_sendHelp', { name })} />
          <Card label={`${t('amount')}: ${money(tx!.amountIn)}`}>
            <Txt color={C.muted}>{t('amount')}</Txt>
            <Txt v="huge">{money(tx!.amountIn)}</Txt>
            {approx(tx!.amountIn) ? <Txt color={C.muted}>{t('approx', { v: approx(tx!.amountIn)! })}</Txt> : null}
            {tx!.amountOut != null ? <Row label={t('youGet')} value={payout(tx!)} /> : null}
            {feeText ? <Row label={t('partnerFee')} value={feeText} /> : null}
          </Card>
          <Button label={t('confirmSend', { amount: money(tx!.amountIn), name })} icon="paper-plane" busy={busy} onPress={pay} />
        </>
      ) : status === 'completed' ? (
        <Notice
          tone="success"
          icon="checkmark-circle"
          title={kind === 'withdraw' ? t('step_doneOut', { amount: payout(tx!) }) : t('step_doneIn', { amount: payout(tx!) })}
        />
      ) : A.DONE.includes(status) ? (
        <Notice tone="danger" icon="close-circle" title={t('step_failed')} body={t('step_failedHelp', { name, status: tx?.message ?? status })} />
      ) : (
        <Notice tone="warn" icon="time" title={t('step_processing', { name })} body={t('step_processingHelp')} />
      )}

      {tx?.moreInfoUrl && status && status !== 'incomplete' ? (
        <Button label={t('anchorReceipt', { name })} icon="document-text" kind="secondary" onPress={() => openPage(tx.moreInfoUrl!)} />
      ) : null}
      {status && (A.DONE.includes(status) || PROCESSING.includes(status)) ? <Button label={t('done')} icon="home" onPress={back} /> : null}
    </Screen>
  );
}

function payout(tx: A.AnchorTx) {
  const n = tx.amountOut ?? tx.amountIn ?? 0;
  return A.formatAmount(n, tx.amountOut != null ? tx.amountOutAsset ?? 'XLM' : 'XLM');
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Txt color={C.muted}>{label}</Txt>
      <Txt bold>{value}</Txt>
    </View>
  );
}
