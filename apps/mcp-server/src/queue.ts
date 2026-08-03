/**
 * Bounded purchase queue (OT-102): one browser per purchase, strictly
 * serialized, with a short honest waiting line. Beyond the line the caller
 * gets a structured busy answer instead of a silently growing backlog of
 * headless browsers.
 *
 * (No TS parameter properties here: the test runs via node's type
 * stripping, which only accepts erasable syntax.)
 */

export class QueueFullError extends Error {
  readonly waiting: number;

  constructor(waiting: number) {
    super(`queue full: ${waiting} purchases already waiting`);
    this.name = 'QueueFullError';
    this.waiting = waiting;
  }
}

export class BoundedQueue {
  private running = 0;
  private readonly waiters: (() => void)[] = [];
  private readonly concurrency: number;
  private readonly maxWaiting: number;

  constructor(concurrency: number, maxWaiting: number) {
    this.concurrency = concurrency;
    this.maxWaiting = maxWaiting;
  }

  get depth(): number {
    return this.running + this.waiters.length;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      if (this.waiters.length >= this.maxWaiting) throw new QueueFullError(this.waiters.length);
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.waiters.shift()?.();
    }
  }
}
