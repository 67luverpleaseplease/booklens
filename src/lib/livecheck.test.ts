/**
 * TEMPORARY live reproduction — NOT committed. Runs the app's real production
 * scan path (analyze → chatComplete → PRIMARY chain) against the real
 * OpenRouter service with a real key and a real photo-like image, then asserts
 * the app produced a validated ScanResult.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyze } from './vision/analyze';
import { keychain } from './openrouter/keychain';

const KEY = process.env.BOOKLENS_TEST_KEY!;
const IMG =
  'data:image/jpeg;base64,' +
  readFileSync('/home/user/booklens/.live-test-img.jpg').toString('base64');

describe('LIVE REPRO', () => {
  it(
    'production scan path returns a validated ScanResult end-to-end',
    async () => {
      keychain.add(KEY, 'live-repro');
      const out = await analyze({ images: [IMG], intent: 'pages', level: 4 });
      console.log('served by:', out.modelLabel, '| chain:', out.chain, '| repaired:', out.repaired);
      console.log('detected:', out.result.detected, '| cards:', out.result.summaries.length);
      console.log('first card zh:', out.result.summaries[0]?.zh);
      console.log('extracted_text head:', out.result.extracted_text.slice(0, 60));
      expect(out.result.summaries.length).toBeGreaterThan(0);
    },
    240_000,
  );
});
