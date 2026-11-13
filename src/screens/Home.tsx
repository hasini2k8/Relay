import React from 'react';
import { Pressable, View } from 'react-native';
import * as Speech from 'expo-speech';
import { Ionicons } from '@expo/vector-icons';
import * as S from '../stellar';
import { useApp } from '../state';
import { speechLang } from '../i18n';
import { fiat, xlm } from '../price';
import { ActionTile, Button, C, Card, FadeIn, GradientCard, IconButton, Notice, Pill, Pulse, Screen, SectionTitle, Skeleton, Txt } from '../ui';
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
  const loc = settings.lang === 'hi' ? 'hi-IN' : 'en-GB';
  const when = (secs: number) => new Date(secs * 1000).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' });
  const date = (secs?: number) => (secs ? new Date(secs * 1000).toLocaleDateString(loc) : '');

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
      title={t('hello')}
      subtitle={`${t('appName')} · ${t('pots')}`}
      right={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <IconButton icon="refresh" label={t('refresh')} onPress={refresh} />
          <IconButton icon="settings-outline" label={t('settings')} onPress={() => go({ name: 'settings' })} />
        </View>
      }
    >
      {/* Wallet hero */}
      <FadeIn>
        <GradientCard label={`${t('balance')}: ${xlm(money)}${approx ? `, ${t('approx', { v: approx })}` : ''}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Txt v="eyebrow" color="#FFFFFFCC">
              {t('wallet')}
            </Txt>
            {S.NETWORK === 'testnet' ? <Pill icon="flask" light label="Testnet" /> : null}
          </View>
          {wallet ? (
            <Txt v="huge" color="#FFFFFF">
              {xlm(money)}
            </Txt>
          ) : (
            <Skeleton height={46} width={200} />
          )}
          {approx ? <Txt color="#FFFFFFDD">{t('approx', { v: approx })}</Txt> : null}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
            <ActionTile light icon="paper-plane" label={t('send')} onPress={() => go({ name: 'send' })} disabled={!wallet?.exists} />
            <ActionTile light icon="qr-code" label={t('receive')} onPress={() => go({ name: 'receive' })} />
            <ActionTile light icon="gift" label={t('claimCode')} onPress={() => go({ name: 'claim' })} />
            <ActionTile light icon="volume-high" label={t('readAloud')} onPress={readAloud} />
          </View>
        </GradientCard>
      </FadeIn>

      {err || error ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err ?? error ?? ''} /> : null}

      {incoming.map((p, i) => {
        const held = !!p.releaseAt && p.releaseAt > now;
        return (
          <FadeIn key={p.id} delay={80 + i * 60}>
            <Card tone="success">
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <Pulse>
                  <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="gift" size={26} color={C.success} />
                  </View>
                </Pulse>
                <View style={{ flex: 1 }}>
                  <Txt bold color={C.success}>
                    {t('waitingForYou')}
                  </Txt>
                  <Txt v="heading">{t('waitingFrom', { amount: xlm(p.amount), who: nameFor(p.from) })}</Txt>
                </View>
              </View>
              {held ? (
                <Notice tone="warn" icon="time" title={t('heldForYou', { time: when(p.releaseAt!) })} body={t('heldForYouHelp')} />
              ) : p.deadline ? (
                <Txt color={C.muted}>{t('receiveBy', { date: date(p.deadline) })}</Txt>
              ) : null}
              <Button label={t('receiveNow')} icon="download" kind="success" busy={busy} disabled={held} onPress={() => receive(p.id, p.amount)} />
            </Card>
          </FadeIn>
        );
      })}

      {/* The heart of RELAY: family pots */}
      {wallet?.exists ? (
        <FadeIn delay={120}>
          <PotsCard />
        </FadeIn>
      ) : null}

      {/* Bank in / out */}
      <FadeIn delay={180}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <BankTile icon="business" title={t('cashOut')} sub={t('cashOutHint')} onPress={() => go({ name: 'anchor', kind: 'withdraw' })} disabled={!wallet?.exists} />
          <BankTile icon="card" title={t('cashIn')} onPress={() => go({ name: 'anchor', kind: 'deposit' })} disabled={!wallet?.exists} />
        </View>
      </FadeIn>
      {S.canUseFriendbot ? (
        <Button
          label={t('addMoney')}
          hint={t('addMoneyHint')}
          icon="add-circle"
          kind="secondary"
          busy={busy}
          onPress={() =>
            run(async () => {
              await S.fundWithFriendbot(keypair!.publicKey());
              await refresh();
            })
          }
        />
      ) : null}

      {activeAnchor.length ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t('inProgress')} />
          {activeAnchor.map((a) => (
            <Card key={a.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Ionicons name="hourglass" size={24} color={C.warn} />
                <View style={{ flex: 1 }}>
                  <Txt bold>{`${a.kind === 'withdraw' ? t('cashOut') : t('cashIn')}${a.amount ? ` · ${xlm(a.amount)}` : ''}`}</Txt>
                  <Txt v="small" color={C.muted}>
                    {a.domain}
                  </Txt>
                </View>
              </View>
              <Button label={t('open')} icon="arrow-forward" kind="secondary" onPress={() => go({ name: 'anchor', kind: a.kind, resumeId: a.id })} />
            </Card>
          ))}
        </View>
      ) : null}

      {outgoing.length + invites.length > 0 ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t('notYetReceived')} />
          <Txt color={C.muted}>{t('notYetReceivedHelp')}</Txt>
          {outgoing.map((p) => (
            <Card key={p.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconDot icon="time" color={C.warn} bg={C.warnBg} />
                <View style={{ flex: 1 }}>
                  <Txt bold>{`${xlm(p.amount)} → ${nameFor(p.to)}`}</Txt>
                  {p.releaseAt && p.releaseAt > now ? (
                    <Txt v="small" bold color={C.warn}>
                      {t('onHoldUntil', { time: when(p.releaseAt) })}
                    </Txt>
                  ) : p.deadline ? (
                    <Txt v="small" color={C.muted}>
                      {t('receiveBy', { date: date(p.deadline) })}
                    </Txt>
                  ) : null}
                </View>
              </View>
              <Button label={t('takeBack')} icon="arrow-undo" kind="danger" busy={busy} onPress={() => takeBack(p.amount, nameFor(p.to), () => S.claim(keypair!, p.id))} />
            </Card>
          ))}
          {invites.map((i) => (
            <Card key={i.publicKey}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconDot icon="gift" color={C.primary} bg={C.primarySoft} />
                <View style={{ flex: 1 }}>
                  <Txt bold>{`${xlm(i.amount)} → ${i.name}`}</Txt>
                  <Txt v="small" color={C.muted}>
                    {t('inviteFor')}
                  </Txt>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                <Button style={{ flex: 1, minWidth: 140 }} label={t('share')} icon="share-social" kind="secondary" onPress={() => shareText(`${t('sentInvite', { who: i.name })}\n${claimLink(i.secret)}\n${i.secret}`)} />
                <Button style={{ flex: 1, minWidth: 140 }} label={t('takeBack')} icon="arrow-undo" kind="danger" busy={busy} onPress={() => takeBack(i.amount, i.name, () => S.cancelInvite(keypair!, i.publicKey))} />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      <View style={{ gap: 4 }}>
        <SectionTitle title={t('activity')} />
        <Card style={{ paddingVertical: 6, gap: 0 }}>
          {activity.length === 0 ? (
            loading ? (
              <View style={{ gap: 10, paddingVertical: 10 }}>
                <Skeleton />
                <Skeleton width="70%" />
              </View>
            ) : (
              <Txt color={C.muted} style={{ paddingVertical: 12 }}>
                {t('noActivity')}
              </Txt>
            )
          ) : null}
          {activity.map((a, idx) => {
            const incomingKind = a.kind === 'in' || a.kind === 'claimed' || a.kind === 'setup';
            const cashOut = anchorTxs.find((x) => x.paidHash && x.paidHash === a.hash);
            const label = cashOut ? `${t('cashOut')} (${cashOut.domain})` : t(`act_${a.kind}` as any, { who: nameFor(a.counterparty) });
            const at = new Date(a.at).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' });
            const amount = `${incomingKind ? '+' : '−'}${xlm(a.amount)}`;
            return (
              <Pressable
                key={a.id}
                accessibilityRole="link"
                accessibilityLabel={`${label}, ${amount}, ${at}`}
                accessibilityHint={t('viewOnStellar')}
                onPress={() => openUrl(S.explorerTx(a.hash))}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 8, borderTopWidth: idx ? 1 : 0, borderColor: C.hairline, opacity: pressed ? 0.7 : 1 })}
              >
                <IconDot icon={incomingKind ? 'arrow-down' : 'arrow-up'} color={incomingKind ? C.success : C.primary} bg={incomingKind ? C.successBg : C.primarySoft} />
                <View style={{ flex: 1 }}>
                  <Txt>{label}</Txt>
                  <Txt v="small" color={C.muted}>
                    {at}
                  </Txt>
                </View>
                <Txt bold color={incomingKind ? C.success : C.text}>
                  {amount}
                </Txt>
              </Pressable>
            );
          })}
        </Card>
      </View>
    </Screen>
  );
}

function IconDot({ icon, color, bg }: { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; bg: string }) {
  return (
    <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={20} color={color} />
    </View>
  );
}

function BankTile({ icon, title, sub, onPress, disabled }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; sub?: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={sub ? `${title}. ${sub}` : title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ flex: 1, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 })}
    >
      <Card style={{ minHeight: 120 }}>
        <IconDot icon={icon} color={C.plum} bg="#ECE6F7" />
        <Txt bold>{title}</Txt>
        {sub ? (
          <Txt v="small" color={C.muted} numberOfLines={2}>
            {sub}
          </Txt>
        ) : null}
      </Card>
    </Pressable>
  );
}
