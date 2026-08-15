# pushdraft

The CLI for [Pushdraft](https://pushdraft.dev), the open-source alternative to
[postplan.dev](https://postplan.dev). Publish versioned HTML drafts and protect
them with authentication. The server, API and CLI are all open source.

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
