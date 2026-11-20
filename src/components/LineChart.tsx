import { useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors } from './theme';

interface Props {
  values: number[];
  labels: string[];
  selected: number;
  onSelect: (index: number) => void;
  formatY: (v: number) => string;
  color?: string;
  height?: number;
}

const PAD = { top: 18, right: 10, bottom: 6, left: 10 };

export function LineChart({ values, labels, selected, onSelect, formatY, color = colors.accent, height = 170 }: Props) {
  const [width, setWidth] = useState(0);
  const n = values.length;
  const max = Math.max(1, ...values) * 1.08;
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = n > 1 ? `${line} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : '';
  const sel = Math.min(Math.max(0, selected), n - 1);

  const pick = (e: GestureResponderEvent) => {
    if (n === 0 || width === 0) return;
    const fx = (e.nativeEvent.locationX - PAD.left) / plotW;
    onSelect(Math.min(n - 1, Math.max(0, Math.round(fx * (n - 1)))));
  };

  const shown = n <= 2 ? labels.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <View>
      <View
        style={{ height }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={pick}
        onResponderMove={pick}
        onResponderTerminationRequest={() => false}
      >
        {width > 0 && n > 0 && (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity={0.35} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke={colors.border} strokeWidth={1} />
            {area !== '' && <Path d={area} fill="url(#fill)" />}
            {n > 1 && <Path d={line} stroke={color} strokeWidth={2.5} fill="none" strokeLinejoin="round" />}
            <Line x1={x(sel)} x2={x(sel)} y1={PAD.top - 6} y2={y(0)} stroke={colors.textMuted} strokeWidth={1} strokeDasharray="3,3" />
            <Circle cx={x(sel)} cy={y(values[sel])} r={5} fill={color} stroke={colors.surface} strokeWidth={2} />
          </Svg>
        )}
        {width > 0 && n > 0 && (
          <Text style={[styles.max, { left: PAD.left }]}>{formatY(Math.max(...values))}</Text>
        )}
      </View>
      <View style={styles.labels}>
        {shown.map((i) => (
          <Text
            key={i}
            style={[
              styles.label,
              { left: Math.min(Math.max(0, x(i) - 30), Math.max(0, width - 60)) },
              i === sel && { color: colors.text },
            ]}
            numberOfLines={1}
          >
            {labels[i]}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  max: { position: 'absolute', top: 0, color: colors.textMuted, fontSize: 11 },
  labels: { height: 16, marginTop: 4 },
  label: { position: 'absolute', width: 60, textAlign: 'center', color: colors.textMuted, fontSize: 11 },
});
