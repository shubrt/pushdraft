---
name: pushdraft-write
description: Create and publish self-contained HTML documents with Pushdraft. Use when the user wants a plan, spec, write-up, findings, summary, report, comparison, or UI mocks as readable HTML, or mentions HTML without more context. Do not use for HTML that ships as part of a product.
---

# HTML communication

## Document

Create one self-contained HTML file, capped at 512 KB.

- Write it like a spec, not a landing page. Keep it dense and scannable. Avoid
  heroes, decorative chrome, marketing voice, and em dashes.
- Default to true black (`#000`), white primary text, and dark gray only for
  secondary surfaces or accents.
- Make it mobile-readable with a responsive viewport and no fixed-width layout.
- Use semantic HTML, inline CSS, inline SVG, and HTTPS or data URL images.
- Use an inline classic script only when interactivity materially helps. Keep
  scripted pages useful without JavaScript. The sandbox blocks storage, fetch,
  workers, frames, forms, and popups.
- In script-free files, give external links `target="_blank"` and
  `rel="noopener noreferrer"`. If any script exists, omit `target="_blank"`.

Never include external or module scripts, inline event handlers, `javascript:`
URLs, forms, frames, embeds, objects, applets, meta refresh, linked stylesheets,
secrets, private URLs, or local filesystem paths.

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

1. Write the HTML file locally.
2. Run `npx pushdraft upload <file path>`.
3. After the upload succeeds, delete that exact local HTML file.
4. Report the returned Pushdraft URL.

Re-create and upload the same absolute path to update the existing URL. Use
`npx pushdraft upload <file path> --new` only when the user wants a new draft.

Never leave a local HTML file behind after a successful upload. If the upload
fails, keep the file only to fix and retry it, then delete it after the retry
succeeds.

If validation fails, fix the markup and retry. If a scripted upload needs
authentication, ask the user to run `npx pushdraft auth login`, then retry
without removing the requested interactivity.

Never open a browser or claim the document is hosted before upload succeeds.
Do not verify it in a browser unless the user asks.
