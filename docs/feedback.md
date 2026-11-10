# Feedback

Send a bug report or an idea straight from the terminal:

```sh
simon feedback                                   # prompts for a title and a description
simon feedback -t "Logs drop lines on Android"   # prompts only for the description
simon feedback -t "Add a --json flag to list" -m "So scripts can read it."
```

| Flag | |
|---|---|
| `-t`, `--title <text>` | Short summary (required; prompted for if omitted, max 200 characters) |
| `-m`, `--message <text>` | Details (optional; prompted for if omitted, max 10 000 characters) |

simon shows what it's about to send, sends it, and prints the item's number and
link. Without a terminal (in a script or CI) `--title` is required and a missing
`--message` is sent as an empty description.

## What's sent

Your title and description, plus this metadata — nothing else (no paths, project
names, or device details):

| Field | Example |
|---|---|
| `tool` | `simon` |
| `version` | `2.18.0` |
| `channel` | `stable`, `nightly` or `dev` |
| `os` / `arch` | `macos` / `aarch64` |
| `macosVersion` | `15.1` (from `sw_vers -productVersion`) |
| `source` | `cli` |

Feedback goes to [feedbackBox](https://feedbackbox.hvalec.com), where it's triaged.

## Configuration

Release builds have the feedback key baked in, so there's nothing to set up. To
override (e.g. a local build without a key, or a test server):

| Variable | |
|---|---|
| `SIMON_FEEDBACK_KEY` | The feedbackBox ingest key to send with |
| `SIMON_FEEDBACK_URL` | Base URL of the feedbackBox server (default `https://feedbackbox.hvalec.com`) |

For your own builds, copy `.env.example` to `.env` and fill in
`SIMON_FEEDBACK_KEY`; `scripts/build-binaries.sh` loads it. A build without a key
says "Feedback isn't configured in this build" unless `SIMON_FEEDBACK_KEY` is set.
