import { uploadPayloadSchema, type UploadPayload } from "@pushdraft/contracts";
import { Elysia } from "elysia";

import {
  consumeDraftAccessTicket,
  createApiKey,
  createDraftAccessTicket,
  createWebSession,
  findActiveWebSessionById,
  findApiKeyByToken,
  findOrCreateAccountForIdentity,
  findWebSession,
  listApiKeys,
  revokeApiKey,
  revokeWebSession,
  validCsrfToken,
  type ApiKeyAuth,
} from "./auth/repository";
import {
  clearAuthStateCookie,
  clearCsrfCookie,
  clearSessionCookie,
  createAuthStateCookie,
  createCsrfCookie,
  createDraftShareSessionCookie,
  createDraftSessionCookie,
  createSessionCookie,
  readAuthState,
  readCsrfToken,
  readDraftShareSession,
  readDraftSession,
  readSessionToken,
  type WebSession,
} from "./auth/session";
import { buildAuthorizeUrl, buildPkce, exchangeAndVerifyShooCode } from "./auth/shoo";
import type { AppConfig } from "./config";
import type { Database } from "./db/database";
import { validateHtml } from "./drafts/html-policy";
import { validateImage } from "./drafts/image-policy";
import {
  getDraftDetail,
  getStoredContent,
  getStoredReference,
  listDrafts,
  uploadDraft,
} from "./drafts/repository";
import { randomToken } from "./lib/crypto";
import {
  apexOrigin,
  draftIdFromHostname,
  draftUrl,
  hasConfiguredPort,
  isApexHostname,
  safeApexPath,
} from "./lib/urls";
import {
  consumeDraftShareAccessTicket,
  createDraftShare,
  createDraftShareAccessTicket,
  findActiveDraftShare,
  getStoredSharedContent,
  getStoredSharedReference,
  isDraftShareTtlSeconds,
  listActiveDraftShares,
  revokeDraftShare,
} from "./shares/repository";
import {
  renderApiKey,
  renderAuthError,
  renderCliAuth,
  renderDraftBridge,
  renderDraftDetail,
  renderDraftReady,
  renderDraftShareBridge,
  renderDraftShareCreated,
  renderDraftShareForm,
  renderDraftShareReady,
  renderDraftShareUnavailable,
  renderDrafts,
  renderHome,
  renderNotFound,
  renderSignIn,
} from "./web/render";

type Dependencies = {
  config: AppConfig;
  database: Database;
};

type DraftRequestAccess =
  | { kind: "owner"; accountId: string }
  | { kind: "share"; shareId: string; versionNumber: number };

export function createApp({ config, database }: Dependencies) {
  return new Elysia()
    .onAfterHandle(({ request, responseValue, set }) => {
      set.headers["x-content-type-options"] = "nosniff";
      set.headers["cache-control"] = "private, no-store";
      // Apex forms need a concrete Origin for mutation guards. Draft content stays opaque.
      set.headers["referrer-policy"] = isApexHostname(config, new URL(request.url).hostname)
        ? "strict-origin"
        : "no-referrer";
      set.headers["x-frame-options"] = "DENY";
      set.headers["permissions-policy"] = "camera=(), microphone=(), geolocation=()";
      return responseValue;
    })
    .get("/healthz", async ({ set }) => {
      try {
        await database.query("SELECT 1");
        return { ok: true };
      } catch {
        set.status = 503;
        return { ok: false, error: "Database unavailable." };
      }
    })
    .all("/*", async (context) => {
      const requestUrl = new URL(context.request.url);
      if (!hasConfiguredPort(config, requestUrl)) {
        return response("Misdirected request.", 421, "text/plain; charset=utf-8");
      }
      const hostname = requestUrl.hostname;
      if (isApexHostname(config, hostname)) {
        return handleApex(context.request, requestUrl, config, database);
      }
      const draftId = draftIdFromHostname(config, hostname);
      if (draftId) return handleDraftHost(context.request, requestUrl, draftId, config, database);
      return response("Misdirected request.", 421, "text/plain; charset=utf-8");
    })
    .onError(({ error }) => {
      if (error instanceof RequestBodyTooLargeError) {
        return response("Request body too large.", 413, "text/plain; charset=utf-8");
      }
      console.error(error);
      return json({ ok: false, error: "Internal server error." }, 500);
    });
}

