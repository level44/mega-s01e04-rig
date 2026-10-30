---
name: single-html-preview
description: Publish and replace one exported HTML file through the loopback miniserver and an approved ngrok account, without committing the preview or credentials.
---

# Single HTML preview

Use this repo's `scripts/preview-server.mjs`. Keep exports, ngrok binaries/configuration and
request logs outside Git. Obtain current approval before installing software, publishing a
page, or replacing a course preview without its marker. Existing authentication is not consent.

## Prerequisites

- Node.js 22+, curl, and an installed ngrok CLI. Read `--help` for any flags not already checked.
- A human-owned ngrok account configured by the human. Never request its token in chat or print
  the configuration. A private `--config` path or the human's default ngrok configuration works.
- An exported, self-contained HTML file containing only approved public data.
- A host that remains online for the review. Ngrok is a tunnel, not an unattended deployment.

## Put a rig review page online

From the repo, with rig running on 127.0.0.1:8787, export outside the repo:

```sh
mkdir -p ../preview
curl --fail --silent --show-error \
  --output ../preview/digest.html http://127.0.0.1:8787/digest/2026-10-28
node scripts/preview-server.mjs --file ../preview/digest.html --port 8788
```

Run the last command as a named long-lived service when using a harness. In another named
service, run the installed ngrok binary:

```sh
ngrok http http://127.0.0.1:8788 --log stdout --log-format json --inspect=false
```

Use the actual HTTPS origin printed in its `started tunnel` log; append `/digest.html`. Never
invent the hostname. Record that exact public URL, the external file path and both service names
in a private checkpoint. The admin listener at localhost:4040 is not the preview.

Fetch the public URL and open it in a real browser. Free ngrok accounts show a `Visit Site`
warning; inspect it and continue normally rather than pretending it is absent. Check actual
rows/banner, content type, no scripts/external assets, query-string behavior, and 404 for other
paths such as `/.env`. Programmatic access does not need a warning-bypass header.

## Replace at the same URL

Keep the tunnel and miniserver running. After any required human approval, change the renderer's
inputs and repeat the export command above. The miniserver rereads the file for every request
and sends `Cache-Control: no-store`; it ignores query strings when selecting the file.

For marker cleanup, remove `LANE_MARKER` from both the renderer's `.env` and inherited environment,
restart rig, and export again. Verify the public banner says `no marker set`, the old marker is
absent, and the job data is unchanged. Keep the original public URL in every course claim.

## Take down

Stop the named miniserver to make the HTML unavailable while preserving the ngrok hostname.
For an omp-supervised service, read `omp ps --help` and run:

```sh
omp ps stop <recorded-miniserver-name>
```

Verify the public URL no longer returns the page; the running tunnel may return an upstream
connection error rather than 404. Restart the miniserver with the same file and port to restore
that same URL. For permanent shutdown, stop the recorded ngrok service too. Stopping a tunnel
cannot retract downloaded copies. Never delete or change another project's services.

## Evidence boundary

This routine's initial S01E04 checks exercised publication, rendering, exact/query URL routing,
private-path rejection, and local same-URL file replacement. Record takedown and public marker
replacement separately when actually exercised; do not infer them from these checks.
