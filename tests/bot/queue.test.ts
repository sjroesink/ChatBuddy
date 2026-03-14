import { describe, it, expect } from 'vitest';
import { MessageQueue } from '../../src/bot/queue.js';

describe('MessageQueue', () => {
  it('processes messages sequentially per chat (FIFO order)', async () => {
    const queue = new MessageQueue();
    const order: number[] = [];

    const t1 = queue.enqueue(1, async () => {
      await new Promise(r => setTimeout(r, 20));
      order.push(1);
    });
    const t2 = queue.enqueue(1, async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push(2);
    });
    const t3 = queue.enqueue(1, async () => {
      order.push(3);
    });

    await Promise.all([t1, t2, t3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('processes different chats in parallel', async () => {
    const queue = new MessageQueue();
    const startTimes: Record<number, number> = {};

    const t1 = queue.enqueue(1, async () => {
      startTimes[1] = Date.now();
      await new Promise(r => setTimeout(r, 50));
    });
    const t2 = queue.enqueue(2, async () => {
      startTimes[2] = Date.now();
      await new Promise(r => setTimeout(r, 50));
    });
    const t3 = queue.enqueue(3, async () => {
      startTimes[3] = Date.now();
      await new Promise(r => setTimeout(r, 50));
    });

    await Promise.all([t1, t2, t3]);

    // All three should have started at roughly the same time (within 30ms of each other)
    const times = Object.values(startTimes);
    const spread = Math.max(...times) - Math.min(...times);
    expect(spread).toBeLessThan(30);
  });

  it('continues processing after an error', async () => {
    const queue = new MessageQueue();
    const results: string[] = [];

    const t1 = queue.enqueue(1, async () => {
      throw new Error('intentional failure');
    });

    const t2 = queue.enqueue(1, async () => {
      results.push('after error');
    });

    // t1 should reject
    await expect(t1).rejects.toThrow('intentional failure');
    // t2 should still complete
    await t2;
    expect(results).toEqual(['after error']);
  });

  it('rejects with timeout error for long-running tasks', async () => {
    const queue = new MessageQueue(100); // 100ms timeout

    const task = queue.enqueue(1, async () => {
      await new Promise(r => setTimeout(r, 500)); // longer than timeout
    });

    await expect(task).rejects.toThrow('LLM timeout: antwoord duurde te lang');
  });
});
