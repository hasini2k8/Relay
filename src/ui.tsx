// RELAY design system — "Warm care" theme.
// Still accessibility-first: 56dp+ touch targets, body text ≥ 7:1 on its background,
// roles and labels on everything, and the user's text scale on top of the phone's.
// New in this version: depth (soft shadows, gradient hero cards), motion (fade-up
// entrances, press-scale, animated progress), and family-first building blocks
// (avatars, approval stacks, progress rings, share bars). Only react-native's own
// Animated API and react-native-svg are used, so it runs in Expo Go with no new deps.
import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
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
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from './state';

export const C = {
  bg: '#FBF6EF', // warm cream
  card: '#FFFFFF',
  sunk: '#F3ECE2', // recessed surfaces, tracks
  text: '#1E1B2E', // ink
  muted: '#4A4560',
  border: '#8A8399',
  hairline: '#E8DFD3',
  primary: '#0E4D5C', // deep teal
  primaryText: '#FFFFFF',
  primarySoft: '#DDEEF0',
  plum: '#3B2A6B',
  marigold: '#F2A33A',
  marigoldSoft: '#FDEBD0',
  coral: '#E5604D',
  success: '#1B6B45',
  successBg: '#E2F3E8',
  warn: '#7A4A00',
  warnBg: '#FFF1D6',
  danger: '#A3262A',
  dangerBg: '#FCE6E6',
  focus: '#F2A33A',
};

/** Per-person colours for avatars and contribution charts (all carry white text ≥ 4.5:1). */
export const PERSON = ['#0E4D5C', '#B5452F', '#5A3A8C', '#2F6B2F', '#8A4B00', '#1F4E8C'];
export const personColor = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PERSON[h % PERSON.length];
};

const ND = Platform.OS !== 'web'; // native driver isn't available on web

/** Respects the OS "reduce motion" setting. */
function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduced).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduced);
    return () => sub?.remove?.();
  }, []);
  return reduced;
}

const shadow = (e: number): ViewStyle =>
  Platform.select({
    web: { boxShadow: `0 ${e}px ${e * 3}px rgba(30,27,46,${0.06 + e * 0.008})` } as any,
    default: { shadowColor: '#1E1B2E', shadowOpacity: 0.08 + e * 0.01, shadowRadius: e * 2, shadowOffset: { width: 0, height: e }, elevation: e },
  })!;

// ---------- Text ----------

type Variant = 'title' | 'heading' | 'body' | 'small' | 'huge' | 'eyebrow';
const sizes: Record<Variant, number> = { huge: 42, title: 28, heading: 21, body: 18, small: 15, eyebrow: 13 };

export function Txt({ v = 'body', style, color, bold, ...p }: TextProps & { v?: Variant; color?: string; bold?: boolean }) {
  const { settings } = useApp();
  const fs = sizes[v] * settings.scale;
  const heavy = v === 'title' || v === 'huge' || v === 'heading';
  return (
    <Text
      maxFontSizeMultiplier={2.2}
      accessibilityRole={v === 'title' || v === 'heading' ? 'header' : undefined}
      style={[
        {
          fontSize: fs,
          lineHeight: fs * (v === 'huge' ? 1.12 : 1.35),
          color: color ?? C.text,
          fontWeight: v === 'huge' ? '800' : heavy ? '700' : bold ? '700' : '400',
          letterSpacing: v === 'huge' ? -1 : v === 'title' ? -0.4 : v === 'eyebrow' ? 1.2 : 0,
          textTransform: v === 'eyebrow' ? 'uppercase' : undefined,
        },
        v === 'eyebrow' && { fontWeight: '700' },
        style,
      ]}
      {...p}
    />
  );
}

// ---------- Motion ----------

