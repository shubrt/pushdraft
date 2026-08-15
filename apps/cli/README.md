# pushdraft

Publish private HTML drafts to [pushover.dev](https://pushover.dev).

## Run without installing

```bash
npx pushdraft upload ./plan.html
# or
bunx pushdraft upload ./plan.html
```

## Commands

```text
pushdraft auth login
pushdraft whoami
pushdraft upload <file>
pushdraft list
```

Run `pushdraft --help` for all options.

## Global installation

```bash
npm install --global pushdraft
pushdraft --help
```

The global package also installs `pushover` as an alias.
