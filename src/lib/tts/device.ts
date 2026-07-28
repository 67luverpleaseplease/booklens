/**
 * Speaking, via the device's own voices.
 *
 * Free, offline, instant, and it spends none of the daily request budget. It
 * also emits `onboundary`, which means karaoke highlighting is exact rather
 * than estimated — a real advantage over any cloud TTS.
 *
 * The Web Speech API is, however, full of platform quirks. Each one below is
 * handled deliberately; none of them are theoretical.
 */

import { segmentSentences } from '../chinese/segment';

export type SpeakOptions = {
  voiceId?: string | null;
  lang?: string;
  rate?: number;
  pitch?: number;
  /** Character offset into the full text as speech moves through it. */
  onBoundary?: (charIndex: number) => void;
  /** Index of the sentence that just started. */
  onSentence?: (index: number, sentence: string) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
};

/**
 * Chrome silently truncates a long utterance at roughly 15 seconds. Splitting
 * on sentence boundaries and queueing sidesteps it, and we need per-sentence
 * granularity for the karaoke highlight anyway.
 */
function chunk(text: string): string[] {
  const sentences = segmentSentences(text);
  const out: string[] = [];
  let buffer = '';
  // ~120 Chinese characters lands comfortably under the cutoff at 1x.
  const LIMIT = 120;
  for (const s of sentences) {
    if (buffer && buffer.length + s.length > LIMIT) {
      out.push(buffer);
      buffer = s;
    } else {
      buffer += s;
    }
  }
  if (buffer) out.push(buffer);
  return out.length ? out : [text];
}

export function isSupported(): boolean {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}

/**
 * iOS refuses to speak unless the first `speak()` of the session happens inside
 * a user gesture. Calling this from a tap handler unlocks the engine for the
 * rest of the session.
 */
let primed = false;
export function prime(): void {
  if (primed || !isSupported()) return;
  primed = true;
  try {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch {
    /* nothing to lose */
  }
}

export class DeviceSpeaker {
  private queue: string[] = [];
  private index = 0;
  private baseOffset = 0;
  private opts: SpeakOptions = {};
  private stopped = false;
  private voices: SpeechSynthesisVoice[] = [];

  setVoices(voices: SpeechSynthesisVoice[]): void {
    this.voices = voices;
  }

  get speaking(): boolean {
    return isSupported() && speechSynthesis.speaking && !this.stopped;
  }

  speak(text: string, opts: SpeakOptions = {}): void {
    if (!isSupported() || !text.trim()) {
      opts.onEnd?.();
      return;
    }
    prime();
    this.stop();

    this.stopped = false;
    this.opts = opts;
    this.queue = chunk(text);
    this.index = 0;
    this.baseOffset = 0;
    this.speakNext();
  }

  private speakNext(): void {
    if (this.stopped || this.index >= this.queue.length) {
      if (!this.stopped) this.opts.onEnd?.();

      return;
    }

    const piece = this.queue[this.index];
    const u = new SpeechSynthesisUtterance(piece);
    u.lang = this.opts.lang ?? 'zh-CN';
    u.rate = this.opts.rate ?? 1;
    u.pitch = this.opts.pitch ?? 1;

    const voice = this.opts.voiceId
      ? this.voices.find((v) => (v.voiceURI || v.name) === this.opts.voiceId)
      : undefined;
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }

    const offsetAtStart = this.baseOffset;
    this.opts.onSentence?.(this.index, piece);

    u.onboundary = (e) => {
      if (this.stopped) return;
      this.opts.onBoundary?.(offsetAtStart + (e.charIndex ?? 0));
    };
    u.onend = () => {
      if (this.stopped) return;
      this.baseOffset += piece.length;
      this.index += 1;
      this.speakNext();
    };
    u.onerror = (e) => {
      if (this.stopped) return;
      // "interrupted" and "canceled" are what a normal stop() looks like.
      const err = (e as SpeechSynthesisErrorEvent).error;
      if (err === 'interrupted' || err === 'canceled') return;
      this.opts.onError?.(String(err ?? 'speech failed'));
      this.stop();
    };


    speechSynthesis.speak(u);
  }

  /**
   * Safari's pause() is unreliable — it can leave the engine wedged. Stopping
   * and re-speaking from the current sentence is the dependable equivalent.
   */
  pause(): void {
    if (!isSupported()) return;
    this.stopped = true;
    speechSynthesis.cancel();
  }

  resumeFromSentence(sentenceIndex: number): void {
    if (!this.queue.length) return;
    this.stopped = false;
    this.index = Math.max(0, Math.min(sentenceIndex, this.queue.length - 1));
    this.baseOffset = this.queue.slice(0, this.index).reduce((n, s) => n + s.length, 0);
    speechSynthesis.cancel();
    this.speakNext();
  }

  stop(): void {
    this.stopped = true;

    if (isSupported()) speechSynthesis.cancel();
  }
}

export const speaker = new DeviceSpeaker();
