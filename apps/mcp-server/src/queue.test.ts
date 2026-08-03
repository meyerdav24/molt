/** OT-102 AC: the purchase queue degrades gracefully, never silently grows. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoundedQueue, QueueFullError } from './queue.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('serializes work at the configured concurrency', async () => {
  const q = new BoundedQueue(1, 10);
  let running = 0;
  let peak = 0;
  const job = async () => {
    running++;
    peak = Math.max(peak, running);
    await sleep(10);
    running--;
  };
  await Promise.all([q.run(job), q.run(job), q.run(job)]);
  assert.equal(peak, 1);
});

test('refuses beyond the waiting line with a structured error', async () => {
  const q = new BoundedQueue(1, 1);
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const first = q.run(() => gate); // occupies the slot
  const second = q.run(async () => 'ok'); // fills the line
  await assert.rejects(
    q.run(async () => 'never'),
    QueueFullError,
  );
  assert.equal(q.depth, 2);
  release();
  await first;
  assert.equal(await second, 'ok');
  assert.equal(q.depth, 0);
});

test('a throwing job frees the slot', async () => {
  const q = new BoundedQueue(1, 1);
  await assert.rejects(
    q.run(async () => {
      throw new Error('boom');
    }),
  );
  assert.equal(await q.run(async () => 42), 42);
});
