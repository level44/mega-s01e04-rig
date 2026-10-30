import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
let runsDir: string;

function line(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    at: '2026-10-28T23:00:00+01:00',
    job: 'night/job',
    status: 'ok',
    owner: 'rook',
    ...overrides,
  });
}

function writeLines(...lines: string[]): void {
  writeFileSync(join(runsDir, `${night}.jsonl`), lines.join('\n'));
}

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-reader-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('readNight', () => {
  it('reads the real 2026-10-28 fixture without changing it', () => {
    const fixtures = fileURLToPath(new URL('../runs/', import.meta.url));
    expect(readNight(fixtures, night)).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        {
          job: 'digest/render',
          owner: null,
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00',
          lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh',
          owner: 'rook',
          runs: 4,
          retries: 3,
          lastStatus: 'ok',
          lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00',
          lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync',
          owner: 'rook',
          runs: 8,
          retries: 1,
          lastStatus: 'ok',
          lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00',
          lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup',
          owner: 'lane-07',
          runs: 1,
          retries: 0,
          lastStatus: 'fail',
          lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00',
          lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs',
          owner: 'lane-07',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00',
          lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
    });
  });

  it('returns null for a missing file or runs directory', () => {
    expect(readNight(runsDir, night)).toBeNull();
    expect(readNight(join(runsDir, 'missing'), night)).toBeNull();
  });

  it.each(['', ' \t\r\n\n\t\n'])('returns an empty digest for empty or blank contents %j', (contents) => {
    writeFileSync(join(runsDir, `${night}.jsonl`), contents);
    expect(readNight(runsDir, night)).toEqual({
      night,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts all event statuses and retains a nullable owner and error after recovery', () => {
    writeLines(
      line({ at: '2026-10-28T23:00:00+01:00', status: 'fail', error: 'first failure' }),
      line({ at: '2026-10-28T23:01:00+01:00', status: 'retry', owner: null, error: 'latest failure' }),
      line({ at: '2026-10-28T23:02:00+01:00', owner: null }),
    );
    expect(readNight(runsDir, night)).toEqual({
      night,
      badLines: 0,
      counts: { ok: 1, retry: 1, fail: 1 },
      rows: [{
        job: 'night/job',
        owner: null,
        runs: 3,
        retries: 1,
        lastStatus: 'ok',
        lastError: 'latest failure',
        firstAt: '2026-10-28T23:00:00+01:00',
        lastAt: '2026-10-28T23:02:00+01:00',
      }],
    });
  });

  it('uses instants rather than input or string order and preserves original offsets', () => {
    writeLines(
      line({ at: '2026-10-28T17:00:00.125-05:00', owner: 'latest owner' }),
      line({ at: '2026-10-28T21:45:00Z', status: 'retry', error: 'newest error' }),
      line({ at: '2026-10-28T23:30:00+02:00', status: 'fail', owner: null, error: 'older error' }),
    );
    expect(readNight(runsDir, night)).toEqual({
      night,
      badLines: 0,
      counts: { ok: 1, retry: 1, fail: 1 },
      rows: [{
        job: 'night/job',
        owner: 'latest owner',
        runs: 3,
        retries: 1,
        lastStatus: 'ok',
        lastError: 'newest error',
        firstAt: '2026-10-28T23:30:00+02:00',
        lastAt: '2026-10-28T17:00:00.125-05:00',
      }],
    });
  });

  it('uses input order to break equal-instant ties without clearing the last error', () => {
    writeLines(
      line({ at: '2026-10-28T22:00:00Z', status: 'fail', error: 'first error' }),
      line({ at: '2026-10-28T23:00:00+01:00', status: 'retry', owner: null, error: 'last error' }),
      line({ at: '2026-10-28T22:00:00Z', owner: 'last owner' }),
    );
    expect(readNight(runsDir, night)?.rows).toEqual([{
      job: 'night/job',
      owner: 'last owner',
      runs: 3,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'last error',
      firstAt: '2026-10-28T22:00:00Z',
      lastAt: '2026-10-28T22:00:00Z',
    }]);
  });

  it('sorts jobs in Unicode codepoint order, independently of locale or input order', () => {
    writeLines(...['😀', '\ue000', 'é', 'z', 'a', 'Z'].map((job) => line({ job })));
    const digest = readNight(runsDir, night);
    expect(digest?.rows.map(({ job }) => job)).toEqual(['Z', 'a', 'z', 'é', '\ue000', '😀']);
    expect(digest?.counts).toEqual({ ok: 6, retry: 0, fail: 0 });
    expect(digest?.rows.every(({ runs, retries }) => runs === 1 && retries === 0)).toBe(true);
  });

  it('counts invalid JSON and shapes once each without counting blank lines or dropping good events', () => {
    const badLines = [
      '{',
      'null',
      '[]',
      '42',
      'true',
      '"not an event"',
      '{}',
      line({ at: undefined }),
      line({ job: undefined }),
      line({ status: undefined }),
      line({ owner: undefined }),
      line({ at: 7 }),
      line({ job: null }),
      line({ status: 'queued' }),
      line({ owner: 7 }),
      line({ error: 7 }),
      line({ error: null }),
    ];
    writeLines('', ' \t\r', ...badLines, line(), '');
    expect(readNight(runsDir, night)).toEqual({
      night,
      badLines: badLines.length,
      counts: { ok: 1, retry: 0, fail: 0 },
      rows: [{
        job: 'night/job',
        owner: 'rook',
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-28T23:00:00+01:00',
        lastAt: '2026-10-28T23:00:00+01:00',
      }],
    });
  });

  it.each([
    'not-a-time',
    '2026-10-28',
    '2026-10-28T23:00:00',
    '2026-02-29T23:00:00Z',
    '2026-02-30T23:00:00Z',
    '2100-02-29T23:00:00Z',
    '2026-04-31T23:00:00Z',
    '2026-00-28T23:00:00Z',
    '2026-10-00T23:00:00Z',
    '2026-10-28T24:00:00Z',
    '2026-10-28T23:60:00Z',
    '2026-10-28T23:00:60Z',
    '2026-10-28T23:00:00+24:00',
    '2026-10-28T23:00:00+01:60',
    '2026-10-28T23:00:00Z\n',
  ])('counts an invalid or timezone-ambiguous timestamp as a bad line: %j', (at) => {
    writeLines(line({ at }));
    expect(readNight(runsDir, night)).toEqual({
      night,
      rows: [],
      badLines: 1,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each(['2000-02-29', '2024-02-29', '2026-04-30'])('accepts a real calendar night and timestamp: %s', (validNight) => {
    const at = `${validNight}T00:00:00Z`;
    writeFileSync(join(runsDir, `${validNight}.jsonl`), line({ at }));
    expect(readNight(runsDir, validNight)).toMatchObject({
      night: validNight,
      badLines: 0,
      counts: { ok: 1, retry: 0, fail: 0 },
      rows: [{ firstAt: at, lastAt: at }],
    });
  });

  it.each([
    '',
    'not-a-night',
    '2026-2-03',
    '2026-02-29',
    '1900-02-29',
    '2026-02-30',
    '2026-04-31',
    '2026-00-10',
    '2026-13-10',
    '2026-01-00',
    '2026-01-32',
    '2026-10-28.jsonl',
    '2026-10-28\n',
  ])('rejects an invalid filename date even when that file exists: %j', (invalidNight) => {
    writeFileSync(join(runsDir, `${invalidNight}.jsonl`), line());
    expect(readNight(runsDir, invalidNight)).toBeNull();
  });

  it('rejects traversal to an existing file outside the supplied runs directory', () => {
    writeLines(line());
    const nestedRuns = join(runsDir, 'nested');
    mkdirSync(nestedRuns);
    expect(readNight(nestedRuns, `../${night}`)).toBeNull();
    expect(readNight(nestedRuns, `..\\${night}`)).toBeNull();
    expect(readNight(nestedRuns, `%2e%2e%2f${night}`)).toBeNull();
    expect(readNight(runsDir, `nested/../${night}`)).toBeNull();
    expect(readNight(runsDir, join(runsDir, night))).toBeNull();
  });

  it('does not hide filesystem errors other than ENOENT', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow(/EISDIR/);
    const notDirectory = join(runsDir, 'not-a-directory');
    writeFileSync(notDirectory, 'not a directory');
    expect(() => readNight(notDirectory, night)).toThrow(/ENOTDIR/);
  });
});
