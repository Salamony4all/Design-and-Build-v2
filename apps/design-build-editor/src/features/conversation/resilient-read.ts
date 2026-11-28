/**
 * Asks the server to read a drawing and stays with the answer when the connection drops.
 *
 * Reading a drawing can take a minute, and the answer comes as a stream of lines, one
 * per stage. A phone drops a waiting connection when its screen sleeps, when the browser
 * goes to the background or when the network changes; the person then saw "Failed to
 * fetch" although the server went on and finished the read. The server keeps each read
 * for a few minutes (api/extraction/mupdf/extraction-runs.ts), so here the request is
 * simply sent again with the same file: the answer picks up where it stopped, and the
 * stages already handed on are not handed on twice.
 */

/** How many times the request is sent again before the person is told. */
export const MAX_RECONNECTS = 6;
/**
 * How many of those may find that the server no longer has the read and starts it
 * over. A read that is lost again and again is not a matter of the connection alone.
 */
export const MAX_RESTARTS = 3;
/** A stream that sends nothing for this long is taken to be dead (the server speaks between its stages). */
export const STALL_MS = 90_000;
/** A request that has no answer at all after this long is sent again (uploads on slow lines take time). */
export const NO_ANSWER_MS = 150_000;

export const CONNECTION_LOST =
  'The connection dropped while the drawing was being read, and reconnecting did not help. Check your connection, keep this page open and try again.';

/** A failure worded for the person: shown as it is. */
export class DrawingReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrawingReadError';
  }
}

/** The answer stopped, or never came, without the server saying the read was over. */
export class ConnectionDroppedError extends Error {
  constructor(message = 'The answer stopped before the end.') {
    super(message);
    this.name = 'ConnectionDroppedError';
  }
}

const isAbort = (e: unknown) => !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError';

/**
 * True for a request that got no answer or lost it on the way. False for a cancel and
 * for anything else: an answer that says no is not a dropped connection.
 */
export function isConnectionDrop(e: unknown): boolean {
  if (!e || typeof e !== 'object' || isAbort(e)) return false;
  const name = (e as { name?: unknown }).name;
  if (name === 'ConnectionDroppedError') return true;
  // fetch() and a response body both fail with a TypeError when the network does:
  // "Failed to fetch" and "network error" (Chrome), "Load failed" (Safari),
  // "NetworkError when attempting to fetch resource." (Firefox).
  return e instanceof TypeError || name === 'TypeError' || name === 'NetworkError';
}

/** The pause before asking again: short at first, longer each time. */
export function reconnectDelayMs(attempt: number): number {
  const steps = [600, 1500, 3000, 5000, 8000];
  return steps[Math.max(0, Math.min(Math.floor(attempt) || 0, steps.length - 1))]!;
}

function abortError(): Error {
  if (typeof DOMException === 'function') return new DOMException('The operation was aborted.', 'AbortError');
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}

/** What the page and the network say; replaced in tests. */
export interface ReconnectEnv {
  isVisible(): boolean;
  isOnline(): boolean;
  /** Calls back whenever either may have changed; returns how to stop listening. */
  onChange(callback: () => void): () => void;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export function browserEnv(): ReconnectEnv {
  return {
    isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    onChange: (callback) => {
      if (typeof window === 'undefined') return () => {};
      const events = ['online', 'focus', 'pageshow'] as const;
      document.addEventListener('visibilitychange', callback);
      for (const ev of events) window.addEventListener(ev, callback);
      return () => {
        document.removeEventListener('visibilitychange', callback);
        for (const ev of events) window.removeEventListener(ev, callback);
      };
    },
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const onAbort = () => {
          clearTimeout(id);
          reject(abortError());
        };
        const id = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
  };
}

/**
 * Waits until asking again can work: the page is showing and the browser is online
 * (a phone that is asleep or in another app cannot reach the server), then a short
 * pause. Rejects with an AbortError when the read is cancelled meanwhile.
 */
export async function waitToReconnect(attempt: number, signal?: AbortSignal, env: ReconnectEnv = browserEnv()): Promise<void> {
  if (signal?.aborted) throw abortError();
  const ready = () => env.isVisible() && env.isOnline();
  if (!ready()) {
    await new Promise<void>((resolve, reject) => {
      const stop = () => {
        off();
        signal?.removeEventListener('abort', onAbort);
      };
      const check = () => {
        if (!ready()) return;
        stop();
        resolve();
      };
      const onAbort = () => {
        stop();
        reject(abortError());
      };
      const off = env.onChange(check);
      signal?.addEventListener('abort', onAbort, { once: true });
      check();
    });
  }
  await env.sleep(reconnectDelayMs(attempt), signal);
}

export interface DrawingReadOptions {
  /** Sends the request; called again for every reconnect. */
  request: (signal: AbortSignal) => Promise<Response>;
  /** Cancels the whole read. */
  signal?: AbortSignal;
  /** The connection dropped and the request is about to be sent again (1 for the first time). */
  onReconnecting?: (attempt: number) => void;
  /** What an answer that is not a success means, worded for the person. */
  describeFailure?: (status: number, body: unknown) => string;
  maxReconnects?: number;
  maxRestarts?: number;
  stallMs?: number;
  noAnswerMs?: number;
  wait?: (attempt: number, signal?: AbortSignal) => Promise<void>;
}

const isNdjson = (res: Response) => !!res.body && (res.headers.get('content-type') ?? '').includes('application/x-ndjson');
/** The server could not answer just now; asking again may work. */
const worthAskingAgain = (status: number) => status === 502 || status === 503 || status === 504;

/** Rejects with a ConnectionDroppedError when `work` has not settled after `ms`. */
function within<T>(work: Promise<T>, ms: number, onLate: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => {
      onLate();
      reject(new ConnectionDroppedError('Nothing arrived for too long.'));
    }, ms);
    work.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); },
    );
  });
}

