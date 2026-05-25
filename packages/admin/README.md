# Lexiklar Admin

Admin interface for German language experts to browse, edit, proofread, and manage dictionary data.

## Local Development

```bash
pnpm install          # from repo root
pnpm run dev:admin    # starts on :5174
```

Requires `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` in environment for LLM translation features.

## Hosted Deployment

The admin app can run as a Cloudflare Worker with R2 cache + GitHub API backend, enabling non-technical contributors to use it without cloning the repo.

### Prerequisites

- Cloudflare account with Workers and R2 enabled
- GitHub fine-grained PAT with `contents: write` and `actions: write` on `all43/lexiklar`
- R2 bucket named `lexiklar-admin`

### 1. Create R2 bucket

```bash
npx wrangler r2 bucket create lexiklar-admin
```

### 2. Set Worker secrets

```bash
cd packages/admin/worker
npx wrangler secret put GITHUB_TOKEN        # GitHub PAT
npx wrangler secret put ADMIN_AUTH_TOKEN     # Bearer token for API auth
npx wrangler secret put ANTHROPIC_API_KEY    # for LLM translate
npx wrangler secret put OPENAI_API_KEY       # for LLM translate
```

### 3. Seed R2 cache

One-time upload of all word files, example shards, and config to R2:

```bash
export CLOUDFLARE_ACCOUNT_ID=<your-account-id>
export CLOUDFLARE_API_TOKEN=<your-api-token>
npx tsx scripts/seed-r2-cache.ts --bucket lexiklar-admin
```

### 4. Build and deploy

```bash
cd packages/admin
pnpm run build                    # builds Vue app to dist/
cd worker
npx wrangler deploy               # deploys worker + static assets
```

The app will be available at `admin.lexiklar.app` (or the custom domain configured in `wrangler.toml`).

### 5. Configure GitHub webhook

Set up a webhook on the `all43/lexiklar` repository to keep R2 in sync:

- **URL**: `https://admin.lexiklar.app/webhook`
- **Content type**: `application/json`
- **Events**: Push events only

On every push to `main`, the webhook syncs changed `data/words/**`, `data/examples/**`, and `config/word-whitelist.json` files to R2.

### 6. GitHub Actions pipeline

The workflow `.github/workflows/admin-pipeline.yml` is triggered by `repository_dispatch` when the hosted admin runs pipeline scripts (transform, enrich, translate). It requires these repository secrets:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

## Architecture

```
┌────────────────┐        ┌─────────────────────────────────────┐
│  Admin Vue App │───────>│  API handlers                        │
└────────────────┘        └────────────┬────────────────────────┘
                                       │
                          ┌────────────▼────────────────────────┐
                          │        DataStore interface           │
                          ├─────────────────┬───────────────────┤
                          │ LocalDataStore  │ GitHubDataStore    │
                          │ (fs + git CLI)  │ (GitHub API + R2)  │
                          └─────────────────┴───────────────────┘
```

- **Local mode** (default): reads/writes filesystem directly, uses git CLI for commits, spawns pipeline scripts locally
- **Hosted mode** (Worker): reads from R2 cache, writes via GitHub Contents API, commits via Git Trees API, triggers pipeline via GitHub Actions `repository_dispatch`

### Dev-only endpoints

These require local resources (Wiktionary dump, corpus files, SQLite DB) and return `501` in hosted mode:

- `GET /api/lookup` - raw Wiktionary lookup
- `GET /api/wikt-check` - Wiktionary presence check
- `GET /api/db-search` - SQLite full-text search
- `POST /api/batch-wikt-check` - batch Wiktionary + corpus check
