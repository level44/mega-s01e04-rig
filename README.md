# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
a morning digest of what ran overnight.

The status board lists nights newest first, linking each to `/digest/:night` with its
ok / retry / fail event counts.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Working on it with an agent: start at [AGENTS.md](AGENTS.md).

## Morning digest

- `GET /digest/:night` renders the nightly jobs in the usual lane layout.
- `GET /api/digest/:night` returns the same sorted rows as JSON, plus the night, bad-line count
  and ok/retry/fail event counts. Missing nights return 404; an empty file renders "nothing ran".
- Each job records its run and retry counts, latest owner/status, most recent provided error,
  and first/last timestamps. Recovery retains the previous error; timestamps retain their
  original offsets. Missing owners and errors display as `—`.
- Invalid JSON or event shapes count as bad lines without losing valid jobs. Blank lines are
  ignored. The fixtures in `runs/` are read-only.

Run `pnpm test` and `pnpm typecheck` to check the reader and routes.

## Review copy

With `pnpm start` running and the designated `LANE_MARKER` set in the ignored `.env`, export
the real response outside this repository:

```sh
mkdir -p ../preview
curl --fail --silent --show-error \
  --output ../preview/digest.html http://127.0.0.1:8787/digest/2026-10-28
```

Serve just this exported file on loopback for a tunnel:

```sh
node scripts/preview-server.mjs --file ../preview/digest.html --port 8788
```

The miniserver exposes only `http://127.0.0.1:8788/digest.html` for GET/HEAD. It rereads the
file on each request and disables caching, so replacing the export updates the same URL.
Other paths return 404 and other methods return 405. `--help` prints its options.
Query strings do not change the selected file.

The HTML has inline styles and no client JavaScript or external assets. Publish it only after
the human approves the public host and destination. Do not commit previews or `.env`.

After review and separate replacement approval, remove `LANE_MARKER` from `.env` and from the
server's environment, restart rig, and run the same export command. Confirm the banner says
"no marker set", then replace the page at the exact same public URL. Archive the finished
plan in `docs/plans/done/` with its GitHub issue links.
