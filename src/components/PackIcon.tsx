import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { PACK } from './packArt';

export function PackIcon({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size * 0.75} height={size} viewBox={PACK.viewBox}>
      <Defs>
        <LinearGradient id="pack" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={PACK.gradient[0]} />
          <Stop offset="0.55" stopColor={PACK.gradient[1]} />
          <Stop offset="1" stopColor={PACK.gradient[2]} />
        </LinearGradient>
      </Defs>
      <Path d={PACK.topCrimp} fill={PACK.crimp} />
      <Path d={PACK.bottomCrimp} fill={PACK.crimp} />
      <Path d={PACK.body} fill="url(#pack)" />
      <Path d={PACK.sheen} fill="#ffffff" opacity={0.18} />
      <Path d={PACK.sparkle} fill="#ffffff" />
    </Svg>
  );
}
