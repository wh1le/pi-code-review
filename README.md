# pi-hunk

Explicit human review checkpoints between Pi and [Hunk](https://github.com/roodriigoooo/hunk).

## Workflow

1. Let Pi change the working tree.
2. Run `/hunk review` (or `Ctrl+Shift+H`).
   - No Hunk running: Pi pauses, Hunk opens in the same terminal.
   - Hunk already open: attaches read-only, returns immediately.
3. Review and author notes in Hunk, then exit.
4. On close, the review submits automatically — notes start one agent turn that applies them; an empty review approves silently. If Pi is busy, the checkpoint is kept for later.
5. Repeat until you submit an empty review to approve.

Only explicitly submitted human notes reach the model. Freshness of the complete changeset is verified before submission.

## Commands

| Command | Action |
|---|---|
| `/hunk status` | Checkpoint, session, and freshness status |
| `/hunk review` | Attach or launch Hunk review |
| `/hunk submit` | Submit notes manually (busy-agent case) |
| `/hunk abandon` | Drop the checkpoint without a model turn |
| `/hunk configure` | Enable/disable, set Hunk binary path |

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
