# pp

Monorepo skeleton. `apps/` and `libs/` are empty and waiting for packages.

## Layout

```
apps/              application packages (empty)
libs/              shared library packages (empty)
tools/typescript/  shared tsconfig presets (@tool/tsconfig)
docs/              project docs (empty)
```

## Prerequisites

- Node >= 22
- pnpm >= 11
- Bun >= 1.3.10

## Setup

```bash
pnpm install
cp .env.example .env
```

## Scripts

| Script           | Purpose                                    |
| ---------------- | ------------------------------------------ |
| `pnpm dev`       | run every package's `dev` in parallel      |
| `pnpm build`     | run every package's `build`                |
| `pnpm typecheck` | run every package's `typecheck`            |
| `pnpm check`     | lint and format via vite-plus              |
| `pnpm fix`       | lint and format with autofix               |
| `pnpm qa`        | check, sherif, typecheck, schema check     |

Workspace packages are picked up from `apps/*`, `libs/*`, and `tools/*`. Name new
ones `@pp/<name>` so the filters in `package.json` and `railway.json` resolve.
