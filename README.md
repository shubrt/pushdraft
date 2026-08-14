# pushover

Private, versioned HTML draft publishing for people and agents.

Production runs at `https://pushover.dev`, with drafts on wildcard subdomains.

## Packages

- `apps/api`: Elysia API, Shoo sign-in, PostgreSQL persistence and draft delivery
- `apps/cli`: `pushover` CLI for authentication, upload, update, list and whoami
- `libs/contracts`: shared runtime-validated API contracts

## Local setup

Requirements: [Vite+](https://viteplus.dev) (`vp`), Node 22+, Bun 1.3.10+ and Docker.
`vp` drives installs, scripts, checks and tests; Bun is the API runtime and bundler.

```bash
vp i
cp .env.example .env
docker compose up -d postgres
vp run db:deploy
vp run -F @pushover/api dev
```

The apex runs at `http://localhost:3003`. Drafts use
`http://<draft-id>.localhost:3003`; local DNS support for wildcard localhost names
depends on the browser and operating system.

Build the CLI with:

```bash
vp run -F @pushover/cli build
node apps/cli/dist/cli.js auth login --api-url http://localhost:3003
```

## Checks

```bash
vp run qa
```

`qa` runs formatting, linting, `sherif`, typechecks and the test suite. Tests live
in each package's `test/` directory and run from the repository root:

```bash
vp test run     # single pass
vp test watch   # watch mode
```

The API keeps every browser page and draft private. Browser access uses a Shoo
session plus a one-time subdomain handshake. Agents use a Bearer API key for
listing, uploading and fetching draft HTML.
