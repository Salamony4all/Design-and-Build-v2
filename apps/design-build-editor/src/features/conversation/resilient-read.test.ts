import { describe, expect, it } from 'vitest';
import {
  CONNECTION_LOST,
  ConnectionDroppedError,
  fetchDrawingRead,
  isConnectionDrop,
  reconnectDelayMs,
  waitToReconnect,
  type ReconnectEnv,
} from './resilient-read';

const NDJSON = { 'content-type': 'application/x-ndjson; charset=utf-8' };
const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const OPEN_NEW = line({ type: 'stage-open', run: 'new' });
const OPEN_REPLAY = line({ type: 'stage-open', run: 'replay' });
const WALLS = line({ type: 'stage-walls', walls: 3 });
const WINDOWS = line({ type: 'stage-windows', windows: 2 });
const FURNITURE = line({ type: 'stage-furniture', pieces: 5 });
const COMPLETE = line({ type: 'stage-complete', ok: true });
/** What the browser raises when the network fails under a request or a response body. */
const failedToFetch = () => new TypeError('Failed to fetch');
const networkError = () => new TypeError('network error');
const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

/** A body that sends its parts in order: text, then an error (the connection breaks) or 'hang' (silence). */
function body(parts: Array<string | Error | 'hang'>, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const part = parts[i++];
      if (part === undefined) return controller.close();
      if (part === 'hang') {
        return new Promise<void>((_, reject) => {
          signal?.addEventListener('abort', () => reject(abortError()), { once: true });
        });
      }
      if (part instanceof Error) return controller.error(part);
      controller.enqueue(encoder.encode(part));
    },
  });
}

const stream = (parts: Array<string | Error | 'hang'>, signal?: AbortSignal) =>
  new Response(body(parts, signal), { status: 200, headers: NDJSON });

/** A server that answers each request with the next entry; an Error means the request itself fails. */
function server(answers: Array<((signal: AbortSignal) => Response) | Error>) {
  let calls = 0;
  const request = async (signal: AbortSignal) => {
    const next = answers[Math.min(calls, answers.length - 1)]!;
    calls++;
    if (next instanceof Error) throw next;
    return next(signal);
  };
  return { request, calls: () => calls };
}

async function readTypes(res: Response): Promise<string[]> {
  const text = await res.text();
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l).type as string);
}

const noWait = async () => {};

