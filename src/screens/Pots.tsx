// Family Care Pot screens: create a pot, see it (balance, who paid in, how it was spent,
// requests waiting), put money in, ask to pay from it, and approve a request from a link.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Speech from 'expo-speech';
import { Ionicons } from '@expo/vector-icons';
import * as S from '../stellar';
import * as P from '../pot';
import { potNet, useApp } from '../state';
import { speechLang } from '../i18n';
import { fiat, xlm } from '../price';
import { Avatar, AvatarStack, Bar, Button, C, Card, Choice, Confetti, FadeIn, Field, GradientCard, IconButton, Notice, Pill, PressScale, ProgressRing, Screen, SectionTitle, Txt, personColor } from '../ui';
import { PotJar, ShieldMark } from '../art';
import { Scanner, openUrl, pasteText, proposalLink, shareText, useBusy } from '../helpers';

const PURPOSES = ['p_medicine', 'p_hospital', 'p_groceries', 'p_rent', 'p_bills'] as const;

function useLocale() {
  const { settings } = useApp();
  const loc = settings.lang === 'hi' ? 'hi-IN' : 'en-GB';
  return {
    when: (iso: string) => new Date(iso).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' }),
    day: (secs: number) => new Date(secs * 1000).toLocaleDateString(loc, { dateStyle: 'medium' }),
  };
}

// ---------- Create ----------

export function CreatePot() {
  const { t, keypair, contacts, back, go, refresh, announce, wallet } = useApp();
  const me = keypair!.publicKey();
  const [potName, setPotName] = useState('');
  const [myName, setMyName] = useState('');
  const [members, setMembers] = useState<P.Member[]>([]);
  const [newName, setNewName] = useState('');
  const [newAddr, setNewAddr] = useState('');
  const [addrError, setAddrError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState(2);
  const [scanning, setScanning] = useState(false);
  const { busy, err, setErr, run } = useBusy();

  const all: P.Member[] = [{ address: me, name: myName.trim() || t('you') }, ...members];
  const total = all.length;
  const need = Math.min(Math.max(approvals, 1), total);
  const cost = P.potReserve(total);

  const add = (m: P.Member) => {
    if (!S.isValidAddress(m.address) || m.address === me) return setAddrError(t('badAddress'));
    if (members.some((x) => x.address === m.address)) return;
    setMembers((list) => [...list, { address: m.address.trim(), name: m.name.trim() || `${m.address.slice(0, 4)}…` }]);
    setNewName('');
    setNewAddr('');
    setAddrError(null);
  };

  const create = () =>
    run(async () => {
      if (total < 2) return setErr(t('needTwo'));
      const { potId } = await P.createPot(potNet, keypair!, potName.trim() || t('potNameHint'), all, need);
      announce(t('createPotBtn'));
      await refresh();
      back();
      go({ name: 'pot', id: potId });
    });

  return (
    <Screen title={t('createPot')} onBack={back}>
      <Txt color={C.muted}>{t('potsHelp')}</Txt>
      <Field label={t('potName')} placeholder={t('potNameHint')} value={potName} onChangeText={setPotName} maxLength={28} />
      <Field label={t('yourName')} value={myName} onChangeText={setMyName} maxLength={32} autoComplete="name" />

      <Txt v="heading">{t('members')}</Txt>
      {all.map((m, i) => (
        <Card key={m.address}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar name={m.name} seed={m.address} size={40} />
            <View style={{ flex: 1 }}>
              <Txt bold>{m.name}</Txt>
              <Txt v="small" color={C.muted}>{`${m.address.slice(0, 6)}…${m.address.slice(-6)}`}</Txt>
            </View>
            {i > 0 ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('removeMember', { who: m.name })} onPress={() => setMembers((l) => l.filter((x) => x.address !== m.address))} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="close-circle" size={28} color={C.danger} />
              </Pressable>
            ) : null}
          </View>
        </Card>
      ))}

      {contacts.filter((c) => !all.some((m) => m.address === c.address)).length ? (
        <>
          <Txt bold>{t('addFromSaved')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {contacts
              .filter((c) => !all.some((m) => m.address === c.address))
              .map((c) => (
                <Button key={c.address} kind="secondary" icon="person-add" label={c.name} onPress={() => add(c)} />
              ))}
          </View>
        </>
      ) : null}

      <Card>
        <Field label={t('theirName')} value={newName} onChangeText={setNewName} maxLength={32} />
        <Field label={t('theirAddress')} value={newAddr} onChangeText={(v) => { setNewAddr(v.trim()); setAddrError(null); }} autoCapitalize="characters" autoCorrect={false} error={addrError} />
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <Button style={{ flex: 1, minWidth: 130 }} kind="secondary" icon="clipboard" label={t('paste')} onPress={async () => setNewAddr((await pasteText()).trim())} />
          <Button style={{ flex: 1, minWidth: 130 }} kind="secondary" icon="scan" label={t('scan')} onPress={() => setScanning(true)} />
        </View>
        <Button icon="person-add" label={t('addMember')} disabled={!newAddr} onPress={() => add({ name: newName, address: newAddr })} />
      </Card>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <ShieldMark size={48} />
        <Txt v="heading" style={{ flex: 1 }}>{t('approvalsNeeded')}</Txt>
      </View>
      <Choice
        label={t('approvalsNeeded')}
        value={need}
        onChange={setApprovals}
        options={Array.from({ length: total }, (_, i) => i + 1).map((n) => ({ value: n, label: `${n}` }))}
      />
      <Txt accessibilityLiveRegion="polite">{t('approvalsRule', { n: need, total })}</Txt>
      <Txt v="small" color={C.muted}>{t('potCost', { amount: xlm(cost) })}</Txt>
      {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : null}
      <Button
        label={busy ? t('creatingPot') : t('createPotBtn')}
        icon="people"
        busy={busy}
        disabled={total < 2 || (wallet?.spendable ?? 0) < cost}
        onPress={create}
      />
      <Scanner visible={scanning} onClose={() => setScanning(false)} onScan={(d) => { setScanning(false); const m = d.match(/G[A-Z2-7]{55}/); setNewAddr(m ? m[0] : d.trim()); }} />
    </Screen>
  );
}

