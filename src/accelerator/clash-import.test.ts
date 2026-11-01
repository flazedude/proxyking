import { describe, expect, it } from "vitest";
import { inspectClashConfig, MAX_CONFIG_BYTES } from "./clash-import";

const server = (extra = "") =>
  `proxies:\n  - name: Game server\n    type: ss\n    server: server.example\n    port: 443\n    cipher: aes-128-gcm\n    password: super-private-password\n${extra}`;

describe("Clash metadata preview", () => {
  it("extracts only display metadata and excludes connection/system settings", () => {
    const result = inspectClashConfig(
      server(
        `tun:\n  enable: true\ndns:\n  enable: true\n  enhanced-mode: fake-ip\nmixed-port: 7897\nexternal-controller: 127.0.0.1:9097\nsecret: controller-private-value\nrules:\n  - MATCH,PROXY\n`,
      ),
    );
    expect(result.servers).toEqual([
      {
        id: "import:0",
        name: "Game server",
        type: "ss",
        udp: "unverified",
        origin: "imported",
      },
    ]);
    const serialized = JSON.stringify(result);
    for (const secret of [
      "super-private-password",
      "controller-private-value",
      "server.example",
      "7897",
      "9097",
      "MATCH,PROXY",
    ])
      expect(serialized).not.toContain(secret);
    expect(result.ignored).toEqual([
      "TUN settings",
      "DNS settings",
      "Routing rules",
      "Controller settings",
      "Controller credentials",
      "Proxy ports",
    ]);
  });

  it("recognizes inline provider payloads without opening external providers", () => {
    const result = inspectClashConfig(
      `proxy-providers:\n  local:\n    type: file\n    path: C:\\private\\servers.yaml\n  remote:\n    type: http\n    url: https://provider.example/secret-token\n    header:\n      Authorization: bearer-private-token\n  embedded:\n    type: inline\n    payload:\n      - name: Inline server\n        type: vless\n        server: embedded.example\n        port: 443\n        uuid: private-uuid\nproxy-groups:\n  - name: Games\n    type: select\n    use: [remote]\n`,
    );
    expect(result.providers).toBe(2);
    expect(result.servers.map((item) => item.name)).toEqual(["Inline server"]);
    expect(result.groups).toBe(1);
    expect(result.unresolvedGroups).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(
      /secret-token|private-token|private-uuid|private\\\\servers|embedded\.example/,
    );
  });

  it("allows a provider-only profile but reports that no labels can be imported", () => {
    const report = inspectClashConfig(
      "proxy-providers:\n  remote:\n    type: http\n    url: https://provider.example/secret\n",
    );
    expect(report.servers).toEqual([]);
    expect(report.providers).toBe(1);
  });

  it("does not claim UDP works just because a protocol supports it", () => {
    expect(inspectClashConfig(server()).servers[0].udp).toBe("unverified");
    expect(
      inspectClashConfig(server().replace("type: ss", "type: http")).servers[0]
        .udp,
    ).toBe("disabled");
    expect(
      inspectClashConfig(
        server().replace("    cipher:", "    udp: false\n    cipher:"),
      ).servers[0].udp,
    ).toBe("disabled");
  });

  it.each([
    ["type: ss", "type: unknown-engine-protocol"],
    ["port: 443", "port: 0"],
    ["port: 443", "port: 65536"],
    ["port: 443", 'port: "443"'],
    [
      "server: server.example",
      "server: https://credential@server.example/path",
    ],
    ["name: Game server", "name: https://provider.example/secret-token"],
    ["name: Game server", "name: super-private-password"],
  ])("excludes unsafe or unsupported server metadata: %s", (before, after) => {
    const result = inspectClashConfig(server().replace(before, after));
    expect(result.servers).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  it("reports duplicate server labels without overwriting a selected entry", () => {
    const result = inspectClashConfig(
      `${server()}  - name: Game server\n    type: http\n    server: second.example\n    port: 443\n`,
    );
    expect(result.servers).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it("redacts parser errors even when malformed input contains secrets", () => {
    const malformed = "proxies:\n  - password: [very-private-test-secret\n";
    expect(() => inspectClashConfig(malformed)).toThrow(
      "Invalid or unsupported YAML",
    );
    try {
      inspectClashConfig(malformed);
    } catch (error) {
      expect(String(error)).not.toContain("very-private-test-secret");
    }
  });

  it.each([
    "proxies: []\nproxies: []",
    "proxies: !unsupported []",
    "proxies: &a [*a]",
    "proxies: []\n__proto__: { polluted: true }",
    "proxies: []\nconstructor: { prototype: { polluted: true } }",
    "proxies: []\n? [complex, key]\n: value",
    "proxies: {}",
    "proxy-providers: []",
    "proxies: []\nproxy-groups: {}",
    "- not\n- a\n- mapping",
    "proxies: []\n---\nproxies: []",
    "proxies: []",
  ])(
    "rejects ambiguous, unsafe, or malformed YAML without exposing it",
    (input) => {
      expect(() => inspectClashConfig(input)).toThrow();
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    },
  );

  it("limits bytes, server count, and nesting independently", () => {
    expect(() =>
      inspectClashConfig("#" + "x".repeat(MAX_CONFIG_BYTES)),
    ).toThrow("512 KB");
    expect(() =>
      inspectClashConfig("#" + "界".repeat(MAX_CONFIG_BYTES / 2)),
    ).toThrow("512 KB");
    const many =
      "proxies:\n" +
      Array.from(
        { length: 501 },
        (_, index) =>
          `  - name: Node ${index}\n    type: ss\n    server: example.com\n    port: 443\n`,
      ).join("");
    expect(() => inspectClashConfig(many)).toThrow("500 servers");
    expect(() =>
      inspectClashConfig(
        `proxies: []\nother: ${"[".repeat(40)}0${"]".repeat(40)}`,
      ),
    ).toThrow("too complex");
    expect(() =>
      inspectClashConfig(
        `proxies: []\nother: [${Array(13000).fill("0").join(",")}]`,
      ),
    ).toThrow("too complex");
  });
});
