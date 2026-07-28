import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { Viewfinder } from './components/Viewfinder';
import { SealShutter } from './components/SealShutter';
import { ResultSheet } from './components/ResultSheet';
import { PlayerBar } from './components/PlayerBar';
import { VoicePicker } from './components/VoicePicker';
import { WordPopover } from './components/WordPopover';
import { Settings } from './components/Settings';
import { Shelf } from './components/Shelf';
import { Wordbank } from './components/Wordbank';
import { Onboarding } from './components/Onboarding';
import { QuotaPip } from './components/QuotaPip';

import { useCamera } from './hooks/useCamera';
import { useScan } from './hooks/useScan';
import { useTTS } from './hooks/useTTS';
import { useKeys } from './hooks/useKeychain';
import { useOnline } from './hooks/useQuota';

import { useSettings } from './lib/store/settings';
import { prepareImage } from './lib/camera/imagePrep';
import { imagesFromClipboard, imagesFromDrop, pickImages } from './lib/camera/capture';
import { preloadDict } from './lib/chinese/dict';
import type { SummaryCard, Token } from './lib/vision/schema';
import type { AnalyzeOutcome } from './lib/vision/analyze';
import { segmentSentences } from './lib/chinese/segment';
import type { ShelfEntry } from './lib/store/db';

const MAX_SHOTS = 4;

