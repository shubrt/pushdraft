import type { ContentDescriptor, DraftDetailResponse, DraftSummary } from "@pushdraft/contracts";

import type { WebSession } from "../auth/session";
import type { CreatedDraftShare, DraftShareSummary } from "../shares/repository";

type ActiveNavigation = "drafts" | "cli";

export function renderHome(): string {
  return page(
    "pushdraft",
    `${publicHeader()}<main class="landing page-shell">
      <p class="eyebrow">PRIVATE DRAFT PUBLISHING</p>
      <h1>Private drafts<br>for agents.</h1>
      <p class="lede">Authenticated static HTML publishing for humans and agents.</p>
      <pre class="command"><span>$</span> npx pushdraft upload ./plan.html</pre>
      <div class="landing-links"><a href="/drafts">My drafts</a><a href="/cli/auth">CLI setup</a></div>
    </main>`,
  );
}

export function renderSignIn(next: string): string {
  return page(
    "Sign in · pushdraft",
    `${publicHeader()}<main class="center page-shell">
      <div class="center-content">
        <p class="eyebrow">IDENTITY REQUIRED</p>
        <h1>Private means<br>signed in.</h1>
        <p class="lede">Sign in to read your drafts and manage API access.</p>
        <p><a class="button" href="/auth/sign-in?next=${encodeURIComponent(next)}">Continue with shoo</a></p>
        <p class="fine-print">CLI reads and writes use an API key.</p>
      </div>
    </main>`,
  );
}

export function renderAuthError(message: string): string {
  return page(
    "Sign-in error · pushdraft",
    `${publicHeader()}<main class="center page-shell"><div class="center-content"><p class="eyebrow">SIGN-IN ERROR</p><h1>Could not sign in.</h1><p class="lede">${escapeHtml(message)}</p><p><a href="/">Return home</a></p></div></main>`,
  );
}

export function renderDrafts(
  session: WebSession,
  csrfToken: string,
  drafts: DraftSummary[],
): string {
  const groups = groupDrafts(drafts);
  const body = groups
    .map(([repository, values]) => {
      const repositoryLink = githubRepositoryLink(values[0]);
      return `<section class="repository-section">
        <div class="repository-heading">
          <h2>${escapeHtml(repository)}</h2>
          ${repositoryLink ? `<a class="repository-link" href="${repositoryLink}" target="_blank" rel="noreferrer">GitHub ↗</a>` : ""}
        </div>
        <div class="draft-list">
          ${values.map(renderDraftRow).join("")}
        </div>
      </section>`;
    })
    .join("");

  return page(
    "My drafts · pushdraft",
    `${header(session, csrfToken, "drafts")}<main class="screen page-shell"><h1 class="screen-title">My drafts</h1>${body || '<p class="empty-state">No drafts yet. Upload one with <code>pushdraft upload ./plan.html</code>.</p>'}</main>`,
  );
}