/**
 * The server's answer for a drawing, with dropped connections mended.
 *
 * An answer that is not a stream of stages (an error status, or plain JSON) is returned
 * as it came. A stream is returned as one that survives a dropped connection: the
 * request is sent again, lines for stages already passed on are left out, and the
 * stream only ends when the server says the read is over. Opening and progress lines
 * ("stage-open", "stage-progress") are always passed on. When reconnecting does not
 * help, the request or the stream fails with a DrawingReadError worded for the person.
 */
export async function fetchDrawingRead(options: DrawingReadOptions): Promise<Response> {
  const maxReconnects = options.maxReconnects ?? MAX_RECONNECTS;
  const maxRestarts = options.maxRestarts ?? MAX_RESTARTS;
  const stallMs = options.stallMs ?? STALL_MS;
  const noAnswerMs = options.noAnswerMs ?? NO_ANSWER_MS;
  const wait = options.wait ?? waitToReconnect;
  const outer = options.signal;
  let reconnects = 0;
  /** Reconnects that found the read gone and started it over. */
  let restarts = 0;
  /** One attempt's own cancel switch, so that a dead attempt can be let go without cancelling the read. */
  let attempt: AbortController | null = null;
  const onOuterAbort = () => attempt?.abort();
  outer?.addEventListener('abort', onOuterAbort);
  const release = () => outer?.removeEventListener('abort', onOuterAbort);

  const ask = async (): Promise<Response> => {
    if (outer?.aborted) throw abortError();
    attempt = new AbortController();
    const mine = attempt;
    return within(options.request(mine.signal), noAnswerMs, () => mine.abort());
  };

  /** Pauses and counts one more try; throws the lasting failure when the tries are used up. */
  const beforeAskingAgain = async (cause: unknown) => {
    if (isAbort(cause) || outer?.aborted) throw abortError();
    if (!isConnectionDrop(cause)) throw cause;
    if (reconnects >= maxReconnects || restarts >= maxRestarts) throw new DrawingReadError(CONNECTION_LOST);
    reconnects++;
    options.onReconnecting?.(reconnects);
    await wait(reconnects - 1, outer);
  };

  /** A response to work with: asked again while the connection drops or the server is briefly away. */
  const answer = async (): Promise<Response> => {
    for (;;) {
      try {
        const res = await ask();
        if (!worthAskingAgain(res.status) || reconnects >= maxReconnects) return res;
        await res.body?.cancel().catch(() => {});
        throw new ConnectionDroppedError(`The server answered ${res.status}.`);
      } catch (e) {
        await beforeAskingAgain(e);
      }
    }
  };

  let first: Response;
  try {
    first = await answer();
  } catch (e) {
    release();
    throw e;
  }
  if (!first.ok || !isNdjson(first)) {
    release();
    return first;
  }

  const encoder = new TextEncoder();
  /** Stages already passed on: a read that is picked up again sends them again. */
  const passed = new Set<string>();
  let over = false;
  /** Whoever reads the answer has stopped reading it. */
  let cancelled = false;

  /** Reads the answer through, asking again where it breaks, until the server says the read is over. */
  const pump = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    let res = first;
    try {
      for (;;) {
        try {
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          const mine = attempt;
          const pickedUp = reconnects > 0;
          let text = '';
          for (;;) {
            const { done, value } = await within(reader.read(), stallMs, () => mine?.abort());
            if (done) break;
            text += decoder.decode(value, { stream: true });
            const lines = text.split('\n');
            text = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.trim()) continue;
              let type: unknown;
              let run: unknown;
              try {
                ({ type, run } = (JSON.parse(line) ?? {}) as { type?: unknown; run?: unknown });
              } catch {
                type = undefined; // not ours to judge: passed on as it is
              }
              if (type === 'stage-open') {
                // the server had lost the read (or another server answered) and reads the drawing again
                if (pickedUp && run === 'new') restarts++;
              } else if (typeof type === 'string' && type !== 'stage-progress') {
                if (passed.has(type)) continue;
                passed.add(type);
                if (type === 'stage-complete' || type === 'error') over = true;
              }
              controller.enqueue(encoder.encode(`${line}\n`));
            }
          }
          if (over) break;
          throw new ConnectionDroppedError();
        } catch (e) {
          if (over) break;
          if (cancelled) return;
          await beforeAskingAgain(e);
          res = await answer();
          if (!res.ok || !isNdjson(res)) {
            const failure = await res.json().catch(() => ({}));
            throw new DrawingReadError(options.describeFailure?.(res.status, failure) ?? `The drawing could not be read (${res.status}).`);
          }
        }
      }
      if (!cancelled) controller.close();
    } catch (e) {
      if (!cancelled) controller.error(e);
    } finally {
      release();
    }
  };

  const body = new ReadableStream<Uint8Array>({
    // Not awaited: lines are passed on as they come, and the stream ends with the read.
    start(controller) {
      void pump(controller);
    },
    cancel() {
      cancelled = true;
      attempt?.abort();
      release();
    },
  });

  return new Response(body, { status: first.status, statusText: first.statusText, headers: first.headers });
}
