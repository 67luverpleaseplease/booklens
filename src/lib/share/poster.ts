/**
 * Render a result to a shareable image.
 *
 * Drawn on a canvas in the app's own palette and type rather than screenshotting
 * the DOM — that keeps the output independent of scroll position, viewport, and
 * whichever pinyin mode happened to be on. Costs nothing and needs no network.
 */

import type { ScanResult } from '../vision/schema';

const W = 1080;
const PAD = 72;

const INK = '#0B0B0D';
const PAPER = '#F7F3EA';
const PAPER_DEEP = '#EBE3D4';
const SEAL = '#E2483D';
const GRAPHITE = '#5A5750';

const HAN = '"Noto Serif SC", "Songti SC", serif';
const DISPLAY = '"Instrument Serif", serif';
const BODY = '"Newsreader", Georgia, serif';
const MONO = '"IBM Plex Mono", monospace';

type Line = { text: string; font: string; color: string; size: number; leading: number; gap: number };

/** Greedy wrap. Chinese breaks per character; Latin breaks on spaces. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [];
  const isHan = /\p{Script=Han}/u.test(text);
  const units = isHan ? [...text] : text.split(/(\s+)/);
  const lines: string[] = [];
  let line = '';

  for (const unit of units) {
    const next = line + unit;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line.trimEnd());
      line = unit.trimStart();
    } else {
      line = next;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

async function ensureFonts(): Promise<void> {
  if (!document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`400 64px ${DISPLAY}`),
      document.fonts.load(`400 40px ${HAN}`),
      document.fonts.load(`500 40px ${HAN}`),
      document.fonts.load(`400 28px ${BODY}`),
      document.fonts.load(`400 20px ${MONO}`),
    ]);
    await document.fonts.ready;
  } catch {
    // Falling back to a system serif is a cosmetic loss, not a failure.
  }
}

export async function renderPoster(
  result: ScanResult,
  opts: { modelLabel: string; maxCards?: number } = { modelLabel: '' },
): Promise<Blob> {
  await ensureFonts();

  const maxCards = opts.maxCards ?? 3;
  const cards = result.summaries.slice(0, maxCards);
  const inner = W - PAD * 2;

  // Measure first so the canvas is exactly as tall as the content needs.
  const measure = document.createElement('canvas').getContext('2d')!;
  const blocks: Line[] = [];

  const push = (text: string, font: string, size: number, color: string, leading: number, gap: number, weight = '400') => {
    measure.font = `${weight} ${size}px ${font}`;
    for (const line of wrap(measure, text, inner)) {
      blocks.push({ text: line, font: `${weight} ${size}px ${font}`, color, size, leading, gap: 0 });
    }
    if (blocks.length) blocks[blocks.length - 1].gap = gap;
  };

  const book = result.book;
  push(book?.title_zh || '未知书名', HAN, 62, INK, 78, 10, '500');
  if (book?.title_pinyin) push(book.title_pinyin, MONO, 22, SEAL, 30, 14);
  if (book?.title_en) push(book.title_en, DISPLAY, 38, GRAPHITE, 46, 8);
  if (book?.author_zh || book?.author_en) {
    push([book.author_zh, book.author_en].filter(Boolean).join(' · '), BODY, 24, GRAPHITE, 32, 48);
  }

  cards.forEach((card, i) => {
    push(`${i + 1}  ${card.label_zh}`, MONO, 20, SEAL, 28, 12);
    push(card.zh, HAN, 40, INK, 60, 10);
    push(card.en, BODY, 26, GRAPHITE, 36, i === cards.length - 1 ? 40 : 46);
  });

  if (result.talking_points.length) {
    push('SAY IT OUT LOUD', MONO, 18, GRAPHITE, 26, 14);
    for (const point of result.talking_points.slice(0, 3)) {
      push(`— ${point}`, BODY, 25, INK, 34, 12);
    }
  }

  const contentHeight = blocks.reduce((n, b) => n + b.leading + b.gap, 0);
  /** Where the first baseline sits — below the seal mark. */
  const TOP = PAD + 96;
  /** Room for the rule and the attribution line beneath the content. */
  const FOOTER = 110;
  const H = Math.max(1080, TOP + contentHeight + FOOTER + PAD);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Paper, then a faint grain so it doesn't read as a flat export.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.035;
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? INK : '#ffffff';
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.4, 1.4);
  }
  ctx.globalAlpha = 1;

  // Seal mark, top right — the same 读 chop as the shutter.
  const sealSize = 76;
  const sx = W - PAD - sealSize;
  ctx.fillStyle = SEAL;
  ctx.beginPath();
  ctx.roundRect(sx, PAD - 12, sealSize, sealSize, 18);
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.font = `500 44px ${HAN}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('读', sx + sealSize / 2, PAD - 12 + sealSize / 2 + 2);

  // Body.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  let y = TOP;
  for (const block of blocks) {
    ctx.font = block.font;
    ctx.fillStyle = block.color;
    ctx.fillText(block.text, PAD, y);
    y += block.leading + block.gap;
  }

  // Footer rule and attribution.
  ctx.strokeStyle = PAPER_DEEP;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, H - PAD - 44);
  ctx.lineTo(W - PAD, H - PAD - 44);
  ctx.stroke();

  ctx.font = `400 19px ${MONO}`;
  ctx.fillStyle = GRAPHITE;
  ctx.fillText('书镜 BookLens', PAD, H - PAD);
  if (opts.modelLabel) {
    ctx.textAlign = 'right';
    ctx.fillText(`via ${opts.modelLabel} · free`, W - PAD, H - PAD);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not render the image.'))),
      'image/png',
    );
  });
}

/**
 * Share the poster, or download it where the Web Share API can't take files
 * (most desktop browsers).
 */
export async function sharePoster(result: ScanResult, modelLabel: string): Promise<'shared' | 'downloaded'> {
  const blob = await renderPoster(result, { modelLabel });
  const name = `${result.book?.title_en || result.book?.title_zh || 'booklens'}.png`;
  const file = new File([blob], name, { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: result.book?.title_zh || 'BookLens' });
      return 'shared';
    } catch (err) {
      // A user-cancelled share is not an error worth falling back from.
      if ((err as Error)?.name === 'AbortError') return 'shared';
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