export function renderDraftDetail(
  session: WebSession,
  csrfToken: string,
  detail: DraftDetailResponse,
  shares: DraftShareSummary[] = [],
): string {
  const versionRows = detail.versions
    .map(
      (version) => `<div class="version-row">
        <a class="version-number" href="/${detail.draft.draftId}?version=${version.versionNumber}">v${version.versionNumber}</a>
        <span class="version-file">${escapeHtml(version.file.filename ?? "file")} · ${formatFileKind(version.file.content.kind)} · ${formatBytes(version.file.byteSize)}</span>
        <time datetime="${escapeHtml(version.createdAt)}">${formatDateTime(version.createdAt)}</time>
      </div>`,
    )
    .join("");
  const shareRows = shares
    .map(
      (share) => `<div class="share-row">
        <div class="share-details">
          <strong>v${share.versionNumber}</strong>
          <span>expires <time datetime="${escapeHtml(share.expiresAt)}">${formatExactDateTime(share.expiresAt)}</time></span>
        </div>
        <form method="post" action="/drafts/${encodeURIComponent(detail.draft.draftId)}/shares/${encodeURIComponent(share.id)}/revoke">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          <button class="link" type="submit">Revoke</button>
        </form>
      </div>`,
    )
    .join("");
  const shareAction =
    detail.draft.disabled || detail.draft.latestVersionNumber === null
      ? ""
      : `<a href="/drafts/${encodeURIComponent(detail.draft.draftId)}/share">Share draft</a>`;

  return page(
    `${detail.draft.title} · pushdraft`,
    `${header(session, csrfToken, "drafts")}<main class="screen detail-screen page-shell">
      <a class="back-link" href="/drafts">← My drafts</a>
      <div class="detail-heading">
        <p class="eyebrow">/DRAFTS/${escapeHtml(detail.draft.draftId.toUpperCase())}</p>
        <h1>${escapeHtml(detail.draft.title)}</h1>
        ${detail.draft.description ? `<p class="lede">${escapeHtml(detail.draft.description)}</p>` : ""}
        <p class="detail-action detail-actions"><a href="/${detail.draft.draftId}">Open current draft ↗</a>${shareAction}</p>
      </div>
      <section class="shares-section">
        <div class="section-heading"><h2>Share links</h2><span>${shares.length} active</span></div>
        <div class="share-list">${shareRows || '<p class="empty-state">No active share links.</p>'}</div>
      </section>
      <section class="versions-section">
        <div class="section-heading"><h2>Version history</h2><span>${detail.versions.length} version${detail.versions.length === 1 ? "" : "s"}</span></div>
        <div class="version-list">${versionRows || '<p class="empty-state">No versions yet.</p>'}</div>
      </section>
    </main>`,
  );
}

export function renderDraftShareForm(
  session: WebSession,
  csrfToken: string,
  detail: DraftDetailResponse,
): string {
  const versionNumber = detail.draft.latestVersionNumber;
  const version =
    versionNumber === null ? "No version available" : `v${versionNumber} · current version`;

  return page(
    `Share ${detail.draft.title} · pushdraft`,
    `${header(session, csrfToken, "drafts")}<main class="screen share-screen page-shell">
      <a class="back-link" href="/drafts/${encodeURIComponent(detail.draft.draftId)}">← Draft details</a>
      <p class="eyebrow">/DRAFTS/${escapeHtml(detail.draft.draftId.toUpperCase())}/SHARE</p>
      <h1>Share draft</h1>
      <p class="lede">Anyone with this link can open the current version without signing in. It stops working when it expires or you revoke it.</p>
      <div class="share-summary"><span>Version</span><strong>${version}</strong></div>
      <form class="share-form" method="post" action="/drafts/${encodeURIComponent(detail.draft.draftId)}/shares">
        <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
        <div class="field">
          <label for="share-ttl">Expires after</label>
          <select id="share-ttl" name="ttlSeconds">
            <option value="3600">1 hour</option>
            <option value="86400">1 day</option>
            <option value="604800" selected>7 days</option>
            <option value="2592000">30 days</option>
          </select>
        </div>
        <button type="submit"${versionNumber === null ? " disabled" : ""}>Create share link</button>
      </form>
    </main>`,
  );
}

export function renderDraftShareCreated(
  session: WebSession,
  csrfToken: string,
  created: CreatedDraftShare,
  nonce: string,
): string {
  return page(
    "Share link created · pushdraft",
    `${header(session, csrfToken, "drafts")}<main class="screen share-screen page-shell">
      <a class="back-link" href="/drafts/${encodeURIComponent(created.draftId)}">← Draft details</a>
      <p class="eyebrow">SHARE LINK CREATED</p>
      <h1>Copy this link.</h1>
      <p class="lede">This link is shown once. It opens v${created.versionNumber} without signing in.</p>
      <label class="field-label" for="share-url">Share link</label>
      <div class="copy-row">
        <input class="share-url" id="share-url" type="url" value="${escapeHtml(created.url)}" readonly spellcheck="false">
        <button id="copy-share-link" type="button" hidden>Copy link</button>
      </div>
      <p class="copy-status" id="copy-status" role="status" aria-live="polite">Select the link and copy it.</p>
      <dl class="share-facts">
        <div><dt>Version</dt><dd>v${created.versionNumber}</dd></div>
        <div><dt>Expires</dt><dd><time datetime="${escapeHtml(created.expiresAt)}">${formatExactDateTime(created.expiresAt)}</time></dd></div>
      </dl>
      <p><a href="/drafts/${encodeURIComponent(created.draftId)}">Back to draft details</a></p>
      <script nonce="${escapeHtml(nonce)}">const input=document.getElementById("share-url");const button=document.getElementById("copy-share-link");const status=document.getElementById("copy-status");button.hidden=false;button.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(input.value);status.textContent="Link copied."}catch{input.focus();input.select();status.textContent="Could not copy. Press Ctrl+C or Command+C."}})</script>
    </main>`,
  );
}

