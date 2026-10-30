import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

describe('status board', () => {
  it('shows the lane banner and the nights on disk', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('2026-10-28');
  });

  it('links each night with event counts in newest-first order', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'rig-status-'));
    try {
      writeFileSync(join(runsDir, '2026-10-27.jsonl'), '');
      writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
        JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'backup', owner: null, status: 'retry' }),
        JSON.stringify({ at: '2026-10-28T01:01:00+01:00', job: 'backup', owner: null, status: 'retry' }),
        JSON.stringify({ at: '2026-10-28T01:02:00+01:00', job: 'backup', owner: null, status: 'fail' }),
        JSON.stringify({ at: '2026-10-28T01:03:00+01:00', job: 'backup', owner: null, status: 'ok' }),
        'not JSON',
      ].join('\n'));
      const res = await createApp({ ...config, runsDir }).request('/');
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain('href="/digest/2026-10-28"');
      expect(html).toContain('2026-10-28</a> · ok 1 / retry 2 / fail 1');
      expect(html).toContain('href="/digest/2026-10-27"');
      expect(html).toContain('2026-10-27</a> · ok 0 / retry 0 / fail 0');
      expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });

  it('health answers with the lane id', async () => {
    const res = await createApp(config).request('/health');
    expect(await res.json()).toEqual({ ok: true, lane: 'lane-07' });
  });
});
