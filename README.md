# 书镜 BookLens

Point your camera at a Chinese book. Get four to six one-or-two-sentence summaries in Chinese and English — short enough to say out loud to someone — and have them read to you in a voice you choose.

Runs entirely in the browser. No server, no account, no build step at runtime. Every model it uses is free.

---

## Quick start

```bash
npm install
npm run cedict     # fetch + trim CC-CEDICT into public/ (once, ~30s)
npm run dev
```

Open the app, paste a free [OpenRouter key](https://openrouter.ai/keys), allow the camera.

## How it works

```
photo → downscale to 1600px → OpenRouter (free vision model) → strict JSON
                                                                    ↓
                                            IndexedDB shelf · summary cards
                                            · pinyin ruby · tap-to-define
                                            · read aloud (device voices)
```

There is no backend. OpenRouter allows browser-direct calls (`access-control-allow-origin: *` on `/api/v1/chat/completions`), so the app talks to it from your device and your key never passes through anyone else's server.

## Free-tier survival

OpenRouter's free tier is **20 requests/minute and 50/day per key**. Four things keep that from being a wall:

1. **Quota ledger** — request counts are tracked locally, so a key that's already spent is skipped instantly instead of burning a round-trip to discover a 429.
2. **Model chain in one request** — `models: [...]` with `route: "fallback"` sends three models in a single call. OpenRouter walks the chain server-side, so three models still cost **one** request against your daily 50.
3. **Key rotation** — add several keys and drag to reorder. On `429` a key cools off, on `402` it's done for the day, on `401` it's dropped for good, and the request moves on. Two keys is 100 scans/day.
4. **Provider fallback** — adapters for Google AI Studio, Groq, Mistral and Cerebras exist behind a Settings toggle, off by default.

Spending $10 on OpenRouter once raises the daily cap to 1000 permanently, but nothing here requires it and no request ever spends credit.

### The model chain

| # | Model | Notes |
|---|---|---|
| 1 | `google/gemma-4-31b-it:free` | Largest free Gemma, 262k context, strongest of the free tier on Chinese |
| 2 | `google/gemma-4-26b-a4b-it:free` | MoE with ~4B active params — *faster* than the 31B |
| 3 | `openrouter/free` | Router over whatever free model is healthy; the catch-all |

Backup chain (different family, different failure modes): `nvidia/nemotron-nano-12b-v2-vl:free` → `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`.

**JSON mode is chosen per model, not hardcoded.** The free models genuinely differ:

| Model | `response_format` | `structured_outputs` | `tools` |
|---|---|---|---|
| `gemma-4-31b-it:free` | ✅ | **❌** | ✅ |
| `gemma-4-26b-a4b-it:free` | ✅ | ✅ | ✅ |
| `openrouter/free` | ✅ | ✅ | ✅ |
| both nemotron VLMs | ❌ | ❌ | ✅ |

Sending `gemma-4-31b` a strict `json_schema` would be **rejected outright**. So capabilities are read from `/api/v1/models` at runtime, and a chain is pinned to the strongest mode all of its members support — `json_object` for the default chain, since the 31B is the floor. There's a test asserting exactly that.

## Reading aloud

Voices come from the device via the Web Speech API. Free, offline, instant, and they spend none of your daily requests. They also emit `onboundary`, so the karaoke highlight is exact rather than estimated.

Chinese voices are enumerated at runtime and labelled through a gender map, because `SpeechSynthesisVoice` exposes no gender field and "read it to me in a man's voice" is a real request. On macOS and iOS:

- **男 male** — Eddy, Reed, Rocko, Grandpa
- **女 female** — Tingting 婷婷, Flo, Sandy, Shelley, Grandma

Windows contributes Kangkang (male) and Huihui / Yaoyao; Android contributes Google's zh-CN set. If your saved voice isn't present on a given device, it falls back to another of the same gender rather than erroring.

More voices on iPhone: **Settings → Accessibility → Spoken Content → Voices → Chinese**.

## Reading surface

Summaries render from the model's own token array, never a raw string, which is what makes both features below fall out for free:

- **Pinyin**, tri-state: off → ruby (above each word) → line (beneath). Annotation space is reserved on the line box up front, so toggling causes **zero layout shift**.
- **Tap any word** for pinyin, gloss, HSK badge, audio, stroke order, and save-to-wordbank. Lookup order is model gloss → CC-CEDICT → pinyin reading.

`Intl.Segmenter` handles segmentation locally as a fallback, but it isn't perfect — it splits 图书馆 into 图书 + 馆 — so the model is asked for tokens and the result is checked against an invariant: concatenating every token must reproduce the sentence exactly. When it doesn't, the app re-segments locally.

## Extras

- **Share as image** — renders the summary to a poster in the app's own type and palette, then shares it (`navigator.share`) or downloads it. Drawn on a canvas rather than screenshotting the DOM, so the output doesn't depend on scroll position or which pinyin mode was on. No API cost.
- **Shadowing** — tap any sentence to read from there; hold it to loop that one sentence until you stop.
- **Text size** — three steps for the Chinese, from the player bar or Settings.
- **Budget in view** — a pip on the capture screen shows how many scans are left today and counts down when every key is cooling. Offline is detected and says so instead of letting the shutter fail.
- **Try a different model** — when an answer is thin or wrong, re-read the same photo with the other model family instead of re-photographing the book. Labelled with what it costs.

## Scripts

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm run dev:host` | Dev server on your LAN, for testing on a phone |
| `npm run build` | Typecheck + production build |
| `npm run test` | Vitest |
| `npm run cedict` | Rebuild the bundled dictionary |

## A note on key storage

Keys are kept in `localStorage`, lightly obfuscated with XOR + base64.

**This is not encryption.** It stops a key from sitting in plain sight in devtools or a synced storage dump, and nothing more. Anyone with access to your unlocked device can recover it. That tradeoff is deliberate — the alternative is a server that holds your keys instead, which is worse for a personal tool.

## Deploying

Not deployed yet. `.github/workflows/deploy.yml` is written and dormant; it publishes to GitHub Pages on push to `main` once a remote exists:

```bash
gh repo create booklens --public --source=. --push
gh api -X POST repos/<you>/booklens/pages -f build_type=workflow
```

`vite.config.ts` uses `base: './'`, so the same build also runs on Cloudflare Pages, Netlify, or straight off disk. The live camera needs HTTPS — all of those provide it.

On a phone: **Share → Add to Home Screen**. It launches standalone with no browser chrome.

## Credits

Dictionary data is [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict), CC BY-SA 4.0. Stroke order via [hanzi-writer](https://github.com/chanind/hanzi-writer). The reading interactions are lifted from what [Pleco](https://www.pleco.com/), [Du Chinese](https://duchinese.net/) and [Readibu](https://www.readibu.com/) already proved works.