export function renderCliAuth(
  session: WebSession,
  csrfToken: string,
  keys: Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }>,
): string {
  const keyRows = keys
    .map(
      (key) => `<div class="key-row">
        <div><strong>${escapeHtml(key.name)}</strong><span>created ${formatDate(key.createdAt)}</span></div>
        <span class="key-used">${key.lastUsedAt ? `last used ${formatDateTime(key.lastUsedAt)}` : "never used"}</span>
        <form method="post" action="/cli/auth/keys/${encodeURIComponent(key.id)}/revoke">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          <button class="link" type="submit">Revoke</button>
        </form>
      </div>`,
    )
    .join("");

  return page(
    "CLI setup · pushdraft",
    `${header(session, csrfToken, "cli")}<main class="screen cli-screen page-shell">
      <p class="eyebrow">/CLI/AUTH</p>
      <h1>Connect your CLI</h1>
      <p class="lede">Generate a key, then paste it into <code>pushdraft auth login</code>.</p>
      <form class="primary-form" method="post" action="/cli/auth/keys">
        <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
        <button type="submit">Generate a new API key</button>
      </form>
      <section class="keys-section">
        <div class="section-heading"><h2>Active keys</h2><span>${keys.length} active</span></div>
        <div class="key-list">${keyRows || '<p class="empty-state">No active keys.</p>'}</div>
      </section>
    </main>`,
  );
}

export function renderApiKey(
  session: WebSession,
  csrfToken: string,
  key: { name: string; token: string },
): string {
  return page(
    "New API key · pushdraft",
    `${header(session, csrfToken, "cli")}<main class="screen cli-screen page-shell">
      <p class="eyebrow">/CLI/AUTH/NEW</p>
      <h1>Your new API key</h1>
      <p class="lede">${escapeHtml(key.name)}. This key is shown once.</p>
      <pre class="secret">${escapeHtml(key.token)}</pre>
      <p>Paste it into your terminal now.</p>
      <p><a href="/cli/auth">Back to CLI setup</a></p>
    </main>`,
  );
}

export function renderDraftBridge(action: string, ticket: string, nonce: string): string {
  return page(
    "Opening draft · pushdraft",
    `${publicHeader()}<main class="center page-shell"><div class="center-content"><p class="eyebrow">PRIVATE DRAFT</p><h1>Opening draft.</h1><p class="lede">Continue to the authenticated document.</p><form id="draft-bridge" method="post" action="${escapeHtml(action)}"><input type="hidden" name="ticket" value="${escapeHtml(ticket)}"><button type="submit">Open draft</button></form><script nonce="${escapeHtml(nonce)}">document.getElementById("draft-bridge").requestSubmit()</script></div></main>`,
  );
}

export function renderDraftReady(targetPath: string, nonce: string): string {
  return page(
    "Opening draft · pushdraft",
    `<main class="center page-shell"><div class="center-content"><p class="eyebrow">PRIVATE DRAFT</p><h1>Opening draft.</h1><p class="lede">Authentication complete.</p><p><a href="${escapeHtml(targetPath)}">Open draft</a></p><script nonce="${escapeHtml(nonce)}">window.location.replace(${scriptJson(targetPath)})</script></div></main>`,
  );
}

export function renderDraftShareBridge(action: string, ticket: string, nonce: string): string {
  return page(
    "Opening shared draft · pushdraft",
    `${publicHeader()}<main class="center page-shell"><div class="center-content"><p class="eyebrow">SHARED DRAFT</p><h1>Opening draft.</h1><p class="lede">Continue to the shared document.</p><form id="share-bridge" method="post" action="${escapeHtml(action)}"><input type="hidden" name="ticket" value="${escapeHtml(ticket)}"><button type="submit">Open shared draft</button></form><script nonce="${escapeHtml(nonce)}">history.replaceState(null,"","/share");document.getElementById("share-bridge").requestSubmit()</script></div></main>`,
  );
}