/** Fades and lifts its children in. `delay` lets lists cascade. */
export function FadeIn({ children, delay = 0, style, from = 14 }: { children: React.ReactNode; delay?: number; style?: ViewStyle; from?: number }) {
  const reduced = useReducedMotion();
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: reduced ? 0 : 480, delay: reduced ? 0 : delay, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start();
  }, []);
  return (
    <Animated.View style={[style, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

const APressable = Animated.createAnimatedComponent(Pressable);

/** A Pressable that gently shrinks while pressed. `style` may be a function of { pressed, focused }. */
export function PressScale({ children, style, ...rest }: Omit<React.ComponentProps<typeof Pressable>, 'style' | 'children'> & { style?: any; children?: React.ReactNode }) {
  const s = useRef(new Animated.Value(1)).current;
  const [state, setState] = React.useState({ pressed: false, focused: false });
  const to = (v: number) => Animated.spring(s, { toValue: v, useNativeDriver: ND, speed: 40, bounciness: 6 }).start();
  const resolved = typeof style === 'function' ? style(state) : style;
  return (
    <APressable
      {...(rest as any)}
      onPressIn={(e: any) => {
        setState((x) => ({ ...x, pressed: true }));
        to(0.97);
        rest.onPressIn?.(e);
      }}
      onPressOut={(e: any) => {
        setState((x) => ({ ...x, pressed: false }));
        to(1);
        rest.onPressOut?.(e);
      }}
      onFocus={(e: any) => {
        setState((x) => ({ ...x, focused: true }));
        (rest as any).onFocus?.(e);
      }}
      onBlur={(e: any) => {
        setState((x) => ({ ...x, focused: false }));
        (rest as any).onBlur?.(e);
      }}
      style={[resolved, { transform: [{ scale: s }] }]}
    >
      {children}
    </APressable>
  );
}

/** Slow breathing pulse, for "waiting" states. */
export function Pulse({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const reduced = useReducedMotion();
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
        Animated.timing(a, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced]);
  return <Animated.View style={[style, { transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }] }]}>{children}</Animated.View>;
}

// ---------- Buttons ----------

type BtnKind = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'light';

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
  const bg = { primary: C.primary, danger: C.danger, success: C.success, secondary: C.card, ghost: 'transparent', light: 'rgba(255,255,255,0.16)' }[kind];
  const fg = { primary: C.primaryText, danger: C.primaryText, success: C.primaryText, secondary: C.primary, ghost: C.primary, light: '#FFFFFF' }[kind];
  const border = { primary: C.primary, danger: C.danger, success: C.success, secondary: C.hairline, ghost: 'transparent', light: 'rgba(255,255,255,0.35)' }[kind];
  const off = disabled || busy;
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ focused }: any) => [
        styles.btn,
        { backgroundColor: bg, borderColor: border, opacity: off ? 0.5 : 1 },
        kind !== 'ghost' && kind !== 'light' && shadow(kind === 'secondary' ? 1 : 3),
        focused && ({ outlineColor: C.focus, outlineWidth: 3, outlineStyle: 'solid' } as any),
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={22 * settings.scale} color={fg} /> : null}
      <View style={{ flexShrink: 1 }}>
        <Txt bold color={fg} style={{ textAlign: 'center' }}>
          {label}
        </Txt>
        {hint ? (
          <Txt v="small" color={fg} style={{ textAlign: 'center', opacity: 0.92 }} importantForAccessibility="no">
            {hint}
          </Txt>
        ) : null}
      </View>
    </PressScale>
  );
}