async function handleApex(
  request: Request,
  url: URL,
  config: AppConfig,
  database: Database,
): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/") return html(renderHome());

  if (request.method === "GET" && url.pathname === "/auth/sign-in") {
    const pkce = buildPkce();
    const next = safeNextPath(url.searchParams.get("next"));
    const redirectUri = new URL("/auth/callback", config.publicUrl).toString();
    const cookie = createAuthStateCookie(config, {
      purpose: "oauth-state",
      state: pkce.state,
      verifier: pkce.verifier,
      next,
    });
    return redirect(
      buildAuthorizeUrl(config, {
        redirectUri,
        state: pkce.state,
        challenge: pkce.challenge,
      }),
      303,
      [cookie],
    );
  }

  if (request.method === "GET" && url.pathname === "/auth/callback") {
    const state = readAuthState(config, request.headers);
    const returnedState = url.searchParams.get("state");
    if (!state || returnedState !== state.state) {
      return html(renderAuthError("Sign-in expired or state mismatch."), 400, [
        clearAuthStateCookie(config),
      ]);
    }
    if (url.searchParams.get("error") === "access_denied") {
      return html(renderAuthError("Sign-in was cancelled or consent was declined."), 403, [
        clearAuthStateCookie(config),
      ]);
    }
    const code = url.searchParams.get("code");
    if (!code) {
      return html(renderAuthError("Missing authorization code."), 400, [
        clearAuthStateCookie(config),
      ]);
    }

    try {
      const claims = await exchangeAndVerifyShooCode(config, {
        code,
        verifier: state.verifier,
        redirectUri: new URL("/auth/callback", config.publicUrl).toString(),
      });
      const identity = await findOrCreateAccountForIdentity(database, "shoo", claims.pairwise_sub, {
        email: claimText(claims.email),
        emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : null,
        displayName: claimText(claims.name),
        pictureUrl: claimText(claims.picture),
        piiSubject: claimText(claims.pii_sub),
      });
      const created = await createWebSession(database, identity, readSessionToken(request.headers));
      return redirect(new URL(state.next, config.publicUrl).toString(), 303, [
        clearAuthStateCookie(config),
        createSessionCookie(config, created.sessionToken),
        createCsrfCookie(config, created.csrfToken),
      ]);
    } catch (error) {
      console.error("Shoo sign-in failed:", error);
      return html(renderAuthError("Sign-in could not be completed. Please retry."), 502, [
        clearAuthStateCookie(config),
      ]);
    }
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApi(request, url, config, database);
  }

  const sharedDraftMatch = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{43})$/);
  if (request.method === "GET" && sharedDraftMatch?.[1]) {
    const ticket = await createDraftShareAccessTicket(database, sharedDraftMatch[1]);
    if (!ticket) {
      return html(
        renderDraftShareUnavailable(config.publicUrl.origin),
        404,
        [],
        shareResponseHeaders(),
      );
    }
    const action = draftUrl(config, ticket.draftId, "/_share/exchange");
    const nonce = randomToken(16);
    return html(renderDraftShareBridge(action, ticket.token, nonce), 200, [], {
      ...shareResponseHeaders(),
      "content-security-policy": bridgeContentSecurityPolicy(action, nonce),
    });
  }

  if (request.method === "GET" && url.pathname.startsWith("/s/")) {
    return html(
      renderDraftShareUnavailable(config.publicUrl.origin),
      404,
      [],
      shareResponseHeaders(),
    );
  }

  const session = await readWebSession(database, request);

  if (request.method === "POST" && url.pathname === "/auth/sign-out") {
    if (!session) return redirect(new URL("/", config.publicUrl).toString());
    const form = await readForm(request);
    if (!validBrowserMutation(request, config, session, form.get("csrf"))) {
      return response("Forbidden.", 403, "text/plain; charset=utf-8");
    }
    await revokeWebSession(database, session.id);
    return redirect(new URL("/", config.publicUrl).toString(), 303, [
      clearSessionCookie(config),
      clearCsrfCookie(config),
    ]);
  }

  if (request.method === "GET" && url.pathname === "/drafts") {
    if (!session) return html(renderSignIn("/drafts"));
    return html(
      renderDrafts(
        session,
        readCsrfToken(request.headers) ?? "",
        (await listDrafts(database, config, session.accountId)).drafts,
      ),
    );
  }

  const detailMatch = url.pathname.match(/^\/drafts\/([a-z0-9]{12})$/);
  if (request.method === "GET" && detailMatch?.[1]) {
    if (!session) return html(renderSignIn(url.pathname));
    const [detail, shares] = await Promise.all([
      getDraftDetail(database, config, session.accountId, detailMatch[1]),
      listActiveDraftShares(database, session.accountId, detailMatch[1]),
    ]);
    return detail
      ? html(renderDraftDetail(session, readCsrfToken(request.headers) ?? "", detail, shares))
      : html(renderNotFound(), 404);
  }

  const shareFormMatch = url.pathname.match(/^\/drafts\/([a-z0-9]{12})\/share$/);
  if (request.method === "GET" && shareFormMatch?.[1]) {
    if (!session) return html(renderSignIn(url.pathname));
    const detail = await getDraftDetail(database, config, session.accountId, shareFormMatch[1]);
    return detail && !detail.draft.disabled && detail.draft.latestVersionNumber !== null
      ? html(renderDraftShareForm(session, readCsrfToken(request.headers) ?? "", detail))
      : html(renderNotFound(), 404);
  }

  const createShareMatch = url.pathname.match(/^\/drafts\/([a-z0-9]{12})\/shares$/);
  if (request.method === "POST" && createShareMatch?.[1]) {
    if (!session) return html(renderSignIn(`/drafts/${createShareMatch[1]}/share`));
    const form = await readForm(request);
    if (!validBrowserMutation(request, config, session, form.get("csrf"))) {
      return response("Forbidden.", 403, "text/plain; charset=utf-8");
    }
    const ttlSeconds = parseDraftShareTtl(form.get("ttlSeconds"));
    if (ttlSeconds === null) {
      return response("Invalid share expiration.", 422, "text/plain; charset=utf-8");
    }
    let created;
    try {
      created = await createDraftShare(
        database,
        config,
        session.accountId,
        createShareMatch[1],
        ttlSeconds,
      );
    } catch (error) {
      if (isStatusError(error, 422) && error instanceof Error) {
        return response(error.message, 422, "text/plain; charset=utf-8");
      }
      throw error;
    }
    if (!created) return html(renderNotFound(), 404);
    const nonce = randomToken(16);
    return html(
      renderDraftShareCreated(session, readCsrfToken(request.headers) ?? "", created, nonce),
      201,
      [],
      { "content-security-policy": apexScriptContentSecurityPolicy(nonce) },
    );
  }

  const revokeShareMatch = url.pathname.match(
    /^\/drafts\/([a-z0-9]{12})\/shares\/([A-Za-z0-9]{20})\/revoke$/,
  );
  if (request.method === "POST" && revokeShareMatch?.[1] && revokeShareMatch[2]) {
    if (!session) return html(renderSignIn(`/drafts/${revokeShareMatch[1]}`));
    const form = await readForm(request);
    if (!validBrowserMutation(request, config, session, form.get("csrf"))) {
      return response("Forbidden.", 403, "text/plain; charset=utf-8");
    }
    const revoked = await revokeDraftShare(
      database,
      session.accountId,
      revokeShareMatch[1],
      revokeShareMatch[2],
    );
    if (!revoked) return html(renderNotFound(), 404);
    return redirect(new URL(`/drafts/${revokeShareMatch[1]}`, config.publicUrl).toString());
  }

  if (request.method === "GET" && url.pathname === "/cli/auth") {
    if (!session) return html(renderSignIn("/cli/auth"));
    return html(
      renderCliAuth(
        session,
        readCsrfToken(request.headers) ?? "",
        await listApiKeys(database, session.accountId),
      ),
    );
  }

  if (request.method === "POST" && url.pathname === "/cli/auth/keys") {
    if (!session) return html(renderSignIn("/cli/auth"));
    const form = await readForm(request);
    if (!validBrowserMutation(request, config, session, form.get("csrf"))) {
      return response("Forbidden.", 403, "text/plain; charset=utf-8");
    }
    const name = `CLI · ${new Date().toISOString().slice(0, 10)}`;
    const key = await createApiKey(database, session.accountId, name);
    return html(renderApiKey(session, readCsrfToken(request.headers) ?? "", key));
  }

  const revokeMatch = url.pathname.match(/^\/cli\/auth\/keys\/([^/]+)\/revoke$/);
  if (request.method === "POST" && revokeMatch?.[1]) {
    if (!session) return html(renderSignIn("/cli/auth"));
    const form = await readForm(request);
    if (!validBrowserMutation(request, config, session, form.get("csrf"))) {
      return response("Forbidden.", 403, "text/plain; charset=utf-8");
    }
    await revokeApiKey(database, session.accountId, revokeMatch[1]);
    return redirect(new URL("/cli/auth", config.publicUrl).toString());
  }

  const bridgeMatch = url.pathname.match(/^\/([a-z0-9]{12})$/);
  if (request.method === "GET" && bridgeMatch?.[1]) {
    if (!session) return html(renderSignIn(url.pathname + url.search));
    const version = parsePositiveVersion(url.searchParams.get("version"));
    if (url.searchParams.has("version") && version === null) return html(renderNotFound(), 404);
    const ticket = await createDraftAccessTicket(database, session, bridgeMatch[1], version);
    if (!ticket) return html(renderNotFound(), 404);
    const action = draftUrl(config, bridgeMatch[1], "/_auth/exchange");
    const nonce = randomToken(16);
    return html(renderDraftBridge(action, ticket.token, nonce), 200, [], {
      "content-security-policy": bridgeContentSecurityPolicy(action, nonce),
    });
  }

  return html(renderNotFound(), 404);
}

