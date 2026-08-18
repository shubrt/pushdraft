# pushdraft

The CLI for [Pushdraft](https://pushdraft.dev), the open-source alternative to
[postplan.dev](https://postplan.dev). Publish versioned HTML drafts and protect
them with authentication. Raster image drafts can be attached to HTML drafts by
name. The server, API and CLI are all open source.

## Run without installing

```bash
npx pushdraft upload ./plan.html
# or
bunx pushdraft upload ./plan.html
```

Attach a live image reference:

```bash
pushdraft upload ./hero.png
pushdraft upload ./page.html --ref hero=<image-draft-id>
```

Use `<img src="refs/hero" alt="Hero">` in the HTML. Updating `hero.png` updates
the rendered page without creating a new page version.

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