export function renderDraftShareReady(targetPath: string, nonce: string): string {
  return page(
    "Opening shared draft · pushdraft",
    `<main class="center page-shell"><div class="center-content"><p class="eyebrow">SHARED DRAFT</p><h1>Opening draft.</h1><p class="lede">Share link accepted.</p><p><a href="${escapeHtml(targetPath)}">Open shared draft</a></p><script nonce="${escapeHtml(nonce)}">window.location.replace(${scriptJson(targetPath)})</script></div></main>`,
  );
}

export function renderDraftShareUnavailable(apexUrl = ""): string {
  return page(
    "Share unavailable · pushdraft",
    `${publicHeader(apexUrl)}<main class="center page-shell"><div class="center-content"><p class="eyebrow">SHARE LINK</p><h1>This link is unavailable.</h1><p class="lede">It may have expired or the owner revoked it.</p><p><a href="${escapeHtml(apexPath(apexUrl, "/"))}">Return home</a></p></div></main>`,
  );
}

export function renderNotFound(apexUrl = ""): string {
  return page(
    "Not found · pushdraft",
    `${publicHeader(apexUrl)}<main class="center page-shell"><div class="center-content"><p class="eyebrow">404</p><h1>Not found.</h1><p><a href="${escapeHtml(apexPath(apexUrl, "/"))}">Return home</a></p></div></main>`,
  );
}

function publicHeader(apexUrl = ""): string {
  return `<header class="site-header"><div class="site-header-inner"><a class="brand" href="${escapeHtml(apexPath(apexUrl, "/"))}" aria-label="pushdraft home">pushdraft</a><nav aria-label="Main navigation"><a href="${escapeHtml(apexPath(apexUrl, "/drafts"))}">My drafts</a><a href="${escapeHtml(apexPath(apexUrl, "/cli/auth"))}">CLI setup</a></nav></div></header>`;
}

function apexPath(apexUrl: string, path: string): string {
  return apexUrl ? `${apexUrl.replace(/\/$/, "")}${path}` : path;
}

function header(
  session: WebSession,
  csrfToken: string | undefined,
  activeNavigation: ActiveNavigation,
): string {
  const signOut = csrfToken
    ? `<form class="sign-out" method="post" action="/auth/sign-out"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="link" type="submit">Sign out</button></form>`
    : "";
  const accountLabel = session.email
    ? `${session.accountName}, ${session.email}`
    : session.accountName;
  const pictureUrl = safePictureUrl(session.pictureUrl);
  const avatar = pictureUrl
    ? `<img class="account-avatar" src="${escapeHtml(pictureUrl)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="account-avatar account-initial" aria-hidden="true">${escapeHtml(session.accountName.slice(0, 1).toUpperCase())}</span>`;
  const email = session.email
    ? `<span class="account-email" tabindex="0">${escapeHtml(session.email)}</span>`
    : "";

  return `<header class="site-header"><div class="site-header-inner">
    <a class="brand" href="/" aria-label="pushdraft home">pushdraft</a>
    <nav aria-label="Main navigation">
      <a${activeNavigation === "drafts" ? ' class="active" aria-current="page"' : ""} href="/drafts">My drafts</a>
      <a${activeNavigation === "cli" ? ' class="active" aria-current="page"' : ""} href="/cli/auth">CLI setup</a>
    </nav>
    <div class="account" aria-label="Signed in as ${escapeHtml(accountLabel)}">
      ${avatar}
      <span class="account-name">${escapeHtml(session.accountName)}</span>
      ${email}
    </div>
    ${signOut}
  </div></header>`;
}

