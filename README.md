# pi-control-bridge

Pi package + singleton bridge runtime for integrating [pi-control-hub](https://github.com/CodeOnTime-tech/pi-control-hub) with Pi agent sessions.

## Components

- **Extension** (`extension/`) — Pi lifecycle hooks, command consumer, event proxy.
- **Bridge runtime** (`bridge/`, bin `pi-bridge`) — singleton process: device registration, heartbeat, command polling, IPC server.

## Install

```bash
npm install
npm run build
pi install /absolute/path/to/pi-control-bridge
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["npm:pi-control-bridge"]
}
```

The npm package ships a prebuilt `dist/bridge/main.js` — no build step is required after `pi update`.

## Configuration

Config is loaded from JSON files (no environment variables). Priority from low to high:

1. **Defaults** — built into the package
2. **User config** — `~/.pi/agent/bridge/config.json`
3. **Project config** — `.pi/bridge.json` (nearest ancestor of Pi `cwd`)

Copy [`bridge.config.example.json`](bridge.config.example.json) as a starting point.

| Key | Default | Description |
|---|---|---|
| `hub_url` | `http://127.0.0.1:8000` | pi-control-hub base URL |
| `poll_interval_sec` | `2` | Command polling interval |
| `heartbeat_interval_sec` | `15` | Device heartbeat interval |
| `bridge_data_dir` | `~/.pi/agent/bridge` | State and retry queue directory |
| `ipc_port` | `9473` | Local IPC HTTP port |
| `auto_start_bridge` | `true` | Auto-start bridge on session |

Runtime state (secrets): `~/.pi/agent/bridge/state.json` (`device_token`, `device_id`).

Data from the legacy `~/.pi/bridge/` directory is migrated automatically on first load.

### Example user config

`~/.pi/agent/bridge/config.json`:

```json
{
  "hub_url": "https://hub.example.com"
}
```

### Example project config

`.pi/bridge.json` in your repo:

```json
{
  "hub_url": "http://127.0.0.1:8000"
}
```

## Slash commands

- `/bridge:status` — bridge and backend status
- `/bridge:link-telegram` — create Telegram link token

## Manual bridge

```bash
pi-bridge start
```

Normally the extension starts the bridge automatically on `session_start`.

## Development

```bash
npm install
npm run build
npm test
npm run check
```

## Hub prerequisite

Device re-register via `POST /devices/register` with `device_token` must be supported by pi-control-hub.