// ---------- Pot ----------

export function PotView({ id }: { id: string }) {
  const { t, keypair, back, go, nameFor, prices, settings, proposals, refresh, announce } = useApp();
  const { when, day } = useLocale();
  const [pot, setPot] = useState<P.PotInfo | null>(null);
  const [ledger, setLedger] = useState<P.PotLedger | null>(null);
  const [pending, setPending] = useState<{ xdr: string; p: P.Proposal }[]>([]);
  const [amountText, setAmountText] = useState('');
  const { busy, err, run } = useBusy();

  const load = useCallback(
    () =>
      run(async () => {
        const info = await P.getPot(potNet, id);
        setPot(info);
        setLedger(await P.ledger(potNet, info));
        const mine = proposals.filter((x) => x.potId === id);
        const inspected = await Promise.all(mine.map(async (x) => ({ xdr: x.xdr, p: await P.inspectProposal(potNet, x.xdr).catch(() => null) })));
        setPending(inspected.filter((x): x is { xdr: string; p: P.Proposal } => !!x.p && (x.p.status === 'waiting' || x.p.status === 'ready')));
      }),
    [id, proposals],
  );

  useEffect(() => {
    load();
  }, [load]);

  const memberName = (a: string) => pot?.members.find((m) => m.address === a)?.name ?? nameFor(a);
  const approx = (n: number) => fiat(n, settings.fiat, prices);

  const contribute = () =>
    run(async () => {
      const amount = Number(amountText.replace(',', '.'));
      if (!amount || amount <= 0) throw new Error(t('enterAmount'));
      await P.contribute(potNet, keypair!, id, amount);
      setAmountText('');
      announce(t('paidIn', { amount: xlm(amount) }));
      await Promise.all([refresh(), load()]);
    });

  const readAloud = () => {
    if (!pot) return;
    const lines = [
      `${pot.name}. ${t('potBalance')}: ${xlm(pot.spendable)}`,
      t('approvalsRule', { n: pot.approvals, total: pot.members.length }),
      ...(ledger?.contributions ?? []).map((c) => `${memberName(c.member)}: ${t('paidIn', { amount: xlm(c.total) })}`),
    ];
    Speech.stop();
    Speech.speak(lines.join('. '), { language: speechLang[settings.lang] });
  };

  if (!pot) {
    return (
      <Screen title={t('pots')} onBack={back}>
        {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : <Txt color={C.muted}>…</Txt>}
      </Screen>
    );
  }

  const totals = new Map((ledger?.contributions ?? []).map((c) => [c.member, c.total]));
  const totalIn = pot.members.reduce((s, m) => s + (totals.get(m.address) ?? 0), 0);
  const spentList = ledger?.spent ?? [];
  const totalOut = spentList.reduce((s, x) => s + x.amount, 0);
  const even = pot.members.length ? totalIn / pot.members.length : 0;
  const maxPaid = Math.max(1, ...pot.members.map((m) => totals.get(m.address) ?? 0));
  // Spending grouped by what it was for (from the memo every request carries).
  const byPurpose = [...spentList.reduce((map, s) => map.set(s.purpose || '—', (map.get(s.purpose || '—') ?? 0) + s.amount), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]);
  const purposeIcon = (p: string): React.ComponentProps<typeof Ionicons>['name'] => {
    const s = p.toLowerCase();
    if (/medic|दवा|pharm|bp/.test(s)) return 'medkit';
    if (/hospit|अस्पताल|doctor/.test(s)) return 'pulse';
    if (/grocer|राशन|food/.test(s)) return 'basket';
    if (/rent|किराया/.test(s)) return 'home';
    if (/bill|बिल|electric/.test(s)) return 'flash';
    return 'receipt';
  };

  return (
    <Screen title={pot.name} subtitle={t('membersCount', { n: pot.members.length })} onBack={back} right={<IconButton icon="volume-high" label={t('readAloud')} onPress={readAloud} />}>
      <FadeIn>
        <GradientCard label={`${t('potBalance')}: ${xlm(pot.spendable)}. ${t('approvalsRule', { n: pot.approvals, total: pot.members.length })}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Txt v="eyebrow" color="#FFFFFFCC">{t('potBalance')}</Txt>
            <AvatarStack size={34} people={pot.members.map((m) => ({ name: m.name, seed: m.address }))} />
          </View>
          <Txt v="huge" color="#fff">{xlm(pot.spendable)}</Txt>
          {approx(pot.spendable) ? <Txt color="#FFFFFFDD">{t('approx', { v: approx(pot.spendable)! })}</Txt> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <Stat label={t('totalIn')} value={xlm(totalIn)} />
            <Stat label={t('totalOut')} value={xlm(totalOut)} />
          </View>
          <Pill icon="shield-checkmark" light label={t('approvalsRule', { n: pot.approvals, total: pot.members.length })} />
        </GradientCard>
      </FadeIn>
      {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : null}

      <FadeIn delay={80}>
        <Button label={t('requestPayment')} icon="hand-left" onPress={() => go({ name: 'propose', potId: id })} />
      </FadeIn>

      {pending.length ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t('requests')} />
          {pending.map(({ xdr, p }, i) => (
            <FadeIn key={p.hash} delay={100 + i * 60}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${xlm(p.amount)} → ${memberName(p.to)}. ${p.purpose}. ${t('approvals', { have: p.approvedBy.length, need: p.needed })}`} onPress={() => go({ name: 'proposal', xdr })}>
                <Card tone="warn">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                    <ProgressRing value={p.approvedBy.length / p.needed} size={58} stroke={7} color={C.marigold} track="#FFFFFF">
                      <Txt v="small" bold>{`${p.approvedBy.length}/${p.needed}`}</Txt>
                    </ProgressRing>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt bold>{`${xlm(p.amount)} → ${memberName(p.to)}`}</Txt>
                      {p.purpose ? <Txt v="small">{p.purpose}</Txt> : null}
                      <Txt v="small" bold color={C.warn}>{t('moreToGo', { n: Math.max(0, p.needed - p.approvedBy.length) })}</Txt>
                    </View>
                    <Ionicons name="chevron-forward" size={22} color={C.warn} />
                  </View>
                </Card>
              </Pressable>
            </FadeIn>
          ))}
        </View>
      ) : null}

      <FadeIn delay={140}>
        <Card>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field label={t('amountToAdd')} value={amountText} onChangeText={(v) => setAmountText(v.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" placeholder="0" />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {[25, 50, 100, 250].map((n) => (
              <Pressable key={n} accessibilityRole="button" accessibilityLabel={xlm(n)} onPress={() => setAmountText(String(n))} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: C.sunk, justifyContent: 'center' }}>
                <Txt v="small" bold>{`+${n}`}</Txt>
              </Pressable>
            ))}
          </View>
          <Button label={t('addToPot')} icon="add-circle" kind="success" busy={busy} onPress={contribute} />
        </Card>
      </FadeIn>

      {/* Who has paid in, against an even share */}
      <SectionTitle title={t('contributions')} />
      <FadeIn delay={180}>
        <Card>
          <Txt v="small" color={C.muted}>{t('fairShareHelp', { amount: xlm(even) })}</Txt>
          {pot.members.map((m) => {
            const paid = totals.get(m.address) ?? 0;
            const diff = paid - even;
            const pct = totalIn ? Math.round((paid / totalIn) * 100) : 0;
            const status = Math.abs(diff) < 0.5 ? t('evenShare') : diff > 0 ? t('aheadBy', { amount: xlm(diff) }) : t('behindBy', { amount: xlm(-diff) });
            return (
              <View key={m.address} accessible accessibilityLabel={`${m.name}: ${t('paidIn', { amount: xlm(paid) })}. ${status}`} style={{ gap: 8, paddingVertical: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Avatar name={m.name} seed={m.address} size={40} />
                  <View style={{ flex: 1 }}>
                    <Txt bold>{m.address === keypair!.publicKey() ? `${m.name} (${t('you')})` : m.name}</Txt>
                    <Txt v="small" color={diff < -0.5 ? C.warn : C.success}>{status}</Txt>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt bold>{xlm(paid)}</Txt>
                    <Txt v="small" color={C.muted}>{`${pct}%`}</Txt>
                  </View>
                </View>
                <Bar value={paid / maxPaid} marker={even / maxPaid} color={personColor(m.address)} />
              </View>
            );
          })}
        </Card>
      </FadeIn>

      {byPurpose.length ? (
        <>
          <SectionTitle title={t('whereItWent')} />
          <FadeIn delay={220}>
            <Card>
              {byPurpose.map(([purpose, amount]) => (
                <View key={purpose} accessible accessibilityLabel={`${purpose}: ${xlm(amount)}`} style={{ gap: 6, paddingVertical: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Ionicons name={purposeIcon(purpose)} size={20} color={C.plum} />
                    <Txt bold style={{ flex: 1 }}>{purpose}</Txt>
                    <Txt bold>{xlm(amount)}</Txt>
                  </View>
                  <Bar value={totalOut ? amount / totalOut : 0} color={C.plum} height={8} />
                </View>
              ))}
            </Card>
          </FadeIn>
        </>
      ) : null}

      {/* Timeline of every payment out, with who approved it */}
      <SectionTitle title={t('spent')} />
      {spentList.length === 0 ? (
        <Card style={{ alignItems: 'center' }}>
          <PotJar size={96} />
          <Txt color={C.muted} style={{ textAlign: 'center' }}>{t('potEmptySpent')}</Txt>
        </Card>
      ) : null}
      <View>
        {spentList.map((s, i) => (
          <FadeIn key={s.hash} delay={Math.min(i, 8) * 50}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`${s.purpose || ''}, ${xlm(s.amount)} → ${memberName(s.to)}. ${t('approvedBy', { names: s.approvedBy.map(memberName).join(', ') })}. ${when(s.at)}`}
              accessibilityHint={t('viewOnStellar')}
              onPress={() => openUrl(S.explorerTx(s.hash))}
              style={({ pressed }) => ({ flexDirection: 'row', gap: 14, opacity: pressed ? 0.75 : 1 })}
            >
              <View style={{ alignItems: 'center', width: 42 }}>
                <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: '#ECE6F7', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={purposeIcon(s.purpose)} size={20} color={C.plum} />
                </View>
                {i < spentList.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: C.hairline, marginVertical: 4 }} /> : null}
              </View>
              <View style={{ flex: 1, gap: 4, paddingBottom: 18 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Txt bold style={{ flex: 1 }}>{s.purpose || '—'}</Txt>
                  <Txt bold>{`−${xlm(s.amount)}`}</Txt>
                </View>
                <Txt v="small" color={C.muted}>{`→ ${memberName(s.to)} · ${when(s.at)}`}</Txt>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <AvatarStack size={24} people={s.approvedBy.map((a) => ({ name: memberName(a), seed: a }))} />
                  <Txt v="small" color={C.success} style={{ flex: 1 }}>{t('approvedBy', { names: s.approvedBy.map(memberName).join(', ') })}</Txt>
                </View>
              </View>
            </Pressable>
          </FadeIn>
        ))}
      </View>
      <Button label={t('viewOnStellar')} icon="open-outline" kind="ghost" onPress={() => openUrl(S.explorerAccount(id))} />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 16, padding: 12 }}>
      <Txt v="small" color="#FFFFFFCC">{label}</Txt>
      <Txt bold color="#fff">{value}</Txt>
    </View>
  );
}

