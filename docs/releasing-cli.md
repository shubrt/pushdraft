# Releasing the CLI

The `pushdraft` package uses npm trusted publishing. GitHub Actions publishes
tagged releases without a stored npm token.

## First release

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

Create a GitHub environment named `npm`. Add a required reviewer if releases
should wait for manual approval. In the npm package settings, select "Require
two-factor authentication and disallow tokens" after trusted publishing works.

## Later releases

1. Update the version in `apps/cli/package.json` and add the release notes to
   `apps/cli/CHANGELOG.md` in a pull request.
2. Run `pnpm run qa` and merge the pull request into `main`.
3. Tag the merge commit with the matching `cli-v<version>` tag.

```bash
git switch main
git pull --ff-only
git tag -a cli-v0.0.2 -m "pushdraft 0.0.2"
git push origin cli-v0.0.2
```

The publish workflow rejects a tag when its version does not match
`apps/cli/package.json` or its commit is not part of `main`. It then installs
dependencies, runs the repository checks, inspects the package contents and
publishes from `apps/cli` through npm OIDC.
