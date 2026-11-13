import React from 'react';
import { Pressable, View } from 'react-native';
import * as Speech from 'expo-speech';
import { Ionicons } from '@expo/vector-icons';
import * as S from '../stellar';
import { useApp } from '../state';
import { speechLang } from '../i18n';
import { fiat, xlm } from '../price';
import { Button, C, Card, IconButton, Notice, Screen, Txt } from '../ui';
import { PotsCard } from './Pots';
import { claimLink, confirm, openUrl, shareText, useBusy } from '../helpers';

export function Home() {
  const app = useApp();
  const { t, wallet, incoming, outgoing, invites, activity, prices, settings, keypair, nameFor, go, refresh, loading, error, announce, anchorTxs } = app;
  const activeAnchor = anchorTxs.filter((a) => !['completed', 'refunded', 'expired', 'error', 'no_market', 'too_small', 'too_large'].includes(a.status));
  const { busy, err, run } = useBusy();
  const money = wallet?.spendable ?? 0;
  const approx = fiat(money, settings.fiat, prices);
  const now = Date.now() / 1000;
  const when = (secs: number) => new Date(secs * 1000).toLocaleString(settings.lang === 'hi' ? 'hi-IN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const date = (secs?: number) => (secs ? new Date(secs * 1000).toLocaleDateString(settings.lang === 'hi' ? 'hi-IN' : 'en-GB') : '');

  const readAloud = () => {
    const parts = [`${t('balance')}: ${xlm(money)}`];
    if (approx) parts.push(t('approx', { v: approx }));
    if (incoming.length) parts.push(`${t('waitingForYou')}: ${incoming.map((p) => xlm(p.amount)).join(', ')}`);
    Speech.stop();
    Speech.speak(parts.join('. '), { language: speechLang[settings.lang] });
  };

  const receive = (id: string, amount: number) =>
    run(async () => {
      await S.claim(keypair!, id);
      announce(t('receivedBody', { amount: xlm(amount) }));
      await refresh();
    });

  const takeBack = async (amount: number, who: string, fn: () => Promise<unknown>) => {
    if (!(await confirm(t('takeBackConfirm', { amount: xlm(amount), who }), t('takeBack'), t('cancel')))) return;
    await run(async () => {
      await fn();
      await refresh();
    });
  };

  return (
    <Screen
      title={t('appName')}
      right={
        <View style={{ flexDirection: 'row' }}>
          <IconButton icon="refresh" label={t('refresh')} onPress={refresh} />
          <IconButton icon="settings-outline" label={t('settings')} onPress={() => go({ name: 'settings' })} />
        </View>
      }
    >
      {S.NETWORK === 'testnet' ? <Notice tone="warn" icon="flask" title={t('testnetBadge')} /> : null}

      <Card label={`${t('balance')}: ${xlm(money)}${approx ? `, ${t('approx', { v: approx })}` : ''}`}>
        <Txt color={C.muted}>{t('balance')}</Txt>
        <Txt v="huge">{wallet ? xlm(money) : '…'}</Txt>
        {approx ? <Txt color={C.muted}>{t('approx', { v: approx })}</Txt> : null}
      </Card>
      <Button label={t('readAloud')} icon="volume-high" kind="secondary" onPress={readAloud} />

      {err || error ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err ?? error ?? ''} /> : null}

      {incoming.map((p) => (
        <Card key={p.id} tone="success">
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Ionicons name="gift" size={28} color={C.success} />
            <Txt v="heading" color={C.success} style={{ flex: 1 }}>
              {t('waitingForYou')}
            </Txt>
          </View>
          <Txt v="heading">{t('waitingFrom', { amount: xlm(p.amount), who: nameFor(p.from) })}</Txt>
          {p.releaseAt && p.releaseAt > now ? (
            <Notice tone="warn" icon="time" title={t('heldForYou', { time: when(p.releaseAt) })} body={t('heldForYouHelp')} />
          ) : p.deadline ? (
            <Txt color={C.muted}>{t('receiveBy', { date: date(p.deadline) })}</Txt>
          ) : null}
          <Button label={t('receiveNow')} icon="download" kind="success" busy={busy} disabled={!!p.releaseAt && p.releaseAt > now} onPress={() => receive(p.id, p.amount)} />
        </Card>
      ))}

      <Button label={t('send')} icon="paper-plane" onPress={() => go({ name: 'send' })} disabled={!wallet?.exists} />
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        <Button style={{ flex: 1, minWidth: 150 }} label={t('receive')} icon="qr-code" kind="secondary" onPress={() => go({ name: 'receive' })} />
        <Button style={{ flex: 1, minWidth: 150 }} label={t('claimCode')} icon="gift" kind="secondary" onPress={() => go({ name: 'claim' })} />
      </View>

      {wallet?.exists ? <PotsCard /> : null}

      <Button label={t('cashOut')} hint={t('cashOutHint')} icon="business" kind="secondary" onPress={() => go({ name: 'anchor', kind: 'withdraw' })} disabled={!wallet?.exists} />

      {activeAnchor.length ? (
        <View style={{ gap: 10 }}>
          <Txt v="heading">{t('inProgress')}</Txt>
          {activeAnchor.map((a) => (
            <Card key={a.id}>
              <Txt bold>{`${a.kind === 'withdraw' ? t('cashOut') : t('cashIn')}${a.amount ? ` · ${xlm(a.amount)}` : ''}`}</Txt>
              <Txt v="small" color={C.muted}>{a.domain}</Txt>
              <Button label={t('open')} icon="arrow-forward" kind="secondary" onPress={() => go({ name: 'anchor', kind: a.kind, resumeId: a.id })} />
            </Card>
          ))}
        </View>
      ) : null}

      {outgoing.length + invites.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Txt v="heading">{t('notYetReceived')}</Txt>
          <Txt color={C.muted}>{t('notYetReceivedHelp')}</Txt>
          {outgoing.map((p) => (
            <Card key={p.id}>
              <Txt bold>{`${xlm(p.amount)} → ${nameFor(p.to)}`}</Txt>
              {p.releaseAt && p.releaseAt > now ? (
                <Txt bold color={C.warn}>{t('onHoldUntil', { time: when(p.releaseAt) })}</Txt>
              ) : p.deadline ? (
                <Txt color={C.muted}>{t('receiveBy', { date: date(p.deadline) })}</Txt>
              ) : null}
              <Button label={t('takeBack')} icon="arrow-undo" kind="danger" busy={busy} onPress={() => takeBack(p.amount, nameFor(p.to), () => S.claim(keypair!, p.id))} />
            </Card>
          ))}
          {invites.map((i) => (
            <Card key={i.publicKey}>
              <Txt bold>{`${xlm(i.amount)} → ${i.name}`}</Txt>
              <Txt color={C.muted}>{t('inviteFor')}</Txt>
              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                <Button
                  style={{ flex: 1, minWidth: 140 }}
                  label={t('share')}
                  icon="share-social"
                  kind="secondary"
                  onPress={() => shareText(`${t('sentInvite', { who: i.name })}\n${claimLink(i.secret)}\n${i.secret}`)}
                />
                <Button
                  style={{ flex: 1, minWidth: 140 }}
                  label={t('takeBack')}
                  icon="arrow-undo"
                  kind="danger"
                  busy={busy}
                  onPress={() => takeBack(i.amount, i.name, () => S.cancelInvite(keypair!, i.publicKey))}
                />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      <Button label={t('cashIn')} icon="card" kind="secondary" onPress={() => go({ name: 'anchor', kind: 'deposit' })} disabled={!wallet?.exists} />
      {S.canUseFriendbot ? (
        <Button
          label={t('addMoney')}
          hint={t('addMoneyHint')}
          icon="add-circle"
          kind="secondary"
          busy={busy}
          onPress={() => run(async () => { await S.fundWithFriendbot(keypair!.publicKey()); await refresh(); })}
        />
      ) : null}

      <View style={{ gap: 8 }}>
        <Txt v="heading">{t('activity')}</Txt>
        {activity.length === 0 ? <Txt color={C.muted}>{loading ? '…' : t('noActivity')}</Txt> : null}
        {activity.map((a) => {
          const incomingKind = a.kind === 'in' || a.kind === 'claimed' || a.kind === 'setup';
          const cashOut = anchorTxs.find((x) => x.paidHash && x.paidHash === a.hash);
          const label = cashOut ? `${t('cashOut')} (${cashOut.domain})` : t(`act_${a.kind}` as any, { who: nameFor(a.counterparty) });
          const when = new Date(a.at).toLocaleString(settings.lang === 'hi' ? 'hi-IN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
          const amount = `${incomingKind ? '+' : '−'}${xlm(a.amount)}`;
          return (
            <Pressable
              key={a.id}
              accessibilityRole="link"
              accessibilityLabel={`${label}, ${amount}, ${when}`}
              accessibilityHint={t('viewOnStellar')}
              onPress={() => openUrl(S.explorerTx(a.hash))}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 8, borderBottomWidth: 1, borderColor: '#D5DBE3' }}
            >
              <Ionicons name={incomingKind ? 'arrow-down-circle' : 'arrow-up-circle'} size={30} color={incomingKind ? C.success : C.primary} />
              <View style={{ flex: 1 }}>
                <Txt>{label}</Txt>
                <Txt v="small" color={C.muted}>{when}</Txt>
              </View>
              <Txt bold color={incomingKind ? C.success : C.text}>{amount}</Txt>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
