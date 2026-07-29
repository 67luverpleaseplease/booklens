import { useQuotaSummary } from '../hooks/useQuota';

function shortWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.ceil(m / 60)}h`;
}

/**
 * Today's budget, on the capture screen.
 *
 * The free tier is small enough that "how many do I have left" is a question
 * you actually ask before taking a photo — so it shouldn't be buried in
 * Settings.
 */
export function QuotaPip({ onOpen }: { onOpen: () => void }) {
  const q = useQuotaSummary();

  if (q.keyCount === 0) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="rounded-full bg-seal px-2.5 py-1 font-mono text-[10px] tracking-wide text-paper"
      >
        add a key
      </button>
    );
  }

  const remaining = Math.max(0, q.limit - q.used);
  const spent = q.limit > 0 ? q.used / q.limit : 0;
  const blocked = q.readyCount === 0;

  const tone = blocked
    ? 'text-amber'
    : spent > 0.85
      ? 'text-seal'
      : spent > 0.55
        ? 'text-amber'
        : 'text-paper/70';

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${remaining} scans left today. Open key settings.`}
      className="glass-dark flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors hover:bg-ink"
    >
      <span
        aria-hidden
        className={[
          'h-1.5 w-1.5 rounded-full',
          blocked ? 'bg-amber' : spent > 0.85 ? 'bg-seal' : 'bg-jade',
        ].join(' ')}
      />
      <span className={`font-mono text-[10px] tracking-wide ${tone}`}>
        {blocked && q.readyIn !== null ? `back in ${shortWait(q.readyIn)}` : `${remaining} left`}
      </span>
    </button>
  );
}
