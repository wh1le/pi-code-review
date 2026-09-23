# pi-hunk

[![npm version](https://img.shields.io/npm/v/@roodriigoooo/pi-hunk.svg)](https://www.npmjs.com/package/@roodriigoooo/pi-hunk)

pi-hunk orchestrates explicit human review checkpoints between Pi and Hunk.

## Workflow

1. Let Pi change working tree.
2. Run `/hunk review` or press `Ctrl+Shift+H`.
3. Review changes and author notes in Hunk, then exit.
4. On close, pi-hunk submits automatically: human notes start one agent turn that applies them; an empty review approves without a model turn. If Pi is busy, the checkpoint is kept for later (`/hunk submit`, `/hunk abandon`).
5. After requested changes, re-review and submit empty review to approve.

Hunk owns human review. pi-hunk launches or attaches Hunk, captures complete review snapshots, persists checkpoint state, verifies freshness, and delivers only explicitly submitted human notes to model. Empty approval never starts model turn.

When no Hunk session exists, same-terminal review temporarily stops Pi TUI, launches `hunk diff --watch --no-exclude-untracked`, and restores Pi after Hunk exits. The closed review is then submitted automatically: notes become one follow-up agent turn, an empty review approves silently.

If Hunk is already open in another terminal, `/hunk review` attaches read-only and returns immediately. Finish review there, then run `/hunk submit` in Pi.

## Review states

- `hunk · ready` — no active checkpoint.
- `hunk · reviewing` — captured review awaits submission.
- `hunk · re-review` — complete changeset changed after capture.
- `hunk · approved` — empty review was explicitly submitted.
- `hunk · approved · state unknown` — current freshness could not be verified.

Freshness covers complete changeset. Live Hunk session is authoritative. Owned default Git working-tree reviews also receive conservative fallback covering tracked changes, renames, and untracked files. Unsupported sources and failed probes report unknown instead of claiming clean state.

## Requirements

- Node.js 20 or newer.
- Pi.
- Hunk 0.15.3 or newer for review workflow.

## Install

```bash
pi install npm:@roodriigoooo/pi-hunk
```

Restart Pi or run `/reload`.

## Commands

- `/hunk status` — show checkpoint, session, freshness, and journal diagnostics.
- `/hunk review` — attach existing Hunk session or launch same-terminal Hunk.
- `/hunk submit` — validate freshness and deliver exact submitted human notes.
- `/hunk abandon` — abandon active checkpoint without model turn.
- `/hunk configure` — configure Hunk integration and binary path.

## Configuration

`/hunk configure` writes project config to `.pi/hunk.json`:

```json
{
  "hunk": {
    "enabled": true,
    "binary": "hunk"
  }
}
```

Global config lives at `~/.pi/agent/hunk.json`. Project values override global values.

## Checks

```bash
npm run check
npm pack --dry-run
```

## Project layout

- `src/review-export.ts` — complete Hunk export normalization and stable digests.
- `src/changeset.ts` — tool-independent freshness fingerprints and comparisons.
- `src/git-changeset.ts` — owned Git working-tree fallback adapter.
- `src/checkpoint-store.ts` — immutable checkpoint state machine and journal folding.
- `src/hunk-session-client.ts` — read-only Hunk probe and review client.
- `src/hunk-handoff.ts` — child process and Pi terminal lifecycle.
- `src/review-coordinator.ts` — live review sampling and retained final exports.
- `src/index.ts` — commands, shortcut, persistence, and explicit submission.

## License

MIT
