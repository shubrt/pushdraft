---
name: pushdraft-read
description: Fetch and read HTML from a Pushdraft URL through its authenticated raw endpoint. Use whenever the user provides a pushdraft.dev URL and asks to read, summarize, review, compare, or continue working from it.
---

# Read a Pushdraft

Use `curl` and `jq`. Fetch the uploaded HTML with the shell. Do not use web
search or a browser.

1. Remove a trailing slash from the URL, then append `/raw` unless the URL
   already ends in `/raw`.
2. Run:

   ```bash
   (PUSHDRAFT_API_KEY=$(jq -er '.apiKey' "$HOME/.pushdraft/credentials.json") && curl --fail --silent --show-error --location --max-time 30 --header "Authorization: Bearer ${PUSHDRAFT_API_KEY}" --output /tmp/pushdraft.html '<raw-url>')
   ```

3. Read `/tmp/pushdraft.html` and continue the user's request from its contents.

If credentials are missing, ask the user to run `npx pushdraft auth login`, then
retry. If `curl` fails, report its actual HTTP status or network error. Do not
substitute search results.
