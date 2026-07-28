import type { ScanResult } from '../lib/vision/schema';

export function BookHeader({
  result,
  thumbnail,
  modelLabel,
}: {
  result: ScanResult;
  thumbnail?: string;
  modelLabel: string;
}) {
  const book = result.book;
  const confident = result.confidence >= 0.65;

  return (
    <header className="flex gap-3.5">
      {thumbnail ? (
        <img
          src={thumbnail}
          alt=""
          className="h-[92px] w-[68px] shrink-0 rounded-lg border border-paper-line object-cover"
        />
      ) : null}

      <div className="min-w-0 flex-1">
        <h1 className="han text-[23px] leading-tight font-medium text-balance text-ink">
          {book?.title_zh || '未知书名'}
        </h1>

        {book?.title_pinyin ? (
          <p className="mt-0.5 font-mono text-[11px] text-seal">{book.title_pinyin}</p>
        ) : null}

        {book?.title_en ? (
          <p className="font-display mt-0.5 text-[16px] text-graphite italic">{book.title_en}</p>
        ) : null}

        {book?.author_zh || book?.author_en ? (
          <p className="mt-1 text-[13px] text-graphite">
            {[book.author_zh, book.author_en].filter(Boolean).join(' · ')}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            className={[
              'rounded-full px-2 py-0.5 font-mono text-[9.5px] tracking-wide',
              confident
                ? 'bg-jade/15 text-[color-mix(in_srgb,var(--color-jade)_65%,var(--color-ink))]'
                : 'bg-amber/18 text-[color-mix(in_srgb,var(--color-amber)_70%,var(--color-ink))]',
            ].join(' ')}
          >
            {confident ? 'confident' : 'uncertain'} · {Math.round(result.confidence * 100)}%
          </span>

          {book?.genre.slice(0, 3).map((g) => (
            <span
              key={g}
              className="han rounded-full bg-paper-deep px-2 py-0.5 text-[10.5px] text-graphite"
            >
              {g}
            </span>
          ))}

          {book?.year ? (
            <span className="rounded-full bg-paper-deep px-2 py-0.5 font-mono text-[10px] text-graphite">
              {book.year}
            </span>
          ) : null}
        </div>

        {/* Naming the model turns the fallback chain into something visible. */}
        <p className="mt-1.5 font-mono text-[9.5px] tracking-wide text-graphite/60">
          via {modelLabel} · free
        </p>
      </div>
    </header>
  );
}