/** Round icon tile with a label underneath — used for the quick-action row. */
export function ActionTile({ icon, label, onPress, disabled, tint = C.primary, light }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean; tint?: string; light?: boolean }) {
  const { settings } = useApp();
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ alignItems: 'center', gap: 6, minWidth: 72, flex: 1, opacity: disabled ? 0.5 : 1 }}>
      <View style={[styles.tile, light ? { backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.3)' } : { backgroundColor: C.card, borderColor: C.hairline, ...shadow(2) }]}>
        <Ionicons name={icon} size={26 * settings.scale} color={light ? '#fff' : tint} />
      </View>
      <Txt v="small" bold color={light ? '#fff' : C.text} style={{ textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Txt>
    </PressScale>
  );
}

// ---------- Surfaces ----------

export function Card({ children, tone, style, label }: { children: React.ReactNode; tone?: 'success' | 'warn' | 'danger'; style?: ViewStyle; label?: string }) {
  const bg = tone ? { success: C.successBg, warn: C.warnBg, danger: C.dangerBg }[tone] : C.card;
  const border = tone ? { success: '#9CD3B2', warn: '#F0C67A', danger: '#E8A3A3' }[tone] : C.hairline;
  return (
    <View accessible={!!label} accessibilityLabel={label} style={[styles.card, { backgroundColor: bg, borderColor: border }, !tone && shadow(2), style]}>
      {children}
    </View>
  );
}

/** Deep teal → plum card with soft marigold glows. Children render on top in white. */
export function GradientCard({ children, style, label, colors = [C.primary, C.plum] }: { children: React.ReactNode; style?: ViewStyle; label?: string; colors?: [string, string] }) {
  const id = useRef(`g${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <View accessible={!!label} accessibilityLabel={label} style={[styles.gcard, shadow(6), style]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors[0]} />
            <Stop offset="1" stopColor={colors[1]} />
          </LinearGradient>
          <RadialGradient id={`${id}r`} cx="0.9" cy="0.05" r="0.6">
            <Stop offset="0" stopColor={C.marigold} stopOpacity="0.55" />
            <Stop offset="1" stopColor={C.marigold} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={`${id}c`} cx="0.05" cy="1" r="0.55">
            <Stop offset="0" stopColor={C.coral} stopOpacity="0.35" />
            <Stop offset="1" stopColor={C.coral} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id}l)`} />
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id}r)`} />
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id}c)`} />
      </Svg>
      <View style={{ gap: 10 }}>{children}</View>
    </View>
  );
}