export default function App() {
  const settings = useSettings();
  const keys = useKeys();

  const [shots, setShots] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [voicesOpen, setVoicesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [wordsOpen, setWordsOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [word, setWord] = useState<{ token: Token; sentence: string; anchor: HTMLElement } | null>(
    null,
  );
  const [speakingCard, setSpeakingCard] = useState(-1);
  const [loop, setLoop] = useState<{ card: number; sentence: number; text: string } | null>(null);
  const [shelfOutcome, setShelfOutcome] = useState<{
    outcome: AnalyzeOutcome;
    thumbnail: string;
  } | null>(null);

  const scan = useScan();
  const tts = useTTS();
  const online = useOnline();
  const cameraActive = !sheetOpen && !settingsOpen && !shelfOpen && settings.onboarded;
  const camera = useCamera(cameraActive);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const outcome = shelfOutcome?.outcome ?? scan.outcome;
  const thumbnail = shelfOutcome?.thumbnail ?? shots[0];

  useEffect(() => {
    const check = () => setDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (settings.onboarded) preloadDict();
  }, [settings.onboarded]);

  // --- capture -----------------------------------------------------------

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const prepared = await Promise.all(files.slice(0, MAX_SHOTS).map((f) => prepareImage(f)));
    setShots((prev) => [...prev, ...prepared.map((p) => p.dataUrl)].slice(0, MAX_SHOTS));
  }, []);

  const runScan = useCallback(
    async (images: string[]) => {
      if (!images.length) return;
      setShelfOutcome(null);
      const result = await scan.run(images, settings.intent);
      if (result) {
        setSheetOpen(true);
        if (settings.autoplay) {
          const first = result.result.summaries[0];
          if (first) {
            setSpeakingCard(0);
            tts.speak(first.zh);
          }
        }
      }
    },
    [scan, settings.intent, settings.autoplay, tts],
  );

  const onStamp = useCallback(async () => {
    if (shots.length) {
      await runScan(shots);
      return;
    }
    if (camera.state.ready) {
      const blob = await camera.capture();
      if (blob) {
        const prepared = await prepareImage(blob);
        setShots([prepared.dataUrl]);
        await runScan([prepared.dataUrl]);
        return;
      }
    }
    // No live camera — go straight to the OS camera or picker.
    const files = await pickImages({ capture: true });
    if (files.length) {
      const prepared = await Promise.all(files.map((f) => prepareImage(f)));
      const urls = prepared.map((p) => p.dataUrl);
      setShots(urls);
      await runScan(urls);
    }
  }, [shots, camera, runScan]);

  // Paste and drop, on every screen.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => void addFiles(imagesFromClipboard(e));
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      void addFiles(imagesFromDrop(e));
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener('paste', onPaste);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
    };
  }, [addFiles]);

  // --- reading -----------------------------------------------------------

  const speakCard = useCallback(
    (card: SummaryCard, index: number) => {
      if (speakingCard === index && tts.state.speaking) {
        tts.stop();
        setSpeakingCard(-1);
        return;
      }
      setSpeakingCard(index);
      const text =
        settings.readLang === 'en'
          ? card.en
          : settings.readLang === 'both'
            ? `${card.zh} ${card.en}`
            : card.zh;
      tts.speak(text, { lang: settings.readLang === 'en' ? 'en' : 'zh' });
    },
    [speakingCard, tts, settings.readLang],
  );

  // When a sentence is on loop, restart it as soon as it finishes. Everything
  // else just clears the speaking indicator.
  useEffect(() => {
    if (tts.state.speaking) return;
    if (loop) {
      const t = setTimeout(() => tts.speak(loop.text), 400);
      return () => clearTimeout(t);
    }
    setSpeakingCard((c) => (c === -1 ? c : -1));
  }, [tts.state.speaking, loop, tts]);

  const stopLoop = useCallback(() => {
    setLoop(null);
    tts.stop();
    setSpeakingCard(-1);
  }, [tts]);

  /** Tap a sentence to read from there. */
  const handleSentenceTap = useCallback(
    (cardIndex: number, _sentenceIndex: number, text: string) => {
      setLoop(null);
      setSpeakingCard(cardIndex);
      tts.speak(text);
    },
    [tts],
  );

  /** Hold a sentence to loop it — the shadowing drill. */
  const handleSentenceHold = useCallback(
    (cardIndex: number, sentenceIndex: number, text: string) => {
      setLoop({ card: cardIndex, sentence: sentenceIndex, text });
      setSpeakingCard(cardIndex);
      tts.speak(text);
    },
    [tts],
  );

  const playAll = useCallback(() => {
    if (tts.state.speaking) {
      tts.stop();
      setSpeakingCard(-1);
      return;
    }
    const cards = outcome?.result.summaries ?? [];
    if (!cards.length) return;
    setSpeakingCard(0);
    const text = cards
      .map((c) =>
        settings.readLang === 'en' ? c.en : settings.readLang === 'both' ? `${c.zh} ${c.en}` : c.zh,
      )
      .join(' ');
    tts.speak(text, { lang: settings.readLang === 'en' ? 'en' : 'zh' });
  }, [tts, outcome, settings.readLang]);

  /**
   * Character span to underline while speaking. Boundary events give an offset
   * into the whole utterance, so it's mapped back onto the active sentence.
   */
  const highlightRange = useMemo(() => {
    if (!tts.state.speaking || tts.state.charIndex < 0) return null;
    const card = outcome?.result.summaries[speakingCard];
    if (!card) return null;
    const sentences = segmentSentences(card.zh);
    let cursor = 0;
    for (const s of sentences) {
      if (tts.state.charIndex < cursor + s.length) {
        return { start: cursor, end: cursor + s.length };
      }
      cursor += s.length;
    }
    return null;
  }, [tts.state.speaking, tts.state.charIndex, outcome, speakingCard]);

  /** Character span of the sentence on loop, so the card can tint it. */
  const loopRange = useMemo(() => {
    if (!loop) return null;
    const card = outcome?.result.summaries[loop.card];
    if (!card) return null;
    const start = card.zh.indexOf(loop.text);
    return start === -1 ? null : { start, end: start + loop.text.length };
  }, [loop, outcome]);

  // --- keyboard ----------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

      if (e.key === ' ' && !sheetOpen) {
        e.preventDefault();
        void onStamp();
      } else if (e.key.toLowerCase() === 'p') {
        settings.cyclePinyin();
      } else if (e.key === 'Escape') {
        if (word) setWord(null);
        else if (voicesOpen) setVoicesOpen(false);
        else if (sheetOpen) closeSheet();
      } else if (e.key === '/' && !shelfOpen) {
        e.preventDefault();
        setShelfOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen, voicesOpen, shelfOpen, word, onStamp]);

  const closeSheet = useCallback(() => {
    tts.stop();
    setSpeakingCard(-1);
    setLoop(null);
    setSheetOpen(false);
    setShots([]);
    setShelfOutcome(null);
    scan.reset();
  }, [tts, scan]);

  const openShelfEntry = useCallback((entry: ShelfEntry) => {
    setShelfOutcome({
      outcome: {
        result: entry.result,
        model: entry.model,
        modelLabel: entry.modelLabel,
        repaired: false,
        // A shelf entry is a replay, not a fresh run — there's no image kept
        // to re-read, which is why retry is disabled for these.
        chain: 'primary',
      },
      thumbnail: entry.thumbnail,
    });
    setShelfOpen(false);
    setSheetOpen(true);
  }, []);

  // --- render ------------------------------------------------------------

  const showSheet = sheetOpen && outcome;

  return (
    <div ref={rootRef} className="grain relative h-full w-full overflow-hidden bg-ink">
      <div className={desktop ? 'flex h-full gap-4 p-4' : 'h-full'}>
        <div
          className={
            desktop
              ? 'relative min-w-0 flex-1 overflow-hidden rounded-3xl ring-1 ring-ink-line/80 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)]'
              : 'relative h-full'
          }
        >
          <Viewfinder
            videoRef={camera.videoRef}
            camera={camera.state}
            frozenFrame={shots[0] ?? null}
            scanning={scan.busy}
            progress={scan.progress}
            streamText={scan.streamText}
          />

          <TopBar
            intent={settings.intent}
            onIntent={(i) => settings.set('intent', i)}
            onShelf={() => setShelfOpen(true)}
            onWords={() => setWordsOpen(true)}
            onSettings={() => setSettingsOpen(true)}
            keyCount={keys.length}
            online={online}
            torch={camera.state.torchAvailable ? camera.state.torchOn : null}
            onTorch={() => void camera.toggleTorch()}
          />

          <AnimatePresence>
            {!online ? (
              <Banner
                key="offline"
                tone="amber"
                title="You're offline."
                body="Reading a new book needs a connection, but your shelf still works — past summaries open and read aloud with the device voice."
              />
            ) : scan.error ? (
              <ErrorToast error={scan.error} onOpenSettings={() => setSettingsOpen(true)} />
            ) : keys.length === 0 ? (
              <Banner
                key="nokey"
                tone="seal"
                title="One free key and you're reading."
                body="BookLens uses free models on OpenRouter. The key stays on this device."
                action={{ label: 'add a key →', onClick: () => setSettingsOpen(true) }}
              />
            ) : null}
          </AnimatePresence>

          {!showSheet || desktop ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              {shots.length ? (
                <Tray shots={shots} onClear={() => setShots([])} onAdd={() => void pickImages({ multiple: true }).then(addFiles)} />
              ) : null}

              <div
                className={[
                  'pointer-events-auto flex items-end justify-center gap-6 px-6',
                  desktop ? 'glass-dark mx-auto w-fit rounded-full px-7 py-3' : '',
                ].join(' ')}
              >
                <GalleryButton onClick={() => void pickImages({ multiple: true }).then(addFiles)} />
                <SealShutter
                  onPress={() => void onStamp()}
                  busy={scan.busy}
                  disabled={!online}
                  label={online ? 'Read this book' : 'Offline — reading needs a connection'}
                />
                <div className="w-11" aria-hidden />
              </div>
            </div>
          ) : null}
        </div>

        {showSheet && desktop ? (
          <div className="flex h-full flex-col gap-3">
            <ResultSheet
              outcome={outcome}
              thumbnail={thumbnail}
              pinyinMode={settings.pinyin}
              textSize={settings.textSize}
              onWordTap={(token, sentence, anchor) => setWord({ token, sentence, anchor })}
              onSpeakCard={speakCard}
              onSentenceTap={handleSentenceTap}
              onSentenceHold={handleSentenceHold}
              speakingCardIndex={speakingCard}
              highlightRange={highlightRange}
              loopCardIndex={loop?.card ?? -1}
              loopRange={loopRange}
              onRetry={() => void scan.retryOtherChain()}
              retrying={scan.busy}
              canRetry={scan.canRetry && !shelfOutcome}
              onClose={closeSheet}
              desktop
            />
            <div className="w-[420px]">
              <PlayerBar
                speaking={tts.state.speaking}
                onPlayPause={playAll}
                voice={tts.voice}
                onOpenVoices={() => setVoicesOpen(true)}
                pinyinMode={settings.pinyin}
                onCyclePinyin={settings.cyclePinyin}
                readLang={settings.readLang}
                onCycleLang={() =>
                  settings.set(
                    'readLang',
                    settings.readLang === 'zh' ? 'en' : settings.readLang === 'en' ? 'both' : 'zh',
                  )
                }
                rate={settings.rate}
                onRate={(r) => settings.set('rate', r)}
                textSize={settings.textSize}
                onCycleTextSize={settings.cycleTextSize}
                looping={loop !== null}
                onStopLoop={stopLoop}
              />
            </div>
          </div>
        ) : null}
      </div>

      {showSheet && !desktop ? (
        <>
          <ResultSheet
            outcome={outcome}
            thumbnail={thumbnail}
            pinyinMode={settings.pinyin}
            textSize={settings.textSize}
            onWordTap={(token, sentence, anchor) => setWord({ token, sentence, anchor })}
            onSpeakCard={speakCard}
            onSentenceTap={handleSentenceTap}
            onSentenceHold={handleSentenceHold}
            speakingCardIndex={speakingCard}
            highlightRange={highlightRange}
            loopCardIndex={loop?.card ?? -1}
            loopRange={loopRange}
            onRetry={() => void scan.retryOtherChain()}
            retrying={scan.busy}
            canRetry={scan.canRetry && !shelfOutcome}
            onClose={closeSheet}
            desktop={false}
          />
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-45 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <PlayerBar
              speaking={tts.state.speaking}
              onPlayPause={playAll}
              voice={tts.voice}
              onOpenVoices={() => setVoicesOpen(true)}
              pinyinMode={settings.pinyin}
              onCyclePinyin={settings.cyclePinyin}
              readLang={settings.readLang}
              onCycleLang={() =>
                settings.set(
                  'readLang',
                  settings.readLang === 'zh' ? 'en' : settings.readLang === 'en' ? 'both' : 'zh',
                )
              }
              rate={settings.rate}
              onRate={(r) => settings.set('rate', r)}
              textSize={settings.textSize}
              onCycleTextSize={settings.cycleTextSize}
              looping={loop !== null}
              onStopLoop={stopLoop}
            />
          </div>
        </>
      ) : null}

      <WordPopover
        token={word?.token ?? null}
        anchor={word?.anchor ?? null}
        sentence={word?.sentence ?? ''}
        bookTitle={outcome?.result.book?.title_zh ?? ''}
        onClose={() => setWord(null)}
        onSpeak={tts.speakWord}
      />

      <VoicePicker
        open={voicesOpen}
        catalogue={tts.catalogue}
        current={tts.voice}
        onPick={(v) => tts.setVoice(v)}
        onPreview={(v) => tts.speak('这本书讲的是一个关于家和记忆的故事。', { voiceOverride: v.id })}
        onClose={() => setVoicesOpen(false)}
      />

      <Shelf open={shelfOpen} onClose={() => setShelfOpen(false)} onOpenEntry={openShelfEntry} />
      <Wordbank open={wordsOpen} onClose={() => setWordsOpen(false)} onSpeak={tts.speakWord} />
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Onboarding open={!settings.onboarded} onDone={() => settings.set('onboarded', true)} />
    </div>
  );
}

