import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { deleteScan, listScans, searchScans, type ShelfEntry } from '../lib/store/db';

export function Shelf({
  open,
  onClose,
  onOpenEntry,
}: {
  open: boolean;
  onClose: () => void;
  onOpenEntry: (entry: ShelfEntry) => void;
}) {
  const [entries, setEntries] = useState<ShelfEntry[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void listScans().then((e) => {
      setEntries(e);
      setLoading(false);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Search covers Chinese and English in one pass over a prebuilt blob.
    void searchScans(query).then(setEntries);
  }, [query, open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 overflow-y-auto bg-paper text-ink"
        >
          <div className="mx-auto max-w-3xl px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-16">
            <header className="mb-4 flex items-baseline justify-between">
              <h1 className="font-display text-[30px]">
                Shelf <span className="han text-[20px] text-graphite">书架</span>
              </h1>
              <button
                type="button"
                onClick={onClose}
                className="font-mono text-[11px] tracking-wide text-graphite uppercase"
              >
                done
              </button>
            </header>

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search 中文 or English…"
              className="mb-4 w-full rounded-xl border border-paper-line bg-paper px-3.5 py-2.5 text-[14px] text-ink placeholder:text-graphite/40 focus:border-seal focus:outline-none"
            />

            {loading ? null : entries.length === 0 ? (
              <div className="py-16 text-center">
                <div className="han mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl border border-paper-line text-[24px] text-graphite/50">
                  书
                </div>
                <p className="text-[14px] text-graphite">
                  {query ? 'Nothing matches that.' : 'Books you scan will collect here.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {entries.map((entry) => (
                  <ShelfCard
                    key={entry.id}
                    entry={entry}
                    onOpen={() => onOpenEntry(entry)}
                    onDelete={async () => {
                      await deleteScan(entry.id);
                      setEntries((list) => list.filter((e) => e.id !== entry.id));
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function ShelfCard({
  entry,
  onOpen,
  onDelete,
}: {
  entry: ShelfEntry;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const book = entry.result.book;

  return (
    <motion.div layout className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="w-full overflow-hidden rounded-2xl border border-paper-line bg-paper text-left transition-colors hover:border-seal/50"
      >
        {entry.thumbnail ? (
          <img src={entry.thumbnail} alt="" className="aspect-[3/4] w-full object-cover" />
        ) : (
          <div className="han grid aspect-[3/4] w-full place-items-center bg-paper-deep text-[28px] text-graphite/40">
            书
          </div>
        )}
        <div className="px-2.5 py-2">
          <p className="han truncate text-[14px] text-ink">{book?.title_zh || '未知'}</p>
          <p className="truncate text-[11px] text-graphite">{book?.title_en || ''}</p>
          <p className="mt-0.5 font-mono text-[9px] text-graphite/60">
            {new Date(entry.createdAt).toLocaleDateString()}
          </p>
        </div>
      </button>

      <button
        type="button"
        aria-label={confirming ? 'Confirm delete' : 'Delete'}
        onClick={() => {
          if (confirming) onDelete();
          else {
            setConfirming(true);
            setTimeout(() => setConfirming(false), 3000);
          }
        }}
        className={[
          'absolute top-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-full transition-all',
          confirming
            ? 'bg-seal text-paper opacity-100'
            : 'bg-ink/55 text-paper opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        ].join(' ')}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </motion.div>
  );
}
