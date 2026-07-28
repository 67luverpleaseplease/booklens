import { useEffect, useState, type RefObject } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { CameraState } from '../hooks/useCamera';
import { PHASE_LABEL, type ScanPhase, type ScanProgress } from '../lib/vision/analyze';

export function Viewfinder({
  videoRef,
  camera,
  frozenFrame,
  scanning,
  progress,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  camera: CameraState;
  /** Data URL shown in place of the live feed while a scan runs. */
  frozenFrame: string | null;
  scanning: boolean;
  progress: ScanProgress;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-ink">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={[
          'h-full w-full object-cover transition-[filter,opacity] duration-500',
          frozenFrame ? 'opacity-0' : 'opacity-100',
          scanning ? 'saturate-[0.3]' : '',
        ].join(' ')}
      />

      {frozenFrame ? (
        <img
          src={frozenFrame}
          alt=""
          className={[
            'absolute inset-0 h-full w-full object-cover transition-all duration-500',
            scanning ? 'saturate-[0.3] brightness-[0.72]' : '',
          ].join(' ')}
        />
      ) : null}

      {/* vignette — pulls the eye to the centre of the frame */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 38%, rgba(11,11,13,0.62) 100%)',
        }}
      />

      {/* soft floor so the scan status is always legible */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-56"
        style={{
          background: 'linear-gradient(to top, rgba(11,11,13,0.72), transparent)',
        }}
      />

      {!camera.ready && !frozenFrame ? <CameraFallback camera={camera} /> : null}

      {camera.ready && !scanning && !frozenFrame ? <CornerGuides /> : null}

      <AnimatePresence>{scanning ? <ScanOverlay progress={progress} /> : null}</AnimatePresence>
    </div>
  );
}

/** The ink-wash sweep, plus a live status card that owns the wait. */
function ScanOverlay({ progress }: { progress: ScanProgress }) {
  const phase = progress.phase as ScanPhase;
  const label = PHASE_LABEL[phase] ?? PHASE_LABEL.reading;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        className="ink-sweep absolute inset-x-0 h-1/2"
        style={{
          background:
            'linear-gradient(to bottom, transparent, rgba(226,72,61,0.16) 45%, rgba(247,243,234,0.22) 55%, transparent)',
        }}
      />

      <div
        className="absolute inset-x-4 bottom-[7.5rem]"
        aria-live="polite"
        aria-atomic="true"
      >
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="glass-dark relative mx-auto max-w-sm overflow-hidden rounded-2xl px-4 py-3.5"
        >
          {/* progress shimmer — motion says "working" even when seconds pass */}
          <span
            aria-hidden
            className="scan-bar absolute inset-y-0 left-0 w-1/3"
            style={{
              background:
                'linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-seal) 40%, transparent), transparent)',
            }}
          />

          <div className="relative flex items-center gap-3">
            <motion.span
              aria-hidden
              className="block h-5 w-5 shrink-0 rounded-full border-2 border-seal/30 border-t-seal"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
            />

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="han text-[17px] text-paper">{label.zh}</span>
                <span className="font-mono text-[10px] tracking-[0.16em] text-paper/55 uppercase">
                  {label.en}
                </span>
                <span className="scan-dots font-mono text-[12px] text-paper/70" aria-hidden>
                  <span>·</span>
                  <span>·</span>
                  <span>·</span>
                </span>
              </div>
              <p className="mt-0.5 truncate font-mono text-[9.5px] tracking-wide text-paper/45">
                via {progress.via ?? 'free models'} · free
                {progress.keyAttempt && progress.keyAttempt > 1
                  ? ` · key ${progress.keyAttempt}`
                  : ''}
              </p>
            </div>

            <span className="shrink-0 font-mono text-[11px] text-paper/50 tabular-nums">
              {elapsed}s
            </span>
          </div>

          {elapsed >= 25 ? (
            <p className="relative mt-2 border-t border-paper/10 pt-2 font-mono text-[9.5px] leading-relaxed text-paper/50">
              busy hours are slow — still working, hang tight
            </p>
          ) : null}
        </motion.div>
      </div>
    </motion.div>
  );
}

/** Four corner brackets — frame the book without covering it. */
function CornerGuides() {
  const corners = [
    'left-8 top-[18%] border-l-[2.5px] border-t-[2.5px] rounded-tl-xl',
    'right-8 top-[18%] border-r-[2.5px] border-t-[2.5px] rounded-tr-xl',
    'left-8 bottom-[26%] border-l-[2.5px] border-b-[2.5px] rounded-bl-xl',
    'right-8 bottom-[26%] border-r-[2.5px] border-b-[2.5px] rounded-br-xl',
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {corners.map((c) => (
        <span
          key={c}
          className={`absolute h-11 w-11 border-paper/70 ${c}`}
          style={{
            animation: 'pulse-guide 2.8s ease-in-out infinite',
            filter: 'drop-shadow(0 2px 6px rgba(11,11,13,0.6))',
          }}
        />
      ))}
      <p
        className="absolute inset-x-0 top-[calc(18%+3.75rem)] text-center font-mono text-[9.5px] tracking-[0.22em] text-paper/55 uppercase"
        style={{ textShadow: '0 1px 6px rgba(11,11,13,0.7)' }}
      >
        对准书页 · frame the book
      </p>
    </div>
  );
}

function CameraFallback({ camera }: { camera: CameraState }) {
  const message = camera.starting
    ? 'Starting the camera…'
    : camera.error?.reason === 'denied'
      ? 'Camera access was refused. You can still choose a photo from your library.'
      : camera.error?.reason === 'insecure'
        ? 'The live camera needs an https connection. Choosing a photo still works.'
        : camera.error
          ? 'No live camera here — choose a photo instead.'
          : 'Point at a book cover or an open page.';

  return (
    <div className="absolute inset-0 grid place-items-center px-10 text-center">
      <div>
        <div className="han glass-dark mx-auto mb-3 grid h-16 w-16 place-items-center rounded-[20px] text-[30px] text-seal">
          镜
        </div>
        <p className="text-[14px] leading-snug text-balance text-paper/60">{message}</p>
      </div>
    </div>
  );
}
