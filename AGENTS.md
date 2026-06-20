# AGENTS.md

Instructions for AI agents working with the **pi-control-bridge** repository.

## Project

Pi package and singleton bridge runtime for integrating [pi-control-hub](https://github.com/CodeOnTime-tech/pi-control-hub) with Pi agent sessions.

- `extension/` — Pi lifecycle hooks, command consumer, event proxy
- `bridge/` — singleton process: device registration, heartbeat, command polling, IPC server
- `shared/` — shared types, configuration, constants
- `tests/` — unit tests (Vitest)

## Required verification after changes

After any code modifications, **you must** run both commands and ensure they complete successfully:

```bash
make check
make test
```

Do not consider the task complete until both commands pass without errors.

| Command | What it does |
|---------|--------------|
| `make check` | TypeScript type checking (`tsc --noEmit`) |
| `make test` | Run unit tests (`vitest run`) |

Use `make build` when a build is needed.

## Other commands

```bash
make install   # npm install
make help      # list available targets
```

## Conventions

- Keep diffs minimal: do not change code outside the scope of the task
- Follow existing project patterns and style
- Create commits only when explicitly requested by the user
