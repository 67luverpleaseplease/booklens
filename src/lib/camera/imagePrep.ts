/**
 * Getting a photo ready to send.
 *
 * A raw 12MP phone shot is roughly four times the tokens of a 1600px version
 * and reads no better, which matters a lot when the budget is counted in
 * requests per day rather than dollars.
 */

/** Longest edge after downscaling. Plenty for a vision model to read type. */
export const TARGET_LONG_EDGE = 1600;
const MAX_BYTES = 4 * 1024 * 1024;
const START_QUALITY = 0.85;

export type PreparedImage = {
  /** `data:image/jpeg;base64,…` — the shape OpenRouter's image_url expects. */
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
};

/**
 * Scale factor to bring an image under the long-edge cap.
 * Never upscales — a small photo stays small.
 */
export function scaleFor(width: number, height: number, longEdge = TARGET_LONG_EDGE): number {
  const longest = Math.max(width, height);
  if (longest <= longEdge) return 1;
  return longEdge / longest;
}

export function scaledSize(
  width: number,
  height: number,
  longEdge = TARGET_LONG_EDGE,
): { width: number; height: number } {
  const s = scaleFor(width, height, longEdge);
  return { width: Math.round(width * s), height: Math.round(height * s) };
}

/** Approximate decoded byte length of a base64 data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/**
 * EXIF orientation → the canvas transform that corrects it.
 * `createImageBitmap` with `imageOrientation: 'from-image'` handles this for us
 * where supported; this table is the fallback for browsers that don't.
 */
export function orientationTransform(
  orientation: number,
  w: number,
  h: number,
): { width: number; height: number; transform: [number, number, number, number, number, number] } {
  switch (orientation) {
    case 2:
      return { width: w, height: h, transform: [-1, 0, 0, 1, w, 0] };
    case 3:
      return { width: w, height: h, transform: [-1, 0, 0, -1, w, h] };
    case 4:
      return { width: w, height: h, transform: [1, 0, 0, -1, 0, h] };
    case 5:
      return { width: h, height: w, transform: [0, 1, 1, 0, 0, 0] };
    case 6:
      return { width: h, height: w, transform: [0, 1, -1, 0, h, 0] };
    case 7:
      return { width: h, height: w, transform: [0, -1, -1, 0, h, w] };
    case 8:
      return { width: h, height: w, transform: [0, -1, 1, 0, 0, w] };
    default:
      return { width: w, height: h, transform: [1, 0, 0, 1, 0, 0] };
  }
}

/** Read the EXIF orientation tag out of a JPEG, or 1 when there isn't one. */
export async function readOrientation(blob: Blob): Promise<number> {
  try {
    const head = await blob.slice(0, 128 * 1024).arrayBuffer();
    const view = new DataView(head);
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 1;

    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xffe1) {
        // APP1 — check for the Exif header.
        if (view.getUint32(offset + 2, false) !== 0x45786966) return 1;
        const little = view.getUint16(offset + 8, false) === 0x4949;
        const ifdStart = offset + 8 + view.getUint32(offset + 12, little);
        if (ifdStart + 2 > view.byteLength) return 1;
        const tags = view.getUint16(ifdStart, little);
        for (let i = 0; i < tags; i++) {
          const entry = ifdStart + 2 + i * 12;
          if (entry + 8 > view.byteLength) break;
          if (view.getUint16(entry, little) === 0x0112) {
            return view.getUint16(entry + 8, little) || 1;
          }
        }
        return 1;
      }
      if ((marker & 0xff00) !== 0xff00) break;
      offset += view.getUint16(offset, false);
    }
  } catch {
    /* not a JPEG, or truncated — orientation 1 is the safe assumption */
  }
  return 1;
}

async function toBitmap(source: Blob): Promise<{ bitmap: ImageBitmap; alreadyOriented: boolean }> {
  try {
    // Where this is supported the browser applies EXIF for us, which is both
    // faster and more correct than doing it by hand.
    const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
    return { bitmap, alreadyOriented: true };
  } catch {
    return { bitmap: await createImageBitmap(source), alreadyOriented: false };
  }
}

/**
 * Downscale, orient, and JPEG-encode. Steps quality down until the result fits
 * under the size cap rather than failing on a large photo.
 */
export async function prepareImage(source: Blob): Promise<PreparedImage> {
  const { bitmap, alreadyOriented } = await toBitmap(source);
  const orientation = alreadyOriented ? 1 : await readOrientation(source);

  const oriented = orientationTransform(orientation, bitmap.width, bitmap.height);
  const { width, height } = scaledSize(oriented.width, oriented.height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read the photo.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const scale = width / oriented.width;
  const [a, b, c, d, e, f] = oriented.transform;
  ctx.setTransform(a * scale, b * scale, c * scale, d * scale, e * scale, f * scale);
  ctx.drawImage(bitmap, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  bitmap.close?.();

  let quality = START_QUALITY;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  // Four steps is enough to get any phone photo under 4MB at 1600px.
  while (dataUrlBytes(dataUrl) > MAX_BYTES && quality > 0.4) {
    quality -= 0.15;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }

  return { dataUrl, width, height, bytes: dataUrlBytes(dataUrl) };
}

/** Small JPEG for the shelf grid and the capture tray. */
export async function makeThumbnail(dataUrl: string, size = 320): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();

  const { width, height } = scaledSize(img.naturalWidth, img.naturalHeight, size);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.72);
}
