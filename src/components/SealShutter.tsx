import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';

/**
 * The shutter is a 印章 — a carved name chop, not a camera circle.
 *
 * You stamp the book to read it. Everything else in the app is deliberately
 * quiet so this one gesture carries the personality, which is why the press
 * physics get this much attention.
 */
export function SealShutter({
  onPress,
  busy,
  disabled,
  label = 'Read this book',
}: {
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const reduced = useReducedMotion();
  const [bleeding, setBleeding] = useState(false);

  const handlePress = () => {
    if (disabled || busy) return;
    setBleeding(true);
    setTimeout(() => setBleeding(false), 450);
    navigator.vibrate?.(8);
    onPress();
  };

  return (
    <div className="relative flex flex-col items-center gap-2">
      <motion.div
        className="relative grid place-items-center"
        animate={reduced || disabled || busy ? undefined : { y: [0, -3, 0] }}
        transition={{ repeat: Infinity, duration: 4.5, ease: 'easeInOut' }}
      >
        {/* halo ring — spins slowly while reading */}
        <span
          aria-hidden
          className={[
            'absolute h-[104px] w-[104px] rounded-full transition-colors duration-300',
            busy
              ? 'animate-[spin_7s_linear_infinite] border border-dashed border-seal/60'
              : disabled
                ? 'border border-ink-line'
                : 'border border-paper/25',
          ].join(' ')}
        />

        <motion.button
          type="button"
          aria-label={label}
          disabled={disabled || busy}
          onClick={handlePress}
          whileTap={reduced ? undefined : { scale: 0.88 }}
          transition={{ type: 'spring', stiffness: 500, damping: 18, mass: 0.5 }}
          className={[
            'relative grid h-[78px] w-[78px] place-items-center overflow-hidden rounded-[22px]',
            'transition-all duration-150',
            disabled || busy
              ? 'bg-[color-mix(in_srgb,var(--color-seal)_35%,var(--color-ink-soft))]'
              : 'active:bg-seal-deep',
            bleeding && !reduced ? 'seal-bleed' : '',
          ].join(' ')}
          style={{
            background:
              disabled || busy
                ? undefined
                : 'linear-gradient(155deg, var(--color-seal) 15%, var(--color-seal-deep) 115%)',
            boxShadow: disabled
              ? 'none'
              : 'inset 0 -2px 0 rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.22), 0 12px 28px -10px color-mix(in srgb, var(--color-seal) 65%, transparent)',
          }}
        >
          {/* paper-fibre texture, visible for a beat under the glyph on press */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.14] mix-blend-overlay"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='60' height='60' filter='url(%23f)'/%3E%3C/svg%3E\")",
            }}
          />

          {busy ? (
            <motion.span
              aria-hidden
              className="block h-6 w-6 rounded-full border-2 border-paper/35 border-t-paper"
              animate={reduced ? undefined : { rotate: 360 }}
              transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
            />
          ) : (
            <span
              aria-hidden
              className="han relative select-none text-[36px] leading-none font-medium text-paper"
              style={{ textShadow: '0 1px 0 rgba(0,0,0,0.25), 0 4px 14px rgba(0,0,0,0.3)' }}
            >
              读
            </span>
          )}
        </motion.button>
      </motion.div>

      <span className="font-mono text-[10px] tracking-[0.22em] text-ink-mute uppercase">
        {busy ? 'reading' : 'stamp 印章'}
      </span>
    </div>
  );
}
