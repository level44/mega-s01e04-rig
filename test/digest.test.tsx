import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';

type Cell = { attributes: string; text: string };

function tableRows(html: string): Cell[][] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((row) => [...row[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)]
      .map((cell) => ({
        attributes: cell[1],
        text: cell[2].replace(/<[^>]*>/g, '').trim(),
      })))
    .filter((cells) => cells.length > 0);
}

function isMarked(cell: Cell): boolean {
  return /\bclass=["'][^"']*\bwarn\b[^"']*["']/.test(cell.attributes);
}

describe('night digest routes', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeNight(lines: unknown[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
  }

  async function requestNight() {
    const service = createApp({
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    });
    const page = await service.request(`/digest/${night}`);
    const api = await service.request(`/api/digest/${night}`);
    return { page, api };
  }

  it('returns the same sorted, complete job data in HTML and JSON, with warning thresholds and original offsets', async () => {
    writeNight([
      { at: '2026-10-28T04:00:00+01:00', job: 'alpha', status: 'ok', owner: 'new-owner' },
      { at: '2026-10-28T03:30:00+01:00', job: 'zebra', status: 'fail', owner: null },
      { at: '2026-10-28T01:00:00+02:00', job: 'middle', status: 'retry', owner: 'team-b' },
      { at: '2026-10-28T01:00:00+02:00', job: 'alpha', status: 'retry', owner: 'old-owner', error: 'unavailable' },
      { at: '2026-10-28T03:00:00+01:00', job: 'alpha', status: 'retry', owner: 'old-owner', error: 'still unavailable' },
      { at: '2026-10-28T02:00:00+02:00', job: 'middle', status: 'retry', owner: 'team-b' },
      { at: '2026-10-28T02:00:00+02:00', job: 'alpha', status: 'retry', owner: 'old-owner', error: 'timed out' },
      { at: '2026-10-28T03:00:00+01:00', job: 'middle', status: 'ok', owner: 'team-b' },
    ]);
    const { page, api } = await requestNight();
    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(api.headers.get('content-type')).toContain('application/json');

    const digest = await api.json() as NightDigest;
    expect(digest).toEqual({
      night,
      badLines: 0,
      counts: { ok: 2, retry: 5, fail: 1 },
      rows: [
        {
          job: 'alpha', owner: 'new-owner', runs: 4, retries: 3, lastStatus: 'ok',
          lastError: 'still unavailable', firstAt: '2026-10-28T01:00:00+02:00', lastAt: '2026-10-28T04:00:00+01:00',
        },
        {
          job: 'middle', owner: 'team-b', runs: 3, retries: 2, lastStatus: 'ok',
          lastError: null, firstAt: '2026-10-28T01:00:00+02:00', lastAt: '2026-10-28T03:00:00+01:00',
        },
        {
          job: 'zebra', owner: null, runs: 1, retries: 0, lastStatus: 'fail',
          lastError: null, firstAt: '2026-10-28T03:30:00+01:00', lastAt: '2026-10-28T03:30:00+01:00',
        },
      ],
    });

    const html = await page.text();
    expect(html).toContain(night);
    const rows = tableRows(html);
    expect(rows.map((row) => row.map((cell) => cell.text))).toEqual(digest.rows.map((row) => [
      row.job, row.owner ?? '—', String(row.runs), String(row.retries), row.lastStatus,
      row.lastError ?? '—', row.firstAt, row.lastAt,
    ]));
    expect(rows.map((row) => isMarked(row[3]))).toEqual([true, false, false]);
    expect(rows.map((row) => isMarked(row[4]))).toEqual([false, false, true]);
  });

  it('returns 404 from both routes when the night has no file', async () => {
    const { page, api } = await requestNight();
    expect(page.status).toBe(404);
    expect(api.status).toBe(404);
  });

  it('returns an empty digest and says nothing ran for an empty file', async () => {
    writeNight([]);
    const { page, api } = await requestNight();
    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('nothing ran');
    expect(tableRows(html)).toEqual([]);
    expect(await api.json()).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts malformed lines without dropping valid rows or treating blank lines as errors', async () => {
    const valid = { at: '2026-10-28T07:15:00-04:00', job: 'survivor', status: 'ok', owner: null };
    writeFileSync(join(runsDir, `${night}.jsonl`), [
      '', '  ', '{not json', JSON.stringify({ job: 'invalid-shape' }), JSON.stringify(valid), '',
    ].join('\n'));
    const { page, api } = await requestNight();
    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    const digest = await api.json() as NightDigest;
    expect(digest).toEqual({
      night,
      badLines: 2,
      counts: { ok: 1, retry: 0, fail: 0 },
      rows: [{
        job: 'survivor', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: valid.at, lastAt: valid.at,
      }],
    });
    const html = await page.text();
    expect(html).toMatch(/bad lines:\s*2/);
    expect(tableRows(html).map((row) => row.map((cell) => cell.text))).toEqual([
      ['survivor', '—', '1', '0', 'ok', '—', valid.at, valid.at],
    ]);
  });
});
