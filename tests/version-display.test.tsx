import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SyncVersionStatus } from '../src/ui/SyncVersionStatus';
import { validateSyncView, type SyncView } from '../src/shared/progress-sync';
import { APP_VERSION } from '../src/shared/sync-compatibility';

const view: SyncView = { ok: true, enabled: true, pending: 0, lastSuccessAt: null, error: false,
  workerVersion: '0.4.0', devices: [{ id: '11111111-1111-4111-8111-111111111111', version: '0.4.0', protocol: 3,
    reportedAt: '2026-10-11T08:00:00Z', self: true }] };
describe('local and shared version distinction', () => {
  it('shows a reload instruction when the interface is newer than the running worker', () => {
    const html = renderToStaticMarkup(<SyncVersionStatus view={view} working={false} onCheck={() => {}} />);
    expect(html).toContain(`Deze computer: versie ${APP_VERSION}`);
    expect(html).toContain('achtergrond werkt nog met 0.4.0');
    expect(html).toContain('laatst gedeelde versie');
    expect(html).toContain('chrome://extensions');
  });
  it('does not confuse a historical shared announcement with a running old worker', () => {
    const html = renderToStaticMarkup(<SyncVersionStatus view={{ ...view, workerVersion: APP_VERSION }} working={false} onCheck={() => {}} />);
    expect(html).not.toContain('achtergrond werkt nog');
    expect(validateSyncView(view)).toEqual(view);
    expect(validateSyncView({ ...view, workerVersion: 'invalid' })).toBeNull();
    const legacy = { ...view }; delete legacy.workerVersion;
    expect(validateSyncView(legacy)).toEqual(legacy);
  });
});
