import { isAlias, isMap, isScalar, parseDocument, visit } from "yaml";

export const MAX_CONFIG_BYTES = 512 * 1024;
const MAX_NODES = 12000;
const MAX_DEPTH = 32;
const MAX_SERVERS = 500;
const TYPES = new Set([
  "ss",
  "ssr",
  "vmess",
  "vless",
  "trojan",
  "socks5",
  "http",
  "hysteria",
  "hysteria2",
  "tuic",
  "wireguard",
  "anytls",
]);
const PROTOTYPE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const CREDENTIAL_KEYS =
  /password|uuid|private[-_]?key|token|secret|authorization|username/i;

export interface ImportedServer {
  id: string;
  name: string;
  type: string;
  // Compatibility is intentionally not claimed by this preview.
  udp: "disabled" | "unverified";
  origin: "imported";
}
export interface ImportReport {
  servers: ImportedServer[];
  groups: number;
  providers: number;
  unresolvedGroups: number;
  ignored: string[];
  skipped: number;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function shortString(value: unknown, max = 256): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

/**
 * Metadata-only prototype importer. Credentials never leave the transient YAML
 * document. It does not fetch URLs, open provider paths, execute scripts, retain
 * engine configs or claim the current native engine can run these servers.
 */
export function inspectClashConfig(input: string): ImportReport {
  if (new TextEncoder().encode(input).byteLength > MAX_CONFIG_BYTES) {
    throw new Error("Choose a YAML configuration smaller than 512 KB.");
  }
  let document;
  try {
    document = parseDocument(input, {
      schema: "core",
      uniqueKeys: true,
      strict: true,
    });
  } catch {
    throw new Error("Could not parse this YAML configuration.");
  }
  if (document.errors.length || document.warnings.length) {
    // Never display YAML parser excerpts: they can contain passwords or URLs.
    throw new Error(
      "Invalid or unsupported YAML. Check indentation, duplicate keys, and tags.",
    );
  }
  let nodes = 0;
  visit(document, (_, node, path) => {
    if (++nodes > MAX_NODES || path.length > MAX_DEPTH)
      throw new Error("This configuration is too complex to preview.");
    if (isAlias(node))
      throw new Error(
        "YAML aliases are not supported in this preview. Export a configuration with expanded values.",
      );
    if (node && typeof node === "object" && "tag" in node && node.tag)
      throw new Error("YAML tags are not supported in this preview.");
    if (isMap(node)) {
      for (const pair of node.items) {
        if (
          !isScalar(pair.key) ||
          typeof pair.key.value !== "string" ||
          PROTOTYPE_KEYS.has(pair.key.value)
        ) {
          throw new Error(
            "Configuration mappings must use plain, supported string keys.",
          );
        }
      }
    }
  });
  if (!isMap(document.contents))
    throw new Error("Expected a Clash YAML configuration with a proxies list.");
  let config: unknown;
  try {
    config = document.toJS({ maxAliasCount: 0 });
  } catch {
    throw new Error("Could not read this YAML configuration.");
  }
  if (!object(config)) throw new Error("Expected a Clash YAML configuration.");
  const report: ImportReport = {
    servers: [],
    groups: 0,
    providers: 0,
    unresolvedGroups: 0,
    ignored: [],
    skipped: 0,
  };
  const rawServers: unknown[] = [];
  const appendServers = (items: unknown[]) => {
    if (rawServers.length + items.length > MAX_SERVERS)
      throw new Error("Preview at most 500 servers in one configuration.");
    rawServers.push(...items);
  };
  if (config.proxies !== undefined) {
    if (!Array.isArray(config.proxies))
      throw new Error("The proxies field must be a list.");
    appendServers(config.proxies);
  }
  if (config["proxy-providers"] !== undefined) {
    if (!object(config["proxy-providers"]))
      throw new Error("The proxy-providers field must be a mapping.");
    for (const provider of Object.values(config["proxy-providers"])) {
      if (
        object(provider) &&
        provider.type === "inline" &&
        Array.isArray(provider.payload)
      )
        appendServers(provider.payload);
      else report.providers++;
    }
  }
  const names = new Set<string>();
  // Display only labels. Never retain passwords, endpoints, URLs or raw nodes.
  for (const raw of rawServers) {
    if (
      !object(raw) ||
      !shortString(raw.name) ||
      !shortString(raw.type, 32) ||
      !TYPES.has(raw.type) ||
      !shortString(raw.server, 253) ||
      /[\s/\\@#?]/.test(raw.server) ||
      !Number.isInteger(raw.port) ||
      Number(raw.port) < 1 ||
      Number(raw.port) > 65535 ||
      names.has(raw.name) ||
      /:\/\//.test(raw.name)
    ) {
      report.skipped++;
      continue;
    }
    // Guard against a profile whose display label accidentally includes a secret.
    const name = raw.name;
    const containsCredential = Object.entries(raw).some(
      ([key, value]) =>
        CREDENTIAL_KEYS.test(key) &&
        typeof value === "string" &&
        value.length >= 4 &&
        name.includes(value),
    );
    if (containsCredential) {
      report.skipped++;
      continue;
    }
    names.add(raw.name);
    report.servers.push({
      id: `import:${report.servers.length}`,
      name: raw.name,
      type: raw.type,
      udp: raw.type === "http" || raw.udp === false ? "disabled" : "unverified",
      origin: "imported",
    });
  }
  if (config["proxy-groups"] !== undefined) {
    if (!Array.isArray(config["proxy-groups"]))
      throw new Error("The proxy-groups field must be a list.");
    report.groups = config["proxy-groups"].length;
    for (const group of config["proxy-groups"]) {
      if (
        !object(group) ||
        (Array.isArray(group.use) && group.use.length > 0) ||
        (Array.isArray(group.proxies) &&
          group.proxies.some(
            (name) =>
              name !== "DIRECT" &&
              name !== "REJECT" &&
              !names.has(String(name)),
          ))
      )
        report.unresolvedGroups++;
    }
  }
  const sections: [string, string][] = [
    ["tun", "TUN settings"],
    ["dns", "DNS settings"],
    ["rules", "Routing rules"],
    ["rule-providers", "Rule providers"],
    ["script", "Scripts"],
    ["listeners", "Listeners"],
    ["external-controller", "Controller settings"],
    ["external-controller-pipe", "Controller settings"],
    ["external-controller-tls", "Controller settings"],
    ["secret", "Controller credentials"],
    ["mixed-port", "Proxy ports"],
    ["port", "Proxy ports"],
    ["socks-port", "Proxy ports"],
    ["redir-port", "Proxy ports"],
    ["tproxy-port", "Proxy ports"],
    ["allow-lan", "LAN access"],
  ];
  report.ignored = [
    ...new Set(
      sections.filter(([key]) => key in config).map(([, label]) => label),
    ),
  ];
  if (!rawServers.length && !report.providers)
    throw new Error(
      "No proxy servers or providers found. Export a Clash profile containing proxies.",
    );
  return report;
}
