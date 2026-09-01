interface TypewriterOptions {
  /** Base characters revealed per tick (actual amount jitters around this). */
  charsPerTick?: number;
  /** Base milliseconds between ticks (actual delay jitters around this). */
  intervalMs?: number;
  onReveal: (chunk: string) => void;
}

const PUNCTUATION_PAUSE_MS = 140;
const PAUSE_CHARS = new Set(['.', ',', '!', '?', '\n', ':', ';']);

function jitter(base: number, spread: number) {
  return Math.max(1, Math.round(base + (Math.random() * 2 - 1) * spread));
}

/**
 * Paces out incoming text at a readable rate, independent of how fast or
 * bursty the underlying network chunks actually arrive - a short agent reply
 * can otherwise finish streaming in well under a second, which reads as "not
 * streaming at all" even though the backend genuinely sent it incrementally.
 *
 * Chunk size and delay jitter a little on every tick, and punctuation gets a
 * brief extra pause - a perfectly uniform reveal rate reads as mechanical;
 * real typing (and most token-by-token LLM output) has this kind of small
 * irregular rhythm.
 */
export function createTypewriter({
  charsPerTick = 2,
  intervalMs = 20,
  onReveal,
}: TypewriterOptions) {
  let pending = '';
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveFinish: (() => void) | null = null;

  const tick = () => {
    timer = null;
    if (pending.length > 0) {
      const n = Math.min(jitter(charsPerTick, Math.ceil(charsPerTick / 2)), pending.length);
      const revealed = pending.slice(0, n);
      onReveal(revealed);
      pending = pending.slice(n);

      const lastChar = revealed.at(-1);
      const delay = jitter(intervalMs, Math.round(intervalMs / 3));
      const pause = lastChar && PAUSE_CHARS.has(lastChar) ? PUNCTUATION_PAUSE_MS : 0;
      timer = setTimeout(tick, delay + pause);
      return;
    }
    if (ended) {
      resolveFinish?.();
      return;
    }
    timer = setTimeout(tick, intervalMs);
  };

  return {
    /** Queue more text to be revealed gradually. */
    push(text: string) {
      if (!text) return;
      pending += text;
      if (!timer) timer = setTimeout(tick, intervalMs);
    },
    /** Signals no more text is coming; resolves once everything queued has been revealed. */
    finish(): Promise<void> {
      ended = true;
      if (pending.length === 0 && !timer) return Promise.resolve();
      return new Promise(resolve => {
        resolveFinish = resolve;
      });
    },
    /** Reveals whatever is left immediately, skipping the animation (e.g. on error/abort). */
    stop() {
      ended = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = '';
    },
  };
}