// ---------- Ask to pay from the pot ----------

export function Propose({ potId }: { potId: string }) {
  const { t, keypair, contacts, back, go, saveProposal, saveContact, prices, settings } = useApp();
  const [pot, setPot] = useState<P.PotInfo | null>(null);
  const [payeeKind, setPayeeKind] = useState<'member' | 'other'>('member');
  const [to, setTo] = useState('');
  const [toName, setToName] = useState('');
  const [amountText, setAmountText] = useState('');
  const [purpose, setPurpose] = useState('');
  const [scanning, setScanning] = useState(false);
  const { busy, err, setErr, run } = useBusy();

  useEffect(() => {
    run(async () => setPot(await P.getPot(potNet, potId)));
  }, [potId]);

  const amount = Number(amountText.replace(',', '.'));

  const submit = () =>
    run(async () => {
      if (!S.isValidAddress(to)) return setErr(t('badAddress'));
      if (!amount || amount <= 0) return setErr(t('enterAmount'));
      if (pot && amount > pot.spendable) return setErr(t('tooMuch'));
      const xdr = await P.proposeSpend(potNet, keypair!, potId, to, amount, purpose);
      if (payeeKind === 'other' && toName.trim()) saveContact({ name: toName.trim(), address: to });
      saveProposal({ xdr, potId, createdAt: Date.now() });
      back();
      go({ name: 'proposal', xdr });
    });

  if (!pot) return <Screen title={t('requestPayment')} onBack={back}>{err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : <Txt>…</Txt>}</Screen>;

  return (
    <Screen title={t('requestPayment')} onBack={back}>
      <Txt color={C.muted}>{t('fromPot', { pot: pot.name })}</Txt>
      <Txt v="heading">{t('payee')}</Txt>
      <Choice
        label={t('payee')}
        value={payeeKind}
        onChange={(v) => { setPayeeKind(v); setTo(''); }}
        options={[{ value: 'member', label: t('payeeMember') }, { value: 'other', label: t('payeeOther') }]}
      />
      {payeeKind === 'member' ? (
        <Choice label={t('payeeMember')} value={to} onChange={setTo} options={pot.members.map((m) => ({ value: m.address, label: m.name }))} />
      ) : (
        <>
          {contacts.length ? (
            <Choice label={t('contacts')} value={to} onChange={(a) => { setTo(a); setToName(contacts.find((c) => c.address === a)?.name ?? ''); }} options={contacts.map((c) => ({ value: c.address, label: c.name }))} />
          ) : null}
          <Field label={t('theirName')} value={toName} onChangeText={setToName} />
          <Field label={t('theirAddress')} value={to} onChangeText={(v) => setTo(v.trim())} autoCapitalize="characters" autoCorrect={false} />
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <Button style={{ flex: 1, minWidth: 130 }} kind="secondary" icon="clipboard" label={t('paste')} onPress={async () => setTo((await pasteText()).trim())} />
            <Button style={{ flex: 1, minWidth: 130 }} kind="secondary" icon="scan" label={t('scan')} onPress={() => setScanning(true)} />
          </View>
        </>
      )}
      <Field label={`${t('amount')} (XLM)`} value={amountText} onChangeText={(v) => setAmountText(v.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" placeholder="0" />
      {amount > 0 && fiat(amount, settings.fiat, prices) ? <Txt>{t('approx', { v: fiat(amount, settings.fiat, prices)! })}</Txt> : null}
      <Txt color={C.muted}>{t('youHave', { amount: xlm(pot.spendable) })}</Txt>
      <Txt v="heading">{t('purpose')}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {PURPOSES.map((p) => (
          <Button key={p} kind={purpose === t(p) ? 'primary' : 'secondary'} label={t(p)} onPress={() => setPurpose(t(p))} />
        ))}
      </View>
      <Field label={t('purpose')} value={purpose} onChangeText={(v) => setPurpose(P.memoText(v))} placeholder={t('purposeHint')} />
      <Txt v="small" color={C.muted}>{t('purposeHint')}</Txt>
      {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : null}
      <Button label={t('createRequest')} icon="create" busy={busy} disabled={!to || !amount || !purpose} onPress={submit} />
      <Scanner visible={scanning} onClose={() => setScanning(false)} onScan={(d) => { setScanning(false); const m = d.match(/G[A-Z2-7]{55}/); setTo(m ? m[0] : d.trim()); }} />
    </Screen>
  );
}

// ---------- A request, opened from a link or from the pot ----------

export function ProposalView({ xdr: initial }: { xdr: string }) {
  const { t, keypair, back, go, nameFor, saveProposal, removeProposal, refresh, announce, prices, settings } = useApp();
  const { day } = useLocale();
  const [xdr, setXdr] = useState(initial);
  const [p, setP] = useState<P.Proposal | null>(null);
  const [paid, setPaid] = useState<string | null>(null);
  const { busy, err, run } = useBusy();

  useEffect(() => {
    run(async () => setP(await P.inspectProposal(potNet, initial)));
  }, [initial]);

  if (!p) {
    return (
      <Screen title={t('approveTitle')} onBack={back}>
        {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : <Txt color={C.muted}>…</Txt>}
      </Screen>
    );
  }

  const me = keypair?.publicKey();
  const isMember = !!me && p.pot.members.some((m) => m.address === me);
  const iApproved = !!me && p.approvedBy.some((m) => m.address === me);
  const payee = p.pot.members.find((m) => m.address === p.to)?.name ?? nameFor(p.to);
  const remaining = Math.max(0, p.needed - p.approvedBy.length);
  const link = proposalLink(xdr);
  const message = t('shareText', { pot: p.pot.name, amount: xlm(p.amount), who: payee, purpose: p.purpose || '—', link });
  const approx = fiat(p.amount, settings.fiat, prices);

  const approve = () =>
    run(async () => {
      const r = await P.approveProposal(potNet, keypair!, xdr);
      setXdr(r.xdr);
      setP(r.proposal);
      if (r.submittedHash) {
        setPaid(r.submittedHash);
        removeProposal(r.xdr);
        announce(t('paidOut', { amount: xlm(p.amount), who: payee }));
        refresh();
      } else {
        saveProposal({ xdr: r.xdr, potId: p.potId, createdAt: Date.now() });
        announce(t('needsMore', { n: Math.max(0, r.proposal.needed - r.proposal.approvedBy.length) }));
      }
    });

  const submitNow = () =>
    run(async () => {
      const hash = await P.submitProposal(potNet, xdr);
      setPaid(hash);
      removeProposal(xdr);
      announce(t('paidOut', { amount: xlm(p.amount), who: payee }));
      refresh();
    });

  return (
    <Screen title={t('approveTitle')} subtitle={t('fromPot', { pot: p.pot.name })} onBack={back}>
      <FadeIn>
        <GradientCard label={`${xlm(p.amount)} → ${payee}. ${p.purpose}`}>
          <Pill icon="pricetag" light label={p.purpose || '—'} />
          <Txt v="huge" color="#fff">{xlm(p.amount)}</Txt>
          {approx ? <Txt color="#FFFFFFDD">{t('approx', { v: approx })}</Txt> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 18, padding: 12, marginTop: 4 }}>
            <Avatar name={payee} seed={p.to} size={42} ring="#FFFFFF55" />
            <View style={{ flex: 1 }}>
              <Txt v="small" color="#FFFFFFCC">{t('to')}</Txt>
              <Txt bold color="#fff">{payee}</Txt>
              <Txt v="small" color="#FFFFFFAA" selectable numberOfLines={1}>{`${p.to.slice(0, 8)}…${p.to.slice(-8)}`}</Txt>
            </View>
          </View>
        </GradientCard>
      </FadeIn>

      <FadeIn delay={100}>
        <Card tone={p.status === 'ready' || paid ? 'success' : undefined}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <ProgressRing value={paid ? 1 : p.approvedBy.length / p.needed} size={96} stroke={10} color={paid || p.status === 'ready' ? C.success : C.marigold}>
              <Txt v="heading">{`${p.approvedBy.length}/${p.needed}`}</Txt>
            </ProgressRing>
            <View style={{ flex: 1, gap: 4 }}>
              <Txt bold>{t('approvals', { have: p.approvedBy.length, need: p.needed })}</Txt>
              {!paid && remaining > 0 ? <Txt v="small" color={C.warn} bold>{t('moreToGo', { n: remaining })}</Txt> : null}
              {p.expiresAt && !paid ? <Txt v="small" color={C.muted}>{t('expiresOn', { date: day(p.expiresAt) })}</Txt> : null}
            </View>
          </View>
          <View style={{ gap: 8, marginTop: 4 }}>
            {p.pot.members.map((m) => {
              const ok = p.approvedBy.some((a) => a.address === m.address);
              return (
                <View key={m.address} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }} accessible accessibilityLabel={`${m.name}: ${ok ? t('alreadyApproved') : '…'}`}>
                  <Avatar name={m.name} seed={m.address} size={36} done={ok} />
                  <Txt style={{ flex: 1 }} bold={ok}>{m.address === me ? `${m.name} (${t('you')})` : m.name}</Txt>
                  {ok ? <Pill icon="checkmark" tone="success" label="✓" /> : <Ionicons name="ellipsis-horizontal" size={20} color={C.muted} />}
                </View>
              );
            })}
          </View>
        </Card>
      </FadeIn>

      {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : null}

      {paid ? (
        <>
          <View>
            <Confetti />
            <Notice tone="success" icon="checkmark-circle" title={t('paidOut', { amount: xlm(p.amount), who: payee })} />
          </View>
          <Button label={t('viewOnStellar')} icon="open-outline" kind="secondary" onPress={() => openUrl(S.explorerTx(paid))} />
          <Button label={t('done')} icon="home" onPress={() => { back(); go({ name: 'pot', id: p.potId }); }} />
        </>
      ) : p.status === 'stale' ? (
        <Notice tone="danger" icon="close-circle" title={t('staleReq')} />
      ) : p.status === 'expired' ? (
        <Notice tone="danger" icon="close-circle" title={t('expiredReq')} />
      ) : (
        <>
          {!isMember ? <Notice tone="warn" icon="information-circle" title={t('notMember')} /> : null}
          {isMember && !iApproved ? <Button label={busy ? t('approving') : t('approve')} icon="checkmark-done" kind="success" busy={busy} onPress={approve} /> : null}
          {iApproved && p.status === 'waiting' ? <Notice tone="success" icon="checkmark-circle" title={t('requestMade')} body={t('requestShare', { n: remaining })} /> : null}
          {p.status === 'ready' ? (
            <>
              <Notice tone="success" icon="checkmark-circle" title={t('readyToSend')} />
              <Button label={t('submitNow')} icon="paper-plane" busy={busy} onPress={submitNow} />
            </>
          ) : null}
          {p.status === 'waiting' ? (
            <>
              <Card style={{ alignItems: 'center' }} label={t('shareRequest')}>
                <View style={{ padding: 12, backgroundColor: '#fff', borderRadius: 20, borderWidth: 6, borderColor: C.marigoldSoft }}>
                  <QRCode value={link} size={210} ecl="L" color={C.text} />
                </View>
                <Txt v="small" color={C.muted} style={{ textAlign: 'center' }}>{t('requestShare', { n: remaining })}</Txt>
              </Card>
              <Button label={t('shareRequest')} icon="share-social" onPress={() => shareText(message)} />
            </>
          ) : null}
          <Button label={t('notNow')} kind="secondary" onPress={back} />
        </>
      )}
    </Screen>
  );
}

