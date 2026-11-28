// apps/design-build-editor/src/app/api/extraction/mupdf/extraction-runs.ts
//
// One read of a drawing, kept while it runs and for a few minutes afterwards.
//
// A drawing can take a minute to read, and the answer is streamed over a single
// connection. A phone drops that connection when its screen sleeps, when the browser
// goes to the background or when the network changes. The read itself is not lost: it
// goes on here to its end, and a request that arrives with the same file picks it up,
// the lines read so far first, instead of starting again.
//
// Reads are kept in this server instance's memory only. A request that lands on
// another instance reads the drawing again, which is what every request did before.

import { createHash } from 'node:crypto';

/** new: this request started the read. joined: it was already running. replay: it had finished. */
export type RunState = 'new' | 'joined' | 'replay';

export interface ExtractionRun {
  readonly key: string;
  readonly startedAt: number;
  /** The lines sent so far, each a JSON value followed by a newline. */
  readonly lines: string[];
  /** Characters held in `lines`. */
  size: number;
  /** null while the drawing is being read; afterwards, whether it ended with a model. */
  ok: boolean | null;
  finishedAt: number | null;
  /** Settles when the read is over, whatever its result. It never rejects. */
  readonly finished: Promise<void>;
  /** Streams following the read; each is told every new line, then null at the end. */
  readonly listeners: Set<(line: string | null) => void>;
}

/** Sends one stage of the answer to everyone following the read, and records it. */
export type Emit = (chunk: unknown) => Promise<void>;
/** Reads the drawing, stage by stage. Resolves true when it ended with a model. */
export type Produce = (emit: Emit) => Promise<boolean>;

export interface RunStoreOptions {
  /** How long a finished read is kept (ms). */
  keepMs?: number;
  /** How many finished reads are kept. */
  maxFinished?: number;
  /** Characters of finished reads kept in all. */
  maxChars?: number;
  now?: () => number;
  /** Starts the read; by default a moment later, once the first line of the answer can be on its way. */
  defer?: (start: () => void) => void;
  /** Lets waiting output and waiting requests through between two stages of a read. */
  breathe?: () => Promise<void>;
}

export interface ExtractionRunStore {
  /** The read of this file: the one running or kept, else a new one that `produce` fills. */
  open(key: string, produce: Produce): { run: ExtractionRun; state: RunState };
  get(key: string): ExtractionRun | undefined;
  /** Reads held now, running ones included. */
  count(): number;
}

/** The same file gives the same key; nothing else about the request counts. */
export function extractionKey(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createExtractionRunStore(options: RunStoreOptions = {}): ExtractionRunStore {
  const keepMs = options.keepMs ?? 10 * 60_000;
  const maxFinished = options.maxFinished ?? 3;
  const maxChars = options.maxChars ?? 24_000_000;
  const now = options.now ?? Date.now;
  const defer = options.defer ?? ((start: () => void) => { setTimeout(start, 30); });
  const breathe = options.breathe ?? (() => new Promise<void>((resolve) => { setImmediate(resolve); }));
  // insertion order is start order, so reads are listed oldest first
  const runs = new Map<string, ExtractionRun>();

  /**
   * Drops finished reads that are too old, too many or too large together. A running
   * read is never dropped, and the newest finished one always stays: it is the one a
   * client is most likely to come back for.
   */
  const prune = () => {
    const t = now();
    for (const [key, run] of runs) {
      if (run.finishedAt !== null && t - run.finishedAt > keepMs) runs.delete(key);
    }
    const kept = [...runs.values()].filter((r) => r.finishedAt !== null);
    let chars = kept.reduce((n, r) => n + r.size, 0);
    while (kept.length > 1 && (kept.length > maxFinished || chars > maxChars)) {
      const oldest = kept.shift()!;
      chars -= oldest.size;
      runs.delete(oldest.key);
    }
  };

  const tell = (run: ExtractionRun, line: string | null) => {
    for (const listener of [...run.listeners]) {
      try {
        listener(line);
      } catch {
        run.listeners.delete(listener); // that client has gone; the read goes on
      }
    }
  };

  return {
    open(key, produce) {
      prune();
      const existing = runs.get(key);
      if (existing) return { run: existing, state: existing.finishedAt === null ? 'joined' : 'replay' };

      let settle!: () => void;
      const run: ExtractionRun = {
        key,
        startedAt: now(),
        lines: [],
        size: 0,
        ok: null,
        finishedAt: null,
        finished: new Promise<void>((resolve) => { settle = resolve; }),
        listeners: new Set(),
      };
      runs.set(key, run);

      const emit: Emit = async (chunk) => {
        const line = `${JSON.stringify(chunk)}\n`;
        run.lines.push(line);
        run.size += line.length;
        tell(run, line);
        await breathe();
      };

      defer(() => {
        void (async () => {
          let ok = false;
          try {
            ok = (await produce(emit)) === true;
          } catch (e) {
            try {
              await emit({ type: 'error', error: e instanceof Error ? e.message : String(e) });
            } catch {
              /* nothing more can be said */
            }
          }
          run.ok = ok;
          run.finishedAt = now();
          tell(run, null);
          run.listeners.clear();
          // A read that failed is not kept: the next request reads the drawing again.
          if (!ok) runs.delete(key);
          else prune();
          settle();
        })();
      });
      return { run, state: 'new' };
    },
    get: (key) => runs.get(key),
    count: () => runs.size,
  };
}

/**
 * The read as a response body: `opening` first, then every line read so far, then each
 * new line as it comes. A client that goes away only stops listening; the read goes on.
 */
export function streamRun(run: ExtractionRun, opening: Record<string, unknown>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let listener: ((line: string | null) => void) | null = null;
  const leave = () => {
    if (listener) run.listeners.delete(listener);
    listener = null;
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${JSON.stringify(opening)}\n`));
      for (const line of run.lines) controller.enqueue(encoder.encode(line));
      if (run.finishedAt !== null) {
        controller.close();
        return;
      }
      listener = (line) => {
        try {
          if (line === null) controller.close();
          else controller.enqueue(encoder.encode(line));
        } catch {
          leave(); // the stream was closed from the other side
        }
      };
      run.listeners.add(listener);
    },
    cancel() {
      leave();
    },
  });
}
