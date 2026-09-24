# pi-hunk

One-command human review handoff between Pi and [Hunk](https://github.com/roodriigoooo/hunk).

`/code-review` opens a Hunk review of your working tree. When you close it, your human notes are forwarded to the agent as a single follow-up turn; an empty review approves silently without starting a model turn.

## `/code-review`

- Requires idle Pi and TUI mode.
- No Hunk running: Pi pauses, Hunk opens in the same terminal (`hunk diff --watch --no-exclude-untracked`).
- Hunk already running for this repo: choose to **attach** (its notes are forwarded when it closes) or **stop it and start a new review**.
- On close, the Git working tree is re-read and compared with the snapshot taken when `/code-review` started; if anything changed during the review, the notes are withheld as stale and you are asked to re-run `/code-review`.
- Hunk is focused on the file the agent touched most recently.
- Only explicitly authored human notes reach the model.

## Requirements

- Node.js 20+, Pi, Hunk 0.15.3+

## Configuration

`~/.pi/agent/hunk.json` (global) or `.pi/hunk.json` (project, overrides):

```json
{ "hunk": { "enabled": true, "binary": "hunk" } }
```

## Checks

```bash
npm run check
```

## License

MIT