async function handleApi(
  request: Request,
  url: URL,
  config: AppConfig,
  database: Database,
): Promise<Response> {
  const auth = await readBearerAuth(database, request);
  if (!auth) return bearerError();

  if (request.method === "GET" && url.pathname === "/api/me") {
    return json({
      accountId: auth.accountId,
      accountName: auth.accountName,
      apiKeyId: auth.id,
      apiKeyName: auth.name,
    });
  }
  if (request.method === "GET" && url.pathname === "/api/drafts") {
    return json(await listDrafts(database, config, auth.accountId));
  }
  if (request.method === "POST" && url.pathname === "/api/uploads") {
    let body: unknown;
    try {
      body = await readJson(request, uploadRequestLimit(config));
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return json({ ok: false, error: "Request body too large." }, 413);
      }
      if (error instanceof MalformedJsonError) {
        return json({ ok: false, error: "Malformed JSON body." }, 400);
      }
      throw error;
    }
    const parsed = uploadPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return json(
        { ok: false, errors: parsed.error.issues.map((issue) => issue.message), warnings: [] },
        422,
      );
    }
    return handleUpload(request, config, database, auth, parsed.data);
  }
  return json({ ok: false, error: "Not found." }, 404);
}

async function handleUpload(
  request: Request,
  config: AppConfig,
  database: Database,
  auth: ApiKeyAuth,
  payload: UploadPayload,
): Promise<Response> {
  const validation =
    typeof payload.html === "string" ? validateHtml(payload.html, config.maxHtmlBytes) : null;
  if (validation && !validation.ok) {
    return json({ ok: false, errors: validation.errors, warnings: validation.warnings }, 422);
  }
  if (payload.image !== undefined) {
    const imageValidation = validateImage(
      payload.image.base64,
      payload.image.mediaType,
      config.maxHtmlBytes,
    );
    if (!imageValidation.ok) {
      return json({ ok: false, errors: imageValidation.errors, warnings: [] }, 422);
    }
  }
  try {
    const uploaded = await uploadDraft(database, config, payload, validation, {
      apiKeyId: auth.id,
      accountId: auth.accountId,
      sourceIp: request.headers.get("x-real-ip"),
      userAgent: request.headers.get("user-agent"),
      requestId: request.headers.get("x-railway-request-id") ?? request.headers.get("x-vercel-id"),
    });
    return json(uploaded, payload.draftId ? 200 : 201);
  } catch (error) {
    if (isStatusError(error, 404)) return json({ ok: false, error: "Draft not found." }, 404);
    if (isStatusError(error, 422) && error instanceof Error) {
      return json({ ok: false, error: error.message }, 422);
    }
    throw error;
  }
}

