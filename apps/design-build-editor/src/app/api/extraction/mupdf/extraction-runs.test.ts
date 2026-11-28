import { describe, expect, it } from 'vitest';
import { createExtractionRunStore, extractionKey, streamRun, type Emit } from './extraction-runs';

const OPEN = { type: 'stage-open' };

/** A promise the test settles itself. */
function gate() {
  let open!: () => void;
  const passed = new Promise<void>((resolve) => { open = resolve; });
  return { open, passed };
}

/** Everything a stream sends until it closes, as parsed lines. */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Array<Record<string, unknown>>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/** The next line of a stream that is still open. */
async function readLine(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Record<string, unknown>> {
  const { value } = await reader.read();
  return JSON.parse(new TextDecoder().decode(value));
}

const types = (lines: Array<Record<string, unknown>>) => lines.map((l) => l.type);

/** A read in three stages; the test lets each stage through. */
function stagedRead() {
  const walls = gate();
  const rest = gate();
  let calls = 0;
  const produce = async (emit: Emit) => {
    calls++;
    await walls.passed;
    await emit({ type: 'stage-walls', walls: 3 });
    await rest.passed;
    await emit({ type: 'stage-furniture', pieces: 2 });
    await emit({ type: 'stage-complete', ok: true });
    return true;
  };
  return { produce, walls, rest, calls: () => calls };
}

describe('extraction runs', () => {
  it('gives the same file the same key', () => {
    const a = new Uint8Array([37, 80, 68, 70, 1, 2, 3]);
    expect(extractionKey(a)).toBe(extractionKey(new Uint8Array([37, 80, 68, 70, 1, 2, 3])));
    expect(extractionKey(a)).not.toBe(extractionKey(new Uint8Array([37, 80, 68, 70, 1, 2, 4])));
    expect(extractionKey(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('answers before the read starts, then sends each stage and closes', async () => {
    let start: (() => void) | null = null;
    const store = createExtractionRunStore({ defer: (fn) => { start = fn; } });
    const read = stagedRead();
    const { run, state } = store.open('k', read.produce);
    expect(state).toBe('new');

    // The first line can be read while the drawing has not been touched yet.
    const reader = streamRun(run, { ...OPEN, run: state }).getReader();
    expect(await readLine(reader)).toEqual({ type: 'stage-open', run: 'new' });
    expect(read.calls()).toBe(0);

    start!();
    read.walls.open();
    expect(await readLine(reader)).toEqual({ type: 'stage-walls', walls: 3 });
    read.rest.open();
    expect((await readLine(reader)).type).toBe('stage-furniture');
    expect((await readLine(reader)).type).toBe('stage-complete');
    expect((await reader.read()).done).toBe(true);

    await run.finished;
    expect(run.ok).toBe(true);
    expect(run.listeners.size).toBe(0);
  });

  it('goes on reading when the client has gone, and hands the finished read to the request that comes back', async () => {
    const store = createExtractionRunStore({ defer: (fn) => fn() });
    const read = stagedRead();
    const first = store.open('k', read.produce);
    const reader = streamRun(first.run, OPEN).getReader();
    await readLine(reader);
    await reader.cancel(); // the phone dropped the connection during the long first stage
    expect(first.run.listeners.size).toBe(0);

    read.walls.open();
    read.rest.open();
    await first.run.finished;
    expect(first.run.ok).toBe(true);

    const again = store.open('k', read.produce);
    expect(again.state).toBe('replay');
    expect(again.run).toBe(first.run);
    expect(read.calls()).toBe(1); // the drawing was read once
    expect(types(await readAll(streamRun(again.run, { ...OPEN, run: again.state })))).toEqual([
      'stage-open', 'stage-walls', 'stage-furniture', 'stage-complete',
    ]);
  });

  it('lets a request that comes back early join the read in progress', async () => {
    const store = createExtractionRunStore({ defer: (fn) => fn() });
    const read = stagedRead();
    const first = store.open('k', read.produce);
    const gone = streamRun(first.run, OPEN).getReader();
    await gone.cancel();
    read.walls.open();
    await new Promise((resolve) => setTimeout(resolve, 5)); // the walls are read meanwhile

    const back = store.open('k', read.produce);
    expect(back.state).toBe('joined');
    const lines = readAll(streamRun(back.run, { ...OPEN, run: back.state }));
    read.rest.open();
    expect(types(await lines)).toEqual(['stage-open', 'stage-walls', 'stage-furniture', 'stage-complete']);
    expect(read.calls()).toBe(1);
  });

  it('sends every follower the same lines', async () => {
    const store = createExtractionRunStore({ defer: (fn) => fn() });
    const read = stagedRead();
    const { run } = store.open('k', read.produce);
    const a = readAll(streamRun(run, OPEN));
    const b = readAll(streamRun(store.open('k', read.produce).run, OPEN));
    read.walls.open();
    read.rest.open();
    expect(await a).toEqual(await b);
    expect((await a).length).toBe(4);
  });

  it('does not keep a read that failed', async () => {
    const store = createExtractionRunStore({ defer: (fn) => fn() });
    let calls = 0;
    const noWalls = async (emit: Emit) => {
      calls++;
      await emit({ type: 'error', error: 'No building region / walls detected in document.' });
      return false;
    };
    const first = store.open('k', noWalls);
    expect(types(await readAll(streamRun(first.run, OPEN)))).toEqual(['stage-open', 'error']);
    await first.run.finished;
    expect(first.run.ok).toBe(false);
    expect(store.get('k')).toBeUndefined();
    expect(calls).toBe(1);
    expect(store.open('k', noWalls).state).toBe('new');
    expect(calls).toBe(2); // the drawing is read again
  });

  it('reports a read that throws as an error line and does not keep it', async () => {
    const store = createExtractionRunStore({ defer: (fn) => fn() });
    const { run } = store.open('k', async (emit) => {
      await emit({ type: 'stage-walls' });
      throw new Error('out of memory');
    });
    const lines = await readAll(streamRun(run, OPEN));
    expect(lines.at(-1)).toEqual({ type: 'error', error: 'out of memory' });
    await run.finished;
    expect(run.ok).toBe(false);
    expect(store.count()).toBe(0);
  });

  it('keeps few finished reads, for a short time, and never drops one that is running', async () => {
    let t = 1_000;
    const store = createExtractionRunStore({ defer: (fn) => fn(), now: () => t, keepMs: 60_000, maxFinished: 2 });
    const done = async (emit: Emit) => { await emit({ type: 'stage-complete' }); return true; };
    const running = stagedRead();
    const slow = store.open('slow', running.produce);

    for (const key of ['a', 'b', 'c']) {
      t += 1_000;
      await store.open(key, done).run.finished;
    }
    expect(store.get('a')).toBeUndefined(); // the oldest finished read made room
    expect(store.get('b')).toBeDefined();
    expect(store.get('c')).toBeDefined();
    expect(store.get('slow')).toBe(slow.run);

    t += 61_000;
    expect(store.open('b', done).state).toBe('new'); // kept too long: read again
    expect(store.get('c')).toBeUndefined();
    expect(store.get('slow')).toBe(slow.run);
    running.walls.open();
    running.rest.open();
    await slow.run.finished;
    expect(store.open('slow', running.produce).state).toBe('replay');
  });

  it('keeps the newest finished read even when it is larger than the limit', async () => {
    const store = createExtractionRunStore({ defer: (fn) => fn(), maxChars: 50 });
    const big = async (emit: Emit) => { await emit({ type: 'stage-walls', data: 'x'.repeat(200) }); return true; };
    await store.open('first', big).run.finished;
    await store.open('second', big).run.finished;
    expect(store.get('first')).toBeUndefined();
    expect(store.open('second', big).state).toBe('replay');
  });
});
