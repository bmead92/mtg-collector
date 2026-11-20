import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { NitroModules } from 'react-native-nitro-modules';
import { CommonResolutions, useFrameOutput, type Frame } from 'react-native-vision-camera';
import type { Text, TextRecognizer } from 'react-native-vision-camera-ocr-plus';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';
import {
  cardKey,
  check,
  collectorId,
  guideToScanRegion,
  initialAutoState,
  lockCollectorId,
  mergeReads,
  observe,
  sameCard,
  type AutoState,
} from './autoScan';
import type { GuideFrame } from './capture';
import { parseCardText, type CardGuess } from './ocr';

export type AutoStatus = 'searching' | 'holding' | 'captured';

let frameRecognizer: TextRecognizer | null = null;
function getFrameRecognizer(): TextRecognizer {
  if (!frameRecognizer) {
    frameRecognizer = NitroModules.createHybridObject<TextRecognizer>('TextRecognizer');
    frameRecognizer.configure({ language: 'latin', frameSkipThreshold: 2, useLightweightMode: false });
  }
  return frameRecognizer;
}

interface Options {
  enabled: boolean;
  guide: () => GuideFrame | null;
  onCapture: (frameGuess: CardGuess) => void;
}

export function useAutoScan({ enabled, guide, onCapture }: Options) {
  const recognizer = useMemo(() => getFrameRecognizer(), []);
  const [status, setStatus] = useState<AutoStatus>('searching');
  const state = useRef<AutoState>(initialAutoState());
  const cardReads = useRef<CardGuess[]>([]);
  const onCaptureRef = useRef(onCapture);
  const guideRef = useRef(guide);
  useEffect(() => {
    onCaptureRef.current = onCapture;
    guideRef.current = guide;
  });

  const lastHash = useMemo(() => createSynchronizable<number>(0), []);
  const sizeSent = useMemo(() => createSynchronizable<number>(0), []);

  const stats = useRef({ reads: 0, withNumber: 0, since: 0 });

  const evaluate = useCallback(() => {
    const now = Date.now();
    const r = check(state.current, now);
    state.current = r.state;
    const s = r.state;
    const next: AutoStatus =
      sameCard(s.key, s.lockedKey) ? 'captured' : s.key ? 'holding' : 'searching';
    setStatus(next);
    const merged = r.capture ? mergeReads(cardReads.current) : null;
    if (merged) {
      const g = merged;
      state.current = lockCollectorId(state.current, collectorId(g));
      console.info(
        '[auto] capture',
        JSON.stringify({ name: g.name, set: g.setCode, num: g.collectorNumber, foil: g.foil, reads: cardReads.current.length, steadyMs: now - s.since }),
      );
      onCaptureRef.current(g);
    }
  }, []);

  const onText = useCallback(
    (text: Text) => {
      const guess = parseCardText(text);
      const key = cardKey(guess);
      state.current = observe(state.current, key, Date.now(), guess.nameBox ?? null, collectorId(guess));
      if (key) cardReads.current = state.current.reads === 1 ? [guess] : [...cardReads.current, guess];
      const st = stats.current;
      if (st.since === 0) st.since = Date.now();
      st.reads++;
      if (guess.setCode && guess.collectorNumber) st.withNumber++;
      if (Date.now() - st.since > 5000) {
        const secs = (Date.now() - st.since) / 1000;
        console.info(
          '[auto] stats',
          JSON.stringify({ readsPerSec: +(st.reads / secs).toFixed(1), withSetAndNumber: st.withNumber, reads: st.reads }),
        );
        stats.current = { reads: 0, withNumber: 0, since: Date.now() };
      }
      evaluate();
    },
    [evaluate],
  );

  const onFrameSize = useCallback(
    (width: number, height: number, orientation: string) => {
      const sideways = orientation === 'left' || orientation === 'right';
      const fw = sideways ? height : width;
      const fh = sideways ? width : height;
      const g = guideRef.current();
      const region = g ? guideToScanRegion(g, fw, fh) : null;
      console.info('[auto] frame', JSON.stringify({ width, height, orientation, upright: [fw, fh], region }));
      if (region) recognizer.configure({ language: 'latin', frameSkipThreshold: 2, useLightweightMode: false, scanRegion: region });
    },
    [recognizer],
  );

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';
      let text: Text | null | undefined = null;
      try {
        if (sizeSent.getDirty() === 0) {
          sizeSent.setBlocking(1);
          scheduleOnRN(onFrameSize, frame.width, frame.height, frame.orientation as string);
        }
        const nb = frame.getNativeBuffer();
        try {
          text = (recognizer as any).scanFrame(nb.pointer, frame.orientation) as Text | null | undefined;
        } finally {
          nb.release();
        }
      } catch {
        text = null; // a failed OCR job is reported once; just skip this frame
      } finally {
        frame.dispose();
      }
      if (!text) return;
      const s = text.resultText ?? '';
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) | 0;
      if (h === lastHash.getDirty()) return;
      lastHash.setBlocking(h);
      scheduleOnRN(onText, text);
    },
    [recognizer, lastHash, sizeSent, onText, onFrameSize],
  );

  const frameOutput = useFrameOutput({
    targetResolution: CommonResolutions.FHD_16_9,
    pixelFormat: Platform.OS === 'android' ? 'rgb' : 'yuv',
    onFrame,
  });

  useEffect(() => {
    if (!enabled) return;
    state.current = initialAutoState();
    lastHash.setBlocking(0);
    sizeSent.setBlocking(0);
    const t = setInterval(evaluate, 100);
    return () => clearInterval(t);
  }, [enabled, evaluate, lastHash, sizeSent]);

  return { frameOutput, status };
}