export function Pill({ icon, label, tone = 'neutral', light }: { icon?: keyof typeof Ionicons.glyphMap; label: string; tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'marigold'; light?: boolean }) {
  const map = {
    neutral: [C.sunk, C.text],
    success: [C.successBg, C.success],
    warn: [C.warnBg, C.warn],
    danger: [C.dangerBg, C.danger],
    marigold: [C.marigoldSoft, '#6E3F00'],
  } as const;
  const [bg, fg] = light ? ['rgba(255,255,255,0.18)', '#FFFFFF'] : map[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: bg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}>
      {icon ? <Ionicons name={icon} size={16} color={fg} /> : null}
      <Txt v="small" bold color={fg}>
        {label}
      </Txt>
    </View>
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
      <Txt v="heading">{title}</Txt>
      {action && onAction ? (
        <Pressable accessibilityRole="button" accessibilityLabel={action} onPress={onAction} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Txt bold color={C.primary}>
            {action}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------- People ----------

export function Avatar({ name, seed, size = 44, ring, done }: { name: string; seed?: string; size?: number; ring?: string; done?: boolean }) {
  const initials = name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';
  const bg = personColor(seed ?? name);
  return (
    <View importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', borderWidth: ring ? 3 : 0, borderColor: ring }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.38 }}>{initials}</Text>
      </View>
      {done ? (
        <View style={{ position: 'absolute', right: -2, bottom: -2, backgroundColor: '#fff', borderRadius: 12 }}>
          <Ionicons name="checkmark-circle" size={Math.max(16, size * 0.42)} color={C.success} />
        </View>
      ) : null}
    </View>
  );
}

/** Overlapping avatars; approved people get a green tick. */
export function AvatarStack({ people, size = 40, max = 5 }: { people: { name: string; seed: string; done?: boolean }[]; size?: number; max?: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {people.slice(0, max).map((p, i) => (
        <View key={p.seed} style={{ marginLeft: i ? -size * 0.28 : 0 }}>
          <Avatar name={p.name} seed={p.seed} size={size} ring="#FFFFFF" done={p.done} />
        </View>
      ))}
    </View>
  );
}

// ---------- Data shapes ----------

const ACircle = Animated.createAnimatedComponent(Circle);

/** Animated circular progress, e.g. approvals collected. */
export function ProgressRing({ value, size = 120, stroke = 12, color = C.success, track = C.sunk, children }: { value: number; size?: number; stroke?: number; color?: string; track?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const a = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    Animated.timing(a, { toValue: Math.max(0, Math.min(1, value)), duration: reduced ? 0 : 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [value]);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <ACircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${len} ${len}`}
          strokeDashoffset={a.interpolate({ inputRange: [0, 1], outputRange: [len, 0] }) as any}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

/** Horizontal bar that grows in. `marker` draws a thin line (e.g. an even share). */
export function Bar({ value, color = C.primary, marker, height = 10 }: { value: number; color?: string; marker?: number; height?: number }) {
  const a = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    Animated.timing(a, { toValue: Math.max(0, Math.min(1, value)), duration: reduced ? 0 : 800, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [value]);
  return (
    <View style={{ height, borderRadius: height, backgroundColor: C.sunk, overflow: 'hidden' }} importantForAccessibility="no-hide-descendants">
      <Animated.View style={{ height, borderRadius: height, backgroundColor: color, width: a.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
      {marker != null ? <View style={{ position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: C.text, left: `${Math.max(0, Math.min(1, marker)) * 100}%` as any }} /> : null}
    </View>
  );
}

/** A short burst of colourful pieces, for "Paid" moments. Decorative only. */
export function Confetti({ count = 26 }: { count?: number }) {
  const reduced = useReducedMotion();
  const pieces = useRef(
    Array.from({ length: count }, (_, i) => ({
      a: new Animated.Value(0),
      x: Math.random() * 2 - 1,
      rot: Math.random() * 720 - 360,
      color: [C.marigold, C.coral, C.success, '#5A3A8C', '#2E8BA0'][i % 5],
      w: 6 + Math.random() * 6,
      delay: Math.random() * 200,
    })),
  ).current;
  useEffect(() => {
    if (reduced) return;
    Animated.stagger(
      12,
      pieces.map((p) => Animated.timing(p.a, { toValue: 1, duration: 1400, delay: p.delay, easing: Easing.out(Easing.quad), useNativeDriver: ND })),
    ).start();
  }, []);
  if (reduced) return null;
  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 0, alignItems: 'center' }}>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: p.w,
            height: p.w * 1.6,
            borderRadius: 2,
            backgroundColor: p.color,
            opacity: p.a.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateX: p.a.interpolate({ inputRange: [0, 1], outputRange: [0, p.x * 170] }) },
              { translateY: p.a.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, -110, 220] }) },
              { rotate: p.a.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.rot}deg`] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

// ---------- Inputs ----------

export function Field({ label, error, onFocus, onBlur, ...p }: TextInputProps & { label: string; error?: string | null }) {
  const { settings } = useApp();
  const [focus, setFocus] = React.useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Txt bold nativeID={`lbl-${label}`}>
        {label}
      </Txt>
      <TextInput
        accessibilityLabel={label}
        accessibilityLabelledBy={`lbl-${label}`}
        placeholderTextColor={C.muted}
        style={[
          styles.input,
          { fontSize: 19 * settings.scale, borderColor: error ? C.danger : focus ? C.primary : C.hairline, backgroundColor: focus ? C.card : '#FFFDF9' },
          focus && shadow(2),
        ]}
        {...p}
        onFocus={(e) => {
          setFocus(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          onBlur?.(e);
        }}
      />
      {error ? (
        <Txt v="small" color={C.danger} accessibilityLiveRegion="assertive" accessibilityRole="alert">
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

export function Choice<T extends string | number>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <PressScale
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[styles.chip, { backgroundColor: on ? C.primary : C.card, borderColor: on ? C.primary : C.hairline }, on && shadow(2)]}
          >
            {on ? <Ionicons name="checkmark" size={20} color={C.primaryText} /> : null}
            <Txt bold color={on ? C.primaryText : C.text}>
              {o.label}
            </Txt>
          </PressScale>
        );
      })}
    </View>
  );
}

// ---------- Layout ----------

/** Soft background washes behind every screen. Decorative. */
function Backdrop() {
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="xMidYMin slice" viewBox="0 0 400 800">
      <Defs>
        <RadialGradient id="bdA" cx="0.95" cy="0.02" r="0.5">
          <Stop offset="0" stopColor={C.marigold} stopOpacity="0.22" />
          <Stop offset="1" stopColor={C.marigold} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="bdB" cx="0" cy="0.35" r="0.45">
          <Stop offset="0" stopColor="#2E8BA0" stopOpacity="0.12" />
          <Stop offset="1" stopColor="#2E8BA0" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect width="400" height="800" fill="url(#bdA)" />
      <Rect width="400" height="800" fill="url(#bdB)" />
    </Svg>
  );
}

export function Screen({ title, children, onBack, right, subtitle }: { title?: string; children: React.ReactNode; onBack?: () => void; right?: React.ReactNode; subtitle?: string }) {
  const { t, settings } = useApp();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <Backdrop />
      <View style={styles.header}>
        {onBack ? (
          <PressScale accessibilityRole="button" accessibilityLabel={t('back')} onPress={onBack} style={[styles.iconBtn, styles.iconBtnSolid]} hitSlop={8}>
            <Ionicons name="chevron-back" size={24 * settings.scale} color={C.text} />
          </PressScale>
        ) : null}
        {title ? (
          <View style={{ flex: 1 }}>
            <Txt v="title" numberOfLines={2}>
              {title}
            </Txt>
            {subtitle ? <Txt v="small" color={C.muted}>{subtitle}</Txt> : null}
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {right}
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', gap: 16 }}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function IconButton({ icon, label, onPress, light }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; light?: boolean }) {
  const { settings } = useApp();
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.iconBtn, light ? { backgroundColor: 'rgba(255,255,255,0.16)' } : styles.iconBtnSolid]} hitSlop={8}>
      <Ionicons name={icon} size={24 * settings.scale} color={light ? '#fff' : C.text} />
    </PressScale>
  );
}