// --- chrome ---------------------------------------------------------------

function TopBar({
  intent,
  onIntent,
  onShelf,
  onWords,
  onSettings,
  keyCount,
  online,
  torch,
  onTorch,
}: {
  intent: 'cover' | 'pages';
  onIntent: (i: 'cover' | 'pages') => void;
  onShelf: () => void;
  onWords: () => void;
  onSettings: () => void;
  keyCount: number;
  online: boolean;
  torch: boolean | null;
  onTorch: () => void;
}) {
  return (
    <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
      <div className="flex items-center gap-2">
        <span className="glass-dark hidden items-baseline gap-1.5 rounded-full py-2 pr-4 pl-3 md:flex">
          <span className="han text-[15px] leading-none text-paper">书镜</span>
          <span className="font-mono text-[8.5px] tracking-[0.22em] text-paper/50 uppercase">
            BookLens
          </span>
        </span>
        <div className="glass-dark flex items-center gap-1 rounded-full p-1">
        {(['cover', 'pages'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onIntent(mode)}
            aria-pressed={intent === mode}
            className={[
              'han rounded-full px-3 py-1.5 text-[13px] transition-all duration-200',
              intent === mode
                ? 'bg-paper text-ink shadow-[0_2px_10px_rgba(0,0,0,0.35)]'
                : 'text-paper/70 hover:text-paper',
            ].join(' ')}
          >
            {mode === 'cover' ? '封面' : '书页'}
          </button>
        ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {online ? <QuotaPip onOpen={onSettings} /> : null}
        {torch !== null ? (
          <IconButton label="Torch" onClick={onTorch} active={torch}>
            <path d="M9 2h6l-1 7h4l-8 13 2-9H8z" />
          </IconButton>
        ) : null}
        <IconButton label="Words" onClick={onWords}>
          <path d="M5 4h9a3 3 0 013 3v13a2 2 0 00-2-2H5zm14 0h.5A1.5 1.5 0 0121 5.5V18h-2z" />
        </IconButton>
        <IconButton label="Shelf" onClick={onShelf}>
          <path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.8 1-3 15L16 20z" />
        </IconButton>
        <button
          type="button"
          onClick={onSettings}
          aria-label="Settings"
          className="glass-dark relative grid h-9 w-9 place-items-center rounded-full text-paper transition-colors hover:bg-ink/80"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 8a4 4 0 100 8 4 4 0 000-8zm9.4 4a7.4 7.4 0 01-.1 1.2l2 1.6-1.9 3.3-2.4-1a7.5 7.5 0 01-2 1.2l-.4 2.6h-3.8l-.4-2.6a7.5 7.5 0 01-2-1.2l-2.4 1L4.7 14.8l2-1.6A7.4 7.4 0 016.6 12c0-.4 0-.8.1-1.2l-2-1.6 1.9-3.3 2.4 1a7.5 7.5 0 012-1.2l.4-2.6h3.8l.4 2.6c.7.3 1.4.7 2 1.2l2.4-1 1.9 3.3-2 1.6c.1.4.1.8.1 1.2z" />
          </svg>
          {keyCount === 0 ? (
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-seal ring-2 ring-ink" />
          ) : null}
        </button>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={[
        'glass-dark grid h-9 w-9 place-items-center rounded-full transition-colors',
        active ? 'bg-amber/90! text-ink' : 'text-paper hover:bg-ink/80',
      ].join(' ')}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

function GalleryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Choose a photo"
      className="glass-dark grid h-11 w-11 place-items-center rounded-xl text-paper transition-colors hover:bg-ink/80"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm1 12h14l-4.5-6-3.5 4.5-2.5-3z" />
      </svg>
    </button>
  );
}

function Tray({
  shots,
  onClear,
  onAdd,
}: {
  shots: string[];
  onClear: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="pointer-events-auto mb-3 flex items-center justify-center gap-1.5 px-6">
      {shots.map((s, i) => (
        <img
          key={i}
          src={s}
          alt=""
          className="h-12 w-9 rounded-lg border border-paper/15 object-cover shadow-[0_6px_16px_rgba(0,0,0,0.45)]"
        />
      ))}
      {shots.length < MAX_SHOTS ? (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add another page"
          className="grid h-12 w-9 place-items-center rounded-md border border-dashed border-ink-line text-paper/60"
        >
          +
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClear}
        className="ml-1 font-mono text-[10px] tracking-wide text-paper/50 uppercase"
      >
        clear
      </button>
    </div>
  );
}

/** Shared shape for the messages that sit over the viewfinder. */
function Banner({
  tone,
  title,
  body,
  action,
}: {
  tone: 'amber' | 'seal';
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  const bar = tone === 'amber' ? 'bg-amber' : 'bg-seal';
  const accent = tone === 'amber' ? 'text-amber' : 'text-seal';
  const glow =
    tone === 'amber'
      ? '0 16px 40px -16px color-mix(in srgb, var(--color-amber) 45%, transparent)'
      : '0 16px 40px -16px color-mix(in srgb, var(--color-seal) 50%, transparent)';
  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      role="status"
      style={{ boxShadow: glow }}
      className="glass-dark absolute inset-x-4 top-[calc(4.5rem+env(safe-area-inset-top))] z-30 overflow-hidden rounded-[18px] px-4 py-3.5"
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${bar}`} />
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${bar}`}
          style={{ animation: 'pulse-guide 1.6s ease-in-out infinite' }}
        />
        <p className={`text-[13.5px] leading-snug font-medium ${accent}`}>{title}</p>
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-paper/65">{body}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className={`mt-1.5 font-mono text-[11px] underline underline-offset-4 ${accent}`}
        >
          {action.label}
        </button>
      ) : null}
    </motion.div>
  );
}

