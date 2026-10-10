# Changelog

## 0.1.0

- The default API URL is now `https://draft.shubrt.me`. Configs, `API_URL`,
  `--api-url` and draft mappings that still point at `https://pushdraft.dev`
  resolve to the new domain, so re-uploading a known file still adds a version
  to the same draft.
- Versions before 0.1.0 still default to `https://pushdraft.dev`, which now only
  redirects, and their requests fail there. Upgrade with
  `npx pushdraft@latest`. Setting `API_URL` on an older version is no
  workaround: it misses the saved mappings and creates new drafts.
- `pushdraft upload` accepts `.png`, `.jpg`, `.jpeg` and `.webp` files and
  publishes them as image drafts.
- `--ref <name=id>` attaches an image draft to an HTML upload. Repeat it for
  several images and use `refs/<name>` in the HTML.
- `--refs-file <path>` reads a JSON manifest of local images, uploads or updates
  each one and attaches them to the HTML in one command. If an image fails, the
  CLI skips the HTML upload.
- `--draft` must be a 12-character draft ID and cannot be combined with `--new`.
  The CLI rejects invalid values before uploading anything.
- The CLI keeps one draft mapping per API URL and account. Switching between a
  preview and production, or between accounts, no longer loses the mapping for
  the other one.
- Concurrent uploads take file locks. Two runs no longer overwrite each other's
  entries in `~/.pushdraft/drafts.json`, and two first uploads of the same file
  no longer create two drafts.

## 0.0.1

- First public release.
