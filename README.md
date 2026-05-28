# Armosphera One Claude

Sovereign, self-hostable Armenian business operating system with phased one-to-one
Zoho One functional parity. Runs entirely on your own server: data and database stay
local, and outbound network is off by default. AI provider switching (local model by
default, cloud opt-in) is scaffolded for an upcoming milestone.

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
- AI provider config is scaffolded but not yet wired to a live call path in this
  foundation milestone. The intended posture: a local model by default
  (`AI_PROVIDER=local`, Ollama on `127.0.0.1:11434`), with cloud providers opt-in per
  deployment and subject to the same egress allowlist above.

## Configuration

| Env var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `4100` |
| `HOST` | Bind address (keep loopback for local-only access) | `127.0.0.1` |
| `ARMOSPHERA_ONE_DATA_DIR` | Override the data directory | OS app-support dir |
| `ARMOSPHERA_ONE_DB` | Override the DB file path | `<data dir>/armosphera-one.db` |
| `ARMOSPHERA_ONE_ALLOW_EGRESS` | `1` to permit outbound calls | off |
| `ARMOSPHERA_ONE_EGRESS_ALLOWLIST` | Allowed outbound hosts (comma-separated) | empty |
| `AI_PROVIDER` | Scaffolding (not yet wired): `local` / `claude` / `openai` / `auto` | `local` |
| `LOCAL_AI_BASE_URL` | Local AI endpoint (Ollama, OpenAI-compatible) | `http://127.0.0.1:11434/v1` |
| `LOCAL_AI_MODEL` | Local AI model | `gemma3:4b` |

## Test

```bash
npm test
```
