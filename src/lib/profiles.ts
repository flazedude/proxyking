import type { Profile, ProxyProtocol } from "../types";

// Mappings are intentionally explicit: a successful import must not silently
// change a server's transport. References:
// https://shadowsocks.org/doc/sip002.html
// https://github.com/XTLS/Xray-core/discussions/716
// https://sing-box.sagernet.org/configuration/shared/v2ray-transport/
// https://sing-box.sagernet.org/configuration/shared/tls/
const SS_METHODS = new Set([
  "2022-blake3-aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "2022-blake3-chacha20-poly1305",
  "none",
  "aes-128-gcm",
  "aes-192-gcm",
  "aes-256-gcm",
  "chacha20-ietf-poly1305",
  "xchacha20-ietf-poly1305",
  "aes-128-ctr",
  "aes-192-ctr",
  "aes-256-ctr",
  "aes-128-cfb",
  "aes-192-cfb",
  "aes-256-cfb",
  "rc4-md5",
  "chacha20-ietf",
  "xchacha20",
]);
const FINGERPRINTS = new Set([
  "chrome",
  "firefox",
  "edge",
  "safari",
  "360",
  "qq",
  "ios",
  "android",
  "random",
  "randomized",
]);
const COMMON_OPTIONS = new Set([
  "type",
  "security",
  "sni",
  "fp",
  "alpn",
  "allowInsecure",
  "insecure",
  "pbk",
  "sid",
  "path",
  "host",
  "serviceName",
  "mode",
  "headerType",
]);
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_INPUT = 2 * 1024 * 1024;

export interface ManualProfileInput {
  name: string;
  protocol: "http" | "socks";
  server: string;
  port: number;
  username?: string;
  password?: string;
  tls?: boolean;
  serverName?: string;
}

class ImportError extends Error {}

function fail(message: string): never {
  throw new ImportError(message);
}

function decode(value: string, field: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return fail(`Invalid percent encoding in ${field}.`);
  }
}

function decodeBase64Bytes(value: string, field: string): Uint8Array {
  if (
    !value ||
    !/^[A-Za-z0-9+/_-]*={0,2}$/.test(value) ||
    value.length % 4 === 1 ||
    (value.includes("=") && value.length % 4 !== 0)
  ) {
    fail(`Invalid Base64 encoding in ${field}.`);
  }
  const unpadded = value
    .replace(/=+$/, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, "=");
  try {
    const result = atob(padded);
    // Reject noncanonical trailing bits instead of accepting damaged keys.
    if (btoa(result).replace(/=+$/, "") !== unpadded)
      fail(`Invalid Base64 encoding in ${field}.`);
    return Uint8Array.from(result, (character) => character.charCodeAt(0));
  } catch {
    return fail(`Invalid Base64 encoding in ${field}.`);
  }
}

function decodeBase64Text(value: string): string {
  const bytes = decodeBase64Bytes(value, "Shadowsocks credentials");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("Shadowsocks credentials must contain valid UTF-8.");
  }
}

function readOptions(query: string, allowed: Set<string>): Map<string, string> {
  const result = new Map<string, string>();
  if (!query) return result;
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const separator = pair.indexOf("=");
    if (separator < 0) fail("Each query option must have a value.");
    const key = decode(
      pair.slice(0, separator).replace(/\+/g, " "),
      "query option",
    );
    // Do not echo unknown keys or values: either might contain a credential.
    if (!allowed.has(key))
      fail("This link contains an unsupported query option.");
    if (result.has(key)) fail(`The ${key} option occurs more than once.`);
    const value = decode(pair.slice(separator + 1).replace(/\+/g, " "), key);
    if (CONTROL.test(value))
      fail(`The ${key} option contains a control character.`);
    result.set(key, value);
  }
  return result;
}

