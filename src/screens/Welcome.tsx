import React, { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as S from '../stellar';
import { useApp } from '../state';
import { Button, C, Choice, FadeIn, Field, Notice, Pill, Screen, Txt } from '../ui';
import { CareMap } from '../art';
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

  const points: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string; tint: string }[] = [
    { icon: 'people', text: t('onboard1'), tint: C.primary },
    { icon: 'shield-checkmark', text: t('onboard2'), tint: C.success },
    { icon: 'eye', text: t('onboard3'), tint: '#B5452F' },
  ];

  return (
    <Screen>
      <FadeIn>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="heart" size={18} color={C.marigold} />
            </View>
            <Txt v="title" color={C.primary} accessibilityRole="header" style={{ letterSpacing: 3 }}>
              {t('appName')}
            </Txt>
          </View>
        </View>
      </FadeIn>

      <FadeIn delay={120} style={{ alignItems: 'center' }}>
        <CareMap width={330} />
      </FadeIn>

      <FadeIn delay={220}>
        <Txt v="title" style={{ textAlign: 'center', fontSize: 30 * settings.scale, lineHeight: 36 * settings.scale }}>
          {t('onboardTitle')}
        </Txt>
      </FadeIn>

      <View style={{ gap: 10 }}>
        {points.map((p, i) => (
          <FadeIn key={p.text} delay={320 + i * 90}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 18, padding: 12, borderWidth: 1, borderColor: C.hairline }}>
              <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: C.sunk, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={p.icon} size={22} color={p.tint} />
              </View>
              <Txt bold style={{ flex: 1 }}>
                {p.text}
              </Txt>
            </View>
          </FadeIn>
        ))}
      </View>

      {S.NETWORK === 'testnet' ? (
        <FadeIn delay={600} style={{ alignItems: 'center' }}>
          <Pill icon="flask" tone="marigold" label={t('testnetBadge')} />
        </FadeIn>
      ) : null}

      <FadeIn delay={650}>
        <View style={{ gap: 10 }}>
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
        </View>
      </FadeIn>

      {err ? <Notice tone="danger" icon="alert-circle" title={t('errorTitle')} body={err} /> : null}

      <FadeIn delay={720}>
        <View style={{ gap: 12 }}>
          <Button label={busy ? t('creating') : t('createWallet')} hint={t('createWalletHint')} icon="wallet" busy={busy} onPress={create} />
          <Button label={t('haveCode')} hint={t('haveCodeHint')} icon="gift" kind="secondary" onPress={() => go({ name: 'claim' })} />
          <Button label={t('restore')} icon="key" kind="ghost" onPress={() => go({ name: 'restore' })} />
        </View>
      </FadeIn>
    </Screen>
  );
}

export function Restore() {
  const { t, setKeypair, back } = useApp();
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen title={t('restoreTitle')} onBack={back}>
      <FadeIn>
        <View style={{ alignItems: 'center', paddingVertical: 8 }}>
          <View style={{ width: 84, height: 84, borderRadius: 28, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="key" size={40} color={C.primary} />
          </View>
        </View>
      </FadeIn>
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
