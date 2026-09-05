#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
// Provisions the per-PR preview domains that draft delivery needs:
//   up <env>    create the apex and wildcard custom domains on the preview's
//               api service and upsert the Cloudflare DNS records Railway
//               requests (DNS-only; TLS is issued by Railway via the
//               _acme-challenge delegation).
//   down <env>  remove those DNS records. Railway deletes the environment's
//               custom domains together with the PR environment itself.
//
// Requires RAILWAY_API_TOKEN (account token) and CLOUDFLARE_API_TOKEN
// (Zone:Read + DNS:Edit for the zone). <env> is the Railway PR environment
// name, e.g. pushdraft-pr-12.

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const PROJECT_ID = "e2f38f40-c35b-452b-8867-2344f0011f58";
const SERVICE_NAME = "api";
const ZONE_NAME = "pushdraft.dev";
const PREVIEW_SUFFIX = `preview.${ZONE_NAME}`;
const ENVIRONMENT_WAIT_SECONDS = 300;
const HEALTH_WAIT_SECONDS = 480;

const [command, environmentName] = process.argv.slice(2);
if (!["up", "down"].includes(command) || !environmentName?.match(/^[a-z0-9-]+$/)) {
  console.error("Usage: preview-domains.mjs <up|down> <railway-environment-name>");
  process.exit(1);
}

const apexDomain = `${environmentName}.${PREVIEW_SUFFIX}`;
const recordNames = [
  apexDomain,
  `*.${apexDomain}`,
  `_acme-challenge.${apexDomain}`,
  `_railway-verify.${apexDomain}`,
];

function requireToken(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function railway(query) {
  const response = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      authorization: `Bearer ${requireToken("RAILWAY_API_TOKEN")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }
  return payload.data;
}

async function cloudflare(path, init = {}) {
  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${requireToken("CLOUDFLARE_API_TOKEN")}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const payload = await response.json();
  if (!payload.success) {
    throw new Error(`Cloudflare ${path}: ${JSON.stringify(payload.errors)}`);
  }
  return payload.result;
}

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

async function findEnvironment() {
  const data = await railway(`query { environments(projectId: "${PROJECT_ID}") {
    edges { node { id name } } } }`);
  return data.environments.edges.find((edge) => edge.node.name === environmentName)?.node;
}

async function waitForEnvironment() {
  const deadline = Date.now() + ENVIRONMENT_WAIT_SECONDS * 1000;
  for (;;) {
    const environment = await findEnvironment();
    if (environment) return environment;
    if (Date.now() > deadline) {
      throw new Error(`Environment ${environmentName} did not appear in time.`);
    }
    console.log(`Waiting for environment ${environmentName}…`);
    await sleep(10);
  }
}

async function findServiceId(environmentId) {
  const data = await railway(`query { environment(id: "${environmentId}") {
    serviceInstances { edges { node { serviceId serviceName } } } } }`);
  const instance = data.environment.serviceInstances.edges.find(
    (edge) => edge.node.serviceName === SERVICE_NAME,
  );
  if (!instance) throw new Error(`Service ${SERVICE_NAME} not found in ${environmentName}.`);
  return instance.node.serviceId;
}

const DOMAIN_FIELDS = `id domain status { dnsRecords { hostlabel requiredValue recordType }
  verificationToken verificationDnsHost }`;

async function ensureCustomDomain(environmentId, serviceId, domain) {
  const data = await railway(`query { domains(projectId: "${PROJECT_ID}",
    environmentId: "${environmentId}", serviceId: "${serviceId}") {
    customDomains { ${DOMAIN_FIELDS} } } }`);
  const existing = data.domains.customDomains.find((entry) => entry.domain === domain);
  if (existing) {
    console.log(`Railway custom domain ${domain} already exists`);
    return existing;
  }
  const created = await railway(`mutation { customDomainCreate(input: {
    projectId: "${PROJECT_ID}", environmentId: "${environmentId}",
    serviceId: "${serviceId}", domain: "${domain}" }) { ${DOMAIN_FIELDS} } }`);
  console.log(`Created Railway custom domain ${domain}`);
  return created.customDomainCreate;
}

async function zoneId() {
  const zones = await cloudflare(`/zones?name=${ZONE_NAME}`);
  if (!zones.length) throw new Error(`Cloudflare zone ${ZONE_NAME} not found.`);
  return zones[0].id;
}

async function upsertRecord(zone, type, name, content) {
  const existing = await cloudflare(`/zones/${zone}/dns_records?name=${encodeURIComponent(name)}`);
  const body = JSON.stringify({ type, name, content, proxied: false, ttl: 60 });
  if (existing.length) {
    await cloudflare(`/zones/${zone}/dns_records/${existing[0].id}`, { method: "PUT", body });
    console.log(`Updated ${type} record ${name} -> ${content}`);
  } else {
    await cloudflare(`/zones/${zone}/dns_records`, { method: "POST", body });
    console.log(`Created ${type} record ${name} -> ${content}`);
  }
}

async function waitForHealth() {
  const deadline = Date.now() + HEALTH_WAIT_SECONDS * 1000;
  const probes = [
    { name: "apex", url: `https://${apexDomain}/healthz`, status: "not checked" },
    // A valid but unauthenticated draft route verifies wildcard routing without
    // creating a draft or requiring an account credential in the workflow.
    { name: "draft", url: `https://000000000000.${apexDomain}/raw`, status: "not checked" },
  ];
  for (;;) {
    const results = await Promise.all(
      probes.map(async (probe) => {
        try {
          const response = await fetch(probe.url, {
            signal: AbortSignal.timeout(10000),
            redirect: "manual",
          });
          probe.status = `HTTP ${response.status}`;
          if (probe.name === "draft") {
            return (
              response.status === 401 &&
              response.headers.get("www-authenticate") === 'Bearer realm="pushdraft"'
            );
          }
          return response.status === 200 && (await response.json()).ok === true;
        } catch (error) {
          probe.status = `request failed: ${error.message}`;
          return false;
        }
      }),
    );
    if (results.every(Boolean) || Date.now() >= deadline) {
      return {
        ready: results.every(Boolean),
        probes: probes.map((probe, index) => ({ ...probe, ready: results[index] })),
      };
    }
    console.log(
      `Waiting for preview: ${probes.map((probe) => `${probe.name} ${probe.status}`).join(", ")}`,
    );
    await sleep(15);
  }
}