async function handleDraftHost(
  request: Request,
  url: URL,
  draftId: string,
  config: AppConfig,
  database: Database,
): Promise<Response> {
  if (request.method === "POST" && url.pathname === "/_auth/exchange") {
    if (request.headers.get("origin") !== apexOrigin(config)) {
      return response("Unauthorized.", 401, "text/plain; charset=utf-8");
    }
    const form = await readForm(request);
    const ticketValue = form.get("ticket");
    if (!ticketValue) return response("Unauthorized.", 401, "text/plain; charset=utf-8");
    const ticket = await consumeDraftAccessTicket(database, ticketValue, draftId);
    if (!ticket) return response("Unauthorized.", 401, "text/plain; charset=utf-8");
    const targetPath = ticket.versionNumber ? `/v/${ticket.versionNumber}/` : "/";
    const nonce = randomToken(16);
    return html(
      renderDraftReady(targetPath, nonce),
      200,
      [
        createDraftSessionCookie(config, {
          webSessionId: ticket.webSessionId,
          draftId: ticket.draftId,
        }),
      ],
      { "content-security-policy": draftReadyContentSecurityPolicy(nonce) },
    );
  }

  if (request.method === "POST" && url.pathname === "/_share/exchange") {
    if (request.headers.get("origin") !== apexOrigin(config)) {
      return response("Unauthorized.", 401, "text/plain; charset=utf-8");
    }
    const form = await readForm(request);
    const ticketValue = form.get("ticket");
    if (!ticketValue) return response("Unauthorized.", 401, "text/plain; charset=utf-8");
    const ticket = await consumeDraftShareAccessTicket(database, ticketValue, draftId);
    const ttlSeconds = ticket ? secondsUntil(ticket.expiresAt) : null;
    if (!ticket || ttlSeconds === null) {
      return response("Unauthorized.", 401, "text/plain; charset=utf-8");
    }
    const targetPath = `/v/${ticket.versionNumber}/`;
    const nonce = randomToken(16);
    return html(
      renderDraftShareReady(targetPath, nonce),
      200,
      [
        createDraftShareSessionCookie(
          config,
          { shareId: ticket.shareId, draftId: ticket.draftId },
          ttlSeconds,
        ),
      ],
      {
        "content-security-policy": draftReadyContentSecurityPolicy(nonce),
        ...shareResponseHeaders(),
      },
    );
  }

  const route = parseDraftContentRoute(url.pathname);
  if (!route) return html(renderNotFound(), 404);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET, HEAD");
  }
  if (
    route.kind === "content" &&
    !route.raw &&
    route.versionNumber !== undefined &&
    url.pathname !== `/v/${route.versionNumber}/`
  ) {
    return redirect(draftUrl(config, draftId, `/v/${route.versionNumber}/`), 308);
  }

  const authHeader = request.headers.get("authorization");
  let access: DraftRequestAccess | null = null;
  if (authHeader !== null) {
    const auth = await readBearerAuth(database, request);
    if (!auth) return bearerError();
    access = { kind: "owner", accountId: auth.accountId };
  } else {
    const grant = readDraftSession(config, request.headers, draftId);
    const session = grant ? await findActiveWebSessionById(database, grant.webSessionId) : null;
    if (session) {
      access = { kind: "owner", accountId: session.accountId };
    } else {
      const shareGrant = readDraftShareSession(config, request.headers, draftId);
      const share = shareGrant
        ? await findActiveDraftShare(database, shareGrant.shareId, draftId)
        : null;
      if (shareGrant && !share) {
        return html(
          renderDraftShareUnavailable(config.publicUrl.origin),
          404,
          [],
          shareResponseHeaders(),
        );
      }
      if (share) {
        access = {
          kind: "share",
          shareId: share.shareId,
          versionNumber: share.versionNumber,
        };
      }
    }
  }

  if (!access) {
    if (route.kind === "reference" || route.raw) return bearerError();
    const bridgeUrl = new URL(`/${draftId}`, config.publicUrl);
    if (route.versionNumber !== undefined) {
      bridgeUrl.searchParams.set("version", String(route.versionNumber));
    }
    return redirect(bridgeUrl.toString());
  }

  if (
    access.kind === "share" &&
    route.kind === "content" &&
    !route.raw &&
    route.versionNumber === undefined
  ) {
    return redirect(draftUrl(config, draftId, `/v/${access.versionNumber}/`), 303);
  }
  if (access.kind === "share" && !sharedRouteAllows(route, access.versionNumber)) {
    return html(renderNotFound(), 404);
  }

  const content =
    access.kind === "share"
      ? route.kind === "reference"
        ? await getStoredSharedReference(database, access.shareId, draftId, route.name)
        : await getStoredSharedContent(database, access.shareId, draftId)
      : route.kind === "reference"
        ? await getStoredReference(
            database,
            access.accountId,
            draftId,
            route.versionNumber,
            route.name,
          )
        : await getStoredContent(database, access.accountId, draftId, route.versionNumber);
  if (!content) return html(renderNotFound(), 404);

  const headers = new Headers({
    "content-type":
      content.mediaType === "text/html" ? "text/html; charset=utf-8" : content.mediaType,
    "cache-control": "private, no-store",
    "content-security-policy": draftContentSecurityPolicy(),
    "x-content-type-options": "nosniff",
    "content-length": String(content.bytes.byteLength),
    "x-postplan-draft-id": content.draftId,
    "x-postplan-draft-version": String(content.versionNumber),
  });
  if (access.kind === "share") {
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  }
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  const body = content.bytes.buffer.slice(
    content.bytes.byteOffset,
    content.bytes.byteOffset + content.bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, { status: 200, headers });
}

