import type { DraftSummary } from "./api-types.js";

export function formatDrafts(drafts: DraftSummary[], now = Date.now()): string {
  if (drafts.length === 0) return "No drafts yet. Publish one with: pushdraft upload <file>";

  const output = [`Drafts (${drafts.length})`, ""];
  for (const draft of drafts) {
    const repository =
      draft.repoOrg !== null &&
      draft.repoOrg !== undefined &&
      draft.repoName !== null &&
      draft.repoName !== undefined
        ? `${draft.repoOrg}/${draft.repoName}`
        : "no repo";
    const version =
      draft.latestVersionNumber === null || draft.latestVersionNumber === undefined
        ? "no versions"
        : `v${draft.latestVersionNumber}`;
    const versionCount = draft.versionCount ?? 0;
    const count = `${versionCount} version${versionCount === 1 ? "" : "s"}`;
    const disabled = draft.disabled === true ? " · disabled" : "";

    output.push(draft.title ?? "Untitled Draft");
    output.push(
      `  ${repository} · ${version} · ${count} · updated ${timeAgo(draft.updatedAt, now)}${disabled}`,
    );
    if (draft.publicUrl !== undefined) output.push(`  ${draft.publicUrl}`);
    if (draft.description !== null && draft.description !== undefined && draft.description !== "") {
      output.push(`  ${draft.description}`);
    }
    output.push("");
  }

  return output.join("\n");
}

export function timeAgo(value: string | null | undefined, now = Date.now()): string {
  if (value === null || value === undefined || value === "") return "unknown";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "unknown";

  const seconds = Math.max(0, Math.floor((now - then) / 1_000));
  const units: ReadonlyArray<readonly [name: string, seconds: number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  for (const [name, unitSeconds] of units) {
    const amount = Math.floor(seconds / unitSeconds);
    if (amount >= 1) return `${amount} ${name}${amount === 1 ? "" : "s"} ago`;
  }
  return "just now";
}
