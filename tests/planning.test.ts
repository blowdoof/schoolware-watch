import { describe, expect, it } from 'vitest';
import { planningWindow } from '../src/domain/planning';

describe('compact planning window', () => {
  it('uses positive agenda evidence, skips unknown dates and expands without dropping ongoing work', () => {
    const now = new Date('2026-10-05T10:00:00Z');
    const agenda = ['2026-10-02', '2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12', '2026-10-14', '2026-10-16'];
    const ongoing = { startsAt: '2026-10-02 09:00:00', endsAt: '2026-10-07 16:00:00' };
    const window = planningWindow(agenda, [ongoing], now, 5);
    expect(window.days).toEqual(agenda.slice(1));
    expect(window.cutoffDay).toBe('2026-10-14');
    expect(ongoing.startsAt.slice(0, 10) <= window.cutoffDay!).toBe(true);
    expect(planningWindow(agenda, [ongoing], now, 10).cutoffDay).toBe('2026-10-16');
  });
  it('includes positively observed weekend deadlines and handles an empty agenda in Brussels time', () => {
    const now = new Date('2026-10-04T22:30:00Z');
    expect(planningWindow([], [], now, 5)).toEqual({ days: [], cutoffDay: null });
    expect(planningWindow(['2026-10-04'], [{ startsAt: '2026-10-03 09:00:00', endsAt: '2026-10-10 16:00:00' }], now, 5))
      .toEqual({ days: ['2026-10-10'], cutoffDay: '2026-10-10' });
  });
});
