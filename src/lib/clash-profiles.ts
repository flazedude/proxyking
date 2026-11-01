import {
  readClashDocument,
  inspectClashConfig,
} from "../accelerator/clash-import";
import { importProfiles } from "./profiles";
import type { Profile } from "../types";

const baseFields = [
  "name",
  "type",
  "server",
  "port",
  "udp",
  "tfo",
  "mptcp",
  "ip-version",
];
export interface ClashProfiles {
  profiles: Profile[];
  skipped: number;
  externalProviders: number;
  ignored: string[];
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Unsupported node option.");
  // Avoid silently losing behavioral options even if their key is recognized.
  if (
    value.tfo ||
    value.mptcp ||
    (value["ip-version"] && value["ip-version"] !== "dual")
  )
    throw new Error("Unsupported dial option.");
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || /[\x00-\x1f\x7f]/.test(value))
    throw new Error("Invalid field.");
  return value;
}

export function importClashProfiles(input: string): ClashProfiles {
  const report = inspectClashConfig(input);
  const document = readClashDocument(input);
  const raw = Array.isArray(document.proxies) ? [...document.proxies] : [];
  if (record(document["proxy-providers"]))
    for (const provider of Object.values(document["proxy-providers"])) {
      if (
        record(provider) &&
        provider.type === "inline" &&
        Array.isArray(provider.payload)
      )
        raw.push(...provider.payload);
    }
  const result: ClashProfiles = {
    profiles: [],
    skipped: 0,
    externalProviders: report.providers,
    ignored: report.ignored,
  };
  for (const node of raw) {
    try {
      if (!record(node)) throw new Error("Invalid node.");
      for (const key of ["udp", "tls", "tfo", "mptcp", "skip-cert-verify"])
        if (node[key] !== undefined && typeof node[key] !== "boolean")
          throw new Error("Invalid boolean option.");
      const name = text(node.name);
      const host = text(node.server);
      if (
        !Number.isInteger(node.port) ||
        Number(node.port) < 1 ||
        Number(node.port) > 65535
      )
        throw new Error("Invalid port.");
      if (/[\s/\\@#?]/.test(host)) throw new Error("Invalid server.");
      const endpoint = `${host.includes(":") ? `[${host}]` : host}:${node.port}`;
      let link: string;
      if (node.type === "ss") {
        fields(node, [...baseFields, "cipher", "password"]);
        // btoa requires bytes, not arbitrary Unicode credentials.
        const auth = new TextEncoder().encode(
          `${text(node.cipher)}:${text(node.password)}`,
        );
        link = `ss://${btoa(String.fromCharCode(...auth))}@${endpoint}#${encodeURIComponent(name)}`;
      } else if (node.type === "http" || node.type === "socks5") {
        fields(node, [
          ...baseFields,
          "username",
          "password",
          "tls",
          "sni",
          "skip-cert-verify",
        ]);
        if (
          node["skip-cert-verify"] ||
          (node.type === "socks5" && node.tls) ||
          node.sni
        )
          throw new Error("Unsupported TLS setting.");
        const auth =
          node.username !== undefined || node.password !== undefined
            ? `${encodeURIComponent(text(node.username))}:${encodeURIComponent(typeof node.password === "string" ? node.password : text(node.password))}@`
            : "";
        link = `${node.type === "socks5" ? "socks5" : node.tls ? "https" : "http"}://${auth}${endpoint}#${encodeURIComponent(name)}`;
      } else if (node.type === "trojan" || node.type === "vless") {
        if (node["reality-opts"] !== undefined && !record(node["reality-opts"]))
          throw new Error("Invalid Reality settings.");
        if (
          (node.type === "trojan" &&
            (node.tls === false ||
              node.uuid !== undefined ||
              node.flow !== undefined ||
              node["packet-encoding"] !== undefined)) ||
          (node.type === "vless" && node.password !== undefined)
        )
          throw new Error("Mismatched protocol option.");
        fields(node, [
          ...baseFields,
          "password",
          "uuid",
          "tls",
          "servername",
          "sni",
          "skip-cert-verify",
          "alpn",
          "client-fingerprint",
          "network",
          "ws-opts",
          "grpc-opts",
          "reality-opts",
          "flow",
          "packet-encoding",
        ]);
        if (node["packet-encoding"] && node["packet-encoding"] !== "xudp")
          throw new Error("Unsupported packet encoding.");
        const params = new URLSearchParams();
        const reality = record(node["reality-opts"])
          ? node["reality-opts"]
          : null;
        params.set(
          "security",
          reality
            ? "reality"
            : node.type === "trojan" || node.tls
              ? "tls"
              : "none",
        );
        if (node.servername || node.sni)
          params.set("sni", text(node.servername || node.sni));
        if (node["skip-cert-verify"] === true) params.set("allowInsecure", "1");
        if (node["client-fingerprint"])
          params.set("fp", text(node["client-fingerprint"]));
        if (node.alpn) {
          if (
            !Array.isArray(node.alpn) ||
            !node.alpn.every((item) => typeof item === "string")
          )
            throw new Error("Invalid ALPN.");
          params.set("alpn", node.alpn.join(","));
        }
        if (node.flow) params.set("flow", text(node.flow));
        if (reality) {
          fields(reality, ["public-key", "short-id"]);
          params.set("pbk", text(reality["public-key"]));
          if (reality["short-id"]) params.set("sid", text(reality["short-id"]));
        }
        const network = node.network ?? "tcp";
        params.set("type", String(network));
        if (network === "ws") {
          if (!record(node["ws-opts"]))
            throw new Error("Missing WebSocket settings.");
          const ws = node["ws-opts"];
          fields(ws, ["path", "headers"]);
          if (ws.path) params.set("path", text(ws.path));
          if (ws.headers) {
            if (!record(ws.headers)) throw new Error("Invalid headers.");
            fields(ws.headers, ["Host"]);
            if (ws.headers.Host) params.set("host", text(ws.headers.Host));
          }
        } else if (network === "grpc") {
          if (!record(node["grpc-opts"]))
            throw new Error("Missing gRPC settings.");
          const grpc = node["grpc-opts"];
          fields(grpc, ["grpc-service-name"]);
          if (grpc["grpc-service-name"])
            params.set("serviceName", text(grpc["grpc-service-name"]));
        } else if (node["ws-opts"] || node["grpc-opts"])
          throw new Error("Mismatched transport.");
        link = `${node.type}://${encodeURIComponent(text(node.type === "vless" ? node.uuid : node.password))}@${endpoint}?${params}#${encodeURIComponent(name)}`;
      } else throw new Error("Unsupported protocol.");
      const profile = importProfiles(link)[0];
      if (node.udp === false && profile.protocol === "socks")
        throw new Error("Unsupported SOCKS UDP override.");
      if (node.udp === false && profile.protocol !== "http")
        profile.outbound.network = "tcp";
      if (profile.protocol === "vless" && node["packet-encoding"])
        profile.outbound.packet_encoding = node["packet-encoding"];
      result.profiles.push(profile);
    } catch {
      result.skipped++;
    }
  }
  return result;
}