async function reportReadiness(result) {
  const url = `https://${apexDomain}`;
  const lines = [
    "## Preview status",
    "",
    `Domains and DNS: provisioned for ${url}`,
    `Preview readiness: ${result.ready ? "confirmed" : "unconfirmed after timeout"}`,
    "",
    ...result.probes.map(
      (probe) =>
        `- ${probe.name}: ${probe.ready ? "confirmed" : "unconfirmed"}, ${probe.url}, ${probe.status}`,
    ),
    "",
  ];
  console.log(lines.join("\n"));
  if (!result.ready && process.env.GITHUB_ACTIONS === "true") {
    console.log(
      "::warning::Preview domains were provisioned, but apex and wildcard readiness was not confirmed before timeout.",
    );
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `provisioned=true\npreview_ready=${result.ready}\n`,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  }
}

async function up() {
  const environment = await waitForEnvironment();
  const serviceId = await findServiceId(environment.id);
  const domains = await Promise.all(
    [apexDomain, `*.${apexDomain}`].map((domain) =>
      ensureCustomDomain(environment.id, serviceId, domain),
    ),
  );
  const zone = await zoneId();
  for (const domain of domains) {
    for (const record of domain.status.dnsRecords) {
      await upsertRecord(zone, "CNAME", `${record.hostlabel}.${ZONE_NAME}`, record.requiredValue);
    }
    // Ownership check: Railway reports this TXT requirement outside dnsRecords.
    if (domain.status.verificationDnsHost && domain.status.verificationToken) {
      await upsertRecord(
        zone,
        "TXT",
        `${domain.status.verificationDnsHost}.${ZONE_NAME}`,
        domain.status.verificationToken,
      );
    }
  }
  // Keep provisioning best-effort after a health timeout. Only both successful
  // probes confirm readiness; provider failures above still fail the command.
  await reportReadiness(await waitForHealth());
}

async function down() {
  const zone = await zoneId();
  for (const name of recordNames) {
    const records = await cloudflare(`/zones/${zone}/dns_records?name=${encodeURIComponent(name)}`);
    for (const record of records) {
      await cloudflare(`/zones/${zone}/dns_records/${record.id}`, { method: "DELETE" });
      console.log(`Deleted DNS record ${name}`);
    }
  }
  console.log(
    `Cleaned up DNS for ${apexDomain}; Railway removes the domains with the environment.`,
  );
}

await (command === "up" ? up() : down());
