import { importClashProfiles } from "./clash-profiles";
import { importProfiles } from "./profiles";
import type { ClashProfiles } from "./clash-profiles";
import type { Profile } from "../types";

export type ImportSource = "auto" | "url";
type ImportResult =
  | { kind: "review"; report: ClashProfiles }
  | { kind: "links"; profiles: Profile[] };

/** HTTP proxy links need an explicit port and no document path or query. */
export function isYamlDownloadUrl(input: string): boolean {
  const text = input.trim();
  if (/\s/.test(text)) return false;
  const match = /^https?:\/\/([^/?#]+)([^#]*)(?:#.*)?$/i.exec(text);
  if (!match) return false;
  return !/:\d+$/.test(match[1]) || !["", "/"].includes(match[2]);
}

/** URL content is always reviewed as YAML, never recursively fetched or saved. */
export async function inspectServerImport(
  input: string,
  source: ImportSource,
  fetchYaml: (url: string) => Promise<string>,
): Promise<ImportResult> {
  if (source === "url" || isYamlDownloadUrl(input)) {
    return {
      kind: "review",
      report: importClashProfiles(await fetchYaml(input.trim())),
    };
  }
  if (/^\s*(ss|vless|trojan|https?|socks5):\/\//i.test(input)) {
    return { kind: "links", profiles: importProfiles(input) };
  }
  return { kind: "review", report: importClashProfiles(input) };
}