export function Notice({ tone, icon, title, body }: { tone: 'success' | 'warn' | 'danger'; icon: keyof typeof Ionicons.glyphMap; title: string; body?: string }) {
  const fg = { success: C.success, warn: C.warn, danger: C.danger }[tone];
  return (
    <FadeIn from={6}>
      <Card tone={tone} label={body ? `${title}. ${body}` : title}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }} accessibilityLiveRegion="polite">
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFFAA', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={22} color={fg} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt bold color={fg}>
              {title}
            </Txt>
            {body ? <Txt color={C.text}>{body}</Txt> : null}
          </View>
        </View>
      </Card>
    </FadeIn>
  );
}

/** Shimmering placeholder block while data loads. */
export function Skeleton({ height = 20, width = '100%', radius = 10 }: { height?: number; width?: number | string; radius?: number }) {
  const a = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: ND }),
        Animated.timing(a, { toValue: 0.5, duration: 700, useNativeDriver: ND }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View accessibilityLabel="Loading" style={{ height, width: width as any, borderRadius: radius, backgroundColor: C.hairline, opacity: a }} />;
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 58,
    borderRadius: 18,
    borderWidth: 1.5,
    paddingVertical: 12,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  card: { borderRadius: 22, borderWidth: 1, padding: 18, gap: 10 },
  gcard: { borderRadius: 28, padding: 22, overflow: 'hidden' },
  input: { minHeight: 58, borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 16, color: C.text },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  body: { padding: 16, paddingBottom: 56 },
  iconBtn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  iconBtnSolid: { backgroundColor: C.card, borderWidth: 1, borderColor: C.hairline },
  chip: { minHeight: 52, paddingHorizontal: 18, borderRadius: 26, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', gap: 6 },
  tile: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