async function readWebSession(database: Database, request: Request): Promise<WebSession | null> {
  return findWebSession(database, readSessionToken(request.headers));
}

async function readBearerAuth(database: Database, request: Request): Promise<ApiKeyAuth | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ? findApiKeyByToken(database, match[1].trim()) : null;
}

function validBrowserMutation(
  request: Request,
  config: AppConfig,
  session: WebSession,
  submittedToken: string | null,
): boolean {
  return (
    request.headers.get("origin") === apexOrigin(config) &&
    validCsrfToken(session, readCsrfToken(request.headers), submittedToken)
  );
}

async function readForm(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return new URLSearchParams();
  }
  return new URLSearchParams(await readText(request, 4 * 1024));
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const text = await readText(request, maxBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MalformedJsonError();
  }
}

async function readText(request: Request, maxBytes: number): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyTooLargeError();
  }
  if (!request.body) return "";

  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  let byteLength = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    byteLength += next.value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function safeNextPath(value: string | null): string {
  const path = safeApexPath(value);
  if (
    path === "/drafts" ||
    path === "/cli/auth" ||
    /^\/[a-z0-9]{12}(?:\?version=\d+)?$/.test(path)
  ) {
    return path;
  }
  return "/drafts";
}

function parsePositiveVersion(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDraftShareTtl(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return isDraftShareTtlSeconds(parsed) ? parsed : null;
}

function secondsUntil(value: string): number | null {
  const remainingMilliseconds = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(remainingMilliseconds) || remainingMilliseconds <= 0) return null;
  return Math.max(1, Math.ceil(remainingMilliseconds / 1_000));
}

