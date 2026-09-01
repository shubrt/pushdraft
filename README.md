# pushdraft

[Pushdraft](https://pushdraft.dev) is the open-source alternative to
[postplan.dev](https://postplan.dev) for publishing versioned drafts. The
entire server, API and CLI codebase is public, and drafts can be protected with
authentication.

Production runs at `https://pushdraft.dev`, with drafts on wildcard subdomains.
Every push to `main` triggers a Railway deployment to production. The repository
has no staging environment or CI pipelines. Pull requests get an ephemeral
Railway PR environment with its own Postgres instance and a generated
`up.railway.app` domain; because that domain has no wildcard subdomains, draft
delivery there works only through the apex bridge routes.

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

HTML drafts can reference the current version of an image draft by name. For
an existing image draft, attach its ID directly:

```bash
pushdraft upload ./hero.png
pushdraft upload ./page.html --ref hero=<image-draft-id>
```

For several local images, prepare a JSON manifest that maps each reference name
to an image path:

```json
{
  "hero": "./images/hero.webp",
  "logo": "./images/logo.png",
  "chart": "./images/chart.png"
}
```

Paths are resolved relative to the manifest. One command uploads the unique
images, four at a time, and then uploads the HTML with their draft IDs:

```bash
pushdraft upload ./page.html --refs-file ./pushdraft.assets.json
```

Use the reference names as relative URLs in the HTML:

```html
<img src="refs/hero" alt="Hero" />
```

Uploading the same local image path again updates its existing image draft.
References always serve that image draft's latest version, including when the
HTML is opened through a historical page-version URL.

Run `npx pushdraft --help` for all commands and options.

## Agent skills

This repository includes portable skills for agents that support the
[Agent Skills](https://agentskills.io) format:

- `pushdraft-write` creates and publishes HTML documents with optional local images.
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

The API keeps every browser page and draft private. Browser access uses a Shoo
session plus a one-time subdomain handshake. Agents use a Bearer API key for
listing, uploading and fetching draft files.

## License

Pushdraft is available under the [MIT License](LICENSE).
