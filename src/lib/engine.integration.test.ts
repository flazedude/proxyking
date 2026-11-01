/// <reference types="node" />
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createManualProfile, importProfiles } from "./profiles";
import { importClashProfiles } from "./clash-profiles";
import type { Profile } from "../types";

const enginePath = fileURLToPath(
  new URL("../../src-tauri/resources/sing-box.exe", import.meta.url),
);
const engineAvailable = platform === "win32" && existsSync(enginePath);
const uuid = "bf000d23-0752-40b4-affe-68f7707a9661";
const publicKey = "jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0";
const key128 = btoa("0123456789abcdef");
const key256 = btoa("0123456789abcdef0123456789abcdef");
const vless = (query: string) => `vless://${uuid}@proxy.example:443?${query}`;
const trojan = (query: string) =>
  `trojan://${encodeURIComponent("test:@/?#%+雪")}@proxy.example:443${query ? `?${query}` : ""}`;
const ss2022 = (cipher: string, key: string) =>
  `ss://${cipher}:${encodeURIComponent(key)}@proxy.example:8388`;

// All credentials below are public fixtures. `check` only loads and validates
// configuration; it does not run listeners, connect to a proxy, or alter Windows.
// Keep this wrapper aligned with src-tauri/src/config.rs::build_config.
function configFor(input: string | Profile) {
  const profile = typeof input === "string" ? importProfiles(input)[0] : input;
  const outbound: Record<string, unknown> = {
    ...profile.outbound,
    tag: "proxy",
  };
  return {
    log: { disabled: true },
    inbounds: [
      { type: "mixed", tag: "local", listen: "127.0.0.1", listen_port: 2080 },
    ],
    outbounds: [outbound],
    route: { final: "proxy" },
  };
}