function validateHost(value: string): string {
  if (!value || /[\s\u0000-\u001f\u007f\\/?#@%]/.test(value)) {
    fail("Enter a valid server hostname or IP address.");
  }
  if (value.startsWith("[")) {
    try {
      const host = new URL(`http://${value}`).hostname;
      if (!host.startsWith("[") || !value.endsWith("]")) throw new Error();
      return host.slice(1, -1);
    } catch {
      return fail("Enter a valid bracketed IPv6 address.");
    }
  }
  if (value.includes(":") || value.includes("[") || value.includes("]")) {
    fail("IPv6 addresses must be enclosed in square brackets.");
  }
  if (/^[0-9.]+$/.test(value)) {
    const parts = value.split(".");
    if (
      parts.length !== 4 ||
      parts.some(
        (part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255,
      )
    ) {
      fail("Enter a valid IPv4 address.");
    }
    return value;
  }
  let hostname: string;
  try {
    hostname = new URL(`http://${value}`).hostname;
  } catch {
    return fail("Enter a valid server hostname.");
  }
  const normalized = hostname.replace(/\.$/, "").toLowerCase();
  if (
    normalized.length > 253 ||
    normalized
      .split(".")
      .some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
  ) {
    fail("Enter a valid server hostname.");
  }
  // URL parsers accept hexadecimal/octal/integer IPv4 aliases. Refuse those
  // surprising address rewrites while allowing ordinary IDN conversion.
  if (/^[0-9.]+$/.test(normalized) && normalized !== value)
    fail("Use a dotted decimal IPv4 address.");
  return normalized;
}

function endpoint(value: string): { server: string; port: number } {
  const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(value);
  if (!match)
    fail("The server needs a hostname and an explicit port (1–65535).");
  const server = validateHost(match[1]);
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    fail("The server port must be between 1 and 65535.");
  return { server, port };
}

function profileName(value: string): string {
  if (CONTROL.test(value))
    fail("Profile names cannot contain control characters.");
  const name = value.trim();
  if (name.length > 200)
    fail("Profile names must contain at most 200 characters.");
  return name;
}

function manualHost(value: string): string {
  const trimmed = value.trim();
  // A form already separates the port, so a bare IPv6 address is unambiguous.
  return validateHost(
    trimmed.includes(":") && !trimmed.startsWith("[")
      ? `[${trimmed}]`
      : trimmed,
  );
}

/** Creates an HTTP CONNECT or SOCKS5 profile without contacting the server. */
export function createManualProfile(input: ManualProfileInput): Profile {
  if (input.protocol !== "http" && input.protocol !== "socks")
    fail("Choose HTTP or SOCKS5 for a manual proxy.");
  const name = profileName(input.name);
  const server = manualHost(input.server);
  const port = input.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    fail("The server port must be between 1 and 65535.");
  const username = input.username ?? "";
  const password = input.password ?? "";
  if (CONTROL.test(username) || CONTROL.test(password))
    fail("Proxy credentials cannot contain control characters.");
  if (!username && password)
    fail("Enter a username when providing a proxy password.");
  if (input.protocol === "http" && username.includes(":"))
    fail("HTTP Basic authentication usernames cannot contain a colon.");
  const usernameBytes = new TextEncoder().encode(username).length;
  const passwordBytes = new TextEncoder().encode(password).length;
  if (usernameBytes > 8192 || passwordBytes > 8192)
    fail("Proxy credentials must each be at most 8192 UTF-8 bytes.");
  if (input.protocol === "socks" && username) {
    // RFC 1929 encodes each authentication field in one byte and requires a
    // nonempty password. Measure bytes, not JavaScript UTF-16 string length.
    if (!password || usernameBytes > 255 || passwordBytes > 255)
      fail(
        "SOCKS5 authentication requires a username and password of 1–255 UTF-8 bytes each.",
      );
  }
  const serverName = input.serverName?.trim() ?? "";
  if (input.protocol === "socks" && (input.tls || serverName))
    fail("TLS is not supported for SOCKS5 profiles.");
  if (serverName && !input.tls)
    fail("A TLS server name requires TLS to be enabled.");
  const outbound: Record<string, unknown> = {
    type: input.protocol,
    server,
    server_port: port,
  };
  if (input.protocol === "socks") outbound.version = "5";
  if (username) {
    outbound.username = username;
    outbound.password = password;
  }
  if (input.protocol === "http" && input.tls) {
    outbound.tls = {
      enabled: true,
      server_name: serverName ? manualHost(serverName) : server,
    };
  }
  return {
    id: crypto.randomUUID(),
    name: name || `${formatProtocol(input.protocol)} · ${server}`,
    protocol: input.protocol,
    server,
    port,
    outbound,
    createdAt: new Date().toISOString(),
  };
}

function parseStandardProxy(
  scheme: "http" | "https" | "socks5",
  body: string,
  query: string,
  name: string,
): Profile {
  readOptions(query, new Set());
  const at = body.indexOf("@");
  if (at !== body.lastIndexOf("@"))
    fail("Percent-encode special characters in proxy credentials.");
  let username: string | undefined;
  let password: string | undefined;
  if (at >= 0) {
    const userinfo = body.slice(0, at);
    if (/[\/\\]/.test(userinfo))
      fail("Percent-encode special characters in proxy credentials.");
    const colon = userinfo.indexOf(":");
    username = decode(
      colon < 0 ? userinfo : userinfo.slice(0, colon),
      "proxy username",
    );
    password =
      colon < 0 ? "" : decode(userinfo.slice(colon + 1), "proxy password");
    if (!username) fail("Proxy authentication requires a nonempty username.");
  }
  const { server, port } = endpoint(body.slice(at + 1).replace(/\/$/, ""));
  return createManualProfile({
    name,
    protocol: scheme === "socks5" ? "socks" : "http",
    server,
    port,
    username,
    password,
    tls: scheme === "https",
  });
}

function credential(value: string, field: string): string {
  if (!value || CONTROL.test(value))
    fail(`${field} must be nonempty and contain no control characters.`);
  return value;
}

function requireUnused(
  options: Map<string, string>,
  keys: string[],
  reason: string,
) {
  if (keys.some((key) => options.has(key))) fail(reason);
}

function booleanOption(value: string): boolean {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return fail("Certificate verification options must be 0, 1, true, or false.");
}

function buildTls(
  options: Map<string, string>,
  protocol: "vless" | "trojan",
  server: string,
): Record<string, unknown> | undefined {
  const security =
    options.get("security") ?? (protocol === "trojan" ? "tls" : "none");
  if (!["none", "tls", "reality"].includes(security))
    fail("This TLS/security mode is not supported. Use TLS or Reality.");
  if (security === "none") {
    if (protocol === "trojan") fail("Trojan profiles require TLS or Reality.");
    requireUnused(
      options,
      ["sni", "fp", "alpn", "allowInsecure", "insecure", "pbk", "sid"],
      "TLS options require security=tls or security=reality.",
    );
    return undefined;
  }
  if (options.has("allowInsecure") && options.has("insecure"))
    fail("Use only one certificate verification option.");
  const sni = options.get("sni");
  const tls: Record<string, unknown> = {
    enabled: true,
    server_name: sni === undefined ? server : validateHost(sni),
  };
  const insecure = options.get("allowInsecure") ?? options.get("insecure");
  if (insecure !== undefined) tls.insecure = booleanOption(insecure);
  const fingerprint =
    options.get("fp") ?? (protocol === "vless" ? "chrome" : undefined);
  if (fingerprint !== undefined) {
    if (!FINGERPRINTS.has(fingerprint))
      fail("This TLS fingerprint is not supported by the proxy engine.");
    tls.utls = { enabled: true, fingerprint };
  }
  const alpn = options.get("alpn");
  if (alpn !== undefined) {
    const protocols = alpn.split(",");
    if (
      protocols.some(
        (item) =>
          !item ||
          /\s/.test(item) ||
          new TextEncoder().encode(item).length > 255,
      )
    ) {
      fail(
        "ALPN must be a comma-separated list without spaces or empty values.",
      );
    }
    tls.alpn = protocols;
  }
  if (security === "reality") {
    if (!options.has("fp"))
      fail("Reality requires an explicit fp TLS fingerprint.");
    const publicKey = options.get("pbk");
    if (
      !publicKey ||
      !/^[A-Za-z0-9_-]{43}$/.test(publicKey) ||
      decodeBase64Bytes(publicKey, "Reality public key").length !== 32
    ) {
      fail("Reality requires a valid 32-byte Base64URL public key (pbk).");
    }
    const shortId = options.get("sid") ?? "";
    if (!/^(?:[a-fA-F0-9]{2}){0,8}$/.test(shortId))
      fail(
        "Reality short ID (sid) must contain at most 16 hexadecimal characters in pairs.",
      );
    if (tls.insecure === true)
      fail("Reality does not support disabling certificate verification.");
    tls.reality = {
      enabled: true,
      public_key: publicKey,
      short_id: shortId.toLowerCase(),
    };
  } else {
    requireUnused(
      options,
      ["pbk", "sid"],
      "Reality key options require security=reality.",
    );
  }
  return tls;
}

function buildTransport(
  options: Map<string, string>,
): Record<string, unknown> | undefined {
  const type = options.get("type") ?? "tcp";
  if (!["tcp", "ws", "grpc"].includes(type))
    fail(
      "This transport is not supported. Use TCP, WebSocket, or standard gRPC.",
    );
  const headerType = options.get("headerType");
  if (headerType !== undefined && (type !== "tcp" || headerType !== "none")) {
    fail("TCP header obfuscation is not supported.");
  }
  if (type === "tcp") {
    requireUnused(
      options,
      ["path", "host", "serviceName", "mode"],
      "Transport options are not valid for a plain TCP profile.",
    );
    return undefined;
  }
  if (type === "ws") {
    requireUnused(
      options,
      ["serviceName", "mode"],
      "gRPC options cannot be used with WebSocket.",
    );
    let path = options.get("path") ?? "/";
    if (!path.startsWith("/") || /[\s#]/.test(path))
      fail(
        "The WebSocket path must start with / and contain no spaces or fragment.",
      );
    const transport: Record<string, unknown> = { type: "ws" };
    // Xray encodes early data in the path. Preserve other query text exactly.
    const question = path.indexOf("?");
    if (question >= 0) {
      const pieces = path.slice(question + 1).split("&");
      const early = pieces.filter(
        (piece) => decode(piece.split("=")[0], "WebSocket path") === "ed",
      );
      if (early.length > 1) fail("WebSocket early data occurs more than once.");
      if (early.length === 1) {
        const value = early[0].slice(early[0].indexOf("=") + 1);
        if (!/^\d+$/.test(value) || Number(value) > 8192)
          fail("WebSocket early data must be between 0 and 8192 bytes.");
        transport.max_early_data = Number(value);
        if (Number(value) > 0)
          transport.early_data_header_name = "Sec-WebSocket-Protocol";
        const remaining = pieces
          .filter((piece) => piece !== early[0])
          .join("&");
        path = path.slice(0, question) + (remaining ? `?${remaining}` : "");
      }
    }
    transport.path = path;
    const host = options.get("host");
    if (host !== undefined) {
      if (!host || /[\s/@#?\\]/.test(host))
        fail("The WebSocket Host header is invalid.");
      // Host headers may include a port or bracketed IPv6.
      const hostWithPort = /:\d+$/.test(host) && !host.endsWith("]");
      if (hostWithPort) endpoint(host);
      else validateHost(host);
      transport.headers = { Host: host };
    }
    return transport;
  }
  requireUnused(
    options,
    ["path", "host"],
    "Use serviceName for gRPC; HTTP path and Host options cannot be translated.",
  );
  if (options.has("mode") && options.get("mode") !== "gun")
    fail("Only standard gRPC mode (gun) is supported.");
  const serviceName = options.get("serviceName");
  if (
    serviceName !== undefined &&
    (!serviceName || !/^[a-zA-Z0-9_.-]+$/.test(serviceName))
  ) {
    fail(
      "This gRPC service name requires a custom method path, which is not supported.",
    );
  }
  return {
    type: "grpc",
    ...(serviceName === undefined ? {} : { service_name: serviceName }),
  };
}

function parseShadowsocks(
  body: string,
  query: string,
): { server: string; port: number; outbound: Record<string, unknown> } {
  const options = readOptions(query, new Set(["plugin"]));
  if (options.has("plugin"))
    fail("Shadowsocks plugins are not supported in this version.");
  let authority: string;
  let credentials: string;
  let encodedUserinfo = false;
  if (body.includes("@")) {
    const split = body.lastIndexOf("@");
    const userinfo = body.slice(0, split);
    authority = body.slice(split + 1).replace(/\/$/, "");
    if (userinfo.includes("@"))
      fail("Percent-encode special characters in Shadowsocks credentials.");
    if (userinfo.includes(":")) {
      const colon = userinfo.indexOf(":");
      credentials = `${decode(userinfo.slice(0, colon), "Shadowsocks method")}:${decode(userinfo.slice(colon + 1), "Shadowsocks password")}`;
    } else {
      encodedUserinfo = true;
      credentials = decodeBase64Text(
        decode(userinfo, "Shadowsocks credentials"),
      );
    }
  } else {
    // Legacy format encodes the entire method:password@host:port value. The
    // password may itself contain @, colon, slash, or percent characters.
    const decoded = decodeBase64Text(body);
    const split = decoded.lastIndexOf("@");
    if (split < 0)
      fail("Legacy Shadowsocks links need encoded credentials and a server.");
    authority = decoded.slice(split + 1);
    credentials = decoded.slice(0, split);
    encodedUserinfo = true;
  }
  const colon = credentials.indexOf(":");
  if (colon < 1) fail("Shadowsocks credentials need a cipher and password.");
  const method = credentials.slice(0, colon);
  if (!SS_METHODS.has(method))
    fail("This Shadowsocks encryption method is not supported.");
  const password = credential(
    credentials.slice(colon + 1),
    "Shadowsocks password",
  );
  if (method.startsWith("2022-")) {
    if (encodedUserinfo)
      fail(
        "AEAD-2022 Shadowsocks links must use plain, percent-encoded credentials.",
      );
    const keyLength = method === "2022-blake3-aes-128-gcm" ? 16 : 32;
    const keys = password.split(":");
    if (method === "2022-blake3-chacha20-poly1305" && keys.length !== 1)
      fail("This Shadowsocks method does not support identity key chains.");
    for (const key of keys) {
      if (decodeBase64Bytes(key, "Shadowsocks 2022 key").length !== keyLength)
        fail("The Shadowsocks 2022 key has the wrong length for its cipher.");
    }
  }
  const { server, port } = endpoint(authority);
  return {
    server,
    port,
    outbound: {
      type: "shadowsocks",
      server,
      server_port: port,
      method,
      password,
    },
  };
}

function parseProfile(line: string): Profile {
  const match = /^(ss|vless|trojan|http|https|socks5):\/\//i.exec(line);
  if (!match)
    fail(
      "Use an ss://, vless://, trojan://, http://, https://, or socks5:// proxy link.",
    );
  const scheme = match[1].toLowerCase();
  const hash = line.indexOf("#");
  const name = profileName(
    hash < 0 ? "" : decode(line.slice(hash + 1), "profile name"),
  );
  const main = line.slice(match[0].length, hash < 0 ? undefined : hash);
  if (/[\s\u0000-\u001f\u007f]/.test(main))
    fail("Percent-encode spaces and special characters inside the link.");
  const question = main.indexOf("?");
  const body = question < 0 ? main : main.slice(0, question);
  const query = question < 0 ? "" : main.slice(question + 1);
  if (scheme === "http" || scheme === "https" || scheme === "socks5")
    return parseStandardProxy(scheme, body, query, name);
  const protocol: ProxyProtocol =
    scheme === "ss" ? "shadowsocks" : (scheme as "vless" | "trojan");
  let parsed: {
    server: string;
    port: number;
    outbound: Record<string, unknown>;
  };
  if (protocol === "shadowsocks") {
    parsed = parseShadowsocks(body, query);
  } else {
    const at = body.indexOf("@");
    if (at < 1 || at !== body.lastIndexOf("@"))
      fail("The link needs one percent-encoded credential before @.");
    const auth = credential(
      decode(body.slice(0, at), "credentials"),
      protocol === "vless" ? "VLESS UUID" : "Trojan password",
    );
    const { server, port } = endpoint(body.slice(at + 1).replace(/\/$/, ""));
    const allowed = new Set(COMMON_OPTIONS);
    if (protocol === "vless") {
      allowed.add("encryption");
      allowed.add("flow");
    }
    const options = readOptions(query, allowed);
    const outbound: Record<string, unknown> = {
      type: protocol,
      server,
      server_port: port,
    };
    if (protocol === "vless") {
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(auth))
        fail("VLESS requires a valid UUID credential.");
      if ((options.get("encryption") ?? "none") !== "none")
        fail(
          "This VLESS encryption mode is not supported by the proxy engine.",
        );
      outbound.uuid = auth.toLowerCase();
      const flow = options.get("flow");
      if (flow) {
        if (flow !== "xtls-rprx-vision")
          fail("Only the xtls-rprx-vision VLESS flow is supported.");
        if (
          (options.get("type") ?? "tcp") !== "tcp" ||
          !["tls", "reality"].includes(options.get("security") ?? "none")
        ) {
          fail("The Vision flow requires TCP with TLS or Reality.");
        }
        outbound.flow = flow;
      }
    } else {
      outbound.password = auth;
    }
    const tls = buildTls(options, protocol, server);
    const transport = buildTransport(options);
    if (tls) outbound.tls = tls;
    if (transport) outbound.transport = transport;
    parsed = { server, port, outbound };
  }
  return {
    id: crypto.randomUUID(),
    name: name || `${formatProtocol(protocol)} · ${parsed.server}`,
    protocol,
    server: parsed.server,
    port: parsed.port,
    outbound: parsed.outbound,
    createdAt: new Date().toISOString(),
  };
}

/** Imports atomically. Errors contain a line number, never the supplied URI. */
export function importProfiles(text: string): Profile[] {
  if (text.length > MAX_INPUT)
    fail("The import is too large. Paste fewer than 2 MB of share links.");
  const profiles: Profile[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const profile = parseProfile(line);
      const fingerprint = profileFingerprint(profile);
      if (!seen.has(fingerprint)) {
        profiles.push(profile);
        seen.add(fingerprint);
      }
    } catch (error) {
      // Browser URL/decoder exceptions may contain input, so only expose our
      // own deliberately credential-free error strings.
      const message =
        error instanceof ImportError
          ? error.message
          : "This share link could not be parsed.";
      throw new Error(`Line ${index + 1}: ${message}`);
    }
  }
  if (profiles.length === 0)
    fail(
      "Paste at least one ss://, vless://, trojan://, http://, https://, or socks5:// proxy link.",
    );
  return profiles;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

/** Credential-bearing canonical identity for in-memory deduplication. Never log it. */
export function profileFingerprint(profile: Profile): string {
  const { tag: _tag, ...outbound } = profile.outbound;
  return JSON.stringify(canonical(outbound));
}

export function formatProtocol(protocol: ProxyProtocol): string {
  return {
    shadowsocks: "Shadowsocks",
    vless: "VLESS",
    trojan: "Trojan",
    http: "HTTP",
    socks: "SOCKS5",
  }[protocol];
}

export function getProfileSecurity(profile: Profile): string {
  const tls = profile.outbound.tls as Record<string, unknown> | undefined;
  if (tls?.enabled) {
    if ((tls.reality as Record<string, unknown> | undefined)?.enabled)
      return "Reality";
    return tls.insecure ? "TLS (unverified)" : "TLS";
  }
  if (profile.protocol === "shadowsocks" && profile.outbound.method !== "none")
    return "Shadowsocks encryption";
  return "No encryption";
}

export function profileSummary(profile: Profile): string {
  const transport = profile.outbound.transport as
    Record<string, unknown> | undefined;
  const transportName =
    profile.protocol === "http"
      ? "CONNECT"
      : transport?.type === "ws"
        ? "WebSocket"
        : transport?.type === "grpc"
          ? "gRPC"
          : "TCP";
  return `${formatProtocol(profile.protocol)} · ${transportName} · ${getProfileSecurity(profile)}`;
}
