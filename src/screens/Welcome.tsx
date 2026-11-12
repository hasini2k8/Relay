import React, { useState } from 'react';
import { View } from 'react-native';
import * as S from '../stellar';
import { useApp } from '../state';
import { Button, C, Choice, Field, Notice, Screen, Txt } from '../ui';
import { useBusy } from '../helpers';

export function Welcome() {
  const { t, settings, setSettings, setKeypair, go } = useApp();
  const { busy, err, run } = useBusy();

  const create = () =>
    run(async () => {
      const kp = S.newKeypair();
      if (S.canUseFriendbot) await S.fundWithFriendbot(kp.publicKey());
      await setKeypair(kp);
    });

  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: 8, paddingVertical: 16 }}>
        <Txt v="huge" color={C.primary} accessibilityRole="header">
          {t('appName')}
        </Txt>
        <Txt v="heading" style={{ textAlign: 'center' }}>
          {t('tagline')}
        </Txt>
      </View>
      {S.NETWORK === 'testnet' ? <Notice tone="warn" icon="flask" title={t('testnetBadge')} /> : null}
      <Txt bold>{t('chooseLanguage')}</Txt>
      <Choice
        label={t('chooseLanguage')}
        value={settings.lang}
        onChange={(lang) => setSettings({ lang, fiat: lang === 'hi' ? 'INR' : settings.fiat })}
        options={[
          { value: 'en', label: 'English' },
          { value: 'hi', label: 'हिन्दी' },
        ]}
      />
      {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : null}
      <Button label={busy ? t('creating') : t('createWallet')} hint={t('createWalletHint')} icon="wallet" busy={busy} onPress={create} />
      <Button label={t('haveCode')} hint={t('haveCodeHint')} icon="gift" kind="success" onPress={() => go({ name: 'claim' })} />
      <Button label={t('restore')} icon="key" kind="secondary" onPress={() => go({ name: 'restore' })} />
    </Screen>
  );
}

export function Restore() {
  const { t, setKeypair, back } = useApp();
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen title={t('restoreTitle')} onBack={back}>
      <Txt>{t('restoreHelp')}</Txt>
      <Field
        label={t('restoreTitle')}
        value={secret}
        onChangeText={(v) => {
          setSecret(v);
          setError(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        secureTextEntry
        error={error}
      />
      <Button
        label={t('restoreBtn')}
        icon="lock-open"
        onPress={() => (S.isValidSecret(secret) ? setKeypair(S.keypairFromSecret(secret)) : setError(t('badKey')))}
      />
    </Screen>
  );
}