function check(configuration: unknown) {
  return spawnSync(enginePath, ["check", "-c", "stdin"], {
    input: JSON.stringify(configuration),
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
}

const fixtures = [
  [
    "Shadowsocks AES-GCM",
    `ss://${btoa("aes-256-gcm:test-password")}@proxy.example:8388`,
  ],
  [
    "Shadowsocks ChaCha20 AEAD",
    `ss://${btoa("chacha20-ietf-poly1305:test-password")}@proxy.example:8388`,
  ],
  [
    "Shadowsocks legacy URI with punctuation",
    `ss://${btoa("aes-128-gcm:test:/@?#%@127.0.0.1:8388")}`,
  ],
  ["Shadowsocks 2022 AES-128", ss2022("2022-blake3-aes-128-gcm", key128)],
  ["Shadowsocks 2022 AES-256", ss2022("2022-blake3-aes-256-gcm", key256)],
  [
    "Shadowsocks 2022 AES identity chain",
    ss2022("2022-blake3-aes-128-gcm", `${key128}:${key128}`),
  ],
  [
    "Shadowsocks 2022 ChaCha20",
    ss2022("2022-blake3-chacha20-poly1305", key256),
  ],
  ["VLESS plain TCP", vless("security=none")],
  [
    "VLESS TLS with ALPN",
    vless("security=tls&alpn=h2%2Chttp%2F1.1&fp=firefox&sni=tls.example"),
  ],
  ["VLESS TLS Vision", vless("security=tls&flow=xtls-rprx-vision")],
  [
    "VLESS Reality Vision",
    vless(
      `security=reality&flow=xtls-rprx-vision&fp=chrome&pbk=${publicKey}&sid=01a2&sni=tls.example`,
    ),
  ],
  [
    "VLESS Reality empty short ID",
    vless(`security=reality&fp=chrome&pbk=${publicKey}&sid=`),
  ],
  [
    "VLESS TLS WebSocket",
    vless(
      "security=tls&type=ws&host=cdn.example%3A8443&path=%2Fgateway%3Ftoken%3Dvalue",
    ),
  ],
  [
    "VLESS WebSocket early data",
    vless(`type=ws&path=${encodeURIComponent("/gateway?token=a%2Fb&ed=2048")}`),
  ],
  [
    "VLESS TLS gRPC",
    vless("security=tls&type=grpc&serviceName=my.service-name&mode=gun"),
  ],
  ["Trojan TLS with punctuation password", trojan("")],
  ["Trojan TLS WebSocket", trojan("type=ws&path=%2Fgateway&host=cdn.example")],
  ["Trojan TLS gRPC", trojan("type=grpc&serviceName=my.service-name")],
  [
    "Trojan Reality",
    trojan(
      `security=reality&fp=chrome&pbk=${publicKey}&sid=01a2&sni=tls.example`,
    ),
  ],
  ["Trojan IPv6", `trojan://test-password@[2001:db8::1]:443?sni=tls.example`],
  ["HTTP CONNECT without authentication", "http://proxy.example:8080"],
  [
    "HTTP CONNECT with punctuation credentials",
    `http://${encodeURIComponent("test@雪")}:${encodeURIComponent("p:@/#?%+雪")}@proxy.example:8080`,
  ],
  ["HTTP CONNECT with empty password", "http://test@proxy.example:8080"],
  [
    "HTTPS CONNECT with authentication",
    "https://test:password@proxy.example:443",
  ],
  ["SOCKS5 without authentication", "socks5://proxy.example:1080"],
  [
    "SOCKS5 with punctuation credentials",
    `socks5://${encodeURIComponent("test:@雪")}:${encodeURIComponent("p:@/#?%+雪")}@proxy.example:1080`,
  ],
  ["SOCKS5 IPv6", "socks5://test:password@[2001:db8::1]:1080"],
] as const;

describe.skipIf(!engineAvailable)(
  "real sing-box configuration compatibility (requires npm run setup:engine on Windows)",
  () => {
    it("accepts supported imported Clash servers without enabling imported runtime controls", () => {
      const nodes = [
        {
          name: "SS fixture",
          type: "ss",
          server: "proxy.example",
          port: 443,
          cipher: "aes-128-gcm",
          password: "test-only-password",
          udp: false,
        },
        {
          name: "VLESS fixture",
          type: "vless",
          server: "proxy.example",
          port: 443,
          uuid,
          tls: true,
          servername: "tls.example",
          network: "ws",
          "ws-opts": { path: "/game", headers: { Host: "ws.example" } },
        },
        {
          name: "Trojan fixture",
          type: "trojan",
          server: "proxy.example",
          port: 443,
          password: "test-only-password",
          sni: "tls.example",
        },
        {
          name: "HTTP fixture",
          type: "http",
          server: "proxy.example",
          port: 8080,
          username: "fixture",
          password: "test-only-password",
        },
        {
          name: "SOCKS fixture",
          type: "socks5",
          server: "proxy.example",
          port: 1080,
          username: "fixture",
          password: "test-only-password",
        },
      ];
      const imported = importClashProfiles(
        JSON.stringify({
          proxies: nodes,
          tun: { enable: true },
          "mixed-port": 7897,
        }),
      );
      expect(imported.profiles).toHaveLength(5);
      expect(imported.skipped).toBe(0);
      for (const profile of imported.profiles)
        expect(check(configFor(profile)).status).toBe(0);
    });
    it.each(fixtures)("accepts %s", (_name, link) => {
      const result = check(configFor(link));
      expect(
        result.error,
        "The engine must finish its configuration check.",
      ).toBeUndefined();
      expect(
        result.status,
        result.stderr ||
          result.stdout ||
          "The engine configuration check failed.",
      ).toBe(0);
    });

    it("rejects an invalid cipher, demonstrating that the real engine validated the input", () => {
      const configuration = configFor(fixtures[0][1]);
      configuration.outbounds[0].method = "invalid-test-cipher";
      const result = check(configuration);
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
    });

    it("accepts a manual HTTPS proxy with independent TLS server name", () => {
      const profile = createManualProfile({
        name: "Manual HTTPS fixture",
        protocol: "http",
        server: "2001:db8::1",
        port: 8443,
        username: "test@user",
        password: "test:@/#?%+雪",
        tls: true,
        serverName: "tls.example",
      });
      const result = check(configFor(profile));
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr || result.stdout).toBe(0);
    });

    it("accepts manual SOCKS5 authentication at the protocol byte limit", () => {
      const profile = createManualProfile({
        name: "Manual SOCKS5 fixture",
        protocol: "socks",
        server: "proxy.example",
        port: 1080,
        username: "雪".repeat(85),
        password: "p".repeat(255),
      });
      const result = check(configFor(profile));
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr || result.stdout).toBe(0);
    });
  },
);
