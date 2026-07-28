import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadCatalogue, loadSystemVoices, resolveVoice, type Voice, type VoiceCatalogue } from '../lib/tts/voices';
import { DeviceSpeaker, isSupported, prime } from '../lib/tts/device';
import { segmentSentences } from '../lib/chinese/segment';
import { useSettings } from '../lib/store/settings';

const EMPTY: VoiceCatalogue = { chinese: [], english: [], male: [], female: [] };

/** Loads once per session — the OS voice list doesn't change under us. */
export function useVoiceCatalogue(): { catalogue: VoiceCatalogue; loading: boolean } {
  const [catalogue, setCatalogue] = useState<VoiceCatalogue>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void loadCatalogue().then((c) => {
      if (!alive) return;
      setCatalogue(c);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { catalogue, loading };
}

export type SpeakState = {
  speaking: boolean;
  /** Index of the sentence currently being read, or -1. */
  sentence: number;
  /** Character offset within the full text, for word-level highlight. */
  charIndex: number;
};

export function useTTS() {
  const { catalogue, loading } = useVoiceCatalogue();
  const speakerRef = useRef<DeviceSpeaker | null>(null);
  const [state, setState] = useState<SpeakState>({ speaking: false, sentence: -1, charIndex: -1 });
  const [textRef, setTextRef] = useState<string>('');

  const voiceId = useSettings((s) => s.voiceId);
  const preferredGender = useSettings((s) => s.preferredGender);
  const rate = useSettings((s) => s.rate);
  const setSetting = useSettings((s) => s.set);

  if (!speakerRef.current) speakerRef.current = new DeviceSpeaker();

  // Keep the speaker's raw voice list in sync with the catalogue.
  useEffect(() => {
    void loadSystemVoices().then((v) => speakerRef.current?.setVoices(v));
  }, [catalogue]);

  useEffect(() => () => speakerRef.current?.stop(), []);

  const voice: Voice | null = useMemo(
    () => resolveVoice(catalogue, voiceId, preferredGender),
    [catalogue, voiceId, preferredGender],
  );

  const stop = useCallback(() => {
    speakerRef.current?.stop();
    setState({ speaking: false, sentence: -1, charIndex: -1 });
  }, []);

  const speak = useCallback(
    (text: string, opts: { lang?: 'zh' | 'en'; voiceOverride?: string | null } = {}) => {
      if (!text.trim()) return;
      prime();
      const speaker = speakerRef.current!;
      const isZh = (opts.lang ?? 'zh') === 'zh';
      const chosen = opts.voiceOverride ?? (isZh ? voice?.id : null);

      setTextRef(text);
      setState({ speaking: true, sentence: 0, charIndex: 0 });

      speaker.speak(text, {
        voiceId: chosen ?? undefined,
        lang: isZh ? (voice?.lang ?? 'zh-CN') : 'en-US',
        rate,
        onSentence: (index) => setState((s) => ({ ...s, sentence: index })),
        onBoundary: (charIndex) => setState((s) => ({ ...s, charIndex })),
        onEnd: () => setState({ speaking: false, sentence: -1, charIndex: -1 }),
        onError: () => setState({ speaking: false, sentence: -1, charIndex: -1 }),
      });
    },
    [voice, rate],
  );

  /** Speak one word immediately — used by the tap-to-define popover. */
  const speakWord = useCallback(
    (word: string) => {
      if (!word.trim()) return;
      prime();
      const speaker = new DeviceSpeaker();
      void loadSystemVoices().then((v) => {
        speaker.setVoices(v);
        speaker.speak(word, { voiceId: voice?.id, lang: voice?.lang ?? 'zh-CN', rate: 0.85 });
      });
    },
    [voice],
  );

  /** Jump to a sentence — tap-to-seek in the reader. */
  const seekSentence = useCallback((index: number) => {
    speakerRef.current?.resumeFromSentence(index);
    setState((s) => ({ ...s, speaking: true, sentence: index }));
  }, []);

  const sentences = useMemo(() => segmentSentences(textRef), [textRef]);

  const setVoice = useCallback(
    (v: Voice) => {
      setSetting('voiceId', v.id);
      if (v.gender !== 'unknown') setSetting('preferredGender', v.gender);
    },
    [setSetting],
  );

  return {
    supported: isSupported(),
    catalogue,
    loading,
    voice,
    setVoice,
    speak,
    speakWord,
    stop,
    seekSentence,
    state,
    sentences,
  };
}
