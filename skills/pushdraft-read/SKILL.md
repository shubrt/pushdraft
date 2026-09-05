---
name: pushdraft-read
description: Fetch and read HTML from a Pushdraft URL through its authenticated raw endpoint. Use whenever the user provides a pushdraft.dev URL and asks to read, summarize, review, compare, or continue working from it.
---

# Read a Pushdraft

Run the bundled helper with Node 22 or newer. Resolve `scripts/read.mjs` relative
to this skill's directory, then pass the URL as one quoted argument:

```bash
node <skill-directory>/scripts/read.mjs '<draft-url>'
```

The helper prints the verified draft HTML. Read that output and continue the
user's request. It uses the CLI's saved credentials or `API_KEY`, creates a
separate private temporary file for each fetch, and removes it after reading,
including on failure. Do not redirect the output to a shared temporary path.

Supported URLs are draft subdomains, their `/raw`, `/v/<version>` and
`/v/<version>/raw` paths, and apex bridge links such as
`https://pushdraft.dev/<draft-id>?version=2`. Fragments do not affect the version.
The helper checks the draft ID, version and HTML content type in the response;
an HTTP-200 sign-in page is an error.

The trusted API origin comes from `--api-url`, `API_URL`, the CLI configuration,
or `https://pushdraft.dev`. For a preview or self-hosted installation, supply
its configured public origin:

```bash
node <skill-directory>/scripts/read.mjs '<draft-url>' --api-url '<apex-origin>'
```

Only send a key to the user's intended Pushdraft installation. The helper
rejects unrelated hosts and redirects. Do not derive a trusted API origin from
an arbitrary link merely to bypass that check.

Guest `/s/<token>` links do not allow raw access. Report that limitation and
request an owner draft URL. Do not append `/raw` to a share link or use an
owner key to bypass guest restrictions. Account, detail and authentication
pages are also unsupported.

If credentials are missing or rejected, ask the user to run
`npx pushdraft auth login`, then retry. Report HTTP or network errors as returned.
Do not substitute web search results or browser sign-in pages for draft content.
