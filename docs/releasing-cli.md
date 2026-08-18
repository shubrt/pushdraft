# Releasing Pushdraft

A `v<version>` tag releases the same commit to the production app and npm. The
version must match `apps/cli/package.json` exactly.

Pushes to `main` deploy to staging after CI passes. Staging starts with its own
empty database and uses these domains:

- `staging.pushdraft.dev`
- `*.staging.pushdraft.dev`

The release workflow keeps Railway and npm credentials in separate GitHub
environments. It deploys production before it publishes the CLI.

## GitHub and Railway setup

In Railway:

1. Connect the staging API service to `main`, enable "Wait for CI" and disable
   watch-path filters. The `CI` workflow runs on every push to `main`.
2. Disable GitHub autodeploys and "Wait for CI" for the production API service.
   Production only deploys from release tags, after the workflow's own checks.
3. Set `/healthz` as the Railway health check for staging. The release workflow
   checks the production endpoint after each tagged deployment.

Create a Railway project token scoped to the production environment. In
GitHub, create a `production` environment with:

- Secret `RAILWAY_TOKEN`: the production-scoped Railway project token
- Variable `RAILWAY_PROJECT_ID`: the Railway project ID
- Variable `RAILWAY_ENVIRONMENT_ID`: the production environment ID
- Variable `RAILWAY_SERVICE_ID`: the API service ID

Create a separate GitHub environment named `npm`. Add a required reviewer to
either environment if releases need approval.

## First npm release

Trusted publishing can only be configured after the package exists on npm.
After the release setup has reached `main`, publish `0.0.1` once from a clean
checkout:

```bash
cd apps/cli
npm publish --access public
```

Then authorize the workflow on npm:

```bash
npx npm@latest trust github pushdraft \
  --repo shubrt/pushdraft \
  --file publish-cli.yml \
  --environment npm \
  --allow-publish
```

In the npm package settings, select "Require two-factor authentication and
disallow tokens" after trusted publishing works.

## Release

1. Update the version in `apps/cli/package.json` and add the release notes to
   `apps/cli/CHANGELOG.md` in a pull request.
2. Merge the pull request into `main` and confirm the staging deployment.
3. Tag that commit with the matching `v<version>` tag.

```bash
git switch main
git pull --ff-only
git tag -a v0.0.2 -m "pushdraft 0.0.2"
git push origin v0.0.2
```

The release workflow rejects a tag when its version does not match
`apps/cli/package.json` or the tagged commit is not on `main`. It runs the
repository checks once, tells Railway to deploy the exact tagged commit and
waits for a successful deployment. It then checks
`https://pushdraft.dev/healthz` and publishes from `apps/cli` through npm OIDC.
A failed deployment or health check blocks npm publishing.
