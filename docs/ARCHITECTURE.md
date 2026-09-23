# Architecture: persistent dual-agent workspace

## User model

The source of truth for interactive sessions is **tmux on the user's machine**, not the web application or an ephemeral CLI subprocess. Each agent runs in its own tmux pane, preserving its running process, conversation history, authentication environment, working directory, and native interactive UI. Users can attach a native terminal to the session or view and interact with the same pane in the local web cockpit.

The browser renders a text snapshot from `tmux capture-pane` every ~2 seconds and sends literal line input via `tmux send-keys -l`. This is a mirrored terminal **not** a byte-perfect PTY emulator. It does not support full-screen interactive input, keyboard shortcuts, or mouse events. Use the native terminal for those interactions.

## Components

```text
Mac terminal A --tmux attach--> builder pane <--tmux capture/send--> localhost browser
                                          |
                                          +-- local Git repo / task state
                                          |
Mac terminal B --tmux attach--> reviewer pane <--tmux capture/send--> localhost browser
                                                   |
                                                  handoff prompts
```

- `src/tmux.js`: tmux pane discovery, bounded capture, validated pane target, literal input.
- `src/workspace.js`: selected repository, role-to-pane mappings, shared task, explicit handoff records, JSON persistence. On restart it restores *bindings only*; it never autotypes.
- `src/server.js`: loopback HTTP API, origin/host check for writes, read endpoints for terminal snapshots and Git status.
- `public/index.html`: shared project view, session selection, live mirror, text input and explicit handoff buttons.
- `src/orchestrator.js`: previous sequential background job implementation, **not connected to the Phase 2 server**.

## Identity boundaries

Existing Claude and Codex CLI login sessions are retained within tmux. The app does not extract, swap, or duplicate credentials. The two GitHub identities remain the responsibility of the users' two shells and Git credential setup. Simply changing Git author metadata does **not** switch GitHub identity. GitHub push and PR actions are not automated in this phase.

## Reliability / handoff semantics

Current handoff is an explicit user action. It sends a single literal prompt to the selected pane and records the target, HEAD, and note in persistent workspace metadata. The system cannot safely infer that an arbitrary terminal agent is idle; sending input while it is busy may interfere with ongoing work. Thus **fully automated handoff is intentionally not claimed**. For automatic orchestration, a future agent adapter must expose structured, durable turn-completion events and a queue/ACK protocol; parsing terminal text or assuming a Git commit means the target is ready is insufficient.

When both agents point at the same checkout, they may observe uncommitted modifications while coding. For independent verification, the reviewer should review an explicit commit/diff or use a separate read-only worktree. Future work: GitHub A/B credential isolation, PR review adapter, reliable task/turn state machine, independent reviewer snapshot, and approval-controlled remote mutations.

## Security boundary

Local browser UI only; no remote exposure. The project must be under a configured workspace directory. The role target is an existing tmux pane selected by the user. The input endpoint intentionally allows interactive text to an agent, so the server must be treated as a local privileged control surface. The server rejects cross-origin JSON writes; this does not make it safe to expose to untrusted local users or public networks.
