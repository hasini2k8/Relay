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
import { Button, C, Card, Choice, Field, Notice, Screen, Txt } from '../ui';
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
            <Ionicons name="person-circle" size={36} color={C.primary} />
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

      <Txt v="heading">{t('approvalsNeeded')}</Txt>
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
  return (
    <Screen title={pot.name} onBack={back}>
      <Card label={`${t('potBalance')}: ${xlm(pot.spendable)}. ${t('approvalsRule', { n: pot.approvals, total: pot.members.length })}`}>
        <Txt color={C.muted}>{t('potBalance')}</Txt>
        <Txt v="huge">{xlm(pot.spendable)}</Txt>
        {approx(pot.spendable) ? <Txt color={C.muted}>{t('approx', { v: approx(pot.spendable)! })}</Txt> : null}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Ionicons name="shield-checkmark" size={22} color={C.success} />
          <Txt bold color={C.success} style={{ flex: 1 }}>{t('approvalsRule', { n: pot.approvals, total: pot.members.length })}</Txt>
        </View>
      </Card>
      <Button label={t('readAloud')} icon="volume-high" kind="secondary" onPress={readAloud} />
      {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : null}

      <Button label={t('requestPayment')} icon="hand-left" onPress={() => go({ name: 'propose', potId: id })} />

      {pending.length ? (
        <View style={{ gap: 10 }}>
          <Txt v="heading">{t('requests')}</Txt>
          {pending.map(({ xdr, p }) => (
            <Card key={p.hash} tone="warn">
              <Txt bold>{`${xlm(p.amount)} → ${memberName(p.to)}`}</Txt>
              {p.purpose ? <Txt>{p.purpose}</Txt> : null}
              <Txt color={C.muted}>{t('approvals', { have: p.approvedBy.length, need: p.needed })}</Txt>
              <Button label={t('open')} icon="arrow-forward" kind="secondary" onPress={() => go({ name: 'proposal', xdr })} />
            </Card>
          ))}
        </View>
      ) : null}

      <Card>
        <Field label={t('amountToAdd')} value={amountText} onChangeText={(v) => setAmountText(v.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" placeholder="0" />
        <Button label={t('addToPot')} icon="add-circle" kind="success" busy={busy} onPress={contribute} />
      </Card>

      <Txt v="heading">{t('contributions')}</Txt>
      {pot.members.map((m) => (
        <View key={m.address} accessible accessibilityLabel={`${m.name}: ${t('paidIn', { amount: xlm(totals.get(m.address) ?? 0) })}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderBottomWidth: 1, borderColor: '#D5DBE3' }}>
          <Ionicons name="person-circle" size={32} color={C.primary} />
          <Txt style={{ flex: 1 }}>{m.address === keypair!.publicKey() ? `${m.name} (${t('you')})` : m.name}</Txt>
          <Txt bold>{xlm(totals.get(m.address) ?? 0)}</Txt>
        </View>
      ))}

      <Txt v="heading">{t('spent')}</Txt>
      {(ledger?.spent ?? []).length === 0 ? <Txt color={C.muted}>{t('noActivity')}</Txt> : null}
      {(ledger?.spent ?? []).map((s) => (
        <Pressable
          key={s.hash}
          accessibilityRole="link"
          accessibilityLabel={`${s.purpose || ''}, ${xlm(s.amount)} → ${memberName(s.to)}. ${t('approvedBy', { names: s.approvedBy.map(memberName).join(', ') })}. ${when(s.at)}`}
          accessibilityHint={t('viewOnStellar')}
          onPress={() => openUrl(S.explorerTx(s.hash))}
          style={{ gap: 4, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#D5DBE3', minHeight: 64 }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Txt bold style={{ flex: 1 }}>{s.purpose || '—'}</Txt>
            <Txt bold>{`−${xlm(s.amount)}`}</Txt>
          </View>
          <Txt v="small">{`→ ${memberName(s.to)} · ${when(s.at)}`}</Txt>
          <Txt v="small" color={C.success}>{t('approvedBy', { names: s.approvedBy.map(memberName).join(', ') })}</Txt>
        </Pressable>
      ))}
      <Button label={t('viewOnStellar')} icon="open-outline" kind="secondary" onPress={() => openUrl(S.explorerAccount(id))} />
    </Screen>
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
    <Screen title={t('approveTitle')} onBack={back}>
      <Txt color={C.muted}>{t('fromPot', { pot: p.pot.name })}</Txt>
      <Card label={`${xlm(p.amount)} → ${payee}. ${p.purpose}`}>
        <Txt color={C.muted}>{t('to')}</Txt>
        <Txt v="title">{payee}</Txt>
        <Txt v="small" color={C.muted} selectable>{p.to}</Txt>
        <Txt color={C.muted}>{t('amount')}</Txt>
        <Txt v="huge">{xlm(p.amount)}</Txt>
        {approx ? <Txt color={C.muted}>{t('approx', { v: approx })}</Txt> : null}
        <Txt color={C.muted}>{t('purpose')}</Txt>
        <Txt v="heading">{p.purpose || '—'}</Txt>
      </Card>

      <Card tone={p.status === 'ready' || paid ? 'success' : 'warn'}>
        <Txt bold>{t('approvals', { have: p.approvedBy.length, need: p.needed })}</Txt>
        {p.pot.members.map((m) => {
          const ok = p.approvedBy.some((a) => a.address === m.address);
          return (
            <View key={m.address} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }} accessible accessibilityLabel={`${m.name}: ${ok ? t('alreadyApproved') : '…'}`}>
              <Ionicons name={ok ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={ok ? C.success : C.muted} />
              <Txt>{m.name}</Txt>
            </View>
          );
        })}
        {p.expiresAt && !paid ? <Txt v="small" color={C.muted}>{t('expiresOn', { date: day(p.expiresAt) })}</Txt> : null}
      </Card>

      {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : null}

      {paid ? (
        <>
          <Notice tone="success" icon="checkmark-circle" title={t('paidOut', { amount: xlm(p.amount), who: payee })} />
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
              <View style={{ alignItems: 'center', padding: 16, backgroundColor: '#fff', borderRadius: 16 }} accessible accessibilityLabel={t('shareRequest')}>
                <QRCode value={link} size={220} ecl="L" />
              </View>
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
    <View style={{ gap: 10 }}>
      <Txt v="heading">{t('pots')}</Txt>
      <Txt color={C.muted}>{t('potsHelp')}</Txt>
      {pots.map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          accessibilityLabel={`${p.name}, ${xlm(p.spendable)}, ${t('approvalsRule', { n: p.approvals, total: p.members.length })}`}
          onPress={() => go({ name: 'pot', id: p.id })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, padding: 14, backgroundColor: C.card, borderRadius: 14, borderWidth: 1.5, borderColor: '#D5DBE3' }}
        >
          <Ionicons name="people" size={34} color={C.success} />
          <View style={{ flex: 1 }}>
            <Txt bold>{p.name}</Txt>
            <Txt v="small" color={C.muted}>{t('approvalsRule', { n: p.approvals, total: p.members.length })}</Txt>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Txt bold>{xlm(p.spendable)}</Txt>
            {fiat(p.spendable, settings.fiat, prices) ? <Txt v="small" color={C.muted}>{fiat(p.spendable, settings.fiat, prices)}</Txt> : null}
          </View>
        </Pressable>
      ))}
      {pots.length === 0 ? <Txt color={C.muted}>{t('noPots')}</Txt> : null}
      <Button label={t('createPot')} icon="people" kind="success" onPress={() => go({ name: 'createPot' })} />
    </View>
  );
}