describe('fetchDrawingRead', () => {
  it('returns an answer that is not a stream of stages as it came', async () => {
    const tooLarge = server([() => new Response(JSON.stringify({ error: { code: '413' } }), { status: 413, headers: { 'content-type': 'application/json' } })]);
    const res = await fetchDrawingRead({ request: tooLarge.request, wait: noWait });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: { code: '413' } });
    expect(tooLarge.calls()).toBe(1);

    const plain = await fetchDrawingRead({ request: server([() => Response.json({ result: { walls: [] } })]).request, wait: noWait });
    expect(await plain.json()).toEqual({ result: { walls: [] } });
  });

  it('passes a whole stream on unchanged', async () => {
    const s = server([() => stream([OPEN_NEW, WALLS, WINDOWS + FURNITURE, COMPLETE])]);
    const res = await fetchDrawingRead({ request: s.request, wait: noWait });
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    expect(await readTypes(res)).toEqual(['stage-open', 'stage-walls', 'stage-windows', 'stage-furniture', 'stage-complete']);
    expect(s.calls()).toBe(1);
  });

  it('asks again when the request itself fails, as on a phone that dropped the connection while waiting', async () => {
    const waits: number[] = [];
    const reconnecting: number[] = [];
    const s = server([failedToFetch(), () => stream([OPEN_REPLAY, WALLS, FURNITURE, COMPLETE])]);
    const res = await fetchDrawingRead({
      request: s.request,
      wait: async (attempt) => { waits.push(attempt); },
      onReconnecting: (n) => reconnecting.push(n),
    });
    expect(await readTypes(res)).toEqual(['stage-open', 'stage-walls', 'stage-furniture', 'stage-complete']);
    expect(s.calls()).toBe(2);
    expect(waits).toEqual([0]);
    expect(reconnecting).toEqual([1]);
  });

  it('picks a broken stream up again without handing a stage on twice', async () => {
    const s = server([
      () => stream([OPEN_NEW, WALLS, networkError()]), // dropped after the walls
      () => stream([OPEN_REPLAY, WALLS, WINDOWS, FURNITURE, COMPLETE]), // the kept read, from its start
    ]);
    const res = await fetchDrawingRead({ request: s.request, wait: noWait });
    expect(await readTypes(res)).toEqual(['stage-open', 'stage-walls', 'stage-open', 'stage-windows', 'stage-furniture', 'stage-complete']);
    expect(s.calls()).toBe(2);
  });

  it('drops the half line a broken connection left behind', async () => {
    const s = server([
      () => stream([OPEN_NEW, WALLS.slice(0, 12), networkError()]),
      () => stream([OPEN_REPLAY, WALLS, COMPLETE]),
    ]);
    const res = await fetchDrawingRead({ request: s.request, wait: noWait });
    const lines = (await res.text()).split('\n').filter(Boolean);
    expect(lines.map((l) => JSON.parse(l).type)).toEqual(['stage-open', 'stage-open', 'stage-walls', 'stage-complete']);
  });

  it('takes a stream that ends without saying so for a dropped one', async () => {
    const s = server([() => stream([OPEN_NEW, WALLS]), () => stream([OPEN_REPLAY, WALLS, COMPLETE])]);
    const res = await fetchDrawingRead({ request: s.request, wait: noWait });
    expect(await readTypes(res)).toEqual(['stage-open', 'stage-walls', 'stage-open', 'stage-complete']);
  });

  it('lets a silent stream go and asks again', async () => {
    const s = server([(signal) => stream([OPEN_NEW, 'hang'], signal), () => stream([OPEN_REPLAY, WALLS, COMPLETE])]);
    const res = await fetchDrawingRead({ request: s.request, wait: noWait, stallMs: 20 });
    expect(await readTypes(res)).toEqual(['stage-open', 'stage-open', 'stage-walls', 'stage-complete']);
    expect(s.calls()).toBe(2);
  });

  it('asks again while the server is briefly away', async () => {
    const s = server([() => new Response('', { status: 503 }), () => stream([OPEN_NEW, WALLS, COMPLETE])]);
    const res = await fetchDrawingRead({ request: s.request, wait: noWait });
    expect(res.status).toBe(200);
    expect(await readTypes(res)).toEqual(['stage-open', 'stage-walls', 'stage-complete']);
  });

  it('ends on an error line from the server without asking again', async () => {
    const s = server([() => stream([OPEN_NEW, line({ type: 'error', error: 'No building region / walls detected in document.' })])]);
    const res = await fetchDrawingRead({ request: s.request, wait: noWait });
    expect(await readTypes(res)).toEqual(['stage-open', 'error']);
    expect(s.calls()).toBe(1);
  });

  it('tells the person when asking again does not help: before any answer', async () => {
    const s = server([failedToFetch()]);
    await expect(fetchDrawingRead({ request: s.request, wait: noWait, maxReconnects: 3 })).rejects.toMatchObject({
      name: 'DrawingReadError',
      message: CONNECTION_LOST,
    });
    expect(s.calls()).toBe(4); // the first request and three more
  });

  it('tells the person when asking again does not help: in the middle of the answer', async () => {
    const s = server([() => stream([OPEN_NEW, WALLS, networkError()]), failedToFetch()]);
    const res = await fetchDrawingRead({ request: s.request, wait: noWait, maxReconnects: 2 });
    await expect(res.text()).rejects.toMatchObject({ name: 'DrawingReadError', message: CONNECTION_LOST });
    expect(s.calls()).toBe(3);
  });

  it('stops when the read keeps starting over', async () => {
    const s = server([() => stream([OPEN_NEW, networkError()])]); // every server reads from scratch, every answer breaks
    const res = await fetchDrawingRead({ request: s.request, wait: noWait, maxReconnects: 10, maxRestarts: 2 });
    await expect(res.text()).rejects.toMatchObject({ name: 'DrawingReadError' });
    expect(s.calls()).toBe(3); // the first read and two that started over
  });

  it('says what a later answer said when it is not a success', async () => {
    const s = server([
      () => stream([OPEN_NEW, networkError()]),
      () => new Response(JSON.stringify({ error: 'PDF exceeds 26214400 bytes.' }), { status: 413, headers: { 'content-type': 'application/json' } }),
    ]);
    const res = await fetchDrawingRead({
      request: s.request,
      wait: noWait,
      describeFailure: (status, b) => `${status}: ${(b as { error: string }).error}`,
    });
    await expect(res.text()).rejects.toMatchObject({ name: 'DrawingReadError', message: '413: PDF exceeds 26214400 bytes.' });
  });

  it('does not ask again after a cancel', async () => {
    const ac = new AbortController();
    const s = server([(signal) => stream([OPEN_NEW, 'hang'], signal)]);
    const res = await fetchDrawingRead({ request: s.request, signal: ac.signal, wait: noWait });
    const text = res.text();
    ac.abort();
    await expect(text).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.calls()).toBe(1);

    const cancelledEarly = new AbortController();
    cancelledEarly.abort();
    await expect(fetchDrawingRead({ request: s.request, signal: cancelledEarly.signal, wait: noWait })).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.calls()).toBe(1);
  });

  it('does not ask again for a failure that is not the connection', async () => {
    const s = server([new RangeError('bad request body')]);
    await expect(fetchDrawingRead({ request: s.request, wait: noWait })).rejects.toBeInstanceOf(RangeError);
    expect(s.calls()).toBe(1);
  });
});