export function PotsCard() {
  const { t, pots, go, prices, settings } = useApp();
  return (
    <View style={{ gap: 12 }}>
      <SectionTitle title={t('yourPots')} action={pots.length ? `+ ${t('createPot')}` : undefined} onAction={() => go({ name: 'createPot' })} />
      {pots.map((p, i) => (
        <FadeIn key={p.id} delay={i * 70}>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={`${p.name}, ${xlm(p.spendable)}, ${t('approvalsRule', { n: p.approvals, total: p.members.length })}`}
            onPress={() => go({ name: 'pot', id: p.id })}
          >
            <Card style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: C.marigoldSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="heart" size={24} color={C.coral} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt v="heading" numberOfLines={1}>{p.name}</Txt>
                  <Txt v="small" color={C.muted}>{t('membersCount', { n: p.members.length })}</Txt>
                </View>
                <Ionicons name="chevron-forward" size={22} color={C.muted} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
                <View>
                  <Txt v="title">{xlm(p.spendable)}</Txt>
                  {fiat(p.spendable, settings.fiat, prices) ? <Txt v="small" color={C.muted}>{t('approx', { v: fiat(p.spendable, settings.fiat, prices)! })}</Txt> : null}
                </View>
                <AvatarStack size={34} people={p.members.map((m) => ({ name: m.name, seed: m.address }))} />
              </View>
              <Pill icon="shield-checkmark" tone="success" label={t('approvalsRule', { n: p.approvals, total: p.members.length })} />
            </Card>
          </PressScale>
        </FadeIn>
      ))}
      {pots.length === 0 ? (
        <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }}>
          <PotJar size={110} />
          <Txt v="heading" style={{ textAlign: 'center' }}>{t('pots')}</Txt>
          <Txt color={C.muted} style={{ textAlign: 'center' }}>{t('potsHelp')}</Txt>
          <Button style={{ alignSelf: 'stretch' }} label={t('createPot')} icon="people" onPress={() => go({ name: 'createPot' })} />
        </Card>
      ) : null}
    </View>
  );
}