function renderDraftRow(draft: DraftSummary): string {
  const version =
    draft.latestVersionNumber === null
      ? '<span class="no-version">no versions</span>'
      : `<span class="latest-version">v${draft.latestVersionNumber}</span><span aria-hidden="true">·</span><span>${draft.versionCount} version${draft.versionCount === 1 ? "" : "s"}</span>`;
  const updatedAt = draft.latestVersionAt ?? draft.updatedAt;

  return `<div class="draft-row">
    <a class="draft-title" href="/${draft.draftId}">${escapeHtml(draft.title)}</a>
    <span class="draft-meta"><a class="details-link" href="/drafts/${draft.draftId}">Details</a><span aria-hidden="true">·</span>${version}<span aria-hidden="true">·</span><time datetime="${escapeHtml(updatedAt)}">${formatTime(updatedAt)}</time></span>
  </div>`;
}

function groupDrafts(drafts: DraftSummary[]): Array<[string, DraftSummary[]]> {
  const groups = new Map<string, DraftSummary[]>();
  for (const draft of drafts) {
    const repository =
      draft.repoOrg && draft.repoName ? `${draft.repoOrg}/${draft.repoName}` : "No repository";
    const group = groups.get(repository) ?? [];
    group.push(draft);
    groups.set(repository, group);
  }
  return [...groups];
}

function githubRepositoryLink(draft: DraftSummary | undefined): string | null {
  if (
    !draft?.repoOrg ||
    !draft.repoName ||
    draft.repoHost?.toLowerCase().replace(/^www\./, "") !== "github.com"
  ) {
    return null;
  }
  return `https://github.com/${encodeURIComponent(draft.repoOrg)}/${encodeURIComponent(draft.repoName)}`;
}

function formatTime(value: string): string {
  const time = value.match(/T(\d{2}:\d{2})/)?.[1];
  return time ?? escapeHtml(value);
}

function formatDate(value: string): string {
  const date = value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  return date ?? escapeHtml(value);
}

function formatDateTime(value: string): string {
  const date = formatDate(value);
  const time = formatTime(value);
  return date === escapeHtml(value) || time === escapeHtml(value)
    ? escapeHtml(value)
    : `${date} · ${time}`;
}

function formatExactDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return escapeHtml(value);
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][parsed.getUTCMonth()];
  const hours = String(parsed.getUTCHours()).padStart(2, "0");
  const minutes = String(parsed.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${parsed.getUTCFullYear()} · ${hours}:${minutes} UTC`;
}

function formatFileKind(kind: ContentDescriptor["kind"]): string {
  return kind.toUpperCase();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(kilobytes >= 10 ? 0 : 1)} KB`;
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
}

function safePictureUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function scriptJson(value: string): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#000000"><title>${escapeHtml(title)}</title><style>
    :root{color-scheme:dark;--black:#000;--ink:#f4f4f0;--muted:#92928b;--line:#292927;--surface:#0b0b0a;--accent:#dfff00}
    *{box-sizing:border-box}
    [hidden]{display:none!important}
    html{min-width:320px;background:var(--black)}
    body{min-height:100vh;margin:0;background:var(--black);color:var(--ink);font:15px/1.5 "Avenir Next",Avenir,"Segoe UI",Arial,sans-serif;-webkit-font-smoothing:antialiased}
    ::selection{background:var(--accent);color:var(--black)}
    a,.link{color:var(--accent);text-underline-offset:3px}
    a:hover,.link:hover{text-decoration-thickness:2px}
    a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
    h1,h2,p{margin-top:0}
    h1,h2,strong,.draft-title{font-weight:700}
    code,pre,.eyebrow,.draft-meta,.version-row,.key-row,.fine-print{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace}
    code{font-size:.92em;color:var(--ink)}
    button,.button{display:inline-block;border:1px solid var(--accent);border-radius:0;background:var(--accent);color:var(--black);padding:11px 15px;text-decoration:none;font:700 13px/1.2 "Avenir Next",Avenir,"Segoe UI",Arial,sans-serif;cursor:pointer}
    button:hover,.button:hover{background:var(--ink);border-color:var(--ink);text-decoration:none}
    .link{border:0;background:none;padding:0;font:inherit;cursor:pointer}
    .link:hover{background:none;color:var(--accent);text-decoration:underline}
    .page-shell{width:min(100% - 40px,1050px);margin-inline:auto}
    .site-header{border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .site-header-inner{min-height:62px;width:min(100% - 40px,1050px);margin-inline:auto;display:flex;align-items:center;gap:28px}
    .brand{color:var(--ink);font:700 23px/1 Georgia,"Times New Roman",serif;text-decoration:none;letter-spacing:-.04em}
    .brand:hover{text-decoration:none;color:var(--accent)}
    nav{display:flex;align-items:center;gap:26px}
    nav a{color:var(--muted);text-decoration:none}
    nav a:hover,nav a.active{color:var(--accent);text-decoration:none}
    .account{min-width:0;margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px;white-space:nowrap}
    .account-avatar{width:24px;height:24px;flex:0 0 24px;border:1px solid var(--line);border-radius:50%;object-fit:cover}
    .account-initial{display:grid;place-items:center;background:var(--surface);color:var(--ink);font:700 11px/1 "Avenir Next",Avenir,"Segoe UI",Arial,sans-serif}
    .account-name{color:var(--ink)}
    .account-email{max-width:220px;overflow:hidden;text-overflow:ellipsis;filter:blur(4px);opacity:.72;user-select:none}
    .account:hover .account-email,.account-email:focus{filter:none;opacity:1;user-select:text;outline:none}
    .sign-out{margin:0;flex:0 0 auto}
    .sign-out .link{color:var(--ink);font-size:12px;text-decoration:underline}
    .screen{padding-top:34px;padding-bottom:72px}
    .screen-title{margin-bottom:28px;font-size:30px;line-height:1.1;letter-spacing:-.04em}
    .repository-section{margin-top:30px}
    .repository-section:first-of-type{margin-top:0}
    .repository-heading{display:flex;align-items:baseline;gap:13px;margin-bottom:7px}
    .repository-heading h2{margin:0;font-size:16px;line-height:1.2}
    .repository-link{font-size:12px;text-decoration:none}
    .draft-list{border-bottom:1px solid var(--line)}
    .draft-row{min-height:43px;border-top:1px solid var(--line);display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:28px}
    .draft-row:first-child{border-top:0}
    .draft-title{padding:10px 0;color:var(--accent);text-decoration:none;min-width:0;overflow-wrap:anywhere}
    .draft-title:hover{text-decoration:underline}
    .draft-meta{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:11px;white-space:nowrap}
    .details-link{color:var(--ink)}
    .latest-version{color:var(--accent)}
    .no-version{color:var(--muted)}
    .back-link{display:inline-block;margin-bottom:34px;font-size:13px;text-decoration:none}
    .detail-screen{max-width:900px}
    .detail-heading{max-width:720px;margin-bottom:52px}
    .detail-heading h1,.cli-screen h1,.landing h1,.center h1{margin-bottom:14px;font-size:clamp(38px,6vw,62px);line-height:.98;letter-spacing:-.055em}
    .detail-heading h1,.cli-screen h1{font-size:clamp(34px,5vw,50px)}
    .eyebrow{margin-bottom:13px;color:var(--muted);font-size:10px;letter-spacing:.08em}
    .lede{max-width:560px;margin-bottom:24px;color:var(--muted);font-size:16px}
    .detail-action{margin:0}
    .detail-actions{display:flex;gap:22px;flex-wrap:wrap}
    .section-heading{min-height:45px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:20px}
    .section-heading h2{margin:0;font-size:18px}
    .section-heading span{color:var(--muted);font:11px/1.4 "SFMono-Regular",Consolas,"Liberation Mono",monospace}
    .version-row{min-height:42px;border-bottom:1px solid var(--line);display:grid;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:18px;color:var(--muted);font-size:11px}
    .version-file{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .shares-section{margin-bottom:52px}
    .share-row{min-height:52px;border-bottom:1px solid var(--line);display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:26px}
    .share-details{display:flex;align-items:baseline;gap:16px;min-width:0}
    .share-details strong{color:var(--accent)}
    .share-details span{color:var(--muted);font:11px/1.4 "SFMono-Regular",Consolas,"Liberation Mono",monospace}
    .share-screen{max-width:760px;padding-top:52px}
    .share-screen h1{margin-bottom:14px;font-size:clamp(34px,5vw,50px);line-height:.98;letter-spacing:-.055em}
    .share-summary{max-width:520px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:13px 0;display:flex;justify-content:space-between;gap:24px}
    .share-summary span,.field-label{color:var(--muted);font-size:12px}
    .share-form{max-width:520px;margin-top:30px}
    .field{margin-bottom:24px}
    .field label,.field-label{display:block;margin-bottom:7px}
    .field select,.share-url{width:100%;border:1px solid var(--line);border-radius:0;background:var(--surface);color:var(--ink);padding:11px 12px;font:13px/1.3 "SFMono-Regular",Consolas,"Liberation Mono",monospace}
    button:disabled{cursor:not-allowed;opacity:.45}
    .copy-row{display:flex;align-items:stretch;gap:10px}
    .share-url{min-width:0;color:var(--accent)}
    .copy-status{min-height:22px;margin:8px 0 30px;color:var(--muted);font-size:11px}
    .share-facts{max-width:520px;margin:0 0 30px;border-top:1px solid var(--line)}
    .share-facts div{border-bottom:1px solid var(--line);padding:11px 0;display:grid;grid-template-columns:90px minmax(0,1fr);gap:18px}
    .share-facts dt{color:var(--muted);font-size:12px}
    .share-facts dd{margin:0;font:12px/1.5 "SFMono-Regular",Consolas,"Liberation Mono",monospace}
    .cli-screen{max-width:760px;padding-top:72px}
    .cli-screen>.lede{margin-bottom:28px}
    .primary-form{margin:0 0 54px}
    .keys-section{margin-top:0}
    .key-row{min-height:52px;border-bottom:1px solid var(--line);display:grid;grid-template-columns:minmax(170px,1fr) auto auto;align-items:center;gap:26px;color:var(--muted);font-size:11px}
    .key-row>div{display:flex;flex-direction:column;min-width:0}
    .key-row strong{color:var(--ink);font-family:"Avenir Next",Avenir,"Segoe UI",Arial,sans-serif;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .key-used{white-space:nowrap}
    .empty-state{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:18px 0;color:var(--muted)}
    .landing{padding-top:clamp(72px,12vh,150px);padding-bottom:80px}
    .landing h1,.center h1{font-family:Georgia,"Times New Roman",serif;font-weight:400}
    .landing .lede{font-size:18px}
    .command,.secret{max-width:620px;margin:34px 0 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:16px 0;background:transparent;color:var(--ink);overflow:auto;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
    .command span{color:var(--accent)}
    .landing-links{display:flex;gap:22px;margin-top:22px}
    .center{min-height:calc(100vh - 64px);display:grid;align-items:center;padding-top:60px;padding-bottom:80px}
    .center-content{max-width:620px}
    .fine-print{margin-top:22px;color:var(--muted);font-size:11px}
    .secret{max-width:100%;margin:26px 0 18px;color:var(--accent)}
    @media(max-width:720px){
      .page-shell{width:min(100% - 32px,1050px)}
      .site-header-inner{width:min(100% - 32px,1050px);min-height:72px;gap:18px;flex-wrap:wrap;padding:13px 0}
      nav{order:3;width:100%;gap:22px}
      .account{margin-left:auto;max-width:48%}
      .sign-out{order:2}
      .screen{padding-top:34px;padding-bottom:54px}
      .draft-row{grid-template-columns:1fr;gap:0;padding:9px 0}
      .draft-title{padding:0 0 3px}
      .draft-meta{white-space:normal;flex-wrap:wrap}
      .detail-heading{margin-bottom:40px}
      .version-row{grid-template-columns:42px minmax(0,1fr);gap:12px;padding:9px 0}
      .version-row time{grid-column:2}
      .cli-screen{padding-top:48px}
      .key-row{grid-template-columns:1fr auto;gap:5px 16px;padding:10px 0}
      .key-used{grid-column:1}
      .key-row form{grid-column:2;grid-row:1 / span 2}
      .share-screen{padding-top:40px}
    }
    @media(max-width:430px){
      .account-email{display:none}
      .screen-title{font-size:28px}
      .repository-heading{align-items:flex-start;flex-direction:column;gap:3px}
      .section-heading{align-items:flex-start;flex-direction:column;justify-content:center;gap:2px;padding:9px 0}
      .share-details{align-items:flex-start;flex-direction:column;gap:2px;padding:10px 0}
      .copy-row{align-items:stretch;flex-direction:column}
    }
  </style></head><body>${body}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}
