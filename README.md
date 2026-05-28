# Armosphera One Claude

Sovereign, self-hostable Armenian business operating system with phased one-to-one
Zoho One functional parity. Runs entirely on your own server: data and database stay
local, outbound network is off by default, and AI is opt-in (local model by default).

Built by evolving the Armosphera-One prototype; folds in HayHashvapah Finance
(incl. RA-law RAG) and Armosphera CRM assets over the roadmap. See the design spec at
`docs/superpowers/specs/2026-05-28-armosphera-one-claude-local-design.md`.

## Run (local server)

```bash
npm install
npm run build:ui
npm start
```

Default URL: `http://127.0.0.1:4100`. The SQLite database is created outside this
folder, under the OS application-support directory (e.g.
`~/Library/Application Support/ArmospheraOneClaude/armosphera-one.db` on macOS), so it
is never placed in a synced folder.

Demo owner:
- Email: `owner@armosphera.local`
- Password: `change-me-now`

## Data sovereignty

- Outbound network is OFF by default. To allow specific outbound calls (e.g. opt-in
  webhooks or cloud AI), set `ARMOSPHERA_ONE_ALLOW_EGRESS=1` and list hosts in
  `ARMOSPHERA_ONE_EGRESS_ALLOWLIST` (comma-separated). Loopback is always allowed.
- AI defaults to a local model (`AI_PROVIDER=local`, Ollama on `127.0.0.1:11434`).
  Cloud providers are opt-in per deployment.

## Configuration

| Env var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `4100` |
| `ARMOSPHERA_ONE_DATA_DIR` | Override the data directory | OS app-support dir |
| `ARMOSPHERA_ONE_DB` | Override the DB file path | `<data dir>/armosphera-one.db` |
| `ARMOSPHERA_ONE_ALLOW_EGRESS` | `1` to permit outbound calls | off |
| `ARMOSPHERA_ONE_EGRESS_ALLOWLIST` | Allowed outbound hosts | empty |
| `AI_PROVIDER` | `local` / `claude` / `openai` / `auto` | `local` |

## Test

```bash
npm test
```
