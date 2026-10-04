import { describe, expect, it } from 'vitest';
import { validateConnectionMessage } from '../src/shared/connection';
import { createHistoryView, validateHistoryView } from '../src/shared/history';
import { compareObservations } from '../src/domain/observations';
import { check } from './fixtures/observations';

describe('history message boundary', () => {
  it('accepts only supported retention values and category filters', () => {
    expect(validateConnectionMessage({ type: 'history.read', category: 'assignments' })).toEqual({ type: 'history.read', category: 'assignments' });
    expect(validateConnectionMessage({ type: 'history.read', category: 'unknown' })).toBeNull();
    expect(validateConnectionMessage({ type: 'history.clear', scopeId: 'another-profile' })).toBeNull();
    expect(validateConnectionMessage({ type: 'history.retention', days: 90 })).toEqual({ type: 'history.retention', days: 90 });
    expect(validateConnectionMessage({ type: 'history.retention', days: 0 })).toBeNull();
    expect(validateConnectionMessage({ type: 'history.retention', days: '90' })).toBeNull();
  });

  it('returns a validated display projection without scope/profile/source identifiers', () => {
    const scope = compareObservations(null, check());
    const view = createHistoryView(scope, 90);
    expect(validateHistoryView(view)).toEqual(view);
    expect(JSON.stringify(view)).not.toContain('synthetic-source-1');
    expect(JSON.stringify(view)).not.toContain('synthetic-profile-and-window');
    expect(createHistoryView(scope, 90, 'tests').eventCount).toBe(0);
    expect(createHistoryView(scope, 90, 'assignments').eventCount).toBe(1);
    expect(validateHistoryView({ ...view, entries: [{ ...view.entries[0], kind: 'untrusted' }] })).toBeNull();
    expect(validateHistoryView({ ...view, retentionDays: 0 })).toBeNull();
  });
});
