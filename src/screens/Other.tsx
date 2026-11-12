import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as S from '../stellar';
import { useApp } from '../state';
import { fiat, xlm } from '../price';
import { Button, C, Card, Choice, Field, Notice, Screen, Txt } from '../ui';
import { Scanner, confirm, copy, parseCode, pasteText, shareText, useBusy } from '../helpers';

export function Receive() {
  const { t, keypair, back, announce } = useApp();
  const address = keypair!.publicKey();
  const [copied, setCopied] = useState(false);
  return (
    <Screen title={t('myAddress')} onBack={back}>
      <Txt>{t('myAddressHelp')}</Txt>
      <View style={{ alignItems: 'center', padding: 20, backgroundColor: '#fff', borderRadius: 16 }} accessible accessibilityLabel={t('myAddress')}>
        <QRCode value={address} size={240} />
      </View>
      <Card>
        <Txt selectable style={{ fontFamily: 'monospace' }}>{address}</Txt>
      </Card>
      <Button label={copied ? t('copied') : t('copyAddress')} icon="copy" onPress={async () => { await copy(address); setCopied(true); announce(t('copied')); }} />
      <Button label={t('shareAddress')} icon="share-social" kind="secondary" onPress={async () => { if ((await shareText(address)) === 'copied') { setCopied(true); announce(t('copied')); } }} />
    </Screen>
  );
}

export function Claim({ code: initial }: { code?: string }) {
  const { t, keypair, setKeypair, back, nameFor, prices, settings, refresh, announce } = useApp();
  const [code, setCode] = useState(initial ?? '');
  const [info, setInfo] = useState<{ amount: number; sender?: string } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const { busy, err, run } = useBusy();

  const check = (c = code) =>
    run(async () => {
      const parsed = parseCode(c);
      if (!S.isValidSecret(parsed)) return setCodeError(t('badCode'));
      setCode(parsed);
      try {
        const r = await S.inspectInvite(parsed);
        if (r.claimed) return setCodeError(t('codeUsed'));
        setInfo({ amount: r.amount, sender: r.sender });
      } catch (e: any) {
        if (e?.code === 'gone') return setCodeError(t('codeUsed'));
        throw e;
      }
    });

  useEffect(() => {
    if (initial) check(initial);
  }, []);

  const receive = () =>
    run(async () => {
      if (keypair) {
        await S.claimInvite(code, keypair.publicKey());
        setDone(info!.amount);
        refresh();
      } else {
        await S.claimInvite(code);
        setDone(info!.amount - 1);
      }
      announce(t('received'));
    });

  if (done !== null) {
    return (
      <Screen title={t('received')}>
        <Notice tone="success" icon="checkmark-circle" title={t('received')} body={t('receivedBody', { amount: xlm(done) })} />
        <Button
          label={t('done')}
          icon="home"
          onPress={() => (keypair ? back() : setKeypair(S.keypairFromSecret(code)))}
        />
      </Screen>
    );
  }

  const sent = info ? Math.max(0, info.amount - S.INVITE_RESERVE) : 0;
  const approx = info ? fiat(sent, settings.fiat, prices) : null;
  return (
    <Screen title={t('enterCode')} onBack={back}>
      {!info ? (
        <>
          <Txt>{t('codeHelp')}</Txt>
          <Field
            label={t('inviteFor')}
            value={code}
            onChangeText={(v) => { setCode(v); setCodeError(null); }}
            autoCapitalize="characters"
            autoCorrect={false}
            error={codeError}
          />
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <Button style={{ flex: 1, minWidth: 140 }} kind="secondary" icon="clipboard" label={t('paste')} onPress={async () => { const v = parseCode(await pasteText()); setCode(v); setCodeError(null); }} />
            <Button style={{ flex: 1, minWidth: 140 }} kind="secondary" icon="scan" label={t('scan')} onPress={() => setScanning(true)} />
          </View>
          {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : null}
          <Button label={t('next')} icon="arrow-forward" busy={busy} disabled={!code} onPress={() => check()} />
        </>
      ) : (
        <>
          <Card tone="success" label={`${t('codeWorth', { amount: xlm(sent) })}. ${t('codeFrom', { who: nameFor(info.sender) })}`}>
            <Txt v="heading" color={C.success}>{t('moneyForYou')}</Txt>
            <Txt v="huge">{xlm(sent)}</Txt>
            {approx ? <Txt color={C.muted}>{t('approx', { v: approx })}</Txt> : null}
            <Txt v="small" color={C.muted}>{t('plusSetup', { amount: xlm(info.amount - sent) })}</Txt>
            <Txt color={C.muted}>{t('codeFrom', { who: nameFor(info.sender) })}</Txt>
          </Card>
          {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : null}
          <Button
            label={busy ? t('receiving') : keypair ? t('receiveIntoWallet') : t('receiveAsNewWallet')}
            icon="download"
            kind="success"
            busy={busy}
            onPress={receive}
          />
        </>
      )}
      <Scanner visible={scanning} onClose={() => setScanning(false)} onScan={(d) => { setScanning(false); const v = parseCode(d); setCode(v); check(v); }} />
    </Screen>
  );
}

export function Settings() {
  const { t, settings, setSettings, keypair, setKeypair, back, announce } = useApp();
  const [showKey, setShowKey] = useState(false);
  const [anchorDomain, setAnchorDomain] = useState(settings.anchorDomain);
  return (
    <Screen title={t('settings')} onBack={back}>
      <Txt v="heading">{t('language')}</Txt>
      <Choice label={t('language')} value={settings.lang} onChange={(lang) => setSettings({ lang })} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी' }]} />
      <Txt v="heading">{t('textSize')}</Txt>
      <Choice
        label={t('textSize')}
        value={settings.scale}
        onChange={(scale) => setSettings({ scale })}
        options={[{ value: 1, label: t('sizeNormal') }, { value: 1.25, label: t('sizeLarge') }, { value: 1.5, label: t('sizeHuge') }]}
      />
      <Txt v="heading">{t('currency')}</Txt>
      <Choice label={t('currency')} value={settings.fiat} onChange={(fiat) => setSettings({ fiat })} options={[{ value: 'INR', label: '₹ INR' }, { value: 'CAD', label: 'CA$ CAD' }, { value: 'USD', label: 'US$ USD' }]} />

      <Field label={t('anchorSetting')} value={anchorDomain} onChangeText={setAnchorDomain} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <Button
        label={anchorDomain.trim() === settings.anchorDomain ? t('saved') : t('save')}
        kind="secondary"
        icon="save"
        onPress={() => { setSettings({ anchorDomain: anchorDomain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') }); announce(t('saved')); }}
      />

      <Txt v="heading">{t('backupKey')}</Txt>
      <Notice tone="warn" icon="warning" title={t('backupWarn')} />
      {showKey ? (
        <Card>
          <Txt selectable style={{ fontFamily: 'monospace' }}>{keypair!.secret()}</Txt>
        </Card>
      ) : (
        <Button label={t('showKey')} icon="eye" kind="secondary" onPress={() => setShowKey(true)} />
      )}

      <Card>
        <Txt>{t('networkInfo', { net: S.NETWORK })}</Txt>
        <Txt v="small" color={C.muted}>{t('about')}</Txt>
      </Card>

      <Button
        label={t('removeWallet')}
        icon="trash"
        kind="danger"
        onPress={async () => {
          if (await confirm(t('removeConfirm'), t('remove'), t('cancel'))) setKeypair(null);
        }}
      />
    </Screen>
  );
}
