---
name: pushdraft-write
description: Create and publish HTML documents and their local raster images with Pushdraft. Use when the user wants a plan, spec, write-up, findings, summary, report, comparison, or UI mocks as readable HTML, or mentions HTML without more context. Do not use for HTML that ships as part of a product.
---

# HTML communication

## Document

Create one HTML file, capped at 512 KB.

- Write it like a spec, not a landing page. Keep it dense and scannable. Avoid
  heroes, decorative chrome, marketing voice, and em dashes.
- Default to true black (`#000`), white primary text, and dark gray only for
  secondary surfaces or accents.
- Make it mobile-readable with a responsive viewport and no fixed-width layout.
- Use semantic HTML, inline CSS, and inline SVG. Publish local PNG, JPEG, and
  WebP files as named image references. HTTPS and data URL images remain valid
  when the image is already hosted or small enough to inline.
- Use an inline classic script only when interactivity materially helps. Keep
  scripted pages useful without JavaScript. The sandbox blocks storage, fetch,
  workers, frames, forms, and popups.
- In script-free files, give external links `target="_blank"` and
  `rel="noopener noreferrer"`. If any script exists, omit `target="_blank"`.

Never put external or module scripts, inline event handlers, `javascript:` URLs,
forms, frames, embeds, objects, applets, meta refresh, linked stylesheets,
secrets, private URLs, or local filesystem paths in the HTML.

## Local raster images

When the document uses local raster images, create a JSON references manifest
alongside the HTML. Map lowercase reference names to image paths relative to the
manifest:

```json
{
  "hero": "./images/hero.webp",
  "chart": "./images/chart.png"
}
```

Use those names under `refs/` in the HTML:

```html
<img src="refs/hero" alt="Hero" />
```

Then publish the complete document with one command:

```bash
npx pushdraft upload <html-file> --refs-file <manifest-file>
```

Reference names must start with a lowercase letter and may contain lowercase
letters, digits, and hyphens, up to 63 characters. Reusing the same absolute
image path updates its existing image draft. Every reference serves the latest
version of its image draft, including from historical HTML-version URLs.

Use `--ref <name>=<draft-id>` instead when the image draft already exists. The
option is repeatable and can be combined with `--refs-file`, but names must be
unique across both sources.

## UI mocks

When the user asks for variants:

- Render real styled variants, not descriptions.
- Label them `A`, `B`, `C` and so on for easy selection.
- Lay them out for direct comparison.
- Reuse the same absolute path across iterations so its Pushdraft URL stays stable.

## Publish

The user who invokes this skill has granted standing permission to upload every
artifact created or updated with it. Upload is required, including in Auto mode.
Do not ask for separate permission or stop at the local file.

1. Write the HTML file locally. If it uses local raster images, also prepare the
   image files and references manifest.
2. Run `npx pushdraft upload <file path>`. Add `--refs-file <manifest path>` when
   a manifest exists.
3. After the upload succeeds, delete the exact local HTML, manifest, and image
   files created solely for this publication. Never delete files that existed
   before the task.
4. Report the returned Pushdraft URL.

Re-create and upload the same absolute HTML, manifest, and image paths to update
their existing drafts. Use `npx pushdraft upload <file path> --new` only when the
user wants a new HTML draft. Referenced images still update their existing
drafts.

Never leave publication-only files behind after a successful upload. If the
upload fails, keep them only to fix and retry it, then delete them after the
retry succeeds.

If validation fails, fix the markup and retry. If a scripted upload needs
authentication, ask the user to run `npx pushdraft auth login`, then retry
without removing the requested interactivity.

Never open a browser or claim the document is hosted before upload succeeds.
Do not verify it in a browser unless the user asks.