function draftContentSecurityPolicy(): string {
  return [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src 'self' https: data:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function bridgeContentSecurityPolicy(action: string, nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    `form-action ${action}`,
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function draftReadyContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function uploadRequestLimit(config: AppConfig): number {
  return Math.max(2 * 1024 * 1024, config.maxHtmlBytes * 2 + 64 * 1024);
}

type DraftContentRoute =
  | { kind: "content"; raw: boolean; versionNumber?: number }
  | { kind: "reference"; raw: false; name: string; versionNumber?: number };

function sharedRouteAllows(route: DraftContentRoute, versionNumber: number): boolean {
  if (route.kind === "content") {
    return !route.raw && route.versionNumber === versionNumber;
  }
  return route.versionNumber === undefined || route.versionNumber === versionNumber;
}

function parseDraftContentRoute(pathname: string): DraftContentRoute | null {
  if (pathname === "/") return { kind: "content", raw: false };
  if (pathname === "/raw") return { kind: "content", raw: true };

  const currentReference = pathname.match(/^\/refs\/([a-z][a-z0-9-]{0,62})$/);
  if (currentReference?.[1]) {
    return { kind: "reference", raw: false, name: currentReference[1] };
  }

  const versionReference = pathname.match(/^\/v\/([^/]+)\/refs\/([a-z][a-z0-9-]{0,62})$/);
  if (versionReference?.[1] && versionReference[2]) {
    const versionNumber = parsePositiveVersion(versionReference[1]);
    return versionNumber === null
      ? null
      : {
          kind: "reference",
          raw: false,
          name: versionReference[2],
          versionNumber,
        };
  }

  const versionContent = pathname.match(/^\/v\/([^/]+)(\/raw|\/)?$/);
  if (!versionContent?.[1]) return null;
  const versionNumber = parsePositiveVersion(versionContent[1]);
  return versionNumber === null
    ? null
    : { kind: "content", raw: versionContent[2] === "/raw", versionNumber };
}

function bearerError(): Response {
  return json({ ok: false, error: "Missing or invalid API key." }, 401, {
    "www-authenticate": 'Bearer realm="pushdraft"',
  });
}

function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

function html(
  body: string,
  status = 200,
  cookies: string[] = [],
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "text/html; charset=utf-8");
  if (!headers.has("content-security-policy")) {
    headers.set("content-security-policy", apexContentSecurityPolicy());
  }
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(body, { status, headers });
}

function response(body: string, status: number, contentType: string): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed.", {
    status: 405,
    headers: { allow, "content-type": "text/plain; charset=utf-8" },
  });
}

function redirect(location: string, status = 303, cookies: string[] = []): Response {
  const headers = new Headers({ location });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status, headers });
}

function apexContentSecurityPolicy(): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src https: data:",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function apexScriptContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    "img-src https: data:",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function shareResponseHeaders(): Record<string, string> {
  return { "x-robots-tag": "noindex, nofollow, noarchive" };
}

function claimText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function isStatusError(error: unknown, status: number): boolean {
  return error instanceof Error && "status" in error && Reflect.get(error, "status") === status;
}

class RequestBodyTooLargeError extends Error {}

class MalformedJsonError extends Error {}
