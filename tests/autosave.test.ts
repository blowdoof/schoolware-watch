import { describe, expect, it } from 'vitest';
import { AutosaveQueue } from '../src/ui/autosave';

describe('automatic setting saves', () => {
  it('keeps rapid edits in order while a permission prompt is still pending', async () => {
    const queue = new AutosaveQueue();
    let grant!: () => void;
    const permission = new Promise<void>((resolve) => { grant = resolve; });
    let saved = { notifications: false, days: 3, color: '#15803d' };
    const first = { ...saved, notifications: true };
    const second = { ...first, days: 5 };
    const latest = { ...second, color: '#123456' };
    const writes: typeof saved[] = [];
    const edit = (value: typeof saved) => queue.enqueue(async () => {
      await permission;
      saved = value; writes.push(saved);
    });
    const pending = [edit(first), edit(second), edit(latest)];
    await Promise.resolve();
    expect(writes).toEqual([]);
    grant();
    await Promise.all(pending);
    expect(writes).toEqual([first, second, latest]);
    expect(saved).toEqual(latest);
  });

  it('allows a corrected edit to save after a denied or failed change', async () => {
    const queue = new AutosaveQueue();
    const denied = queue.enqueue(async () => { throw new Error('Synthetic permission denial'); });
    const corrected = queue.enqueue(async () => ({ notifications: false, days: 5 }));
    await expect(denied).rejects.toThrow('Synthetic permission denial');
    await expect(corrected).resolves.toEqual({ notifications: false, days: 5 });
  });
});
