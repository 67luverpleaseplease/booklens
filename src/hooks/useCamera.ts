import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CameraError,
  closeStream,
  detectSupport,
  grabFrame,
  openStream,
  setTorch,
  supportsTorch,
} from '../lib/camera/capture';

export type CameraState = {
  ready: boolean;
  starting: boolean;
  error: CameraError | null;
  torchOn: boolean;
  torchAvailable: boolean;
};

/**
 * Owns the live viewfinder. Callers that can't get one fall back to the file
 * input paths in `capture.ts` — this hook never blocks that.
 */
export function useCamera(active: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>({
    ready: false,
    starting: false,
    error: null,
    torchOn: false,
    torchAvailable: false,
  });

  const stop = useCallback(() => {
    closeStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState((s) => ({ ...s, ready: false, torchOn: false }));
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return;
    if (!detectSupport().live) {
      setState((s) => ({
        ...s,
        error: new CameraError('unavailable', 'Live camera is not available here.'),
      }));
      return;
    }
    setState((s) => ({ ...s, starting: true, error: null }));
    try {
      const stream = await openStream();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {
          // Autoplay can be refused; the element still shows frames once the
          // user interacts, so this is not fatal.
        });
      }
      setState({
        ready: true,
        starting: false,
        error: null,
        torchOn: false,
        torchAvailable: supportsTorch(stream),
      });
    } catch (err) {
      setState({
        ready: false,
        starting: false,
        error: err instanceof CameraError ? err : new CameraError('unknown', String(err)),
        torchOn: false,
        torchAvailable: false,
      });
    }
  }, []);

  useEffect(() => {
    if (active) void start();
    else stop();
    return stop;
  }, [active, start, stop]);

  const toggleTorch = useCallback(async () => {
    const next = !state.torchOn;
    const ok = await setTorch(streamRef.current, next);
    if (ok) setState((s) => ({ ...s, torchOn: next }));
  }, [state.torchOn]);

  const capture = useCallback(async (): Promise<Blob | null> => {
    if (!videoRef.current || !state.ready) return null;
    try {
      return await grabFrame(videoRef.current);
    } catch {
      return null;
    }
  }, [state.ready]);

  return { videoRef, state, start, stop, capture, toggleTorch };
}
