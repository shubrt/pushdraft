# pp

Private, versioned HTML draft publishing for people and agents.

## Packages

- `apps/api`: Elysia API, Shoo sign-in, PostgreSQL persistence and draft delivery
- `apps/cli`: `pp` CLI for authentication, upload, update, list and whoami
- `libs/contracts`: shared runtime-validated API contracts

## Local setup

Requirements: Node 22+, pnpm 11+, Bun 1.3.10+ and Docker.

```bash
corepack pnpm install
cp .env.example .env
docker compose up -d postgres
corepack pnpm db:deploy
corepack pnpm --filter @pp/api dev
```

The apex runs at `http://localhost:3003`. Drafts use
`http://<draft-id>.localhost:3003`; local DNS support for wildcard localhost names
depends on the browser and operating system.

Build the CLI with:

```bash
corepack pnpm --filter @pp/cli build
node apps/cli/dist/cli.js auth login --api-url http://localhost:3003
```

## Checks

```bash
corepack pnpm qa
```

The API keeps every browser page and draft private. Browser access uses a Shoo
session plus a one-time subdomain handshake. Agents use a Bearer API key for
listing, uploading and fetching draft HTML.
