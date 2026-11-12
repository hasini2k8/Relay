import React, { useState } from 'react';
import * as Speech from 'expo-speech';
import { Pressable, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import * as S from '../stellar';
import { useApp } from '../state';
import { fiat, xlm } from '../price';
import { Button, C, Card, Choice, Field, Notice, Screen, Txt } from '../ui';
import { speechLang } from '../i18n';
import { Scanner, claimLink, copy, openUrl, pasteText, shareText, useBusy } from '../helpers';

type Step = 'who' | 'amount' | 'safety' | 'confirm' | 'done';

// Scam Shield. Payments to people you haven't paid before wait in a safety hold that the
// Stellar network enforces: the recipient can't take the money until it ends, and you can
// take it back at any time until they do. Red-flag answers lengthen the suggested hold.
const HOLDS = [0, 3600, 86400, 3 * 86400] as const;
type Hold = (typeof HOLDS)[number];
const RED_FLAGS = ['flag_online', 'flag_hurry', 'flag_authority', 'flag_prize'] as const;
type Mode = 'address' | 'invite';

const FEE_MARGIN = 0.01;
// A protected send locks one base reserve per claimant (2 × 0.5 XLM) until it is received or taken back.
const PROTECTED_RESERVE = 1;

export function Send() {
  const { t, wallet, contacts, keypair, prices, settings, back, saveContact, addInvite, refresh, announce } = useApp();
  const [step, setStep] = useState<Step>('who');
  const [mode, setMode] = useState<Mode>('address');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [addrError, setAddrError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<{ hash: string; code?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [answers, setAnswers] = useState<Record<string, 'yes' | 'no' | undefined>>({});
  const [hold, setHold] = useState<Hold>(0);
  const { busy, err, run } = useBusy();

  const who = name.trim() || (mode === 'address' ? `${address.slice(0, 4)}…${address.slice(-4)}` : t('someone'));
  const amount = Number(amountText.replace(',', '.'));
  const reserve = mode === 'invite' ? S.INVITE_RESERVE : PROTECTED_RESERVE;
  const max = Math.max(0, (wallet?.spendable ?? 0) - reserve - FEE_MARGIN);
  const approx = (n: number) => fiat(n, settings.fiat, prices);
  const trusted = contacts.some((c) => c.address === address.trim());
  const redFlags = RED_FLAGS.filter((f) => answers[f] === 'yes').length;
  const holdLabel = (h: Hold): string => ({ 0: t('holdNone'), 3600: t('hold1h'), 86400: t('hold24h'), 259200: t('hold3d') } as Record<number, string>)[h];
  const releaseText = () =>
    new Date(Date.now() + hold * 1000).toLocaleString(settings.lang === 'hi' ? 'hi-IN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  const pickContact = (c: { name: string; address: string }) => {
    setMode('address');
    setName(c.name);
    setAddress(c.address);
    setUnknown(false);
    setStep('amount');
  };

  const checkAddress = () =>
    run(async () => {
      const a = address.trim();
      if (!S.isValidAddress(a)) return setAddrError(t('badAddress'));
      if (a === keypair!.publicKey()) return setAddrError(t('badAddress'));
      setMode('address');
      setUnknown(!(await S.accountExists(a)));
      setStep('amount');
    });

  const checkAmount = () => {
    if (!amount || amount <= 0) return setAmountError(t('enterAmount'));
    if (amount > max) return setAmountError(t('tooMuch'));
    if (mode === 'address' && !trusted) {
      setHold(86400);
      setStep('safety');
    } else {
      setHold(0);
      setStep('confirm');
    }
  };

  const send = () =>
    run(async () => {
      if (mode === 'invite') {
        const r = await S.inviteSend(keypair!, amount);
        addInvite({ publicKey: r.invitePublic, secret: r.inviteSecret, name: who, amount, createdAt: Date.now() });
        setResult({ hash: r.hash, code: r.inviteSecret });
      } else {
        const r = await S.protectedSend(keypair!, address.trim(), amount, { holdSeconds: hold });
        if (name.trim()) saveContact({ name: name.trim(), address: address.trim() });
        setResult({ hash: r.hash });
      }
      setStep('done');
      announce(t('sent'));
      refresh();
    });

  const inviteMessage = (code: string) => `${t('sentBody', { amount: xlm(amount), who })}\n\n${claimLink(code)}\n\n${t('inviteFor')}: ${code}`;

  if (step === 'done' && result) {
    return (
      <Screen title={t('sent')}>
        <Notice tone="success" icon="checkmark-circle" title={t('sent')} body={result.code ? undefined : t('sentBody', { amount: xlm(amount), who })} />
        {result.code ? (
          <>
            <Txt>{t('sentInvite', { who })}</Txt>
            <View style={{ alignItems: 'center', padding: 16, backgroundColor: '#fff', borderRadius: 16 }} accessible accessibilityLabel={t('inviteFor')}>
              <QRCode value={claimLink(result.code)} size={220} />
            </View>
            <Txt v="small" selectable style={{ fontFamily: 'monospace' }}>{result.code}</Txt>
            <Button label={t('shareCode')} icon="share-social" onPress={async () => { if ((await shareText(inviteMessage(result.code!))) === 'copied') { setCopied(true); announce(t('copied')); } }} />
            <Button label={copied ? t('copied') : t('copyCode')} icon="copy" kind="secondary" onPress={async () => { await copy(inviteMessage(result.code!)); setCopied(true); announce(t('copied')); }} />
          </>
        ) : null}
        <Button label={t('viewOnStellar')} icon="open-outline" kind="secondary" onPress={() => openUrl(S.explorerTx(result.hash))} />
        <Button label={t('done')} icon="home" onPress={back} />
      </Screen>
    );
  }

  if (step === 'confirm') {
    const total = mode === 'invite' ? amount + S.INVITE_RESERVE : amount;
    return (
      <Screen title={t('check')} onBack={() => setStep(mode === 'address' && !trusted ? 'safety' : 'amount')}>
        <Card label={`${t('to')}: ${who}. ${t('amount')}: ${xlm(amount)}`}>
          <Txt color={C.muted}>{t('to')}</Txt>
          <Txt v="title">{who}</Txt>
          {mode === 'address' ? <Txt v="small" color={C.muted} selectable>{address.trim()}</Txt> : null}
          <View style={{ height: 8 }} />
          <Txt color={C.muted}>{t('amount')}</Txt>
          <Txt v="huge">{xlm(amount)}</Txt>
          {approx(amount) ? <Txt color={C.muted}>{t('approx', { v: approx(amount)! })}</Txt> : null}
        </Card>
        <Card>
          <Row label={t('fee')} value={t('feeValue')} />
          {mode === 'invite' ? (
            <>
              <Row label={t('setupCost')} value={xlm(S.INVITE_RESERVE)} />
              <Txt v="small" color={C.muted}>{t('setupCostHelp')}</Txt>
            </>
          ) : null}
        </Card>
        <Notice
          tone="success"
          icon="shield-checkmark"
          title={t('protectionTitle')}
          body={mode === 'invite' ? t('protectionInvite') : t('protectionBody', { who, days: S.PROTECTED_DAYS })}
        />
        {mode === 'address' ? (
          <Card>
            <Txt bold>{t('holdTitle')}</Txt>
            <Txt color={C.muted}>{t('holdHelp')}</Txt>
            <Choice label={t('holdTitle')} value={hold} onChange={(h) => setHold(h)} options={HOLDS.map((h) => ({ value: h, label: holdLabel(h) }))} />
            {hold > 0 ? <Txt accessibilityLiveRegion="polite">{t('holdUntil', { who, time: releaseText() })}</Txt> : null}
          </Card>
        ) : null}
        {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : null}
        <Button label={busy ? t('sending') : t('sendNow', { amount: xlm(total) })} icon="paper-plane" busy={busy} onPress={send} />
        <Button label={t('cancel')} kind="secondary" onPress={back} />
      </Screen>
    );
  }

  if (step === 'safety') {
    const questions = RED_FLAGS.map((f) => t(f));
    return (
      <Screen title={t('safetyTitle')} onBack={() => setStep('amount')}>
        <Txt>{t('safetyIntro', { who })}</Txt>
        <Button
          label={t('readAloud')}
          icon="volume-high"
          kind="secondary"
          onPress={() => { Speech.stop(); Speech.speak([t('safetyIntro', { who }), ...questions].join('. '), { language: speechLang[settings.lang] }); }}
        />
        {RED_FLAGS.map((f) => (
          <Card key={f}>
            <Txt bold>{t(f)}</Txt>
            <Choice
              label={t(f)}
              value={answers[f] ?? ('' as any)}
              onChange={(v: 'yes' | 'no') => {
                const next = { ...answers, [f]: v };
                setAnswers(next);
                setHold(RED_FLAGS.some((x) => next[x] === 'yes') ? 259200 : 86400);
              }}
              options={[{ value: 'no', label: t('no') }, { value: 'yes', label: t('yes') }]}
            />
          </Card>
        ))}
        {redFlags > 0 ? (
          <>
            <Notice tone="danger" icon="warning" title={t('scamWarnTitle')} body={t('scamWarnBody')} />
            <Button label={t('stopAndCall')} icon="call" kind="danger" onPress={back} />
          </>
        ) : null}
        <Button
          label={t('next')}
          icon="arrow-forward"
          kind={redFlags > 0 ? 'secondary' : 'primary'}
          disabled={RED_FLAGS.some((f) => !answers[f])}
          onPress={() => setStep('confirm')}
        />
      </Screen>
    );
  }

  if (step === 'amount') {
    return (
      <Screen title={t('howMuch')} onBack={() => setStep('who')}>
        <Txt v="heading">{`${t('to')}: ${who}`}</Txt>
        {unknown ? <Notice tone="warn" icon="help-circle" title={t('unknownAddress')} /> : null}
        <Field
          label={`${t('amount')} (XLM)`}
          value={amountText}
          onChangeText={(v) => { setAmountText(v.replace(/[^0-9.,]/g, '')); setAmountError(null); }}
          keyboardType="decimal-pad"
          placeholder="0"
          error={amountError}
          autoFocus
          style={{ fontSize: 34 * settings.scale, minHeight: 72, borderWidth: 2, borderRadius: 12, paddingHorizontal: 14, backgroundColor: '#fff', borderColor: amountError ? C.danger : C.border, color: C.text }}
        />
        {amount > 0 && approx(amount) ? <Txt accessibilityLiveRegion="polite">{t('approx', { v: approx(amount)! })}</Txt> : null}
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          {[10, 50, 100, 500].filter((n) => n <= max).map((n) => (
            <Button key={n} style={{ flexGrow: 1, minWidth: 80 }} kind="secondary" label={String(n)} onPress={() => { setAmountText(String(n)); setAmountError(null); }} />
          ))}
        </View>
        <Txt color={C.muted}>{t('youHave', { amount: xlm(max) })}</Txt>
        <Button label={t('next')} icon="arrow-forward" onPress={checkAmount} />
      </Screen>
    );
  }

  return (
    <Screen title={t('whoTo')} onBack={back}>
      {contacts.length ? (
        <View style={{ gap: 8 }}>
          <Txt v="heading">{t('contacts')}</Txt>
          {contacts.map((c) => (
            <Pressable
              key={c.address}
              accessibilityRole="button"
              accessibilityLabel={c.name}
              onPress={() => pickContact(c)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, padding: 12, backgroundColor: C.card, borderRadius: 14, borderWidth: 1.5, borderColor: '#D5DBE3' }}
            >
              <Ionicons name="person-circle" size={40} color={C.primary} />
              <View style={{ flex: 1 }}>
                <Txt bold>{c.name}</Txt>
                <Txt v="small" color={C.muted}>{`${c.address.slice(0, 6)}…${c.address.slice(-6)}`}</Txt>
              </View>
              <Ionicons name="chevron-forward" size={24} color={C.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <Txt v="heading">{t('newPerson')}</Txt>
      <Field label={t('theirName')} value={name} onChangeText={setName} autoComplete="name" />
      <Field
        label={t('theirAddress')}
        value={address}
        onChangeText={(v) => { setAddress(v.trim()); setAddrError(null); }}
        autoCapitalize="characters"
        autoCorrect={false}
        error={addrError}
      />
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <Button style={{ flex: 1, minWidth: 140 }} kind="secondary" icon="clipboard" label={t('paste')} onPress={async () => { setAddress((await pasteText()).trim()); setAddrError(null); }} />
        <Button style={{ flex: 1, minWidth: 140 }} kind="secondary" icon="scan" label={t('scan')} onPress={() => setScanning(true)} />
      </View>
      {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : null}
      <Button label={t('next')} icon="arrow-forward" busy={busy} onPress={checkAddress} disabled={!address} />
      <View style={{ height: 8 }} />
      <Button
        label={t('noApp')}
        hint={t('noAppHint')}
        icon="gift"
        kind="success"
        onPress={() => { setMode('invite'); setUnknown(false); setStep('amount'); }}
      />
      <Scanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onScan={(data) => {
          setScanning(false);
          const m = data.match(/G[A-Z2-7]{55}/);
          setAddress(m ? m[0] : data.trim());
          setAddrError(null);
        }}
      />
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Txt color={C.muted}>{label}</Txt>
      <Txt bold>{value}</Txt>
    </View>
  );
}
