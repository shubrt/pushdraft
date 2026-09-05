import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";

const source = (
  await readFile(new URL("../../../tools/preview-domains.mjs", import.meta.url), "utf8")
)
  .replace(/^#![^\n]*\n/, "")
  .replace('import { appendFile } from "node:fs/promises";', "");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<void>;

async function runProvision(
  options: {
    apexStatus?: number;
    draftStatus?: number;
    draftFailure?: string;
    missingChallenge?: boolean;
    providerFailure?: "railway" | "cloudflare";
  } = {},
) {
  let now = 0;
  const logs: string[] = [];
  const files: Record<string, string> = {};
  const requests: string[] = [];
  const apexDomain = "pushdraft-pr-23.preview.pushdraft.dev";
  const fetchImpl = async (input: string, init?: RequestInit) => {
    requests.push(input);
    if (input.includes("backboard.railway.com")) {
      if (options.providerFailure === "railway")
        return Response.json({ errors: [{ message: "Railway unavailable" }] });
      const { query } = JSON.parse(init?.body as string) as { query: string };
      if (query.includes("environments("))
        return Response.json({
          data: { environments: { edges: [{ node: { id: "env", name: "pushdraft-pr-23" } }] } },
        });
      if (query.includes("environment("))
        return Response.json({
          data: {
            environment: {
              serviceInstances: { edges: [{ node: { serviceId: "api", serviceName: "api" } }] },
            },
          },
        });
      if (query.includes("domains("))
        return Response.json({
          data: {
            domains: {
              customDomains: [apexDomain, `*.${apexDomain}`].map((domain) => ({
                domain,
                status: {
                  dnsRecords: [
                    {
                      hostlabel: domain.replace(/\.pushdraft\.dev$/, ""),
                      requiredValue: "preview.up.railway.app",
                      recordType: "CNAME",
                    },
                  ],
                },
              })),
            },
          },
        });
      throw new Error(`Unexpected Railway query ${query}`);
    }
    if (input.includes("api.cloudflare.com")) {
      if (options.providerFailure === "cloudflare")
        return Response.json({ success: false, errors: [{ message: "DNS write denied" }] });
      if (input.includes("/zones?"))
        return Response.json({ success: true, result: [{ id: "zone" }] });
      return Response.json({ success: true, result: [] });
    }
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (input === `https://${apexDomain}/healthz`)
      return Response.json(
        { ok: (options.apexStatus ?? 200) === 200 },
        { status: options.apexStatus ?? 200 },
      );
    if (input === `https://000000000000.${apexDomain}/raw`) {
      if (options.draftFailure) throw new Error(options.draftFailure);
      return new Response("Unauthorized", {
        status: options.draftStatus ?? 401,
        headers: options.missingChallenge ? {} : { "www-authenticate": 'Bearer realm="pushdraft"' },
      });
    }
    throw new Error(`Unexpected URL ${input}`);
  };
  const execute = new AsyncFunction(
    "process",
    "fetch",
    "Date",
    "setTimeout",
    "console",
    "appendFile",
    source,
  );
  let error: unknown;
  try {
    await execute(
      {
        argv: ["node", "preview-domains.mjs", "up", "pushdraft-pr-23"],
        env: {
          RAILWAY_API_TOKEN: "test",
          CLOUDFLARE_API_TOKEN: "test",
          GITHUB_OUTPUT: "output",
          GITHUB_STEP_SUMMARY: "summary",
          GITHUB_ACTIONS: "true",
        },
        exit(code: number) {
          throw new Error(`Exit ${code}`);
        },
      },
      fetchImpl,
      { now: () => now },
      (callback: () => void, milliseconds: number) => {
        now += milliseconds;
        callback();
      },
      {
        log: (...values: unknown[]) => logs.push(values.join(" ")),
        error: (...values: unknown[]) => logs.push(values.join(" ")),
      },
      async (filename: string, text: string) => {
        files[filename] = (files[filename] ?? "") + text;
      },
    );
  } catch (caught) {
    error = caught;
  }
  return { files, logs, requests, error };
}

describe("preview domain provisioning and readiness", () => {
  test("confirms apex health and the authenticated wildcard route separately", async () => {
    const result = await runProvision();
    expect(result.error).toBeUndefined();
    expect(result.files.output).toBe("provisioned=true\npreview_ready=true\n");
    expect(result.files.summary).toContain("apex: confirmed");
    expect(result.files.summary).toContain("draft: confirmed");
    expect(result.logs.join("\n")).not.toContain("::warning::");
  });

  test.each([
    { apexStatus: 503 },
    { draftStatus: 503 },
    { draftStatus: 200 },
    { draftStatus: 302 },
    { missingChallenge: true },
    { draftFailure: "DNS lookup failed" },
    { draftFailure: "TLS certificate not valid" },
  ])("reports unconfirmed readiness after timeout: %j", async (options) => {
    const result = await runProvision(options);
    expect(result.error).toBeUndefined();
    expect(result.files.output).toBe("provisioned=true\npreview_ready=false\n");
    expect(result.files.summary).toContain("Domains and DNS: provisioned");
    expect(result.files.summary).toContain("Preview readiness: unconfirmed after timeout");
    expect(result.logs.join("\n")).toContain("::warning::");
    expect(result.requests.filter((url) => url.endsWith("/raw")).length).toBeGreaterThan(1);
  });

  test.each(["railway", "cloudflare"] as const)(
    "does not label %s provider failures as provisioned",
    async (providerFailure) => {
      const result = await runProvision({ providerFailure });
      expect(result.error).toBeInstanceOf(Error);
      expect(result.files.output).toBeUndefined();
      expect(result.files.summary).toBeUndefined();
      expect(result.requests.some((url) => url.endsWith("/healthz"))).toBe(false);
    },
  );
});
