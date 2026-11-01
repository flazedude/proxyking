import { describe, expect, it } from "vitest";
import { importClashProfiles } from "./clash-profiles";

describe("isolated Clash server import", () => {
  it("copies supported credentials into the existing profile contract without importing runtime controls", () => {
    const imported = importClashProfiles(
      "proxies:\n  - name: Fixture\n    type: ss\n    server: 127.0.0.1\n    port: 23456\n    cipher: aes-128-gcm\n    password: fixture-password\ntun:\n  enable: true\nexternal-controller: 0.0.0.0:9090\nsecret: unused-controller-secret\n",
    );
    expect(imported.profiles).toHaveLength(1);
    expect(imported.profiles[0].outbound).toMatchObject({
      type: "shadowsocks",
      password: "fixture-password",
      method: "aes-128-gcm",
    });
    expect(JSON.stringify(imported.profiles)).not.toMatch(
      /external-controller|unused-controller-secret|tun/,
    );
    expect(imported.ignored).toContain("TUN settings");
  });
  it("preserves VLESS TLS and WebSocket settings", () => {
    const result = importClashProfiles(
      "proxies:\n  - name: Fixture\n    type: vless\n    server: proxy.example\n    port: 443\n    uuid: 12345678-1234-1234-1234-123456789abc\n    tls: true\n    servername: sni.example\n    network: ws\n    ws-opts:\n      path: /game\n      headers:\n        Host: ws.example\n",
    );
    expect(result.skipped).toBe(0);
    expect(result.profiles[0].outbound).toMatchObject({
      tls: { enabled: true, server_name: "sni.example" },
      transport: { type: "ws", path: "/game", headers: { Host: "ws.example" } },
    });
  });
  it("rejects unsupported protocol options rather than silently changing their meaning", () => {
    const result = importClashProfiles(
      "proxies:\n  - name: Plugin\n    type: ss\n    server: proxy.example\n    port: 443\n    cipher: aes-128-gcm\n    password: fixture-password\n    plugin: obfs\n  - name: VMess\n    type: vmess\n    server: proxy.example\n    port: 443\n    uuid: fixture-private-id\nproxy-providers:\n  external:\n    type: http\n    url: https://provider.example/private-token\n",
    );
    expect(result.profiles).toEqual([]);
    expect(result.skipped).toBe(2);
    expect(result.externalProviders).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(
      /private-token|fixture-password|fixture-private-id/,
    );
  });
});