describe('isConnectionDrop', () => {
  it('knows a dropped connection from a cancel and from other failures', () => {
    expect(isConnectionDrop(failedToFetch())).toBe(true); // Chrome, the request
    expect(isConnectionDrop(networkError())).toBe(true); // Chrome, the response body
    expect(isConnectionDrop(new TypeError('Load failed'))).toBe(true); // Safari
    expect(isConnectionDrop(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true); // Firefox
    expect(isConnectionDrop(new ConnectionDroppedError())).toBe(true);
    expect(isConnectionDrop(abortError())).toBe(false);
    expect(isConnectionDrop(new Error('Extraction failed (500).'))).toBe(false);
    expect(isConnectionDrop(new SyntaxError('Unexpected token'))).toBe(false);
    for (const v of [null, undefined, 'Failed to fetch', 0]) expect(isConnectionDrop(v)).toBe(false);
  });
});

describe('waitToReconnect', () => {
  function fakeEnv(state: { visible: boolean; online: boolean }) {
    const listeners = new Set<() => void>();
    const slept: number[] = [];
    const env: ReconnectEnv = {
      isVisible: () => state.visible,
      isOnline: () => state.online,
      onChange: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
      sleep: async (ms) => { slept.push(ms); },
    };
    return { env, slept, listeners, change: () => { for (const cb of [...listeners]) cb(); } };
  }

  it('pauses a little longer each time, within bounds', () => {
    const delays = [0, 1, 2, 3, 4, 5, 20].map(reconnectDelayMs);
    expect(delays[0]).toBeLessThan(1000);
    for (let i = 1; i < delays.length; i++) expect(delays[i]!).toBeGreaterThanOrEqual(delays[i - 1]!);
    expect(Math.max(...delays)).toBeLessThanOrEqual(8000);
    expect(reconnectDelayMs(-3)).toBe(delays[0]);
    expect(reconnectDelayMs(Number.NaN)).toBe(delays[0]);
  });

  it('only pauses when the page is showing and online', async () => {
    const f = fakeEnv({ visible: true, online: true });
    await waitToReconnect(1, undefined, f.env);
    expect(f.slept).toEqual([reconnectDelayMs(1)]);
    expect(f.listeners.size).toBe(0);
  });

  it('waits for the phone to wake and for the network to return before asking again', async () => {
    const state = { visible: false, online: false };
    const f = fakeEnv(state);
    let done = false;
    const waiting = waitToReconnect(0, undefined, f.env).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    state.visible = true; // the screen is back on, still no network
    f.change();
    await Promise.resolve();
    expect(done).toBe(false);
    expect(f.slept).toEqual([]);
    state.online = true;
    f.change();
    await waiting;
    expect(done).toBe(true);
    expect(f.slept).toEqual([reconnectDelayMs(0)]);
    expect(f.listeners.size).toBe(0);
  });

  it('stops waiting when the read is cancelled', async () => {
    const f = fakeEnv({ visible: false, online: true });
    const ac = new AbortController();
    const waiting = waitToReconnect(0, ac.signal, f.env);
    ac.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.listeners.size).toBe(0);
    await expect(waitToReconnect(0, ac.signal, f.env)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('fetchDrawingRead: a reader that stops', () => {
  it('passes lines on as they come, and does not ask again once nobody is reading', async () => {
    const s = server([(signal) => stream([OPEN_NEW, WALLS, 'hang'], signal)]);
    const res = await fetchDrawingRead({ request: s.request, wait: noWait });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    // the walls can be read while the answer is still open
    let text = '';
    while (!text.includes('stage-walls')) text += decoder.decode((await reader.read()).value, { stream: true });
    expect(text.split('\n').filter(Boolean).map((l) => JSON.parse(l).type)).toEqual(['stage-open', 'stage-walls']);
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(s.calls()).toBe(1);
  });
});
