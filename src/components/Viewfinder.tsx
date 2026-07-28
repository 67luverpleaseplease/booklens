import type { RefObject } from 'react';
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
            'radial-gradient(ellipse at center, transparent 42%, rgba(11,11,13,0.55) 100%)',
        }}
      />

      {!camera.ready && !frozenFrame ? <CameraFallback camera={camera} /> : null}

      {camera.ready && !scanning && !frozenFrame ? <CornerGuides /> : null}

      <AnimatePresence>{scanning ? <ScanOverlay progress={progress} /> : null}</AnimatePresence>
    </div>
  );
}

/** The ink-wash sweep, plus a status line that names what's happening. */
function ScanOverlay({ progress }: { progress: ScanProgress }) {
  const phase = progress.phase as ScanPhase;
  const label = PHASE_LABEL[phase] ?? PHASE_LABEL.reading;

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
        className="absolute inset-x-0 bottom-0 px-6 pb-32"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="flex items-baseline gap-2">
          <span className="han text-[17px] text-paper">{label.zh}</span>
          <span className="font-mono text-[10px] tracking-[0.16em] text-paper/60 uppercase">
            {label.en}
          </span>
        </div>
        {progress.via ? (
          <p className="mt-0.5 font-mono text-[9.5px] tracking-wide text-paper/45">
            via {progress.via} · free
            {progress.keyAttempt && progress.keyAttempt > 1
              ? ` · key ${progress.keyAttempt}`
              : ''}
          </p>
        ) : null}
      </div>
    </motion.div>
  );
}

/** Four corner brackets — frame the book without covering it. */
function CornerGuides() {
  const corners = [
    'left-8 top-[18%] border-l-2 border-t-2 rounded-tl-lg',
    'right-8 top-[18%] border-r-2 border-t-2 rounded-tr-lg',
    'left-8 bottom-[26%] border-l-2 border-b-2 rounded-bl-lg',
    'right-8 bottom-[26%] border-r-2 border-b-2 rounded-br-lg',
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {corners.map((c) => (
        <span
          key={c}
          className={`absolute h-9 w-9 border-paper/45 ${c}`}
          style={{ animation: 'pulse-guide 2.8s ease-in-out infinite' }}
        />
      ))}
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
        <div className="han mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl border border-ink-line text-[26px] text-ink-mute">
          镜
        </div>
        <p className="text-[14px] leading-snug text-balance text-paper/60">{message}</p>
      </div>
    </div>
  );
}
