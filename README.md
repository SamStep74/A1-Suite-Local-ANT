<p align="center">
  <img src="brand/a1-suite.svg" alt="A1 Suite" height="64" />
</p>

# A1 Suite

> Part of the **A1** product family. Brand mark: deep-teal `#1E3A3A` rounded square with white **A1**, product name beside it.

Sovereign, self-hostable Armenian business operating system with phased one-to-one
Zoho One functional parity. Runs entirely on your own server: data and database stay
local, and outbound network is off by default. AI provider switching (local model by
default, cloud opt-in) is scaffolded for an upcoming milestone.

Built by evolving the Armosphera-One prototype; folds in HayHashvapah Finance
(incl. RA-law RAG) and Armosphera CRM assets over the roadmap. See the design spec at
`docs/superpowers/specs/2026-05-28-armosphera-one-claude-local-design.md`.

Operator installation, backup, and tenant transfer procedures are documented in
`docs/deployment/a1-suite-installation-transfer-trilingual.md`.

## Run (local server)

```bash
npm install
npm run build:ui
npm start
```

For phone/lab LAN access (OPPO / remote preview), start with LAN binding:

```bash
HOST=0.0.0.0 PORT=4178 npm run start:lan
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

## Legal knowledge base (RA-law RAG)

Armenian-law retrieval is local and offline-first. Lexical search (BM25) needs no
model and no network. Optional semantic re-ranking uses a local Ollama embedder
(`bge-m3`) over loopback; if it is absent, search falls back to BM25 automatically.

Install the prebuilt knowledge base:

```bash
node scripts/install-laws.js [path-to-laws.sqlite]
```

With no argument it looks for an existing HayHashvapah build at
`~/Library/Application Support/HayHashvapahWebClaude/data/laws.sqlite`. The KB is
copied to `~/Library/Application Support/ArmospheraOneClaude/laws.sqlite` (override
with `ARMOSPHERA_ONE_LAWS_DB`). Query it via `GET /api/legal/law-search?q=...`.

### Build the KB from raw law text (in-repo, zero dependencies)

A1 Suite can build the knowledge base directly from plain-text legislation — no
external tools, no network. Put one law per `.txt`/`.md` file in a directory (the
filename becomes the law title), then:

```bash
node scripts/ingest-laws.js <source-dir> [dest.sqlite]          # BM25-only (offline default)
node scripts/ingest-laws.js <source-dir> [dest.sqlite] --embed  # + local vector embeddings
```

The ingest splits each file into article-aware chunks on `Հոդված N` / `Article N`
markers (the article number is captured for precise retrieval), writes the canonical
`law_chunks` table, and is idempotent (content-hashed chunk ids — re-running only fills
gaps). With no `dest`, it writes to `ARMOSPHERA_ONE_LAWS_DB` / the default data dir.

`--embed` is **opt-in and failure-tolerant**: it calls the local Ollama embedder
(`bge-m3`) over loopback to populate vectors for hybrid search. If the embedder is not
running, the rows stay lexical (BM25) and the command still succeeds — the KB is never
left in a broken state.

> **PDF sources:** `.pdf` files are accepted directly when the local `pdftotext`
> binary is available. If it is missing, PDFs are skipped with a warning while
> `.txt` / `.md` sources still ingest normally; install Poppler or pre-convert PDFs
> to text on hosts where native extraction is not available.

## Configuration

| Env var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `4100` |
| `HOST` | Bind address (keep loopback for local-only access) | `127.0.0.1` |
| `A1_STUDIO_DATA_DIR` | Platform alias for data directory override | OS app-support dir |
| `ARMOSPHERA_ONE_DATA_DIR` | Legacy data directory override | OS app-support dir |
| `A1_STUDIO_SQLITE` | Platform alias for DB file path | `/opt/a1/product-data/studio/armosphera-one.db` |
| `ARMOSPHERA_ONE_DB` | Legacy DB file path override | `<data dir>/armosphera-one.db` |
| `ARMOSPHERA_ONE_ALLOW_EGRESS` | `1` to permit outbound calls | off |
| `ARMOSPHERA_ONE_EGRESS_ALLOWLIST` | Allowed outbound hosts (comma-separated) | empty |
| `AI_PROVIDER` | Scaffolding (not yet wired): `local` / `claude` / `openai` / `auto` | `local` |
| `LOCAL_AI_BASE_URL` | Local AI endpoint (Ollama, OpenAI-compatible) | `http://127.0.0.1:11434/v1` |
| `LOCAL_AI_MODEL` | Local AI model | `gemma3:4b` |
| `ARMOSPHERA_ONE_LAWS_DB` | Override the legal KB path | `<data dir>/laws.sqlite` |
| `LAW_EMBED_MODEL` | Local embedder model for semantic search | `bge-m3` |
| `LAW_EMBED_BASE` | Local embedder base URL (loopback) | `http://127.0.0.1:11434` |
| `A1_PLATFORM_TENANT_RESOLUTION` | `1` to resolve Studio tenant context from A1 Platform | off |
| `A1_PLATFORM_API_URL` | A1 Platform API base URL through VM gateway/tunnel | `http://127.0.0.1:8088` |
| `A1_PLATFORM_TOKEN` | Optional server-to-server token for sensitive tenant context | empty |
| `A1_PLATFORM_TENANT_STRICT` | `1` to fail closed when platform lookup is unavailable or host is unknown | off |
| `A1_PLATFORM_TENANT_TIMEOUT_MS` | Platform tenant lookup timeout | `1200` |
| `A1_PLATFORM_TENANT_CACHE_MS` | Per-host tenant lookup cache TTL | `10000` |

When tenant resolution is enabled, Studio asks A1 Platform for the current
tenant by `product=studio` and forwards the original request host in
`x-a1-request-host`. Non-strict mode fails open for temporary platform lookup
errors; strict mode fails closed. Tenant maintenance, tenant disabled, module
disabled, and egress-blocked responses always block the request. Public health
responses expose only enabled/resolved/strict flags; the authenticated
audit-reader tenant summary redacts database URLs and only exposes sanitized
module codes.

For the supported VM runtime, keep A1 Platform inside the Ubuntu VM and expose it
to Mac-hosted product dev servers through `infra/vm/a1-vm.sh tunnel`; then use
`A1_PLATFORM_API_URL=http://127.0.0.1:8088`. Do not require Docker Desktop on the
Mac or client machine.

## Test

```bash
npm test
```
