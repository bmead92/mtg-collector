import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import { ProductBrowser } from '../components/ProductBrowser';
import { Segmented } from '../components/Segmented';
import { colors } from '../components/theme';
import { captureAndRecognize, takePhoto, type GuideFrame } from '../lib/capture';
import type { CardGuess } from '../lib/ocr';
import { getSetting, setSetting } from '../lib/db';
import { logFailure, logRead } from '../lib/diag';
import { setPendingScan } from '../lib/pendingScan';
import { useGalleryPrefs } from '../lib/prefs';
import { formatCents } from '../lib/pricing';
import { cardImage } from '../lib/scryfall';
import { isCompleteRead } from '../lib/autoScan';
import { enqueue, enqueueRead, isBusy, itemPrice, useStack } from '../lib/stack';
import { useAutoScan } from '../lib/useAutoScan';
import { setOpening, useOpening } from '../lib/opening';
import { productPrice, setCodesByCount } from '../lib/sealed';

type Mode = 'auto' | 'single';
let lastMode: Mode = 'auto';

const TIP_KEY = 'tip.scan';

export default function ScanScreen() {
  const [{ priceSource }] = useGalleryPrefs();
  const insets = useSafeAreaInsets();
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const [mode, setModeState] = useState<Mode>(lastMode);
  const photoOutput = usePhotoOutput({ qualityPrioritization: 'balanced' });
  const [focused, setFocused] = useState(true);
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const setMode = (m: Mode) => {
    lastMode = m;
    setModeState(m);
  };
  const stack = useStack();
  const opening = useOpening();
  const [picking, setPicking] = useState(false);
  const [tip, setTip] = useState(false);
  const { width: winW, height: winH } = useWindowDimensions();
  const [bottomBarH, setBottomBarH] = useState(200);
  const topBarH = insets.top + 56;
  // The frame stays centered, so it must clear whichever bar is taller on both sides (+ room for the hint).
  const guideMaxH = winH - 2 * Math.max(bottomBarH, topBarH) - 40;
  const guideWidth = Math.max(160, Math.min(winW * 0.78, (guideMaxH * 63) / 88));
  const pickerBack = useRef<(() => boolean) | null>(null);
  const [flash] = useState(() => new Animated.Value(0));
  const viewSize = useRef<{ width: number; height: number } | null>(null);
  const guideRect = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const currentGuide = (): GuideFrame | null =>
    viewSize.current && guideRect.current
      ? { viewWidth: viewSize.current.width, viewHeight: viewSize.current.height, ...guideRect.current }
      : null;

  const shootStackRef = useRef<(hint?: CardGuess) => void>(() => {});
  const auto = useAutoScan({
    enabled: mode === 'auto' && focused && !picking && !tip,
    guide: currentGuide,
    onCapture: (frameGuess) => {
      Vibration.vibrate(30);
      if (isCompleteRead(frameGuess)) {
        blink();
        enqueueRead(frameGuess);
      } else {
        shootStackRef.current(frameGuess); // photo + frame read, as before
      }
    },
  });

  useEffect(() => {
    if (!hasPermission && canRequestPermission) requestPermission();
  }, [hasPermission, canRequestPermission, requestPermission]);

  useEffect(() => {
    getSetting<boolean>(TIP_KEY)
      .then((seen) => setTip(!seen))
      .catch(() => {});
  }, []);
  const closeTip = () => {
    setTip(false);
    setSetting(TIP_KEY, true).catch(() => {});
  };

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const blink = () => {
    flash.setValue(0.7);
    Animated.timing(flash, { toValue: 0, duration: 250, useNativeDriver: true }).start();
  };

  const pendingShots = useRef(0);
  const pendingHints = useRef<(CardGuess | null)[]>([]);
  const shooting = useRef(false);
  const [queuedShots, setQueuedShots] = useState(0);
  const MAX_PENDING_SHOTS = 3;

  const drainShots = async () => {
    if (shooting.current) return;
    shooting.current = true;
    try {
      while (pendingShots.current > 0) {
        const t0 = Date.now();
        try {
          const photo = await takePhoto(photoOutput);
          if (__DEV__) console.log('[stack] capture ms', Date.now() - t0);
          enqueue(photo, currentGuide(), pendingHints.current.shift() ?? null);
        } catch (e) {
          pendingHints.current.shift();
          console.warn('Capture failed', e);
        }
        pendingShots.current--;
        setQueuedShots(pendingShots.current);
      }
    } finally {
      shooting.current = false;
    }
  };

  const shootStack = (hint?: CardGuess) => {
    if (pendingShots.current >= MAX_PENDING_SHOTS) return;
    pendingShots.current++;
    pendingHints.current.push(hint ?? null);
    setQueuedShots(pendingShots.current);
    blink();
    void drainShots();
  };

  useEffect(() => {
    shootStackRef.current = shootStack;
  });

  const capture = async () => {
    if (mode !== 'single') return shootStack();
    if (busy) return;
    setBusy(true);
    try {
      const { photoUri, guess } = await captureAndRecognize(photoOutput, currentGuide());
      logRead('single', guess);
      setPendingScan({ photoUri, guess });
      router.push('/confirm');
    } catch (e) {
      logFailure('single', e);
      Alert.alert('Scan failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!hasPermission) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.msg}>Scanning needs the camera.</Text>
        <Pressable style={styles.button} onPress={canRequestPermission ? requestPermission : () => Linking.openSettings()}>
          <Text style={styles.buttonText}>{canRequestPermission ? 'Allow camera' : 'Open settings'}</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginTop: 20 }}>
          <Text style={styles.backLink}>Back</Text>
        </Pressable>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>No back camera found.</Text>
      </View>
    );
  }

  const processing = stack.filter(isBusy).length;
  const recent = stack.slice(-3).reverse();

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        viewSize.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
      }}
    >
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={focused}
        outputs={mode === 'auto' ? [photoOutput, auto.frameOutput] : [photoOutput]}
        torchMode={cameraStarted ? (torch ? 'on' : 'off') : undefined}
        onStarted={() => setCameraStarted(true)}
        onStopped={() => setCameraStarted(false)}
        onError={(e) => console.warn('Camera error', e)}
        enableNativeTapToFocusGesture
      />

      <View pointerEvents="none" style={styles.guideWrap}>
        <View
          style={[
            styles.guide,
            { width: guideWidth },
            mode === 'auto' && auto.status === 'holding' && { borderColor: colors.accent },
            mode === 'auto' && auto.status === 'captured' && { borderColor: colors.price },
          ]}
          onLayout={(e) => {
            const { x, y, width, height } = e.nativeEvent.layout;
            guideRect.current = { x, y, width, height };
          }}
        >
          <View style={styles.keyCorner} />
        </View>
        <Text style={styles.hint}>
          {mode !== 'auto'
            ? 'Line up the card · keep the bottom-left sharp'
            : auto.status === 'holding'
              ? 'Hold still…'
              : auto.status === 'captured'
                ? 'Got it · swap in the next card'
                : 'Hold a card inside the frame'}
        </Text>
      </View>

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, { opacity: flash }]} />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.topText}>Close</Text>
        </Pressable>
        <Pressable onPress={() => setTorch((t) => !t)} hitSlop={12}>
          <Text style={styles.topText}>{torch ? 'Light: on' : 'Light: off'}</Text>
        </Pressable>
      </View>

      {opening && (
        <View style={[styles.openingBanner, { top: insets.top + 44 }]}>
          <Text style={styles.openingText} numberOfLines={1}>
            Opening: {opening.product.name} · {formatCents(productPrice(opening.product))}
          </Text>
          <Pressable hitSlop={12} onPress={() => setOpening(null)} accessibilityLabel="Not opening this">
            <Text style={styles.openingClose}>✕</Text>
          </Pressable>
        </View>
      )}

      {mode !== 'single' && recent.length > 0 && (
        <View style={[styles.strip, { top: insets.top + (opening ? 92 : 64) }]} pointerEvents="none">
          {recent.map((it) => {
            const thumb = (it.card && cardImage(it.card, 'small')) || it.photoUri;
            return (
              <View key={it.id} style={styles.stripItem}>
                {thumb ? (
                  <Image source={{ uri: thumb }} style={styles.stripThumb} contentFit="cover" />
                ) : (
                  <View style={[styles.stripThumb, styles.centerInline]}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                )}
                <Text style={styles.stripName} numberOfLines={1}>
                  {it.card?.name ?? (isBusy(it) ? '…' : 'Not found')}
                </Text>
                <Text style={styles.stripPrice}>{it.card && !isBusy(it) ? formatCents(itemPrice(it, priceSource)) : ''}</Text>
              </View>
            );
          })}
        </View>
      )}

      <View
        style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}
        onLayout={(e) => setBottomBarH(e.nativeEvent.layout.height)}
      >
        <View style={styles.modeToggle}>
          <Segmented
            options={['auto', 'single'] as const}
            value={mode}
            onChange={setMode}
            labels={{ auto: 'Auto', single: 'Single' }}
          />
        </View>

        <View style={styles.shutterRow}>
          <View style={styles.sideSlot}>
            <Pressable style={styles.reviewButton} onPress={() => setPicking(true)} accessibilityLabel="Pick the pack or box you're opening">
              <Text style={styles.reviewText}>Pack / box</Text>
              <Text style={styles.wrapperSub}>{opening ? 'change' : 'opening one?'}</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.shutter, (busy || queuedShots >= MAX_PENDING_SHOTS) && { opacity: 0.5 }]}
            onPress={capture}
            disabled={busy}
          >
            {busy && mode === 'single' ? (
              <ActivityIndicator color="#000" />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </Pressable>
          <View style={styles.sideSlot}>
            {stack.length > 0 && (
              <Pressable style={styles.reviewButton} onPress={() => router.push('/stack')}>
                <Text style={styles.reviewText}>Review</Text>
                <Text style={styles.reviewCount}>
                  {stack.length}
                  {processing > 0 ? ` (${processing}…)` : ''}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
        {busy && mode === 'single' && <Text style={styles.hint}>Reading card…</Text>}
      </View>

      <Modal
        visible={picking}
        animationType="slide"
        onRequestClose={() => {
          if (!pickerBack.current?.()) setPicking(false);
        }}
        statusBarTranslucent
      >
        <View style={[styles.picker, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.pickerTop}>
            <Text style={styles.pickerTitle}>What are you opening?</Text>
            <Pressable onPress={() => setPicking(false)} hitSlop={12}>
              <Text style={styles.pickerClose}>Cancel</Text>
            </Pressable>
          </View>
          {picking && (
            <ProductBrowser
              backRef={pickerBack}
              setCodes={setCodesByCount(stack.flatMap((it) => (it.card ? [it.card.set] : [])))}
              onPick={(p) => {
                setOpening({ product: p.product, type: p.type });
                setPicking(false);
              }}
            />
          )}
          {opening && (
            <Pressable onPress={() => { setOpening(null); setPicking(false); }} style={styles.pickerClear}>
              <Text style={styles.pickerClearText}>Not opening anything</Text>
            </Pressable>
          )}
        </View>
      </Modal>

      <Modal visible={tip} transparent animationType="fade" onRequestClose={closeTip}>
        <View style={styles.tipBackdrop}>
          <View style={styles.tipCard}>
            <Text style={styles.tipTitle}>Scanning</Text>
            <Text style={styles.tipText}>
              Hold one card inside the frame. Auto adds it once the name and set line are readable; Single takes a
              photo when you tap.
            </Text>
            <Text style={styles.tipText}>Cards wait in your stack until you review and save them.</Text>
            <Pressable style={[styles.button, { alignSelf: 'flex-end', marginTop: 6 }]} onPress={closeTip}>
              <Text style={styles.buttonText}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  centerInline: { alignItems: 'center', justifyContent: 'center' },
  msg: { color: colors.text, textAlign: 'center', marginBottom: 16 },
  button: { backgroundColor: colors.accent, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  buttonText: { color: '#fff', fontWeight: '700' },
  backLink: { color: colors.accent, fontWeight: '600' },
  tipBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 28 },
  tipCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 20, gap: 10, borderWidth: 1, borderColor: colors.border },
  tipTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  tipText: { color: colors.textMuted, fontSize: 15, lineHeight: 21 },
  guideWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guide: {
    aspectRatio: 63 / 88,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: 14,
  },
  keyCorner: {
    position: 'absolute',
    left: -2,
    bottom: -2,
    width: '34%',
    height: '16%',
    borderLeftWidth: 5,
    borderBottomWidth: 5,
    borderColor: colors.accent,
    borderBottomLeftRadius: 14,
  },
  flash: { backgroundColor: '#fff' },
  hint: {
    color: '#fff',
    marginTop: 12,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 24,
    textShadowColor: '#000',
    textShadowRadius: 4,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  topText: { color: '#fff', fontSize: 16, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 4 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center' },
  strip: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  stripItem: {
    width: 104,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 8,
    padding: 6,
    alignItems: 'center',
    gap: 2,
  },
  stripThumb: { width: 40, height: 56, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)' },
  stripName: { color: '#fff', fontSize: 11, maxWidth: 92 },
  stripPrice: { color: colors.price, fontSize: 12, fontWeight: '700' },
  modeToggle: { width: 220, marginBottom: 16 },
  shutterRow: { flexDirection: 'row', alignItems: 'center', width: '100%', paddingHorizontal: 24 },
  sideSlot: { flex: 1, alignItems: 'center' },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 62, height: 62, borderRadius: 31, borderWidth: 2, borderColor: '#000' },
  reviewButton: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
  },
  reviewText: { color: '#fff', fontWeight: '700' },
  picker: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: 16, gap: 12 },
  pickerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  pickerClose: { color: colors.accent, fontWeight: '600', fontSize: 15 },
  pickerClear: { alignSelf: 'center', padding: 8 },
  pickerClearText: { color: colors.danger, fontWeight: '600' },
  wrapperSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11 },
  openingBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  openingText: { flex: 1, color: '#fff', fontWeight: '600' },
  openingClose: { color: '#fff', fontSize: 16, fontWeight: '700' },
  reviewCount: { color: colors.price, fontWeight: '700', fontSize: 12 },
});
