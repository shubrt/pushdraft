# pushdraft

[Pushdraft](https://pushdraft.dev) is the open-source alternative to
[postplan.dev](https://postplan.dev) for publishing versioned drafts. The
entire server, API and CLI codebase is public, and drafts can be protected with
authentication.

Production runs at `https://pushdraft.dev`, with drafts on wildcard subdomains.
Every successful push to `main` deploys to the isolated staging environment at
`https://staging.pushdraft.dev`. A matching `v<version>` tag deploys that commit
to production and then publishes the CLI with the same version.

## Packages

- `apps/api`: Elysia API, Shoo sign-in, PostgreSQL persistence and draft delivery
- `apps/cli`: `pushdraft` CLI for authentication, upload, update, list and whoami
- `libs/contracts`: shared runtime-validated API contracts

## CLI

Run the CLI without installing it:

```bash
npx pushdraft upload ./plan.html
# or
bunx pushdraft upload ./plan.html
```

HTML drafts can reference the current version of an image draft by name:

```bash
pushdraft upload ./hero.png
pushdraft upload ./page.html --ref hero=<image-draft-id>
```

The HTML uses a relative URL so current and historical page versions resolve
their own reference mapping:

```html
<img src="refs/hero" alt="Hero" />
```

Run `npx pushdraft --help` for all commands and options.

## Agent skills

This repository includes portable skills for agents that support the
[Agent Skills](https://agentskills.io) format:

- `pushdraft-write` creates and publishes self-contained HTML documents.
- `pushdraft-read` reads an existing Pushdraft URL through its raw endpoint.

Install them from the repository with:

```bash
npx skills add shubrt/pushdraft
```

The canonical files live in [`skills`](skills). To install a skill manually,
copy its directory to `~/.claude/skills/` for Claude Code or
`~/.codex/skills/` for Codex.

## Local setup

Requirements: [Vite+](https://viteplus.dev) (`vp`), Node 22+, Bun 1.3.10+ and Docker.
`vp` drives installs, scripts, checks and tests; Bun is the API runtime and bundler.

```bash
vp i
cp .env.example .env
docker compose up -d postgres
vp run db:deploy
vp run -F @pushdraft/api dev
```

The apex runs at `http://localhost:3003`. Drafts use
`http://<draft-id>.localhost:3003`; local DNS support for wildcard localhost names
depends on the browser and operating system.

Build the CLI with:

```bash
vp run -F pushdraft build
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

App and CLI releases use one tag and npm trusted publishing from GitHub Actions.
See [`docs/releasing-cli.md`](docs/releasing-cli.md) for environment setup and
the release flow.

The API keeps every browser page and draft private. Browser access uses a Shoo
session plus a one-time subdomain handshake. Agents use a Bearer API key for
listing, uploading and fetching draft files.

## License

Pushdraft is available under the [MIT License](LICENSE).
