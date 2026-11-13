import React, { useState } from 'react';
import { Alert, Linking, Modal, Platform, Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, C, Txt } from './ui';
import { useApp } from './state';

export function confirm(message: string, okLabel: string, cancelLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  return new Promise((resolve) =>
    Alert.alert('', message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

/** System share sheet; falls back to copying when the platform has none. Returns 'shared' | 'copied'. */
export async function shareText(message: string): Promise<'shared' | 'copied'> {
  try {
    if (Platform.OS !== 'web' || (typeof navigator !== 'undefined' && (navigator as any).share)) {
      await Share.share({ message });
      return 'shared';
    }
  } catch {}
  await Clipboard.setStringAsync(message);
  return 'copied';
}

export const copy = (text: string) => Clipboard.setStringAsync(text);
export const pasteText = () => Clipboard.getStringAsync();
export const openUrl = (url: string) => Linking.openURL(url);

export function claimLink(code: string) {
  // Keep the path so links work when hosted under a sub-path (e.g. GitHub Pages /relay-wallet/).
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}${window.location.pathname}?claim=${code}`;
  return `relay://claim?code=${code}`;
}

export function proposalLink(xdr: string) {
  const x = encodeURIComponent(xdr);
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}${window.location.pathname}?proposal=${x}`;
  return `relay://proposal?x=${x}`;
}

/** Accepts a bare claim code or any link that carries one. */
export function parseCode(input: string) {
  const s = input.trim();
  const m = s.match(/[?&](?:claim|code)=([A-Z2-7]{56})/);
  return (m?.[1] ?? s).toUpperCase();
}

export function Scanner({ visible, onClose, onScan }: { visible: boolean; onClose: () => void; onScan: (data: string) => void }) {
  const { t } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [done, setDone] = useState(false);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => setDone(false)}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {permission?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (done) return;
              setDone(true);
              onScan(data);
            }}
            accessibilityLabel={t('scan')}
          />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: C.bg }}>
            <Txt>{t('cameraNeeded')}</Txt>
            <Button label={t('allowCamera')} icon="camera" onPress={requestPermission} />
          </View>
        )}
        <View style={{ padding: 16, backgroundColor: C.bg }}>
          <Button label={t('cancel')} kind="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

export function useBusy() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setErr(null);
    try {
      return await fn();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, setErr, run };
}
