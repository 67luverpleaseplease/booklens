import { motion, AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { PREVIEW_LINE, type Voice, type VoiceCatalogue } from '../lib/tts/voices';

/**
 * Split 男声 / 女声, because "read it to me in a man's voice" is a real request
 * and the OS exposes no gender field to answer it with. Every row previews the
 * same line so voices are actually comparable.
 */
export function VoicePicker({
  open,
  catalogue,
  current,
  onPick,
  onPreview,
  onClose,
}: {
  open: boolean;
  catalogue: VoiceCatalogue;
  current: Voice | null;
  onPick: (v: Voice) => void;
  onPreview: (v: Voice) => void;
  onClose: () => void;
}) {
  const [previewing, setPreviewing] = useState<string | null>(null);

  const other = catalogue.chinese.filter((v) => v.gender === 'unknown');

  const section = (title: string, sub: string, voices: Voice[]) =>
    voices.length ? (
      <section key={title} className="mb-4">
        <h3 className="mb-1.5 flex items-baseline gap-2">
          <span className="han text-[15px] text-ink">{title}</span>
          <span className="font-mono text-[9.5px] tracking-[0.16em] text-graphite/70 uppercase">
            {sub}
          </span>
        </h3>
        <div className="space-y-1">
          {voices.map((v) => {
            const active = current?.id === v.id;
            return (
              <div
                key={v.id}
                className={[
                  'flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors',
                  active ? 'border-seal bg-seal/8' : 'border-paper-line hover:border-graphite/40',
                ].join(' ')}
              >
                <button
                  type="button"
                  onClick={() => onPick(v)}
                  className="min-w-0 flex-1 text-left"
                  aria-pressed={active}
                >
                  <span className="block truncate text-[15px] text-ink">{v.label}</span>
                  <span className="block font-mono text-[10px] text-graphite">
                    {[v.note, v.lang].filter(Boolean).join(' · ')}
                  </span>
                </button>

                {active ? (
                  <span className="font-mono text-[9px] tracking-wide text-seal uppercase">on</span>
                ) : null}

                <button
                  type="button"
                  aria-label={`Preview ${v.label}`}
                  onClick={() => {
                    setPreviewing(v.id);
                    onPreview(v);
                    setTimeout(() => setPreviewing((p) => (p === v.id ? null : p)), 2600);
                  }}
                  className={[
                    'grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors',
                    previewing === v.id
                      ? 'bg-seal text-paper'
                      : 'bg-paper-deep text-graphite hover:bg-ink hover:text-paper',
                  ].join(' ')}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </section>
    ) : null;

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-ink/70"
          />
          <motion.div
            role="dialog"
            aria-label="Choose a voice"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[78vh] overflow-y-auto rounded-t-3xl bg-paper px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-ink"
          >
            <div className="mb-3 flex items-center justify-center">
              <span className="h-1 w-9 rounded-full bg-paper-line" aria-hidden />
            </div>

            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-display text-[22px] text-ink">Choose a voice</h2>
              <button
                type="button"
                onClick={onClose}
                className="font-mono text-[10px] tracking-wide text-graphite uppercase"
              >
                done
              </button>
            </div>

            {catalogue.chinese.length === 0 ? (
              <p className="py-6 text-center text-[14px] text-graphite">
                No Chinese voices are installed on this device. On iPhone: Settings → Accessibility →
                Spoken Content → Voices → Chinese.
              </p>
            ) : (
              <>
                {section('男声', 'male', catalogue.male)}
                {section('女声', 'female', catalogue.female)}
                {section('其他', 'other', other)}
                <p className="pb-2 font-mono text-[10px] leading-relaxed text-graphite/60">
                  Preview line: <span className="han">{PREVIEW_LINE}</span>
                </p>
              </>
            )}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
