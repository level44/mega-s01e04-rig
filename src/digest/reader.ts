import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  time: number;
  job: string;
  status: DigestRow['lastStatus'];
  owner: string | null;
  error: string | undefined;
};

type Aggregate = {
  row: DigestRow;
  firstTime: number;
  lastTime: number;
  errorTime: number;
};

const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const timestampPattern = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isNight(value: string): boolean {
  if (value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  const leapDay = month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day >= 1 && day <= monthDays[month - 1] + (leapDay ? 1 : 0);
}

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (
    typeof event.at !== 'string' ||
    typeof event.job !== 'string' ||
    (event.status !== 'ok' && event.status !== 'retry' && event.status !== 'fail') ||
    (event.owner !== null && typeof event.owner !== 'string') ||
    (event.error !== undefined && typeof event.error !== 'string')
  ) return null;

  const match = timestampPattern.exec(event.at);
  if (!match || match[0] !== event.at || !isNight(event.at.slice(0, 10))) return null;
  const time = Date.parse(event.at);
  if (!Number.isFinite(time)) return null;
  return {
    at: event.at,
    time,
    job: event.job,
    status: event.status,
    owner: event.owner,
    error: event.error,
  };
}

function compareJobs(left: string, right: string): number {
  let l = 0;
  let r = 0;
  while (l < left.length && r < right.length) {
    const a = left.codePointAt(l)!;
    const b = right.codePointAt(r)!;
    if (a !== b) return a - b;
    l += a > 0xffff ? 2 : 1;
    r += b > 0xffff ? 2 : 1;
  }
  return (left.length - l) - (right.length - r);
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) return null;
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, Aggregate>();
  for (const line of contents.split('\n')) {
    if (line.trim() === '') continue;
    const event = parseEvent(line);
    if (!event) {
      digest.badLines++;
      continue;
    }
    digest.counts[event.status]++;
    const aggregate = jobs.get(event.job);
    if (!aggregate) {
      jobs.set(event.job, {
        row: {
          job: event.job,
          owner: event.owner,
          runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status,
          lastError: event.error ?? null,
          firstAt: event.at,
          lastAt: event.at,
        },
        firstTime: event.time,
        lastTime: event.time,
        errorTime: event.error === undefined ? -Infinity : event.time,
      });
      continue;
    }

    const { row } = aggregate;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.time < aggregate.firstTime) {
      aggregate.firstTime = event.time;
      row.firstAt = event.at;
    }
    // Equal timestamps retain input order for the latest owner, status and error.
    if (event.time >= aggregate.lastTime) {
      aggregate.lastTime = event.time;
      row.lastAt = event.at;
      row.owner = event.owner;
      row.lastStatus = event.status;
    }
    if (event.error !== undefined && event.time >= aggregate.errorTime) {
      aggregate.errorTime = event.time;
      row.lastError = event.error;
    }
  }
  digest.rows = Array.from(jobs.values(), ({ row }) => row).sort((a, b) => compareJobs(a.job, b.job));
  return digest;
};
