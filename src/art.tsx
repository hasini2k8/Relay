// Hand-built SVG illustrations. Decorative: hidden from screen readers.
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { C } from './ui';

const APath = Animated.createAnimatedComponent(Path);

function useLoop(duration: number) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((reduced) => {
        if (reduced) return;
        loop = Animated.loop(Animated.timing(a, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: false }));
        loop.start();
      })
      .catch(() => {});
    return () => loop?.stop();
  }, []);
  return a;
}

/**
 * Three siblings in three cities, money flowing along dashed arcs into one home
 * with a heart — the whole idea of a Family Care Pot in one picture.
 */
export function CareMap({ width = 340, cities = ['Toronto', 'Dubai', 'London'], home = 'Pune' }: { width?: number; cities?: string[]; home?: string }) {
  const flow = useLoop(2400);
  const dash = flow.interpolate({ inputRange: [0, 1], outputRange: [0, -36] });
  const h = (width * 300) / 340;
  const pts = [
    { x: 55, y: 60, c: '#0E4D5C', i: 'P' },
    { x: 170, y: 34, c: '#B5452F', i: 'A' },
    { x: 285, y: 60, c: '#5A3A8C', i: 'M' },
  ];
  const homeX = 170;
  const homeY = 205;
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={width} height={h} viewBox="0 -14 340 300">
        <Defs>
          <RadialGradient id="cmGlow" cx="0.5" cy="0.78" r="0.5">
            <Stop offset="0" stopColor={C.marigold} stopOpacity="0.45" />
            <Stop offset="1" stopColor={C.marigold} stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="cmRoof" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.coral} />
            <Stop offset="1" stopColor="#C2452F" />
          </LinearGradient>
          <LinearGradient id="cmWall" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFF7EA" />
            <Stop offset="1" stopColor="#F6E3C8" />
          </LinearGradient>
        </Defs>
        {/* globe hint */}
        <Ellipse cx="170" cy="150" rx="160" ry="105" fill="none" stroke={C.hairline} strokeWidth="1.5" />
        <Ellipse cx="170" cy="150" rx="95" ry="105" fill="none" stroke={C.hairline} strokeWidth="1" />
        <Path d="M10 150 H330" stroke={C.hairline} strokeWidth="1" />
        <Rect x="0" y="0" width="340" height="265" fill="url(#cmGlow)" />

        {/* flowing arcs */}
        {pts.map((p, i) => {
          const mx = (p.x + homeX) / 2 + (i - 1) * 20;
          const my = Math.min(p.y, homeY) + 40;
          return (
            <APath
              key={`arc${i}`}
              d={`M${p.x} ${p.y + 22} Q ${mx} ${my} ${homeX} ${homeY - 40}`}
              stroke={p.c}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="2 10"
              strokeDashoffset={dash as any}
              fill="none"
              opacity={0.85}
            />
          );
        })}

        {/* home */}
        <G>
          <Ellipse cx={homeX} cy={homeY + 46} rx="62" ry="8" fill="#1E1B2E" opacity="0.08" />
          <Rect x={homeX - 44} y={homeY - 8} width="88" height="54" rx="6" fill="url(#cmWall)" stroke="#E2CBA8" />
          <Path d={`M${homeX - 56} ${homeY - 4} L${homeX} ${homeY - 48} L${homeX + 56} ${homeY - 4} Z`} fill="url(#cmRoof)" />
          <Rect x={homeX - 10} y={homeY + 18} width="20" height="28" rx="3" fill={C.primary} />
          <Rect x={homeX - 36} y={homeY + 6} width="16" height="14" rx="2" fill={C.marigoldSoft} stroke="#E2CBA8" />
          <Rect x={homeX + 20} y={homeY + 6} width="16" height="14" rx="2" fill={C.marigoldSoft} stroke="#E2CBA8" />
          {/* heart */}
          <Path
            d={`M${homeX} ${homeY - 12} c -4 -7 -16 -6 -16 3 c 0 7 10 12 16 17 c 6 -5 16 -10 16 -17 c 0 -9 -12 -10 -16 -3 z`}
            fill={C.marigold}
            transform={`translate(0 -10)`}
          />
        </G>
        <SvgText x={homeX} y={homeY + 70} fontSize="13" fontWeight="700" fill={C.text} textAnchor="middle">
          {home}
        </SvgText>

        {/* siblings */}
        {pts.map((p, i) => (
          <G key={`p${i}`}>
            <Circle cx={p.x} cy={p.y} r="24" fill="#fff" />
            <Circle cx={p.x} cy={p.y} r="20" fill={p.c} />
            <SvgText x={p.x} y={p.y + 6} fontSize="16" fontWeight="800" fill="#fff" textAnchor="middle">
              {p.i}
            </SvgText>
            <SvgText x={p.x} y={p.y - 30} fontSize="12" fontWeight="700" fill={C.muted} textAnchor="middle">
              {cities[i] ?? ''}
            </SvgText>
          </G>
        ))}
      </Svg>
    </View>
  );
}

/** Small shield-with-check mark, used beside "needs N approvals". */
export function ShieldMark({ size = 64 }: { size?: number }) {
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Defs>
          <LinearGradient id="shG" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#2E8BA0" />
            <Stop offset="1" stopColor={C.primary} />
          </LinearGradient>
        </Defs>
        <Path d="M32 4 L56 13 V30 C56 45 45 55 32 60 C19 55 8 45 8 30 V13 Z" fill="url(#shG)" />
        <Path d="M21 32 L29 40 L44 24" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  );
}

/** Empty-state art: an open jar (the pot) with coins dropping in. */
export function PotJar({ size = 120 }: { size?: number }) {
  const drop = useLoop(1800);
  const y = drop.interpolate({ inputRange: [0, 0.7, 1], outputRange: [-10, 46, 46] });
  const o = drop.interpolate({ inputRange: [0, 0.1, 0.65, 0.75, 1], outputRange: [0, 1, 1, 0, 0] });
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Ellipse cx="60" cy="108" rx="34" ry="5" fill="#1E1B2E" opacity="0.08" />
        <Path d="M30 46 C26 60 26 92 36 102 C44 108 76 108 84 102 C94 92 94 60 90 46 Z" fill={C.marigoldSoft} stroke={C.marigold} strokeWidth="3" />
        <Rect x="28" y="38" width="64" height="10" rx="5" fill={C.marigold} />
        <Path d="M50 74 c -3 -5 -11 -4 -11 2 c 0 5 7 8 11 12 c 4 -4 11 -7 11 -12 c 0 -6 -8 -7 -11 -2 z" fill={C.coral} transform="translate(10 0)" />
      </Svg>
      <Animated.View style={{ position: 'absolute', left: size / 2 - 9, top: 0, opacity: o, transform: [{ translateY: y }] }}>
        <Svg width={18} height={18} viewBox="0 0 18 18">
          <Circle cx="9" cy="9" r="8" fill={C.marigold} stroke="#C27A12" strokeWidth="1.5" />
          <Path d="M6 9 H12" stroke="#7A4A00" strokeWidth="1.5" strokeLinecap="round" />
        </Svg>
      </Animated.View>
    </View>
  );
}