function ErrorToast({
  error,
  onOpenSettings,
}: {
  error: NonNullable<ReturnType<typeof useScan>['error']>;
  onOpenSettings: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const wait = error.retryAt ? Math.max(0, error.retryAt - now) : 0;
  const mins = Math.ceil(wait / 60000);

  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      role="alert"
      style={{
        boxShadow: '0 16px 40px -16px color-mix(in srgb, var(--color-seal) 50%, transparent)',
      }}
      className="glass-dark absolute inset-x-4 top-[calc(4.5rem+env(safe-area-inset-top))] z-30 overflow-hidden rounded-[18px] px-4 py-3.5"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-seal" />
      <div className="flex items-center gap-2">
        <span className="han shrink-0 text-[13px] text-seal">出错了</span>
        <p className="text-[13.5px] leading-snug text-paper">{error.message}</p>
      </div>
      {error.kind === 'no-keys' ? (
        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-1.5 font-mono text-[11px] text-seal underline underline-offset-4"
        >
          add a free key →
        </button>
      ) : wait > 0 ? (
        <p className="mt-1.5 font-mono text-[11px] text-paper/50">
          <span className="scan-dots mr-1" aria-hidden>
            <span>·</span>
            <span>·</span>
            <span>·</span>
          </span>
          back in {mins > 1 ? `${mins} minutes` : `${Math.ceil(wait / 1000)}s`}
        </p>
      ) : null}
    </motion.div>
  );
}
