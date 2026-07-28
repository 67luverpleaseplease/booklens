import { useCallback, useRef, useState } from 'react';
import { analyze, type AnalyzeOutcome, type ScanPhase, type ScanProgress } from '../lib/vision/analyze';
import { PRIMARY_CHAIN, SECONDARY_CHAIN } from '../lib/openrouter/chains';
import { AllKeysUnavailable } from '../lib/openrouter/client';
import { classifyThrown, humanize, RequestFailure } from '../lib/openrouter/errors';
import { useSettings } from '../lib/store/settings';
import { saveScan } from '../lib/store/db';
import { makeThumbnail } from '../lib/camera/imagePrep';

export type ScanError = {
  message: string;
  /** Set when we're waiting on a quota rather than genuinely broken. */
  retryAt?: number;
  kind: 'no-keys' | 'exhausted' | 'failed';
};

export function useScan() {
  const [progress, setProgress] = useState<ScanProgress>({ phase: 'idle' });
  const [outcome, setOutcome] = useState<AnalyzeOutcome | null>(null);
  const [error, setError] = useState<ScanError | null>(null);
  /** Live payload text streaming in from the model — the "watch it read" feed. */
  const [streamText, setStreamText] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  // Kept so "try a different model" can re-read the same photo without
  // asking the user to take it again.
  const lastRun = useRef<{ images: string[]; intent: 'cover' | 'pages' } | null>(null);

  const level = useSettings((s) => s.level);
  const traditional = useSettings((s) => s.traditional);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setProgress({ phase: 'idle' });
  }, []);

  const reset = useCallback(() => {
    cancel();
    setOutcome(null);
    setError(null);
  }, [cancel]);

  const run = useCallback(
    async (
      images: string[],
      intent: 'cover' | 'pages',
      opts: { preferChain?: typeof PRIMARY_CHAIN; keepPrevious?: boolean } = {},
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      lastRun.current = { images, intent };

      setError(null);
      // On a retry, hold the old result on screen until the new one lands —
      // blanking the sheet mid-request feels like a crash.
      if (!opts.keepPrevious) setOutcome(null);
      setStreamText('');
      setProgress({ phase: 'reading' });

      try {
        const result = await analyze({
          images,
          intent,
          level,
          traditional,
          preferChain: opts.preferChain,
          signal: controller.signal,
          onProgress: setProgress,
          onStream: setStreamText,
        });
        setOutcome(result);
        setProgress({ phase: 'done', via: result.modelLabel });
        setStreamText('');

        // Save in the background — a slow thumbnail shouldn't delay the result.
        void (async () => {
          try {
            await saveScan({
              id: crypto.randomUUID(),
              createdAt: Date.now(),
              thumbnail: await makeThumbnail(images[0]),
              intent,
              model: result.model,
              modelLabel: result.modelLabel,
              result: result.result,
            });
          } catch {
            /* the shelf is a convenience, not the product */
          }
        })();

        return result;
      } catch (err) {
        if (controller.signal.aborted) {
          setProgress({ phase: 'idle' });
          return null;
        }
        if (err instanceof AllKeysUnavailable) {
          setError({
            kind: err.reason,
            message: err.message,
            retryAt: err.nextAvailableAt ?? undefined,
          });
        } else {
          const failure = err instanceof RequestFailure ? err : classifyThrown(err);
          setError({ kind: 'failed', message: humanize(failure) });
        }
        setProgress({ phase: 'error' });
        setStreamText('');
        return null;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [level, traditional],
  );

  const busy: boolean =
    progress.phase === 'reading' ||
    progress.phase === 'understanding' ||
    progress.phase === 'writing';

  /** Re-read the same photo with the model family we didn't use last time. */
  const retryOtherChain = useCallback(async () => {
    const previous = lastRun.current;
    if (!previous || !outcome) return null;
    const other = outcome.chain === 'primary' ? SECONDARY_CHAIN : PRIMARY_CHAIN;
    return run(previous.images, previous.intent, { preferChain: other, keepPrevious: true });
  }, [outcome, run]);

  return {
    run,
    retryOtherChain,
    canRetry: Boolean(outcome && lastRun.current),
    cancel,
    reset,
    progress,
    outcome,
    error,
    busy,
    streamText,
    phase: progress.phase as ScanPhase,
  };
}
