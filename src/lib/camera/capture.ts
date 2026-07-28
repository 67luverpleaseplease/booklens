/**
 * Getting a photo out of the device.
 *
 * The live viewfinder is the good path, but it is not always available — iOS
 * in-app browsers block getUserMedia, desktops may have no camera, and
 * permission can simply be refused. So every entry point degrades:
 *
 *   live stream → native camera via file input → file picker → paste → drop
 */

export type CameraSupport = {
  /** A live <video> viewfinder is possible. */
  live: boolean;
  /** `capture="environment"` opens the OS camera app. */
  nativeCapture: boolean;
  torch: boolean;
};

export function detectSupport(): CameraSupport {
  const hasMediaDevices =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  // getUserMedia requires a secure context; file inputs do not.
  const secure = typeof window !== 'undefined' && (window.isSecureContext ?? false);
  return {
    live: hasMediaDevices && secure,
    nativeCapture: typeof document !== 'undefined' && 'capture' in document.createElement('input'),
    torch: false, // Resolved per-stream once we know the track's capabilities.
  };
}

export class CameraError extends Error {
  readonly reason: 'denied' | 'unavailable' | 'insecure' | 'unknown';
  constructor(reason: CameraError['reason'], message: string) {
    super(message);
    this.name = 'CameraError';
    this.reason = reason;
  }
}

function toCameraError(err: unknown): CameraError {
  const name = (err as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new CameraError('denied', 'Camera access was refused.');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new CameraError('unavailable', 'No camera was found on this device.');
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return new CameraError('insecure', 'The camera needs a secure (https) connection.');
  }
  return new CameraError('unknown', (err as Error)?.message ?? 'The camera could not start.');
}

/** Rear camera at as high a resolution as the device will offer. */
export async function openStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unavailable', 'This browser has no camera API.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 2560 },
        height: { ideal: 1440 },
      },
      audio: false,
    });
  } catch (err) {
    // An exact facingMode can fail on laptops with only a front camera.
    try {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch {
      throw toCameraError(err);
    }
  }
}

export function closeStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

type TorchConstraint = MediaTrackConstraintSet & { torch?: boolean };

export function supportsTorch(stream: MediaStream | null): boolean {
  const track = stream?.getVideoTracks()[0];
  if (!track?.getCapabilities) return false;
  return 'torch' in track.getCapabilities();
}

export async function setTorch(stream: MediaStream | null, on: boolean): Promise<boolean> {
  const track = stream?.getVideoTracks()[0];
  if (!track || !supportsTorch(stream)) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as TorchConstraint] });
    return true;
  } catch {
    return false;
  }
}

/** Grab the current video frame as a JPEG blob. */
export async function grabFrame(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new CameraError('unknown', 'The camera is not ready yet.');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new CameraError('unknown', 'Could not capture the frame.');
  ctx.drawImage(video, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new CameraError('unknown', 'Could not encode the photo.'))),
      'image/jpeg',
      0.92,
    );
  });
}

/**
 * Open the OS camera (or picker) and resolve with what the user chose.
 * `capture: true` asks iOS and Android to go straight to the camera.
 */
export function pickImages(opts: { capture?: boolean; multiple?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (opts.multiple) input.multiple = true;
    if (opts.capture) input.setAttribute('capture', 'environment');
    input.style.position = 'fixed';
    input.style.left = '-9999px';

    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => finish([...(input.files ?? [])]));
    // There is no reliable "cancelled" event across browsers; window focus
    // returning with no selection is the closest signal we get.
    input.addEventListener('cancel', () => finish([]));
    window.addEventListener(
      'focus',
      () => setTimeout(() => finish([...(input.files ?? [])]), 500),
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
}

/** Pull any images out of a paste event. */
export function imagesFromClipboard(e: ClipboardEvent): File[] {
  const out: File[] = [];
  for (const item of e.clipboardData?.items ?? []) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) out.push(file);
    }
  }
  return out;
}

/** Pull any images out of a drop event. */
export function imagesFromDrop(e: DragEvent): File[] {
  return [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
}
