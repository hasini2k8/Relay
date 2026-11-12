// Accessible building blocks: big touch targets (min 56dp), high-contrast colours
// (all text ≥ 7:1 on its background), screen-reader roles and labels on everything,
// and a user-chosen text scale applied on top of the phone's own font size.
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from './state';

export const C = {
  bg: '#F5F7FA',
  card: '#FFFFFF',
  text: '#0B1220',
  muted: '#3A4555',
  border: '#7A8699',
  primary: '#0B4F8A',
  primaryText: '#FFFFFF',
  success: '#0B5D33',
  successBg: '#E3F4EA',
  warn: '#7A4A00',
  warnBg: '#FFF3D6',
  danger: '#9B1B1F',
  dangerBg: '#FDE7E8',
  focus: '#F2B705',
};

type Variant = 'title' | 'heading' | 'body' | 'small' | 'huge';
const sizes: Record<Variant, number> = { huge: 40, title: 28, heading: 22, body: 18, small: 16 };

export function Txt({ v = 'body', style, color, bold, ...p }: TextProps & { v?: Variant; color?: string; bold?: boolean }) {
  const { settings } = useApp();
  const fs = sizes[v] * settings.scale;
  return (
    <Text
      maxFontSizeMultiplier={2.2}
      accessibilityRole={v === 'title' || v === 'heading' ? 'header' : undefined}
      style={[
        { fontSize: fs, lineHeight: fs * 1.35, color: color ?? C.text, fontWeight: bold || v === 'title' || v === 'huge' || v === 'heading' ? '700' : '400' },
        style,
      ]}
      {...p}
    />
  );
}

type BtnKind = 'primary' | 'secondary' | 'danger' | 'success';

export function Button({
  label,
  hint,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  busy,
  style,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  kind?: BtnKind;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const { settings } = useApp();
  const filled = kind !== 'secondary';
  const bg = { primary: C.primary, danger: C.danger, success: C.success, secondary: C.card }[kind];
  const fg = filled ? C.primaryText : C.primary;
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed, focused }: any) => [
        styles.btn,
        { backgroundColor: bg, borderColor: filled ? bg : C.primary, opacity: off ? 0.55 : pressed ? 0.85 : 1 },
        focused && { outlineColor: C.focus, outlineWidth: 3, outlineStyle: 'solid' as any },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={24 * settings.scale} color={fg} /> : null}
      <View style={{ flexShrink: 1 }}>
        <Txt bold color={fg} style={{ textAlign: 'center' }}>
          {label}
        </Txt>
        {hint ? (
          <Txt v="small" color={fg} style={{ textAlign: 'center', opacity: 0.95 }} importantForAccessibility="no">
            {hint}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}

export function Card({ children, tone, style, label }: { children: React.ReactNode; tone?: 'success' | 'warn' | 'danger'; style?: ViewStyle; label?: string }) {
  const bg = tone ? { success: C.successBg, warn: C.warnBg, danger: C.dangerBg }[tone] : C.card;
  const border = tone ? { success: C.success, warn: C.warn, danger: C.danger }[tone] : '#D5DBE3';
  return (
    <View accessible={!!label} accessibilityLabel={label} style={[styles.card, { backgroundColor: bg, borderColor: border }, style]}>
      {children}
    </View>
  );
}

export function Field({ label, error, ...p }: TextInputProps & { label: string; error?: string | null }) {
  const { settings } = useApp();
  return (
    <View style={{ gap: 6 }}>
      <Txt bold nativeID={`lbl-${label}`}>{label}</Txt>
      <TextInput
        accessibilityLabel={label}
        accessibilityLabelledBy={`lbl-${label}`}
        placeholderTextColor={C.muted}
        style={[styles.input, { fontSize: 20 * settings.scale, borderColor: error ? C.danger : C.border }]}
        {...p}
      />
      {error ? (
        <Txt v="small" color={C.danger} accessibilityLiveRegion="assertive" accessibilityRole="alert">
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

export function Screen({ title, children, onBack, right }: { title?: string; children: React.ReactNode; onBack?: () => void; right?: React.ReactNode }) {
  const { t, settings } = useApp();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={styles.header}>
        {onBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('back')} onPress={onBack} style={styles.iconBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={28 * settings.scale} color={C.text} />
          </Pressable>
        ) : null}
        {title ? (
          <Txt v="title" style={{ flex: 1 }} numberOfLines={2}>
            {title}
          </Txt>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {right}
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', gap: 16 }}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function IconButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const { settings } = useApp();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.iconBtn} hitSlop={8}>
      <Ionicons name={icon} size={28 * settings.scale} color={C.text} />
    </Pressable>
  );
}

export function Notice({ tone, icon, title, body }: { tone: 'success' | 'warn' | 'danger'; icon: keyof typeof Ionicons.glyphMap; title: string; body?: string }) {
  const fg = { success: C.success, warn: C.warn, danger: C.danger }[tone];
  return (
    <Card tone={tone} label={body ? `${title}. ${body}` : title}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }} accessibilityLiveRegion="polite">
        <Ionicons name={icon} size={28} color={fg} />
        <View style={{ flex: 1, gap: 4 }}>
          <Txt bold color={fg}>
            {title}
          </Txt>
          {body ? <Txt color={C.text}>{body}</Txt> : null}
        </View>
      </View>
    </Card>
  );
}

export function Choice<T extends string | number>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[styles.chip, { backgroundColor: on ? C.primary : C.card, borderColor: on ? C.primary : C.border }]}
          >
            {on ? <Ionicons name="checkmark" size={20} color={C.primaryText} /> : null}
            <Txt bold color={on ? C.primaryText : C.text}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 60,
    borderRadius: 14,
    borderWidth: 2,
    paddingVertical: 12,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  card: { borderRadius: 16, borderWidth: 1.5, padding: 16, gap: 10 },
  input: { minHeight: 58, borderWidth: 2, borderRadius: 12, paddingHorizontal: 14, backgroundColor: C.card, color: C.text },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  body: { padding: 16, paddingBottom: 48 },
  iconBtn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  chip: { minHeight: 52, paddingHorizontal: 16, borderRadius: 26, borderWidth: 2, flexDirection: 'row', alignItems: 'center', gap: 6 },
});
