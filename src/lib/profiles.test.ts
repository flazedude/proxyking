import { describe, expect, it } from "vitest";
import {
  createManualProfile,
  formatProtocol,
  getProfileSecurity,
  importProfiles,
  profileFingerprint,
  profileSummary,
} from "./profiles";
import type { ManualProfileInput } from "./profiles";

const UUID = "bf000d23-0752-40b4-affe-68f7707a9661";
const REALITY_KEY = "jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0";
const vless = (query = "", host = "proxy.example:443") =>
  `vless://${UUID}@${host}${query ? `?${query}` : ""}`;
const base64 = (value: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(value)));
const ss = (password = "password", host = "proxy.example:8388") =>
  `ss://${base64(`aes-256-gcm:${password}`)}@${host}`;

describe("manual HTTP and SOCKS5 profiles", () => {
  const manual = (options: Partial<ManualProfileInput> = {}) =>
    createManualProfile({
      name: "Office proxy",
      protocol: "http",
      server: "proxy.example",
      port: 8080,
      ...options,
    });

  it("creates an unauthenticated HTTP CONNECT profile and normalizes form input", () => {
    const profile = manual({
      name: "  Office proxy  ",
      server: " PROXY.Example. ",
    });
    expect(profile).toMatchObject({
      name: "Office proxy",
      protocol: "http",
      server: "proxy.example",
      port: 8080,
    });
    expect(profile.outbound).toEqual({
      type: "http",
      server: "proxy.example",
      server_port: 8080,
    });
    expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(profile.createdAt))).toBe(false);
    expect(profileSummary(profile)).toBe("HTTP · CONNECT · No encryption");
  });

  it("supports either bracketed or bare IPv6 and preserves SOCKS5 credentials exactly", () => {
    const credentials = { username: " login:@雪 ", password: " p:@/?#%+雪 " };
    const profile = manual({
      protocol: "socks",
      server: "2001:DB8::1",
      port: 1080,
      ...credentials,
    });
    expect(profile.outbound).toEqual({
      type: "socks",
      version: "5",
      server: "2001:db8::1",
      server_port: 1080,
      ...credentials,
    });
    expect(manual({ server: "[2001:DB8::1]" }).server).toBe("2001:db8::1");
    expect(getProfileSecurity(profile)).toBe("No encryption");
    expect(profileSummary(profile)).toBe("SOCKS5 · TCP · No encryption");
  });

  it("enables verified HTTPS proxy TLS with an optional independent server name", () => {
    const profile = manual({
      tls: true,
      server: "192.0.2.1",
      serverName: " TLS.EXAMPLE ",
    });
    expect(profile.outbound.tls).toEqual({
      enabled: true,
      server_name: "tls.example",
    });
    expect(getProfileSecurity(profile)).toBe("TLS");
    expect(manual({ tls: true }).outbound.tls).toEqual({
      enabled: true,
      server_name: "proxy.example",
    });
    expect(profile.protocol).toBe("http");
  });

  it("keeps empty authentication absent but supports an HTTP username with an empty password", () => {
    expect(manual({ username: "", password: "" }).outbound).not.toHaveProperty(
      "username",
    );
    expect(manual({ username: "user" }).outbound).toMatchObject({
      username: "user",
      password: "",
    });
    expect(manual({ protocol: "socks" }).outbound).not.toHaveProperty(
      "username",
    );
  });

  it("provides a default label and accepts existing-length Unicode labels", () => {
    expect(manual({ name: " " }).name).toBe("HTTP · proxy.example");
    expect(manual({ name: "東京".repeat(100) }).name).toHaveLength(200);
    expect(formatProtocol("http")).toBe("HTTP");
    expect(formatProtocol("socks")).toBe("SOCKS5");
  });

  it.each([0, -1, 65536, 443.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid manual port: %s",
    (port) => {
      expect(() => manual({ port })).toThrow("port must be between");
    },
  );

  it.each([
    [{ server: "http://proxy.example" }, "hostname"],
    [{ server: "proxy.example:8080" }, "IPv6"],
    [{ server: "2001:db8::broken" }, "IPv6"],
    [{ server: "999.1.2.3" }, "IPv4"],
    [{ server: "" }, "hostname"],
    [{ password: "test-secret" }, "username"],
    [{ username: "user\nname", password: "test-secret" }, "control characters"],
    [{ username: "user", password: "test\0secret" }, "control characters"],
    [
      { username: "user:tenant", password: "test-secret" },
      "cannot contain a colon",
    ],
    [{ protocol: "socks", username: "user" }, "1–255"],
    [
      { protocol: "socks", username: "雪".repeat(86), password: "test-secret" },
      "1–255",
    ],
    [
      { protocol: "socks", username: "user", password: "a".repeat(256) },
      "1–255",
    ],
    [{ username: "a".repeat(8193) }, "8192"],
    [{ protocol: "socks", tls: true }, "TLS is not supported"],
    [{ protocol: "socks", serverName: "tls.example" }, "TLS is not supported"],
    [{ serverName: "tls.example" }, "requires TLS"],
    [{ tls: true, serverName: "https://tls.example" }, "hostname"],
    [{ name: "a".repeat(201) }, "200"],
    [{ name: "label\n" }, "control characters"],
  ] as [Partial<ManualProfileInput>, string][])(
    "rejects invalid manual settings %#",
    (options, reason) => {
      expect(() => manual(options)).toThrow(reason);
    },
  );

  it("uses UTF-8 byte limits for SOCKS5 credentials without rejecting valid boundaries", () => {
    expect(
      manual({
        protocol: "socks",
        username: "雪".repeat(85),
        password: "a".repeat(255),
      }).outbound.username,
    ).toBe("雪".repeat(85));
  });
});

describe("HTTP, HTTPS, and SOCKS5 URI imports", () => {
  it.each([
    ["http://proxy.example:80", "http", 80, false],
    ["https://proxy.example:443/", "http", 443, true],
    ["socks5://proxy.example:1080", "socks", 1080, false],
  ] as const)(
    "imports %s without guessing a default port",
    (uri, protocol, port, tls) => {
      const [profile] = importProfiles(uri);
      expect(profile).toMatchObject({
        protocol,
        server: "proxy.example",
        port,
      });
      expect(Boolean(profile.outbound.tls)).toBe(tls);
      if (protocol === "socks") expect(profile.outbound.version).toBe("5");
    },
  );

  it.each(["http", "https", "socks5"])(
    "decodes %s proxy credentials exactly once and retains Unicode labels",
    (scheme) => {
      const username = "login@雪%20+";
      const password = "p:@/#?雪%20+";
      const [profile] = importProfiles(
        `${scheme}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@[2001:db8::1]:8443#${encodeURIComponent("東京 + Office")}`,
      );
      expect(profile).toMatchObject({
        name: "東京 + Office",
        server: "2001:db8::1",
        outbound: { username, password },
      });
    },
  );

  it("allows HTTP username-only auth and colon characters in SOCKS5 usernames", () => {
    expect(
      importProfiles("http://user@proxy.example:80")[0].outbound,
    ).toMatchObject({ username: "user", password: "" });
    expect(
      importProfiles("socks5://user%3Atenant:password@proxy.example:1080")[0]
        .outbound.username,
    ).toBe("user:tenant");
  });

  it("deduplicates manual and imported profiles with the same connection settings", () => {
    const manual = createManualProfile({
      name: "Manual",
      protocol: "http",
      server: "PROXY.example",
      port: 443,
      username: "user",
      password: "p@ss",
      tls: true,
    });
    const [imported] = importProfiles(
      "https://user:p%40ss@proxy.example:443#Imported",
    );
    expect(profileFingerprint(imported)).toBe(profileFingerprint(manual));
    expect(
      importProfiles(
        "http://proxy.example:80\nHTTP://PROXY.EXAMPLE:80/#Another",
      ),
    ).toHaveLength(1);
  });

  it.each([
    "http://proxy.example",
    "https://proxy.example",
    "socks5://proxy.example",
    "http://proxy.example:80/route",
    "https://subscription.example:443/config",
    "socks5://proxy.example:1080?udpOverTcp=true",
    "http://proxy.example:80?tls=1",
    "https://proxy.example:443?sni=other.example",
    "https://proxy.example:443?insecure=1",
    "http://:secret@proxy.example:80",
    "http://@proxy.example:80",
    "http://user%3Atenant:secret@proxy.example:80",
    "socks5://user@proxy.example:1080",
    "http://user%ZZ:secret@proxy.example:80",
    "http://user:secret%0D@proxy.example:80",
    "http://user:secret@extra@proxy.example:80",
    "http://user/name:secret@proxy.example:80",
    "socks4://proxy.example:1080",
    "socks5h://proxy.example:1080",
  ])("rejects unsupported or ambiguous proxy URI %#", (uri) => {
    expect(() => importProfiles(uri)).toThrow("Line 1:");
  });

  it("does not expose credentials when a proxy URI fails validation", () => {
    expect(() =>
      importProfiles(
        "http://user:test-private-value@proxy.example:80?test-secret-option=value",
      ),
    ).toThrow("unsupported query option");
    try {
      importProfiles("socks5://user:test-private-value@proxy.example:999999");
    } catch (error) {
      expect(String(error)).toContain("Line 1:");
      expect(String(error)).not.toContain("test-private-value");
    }
  });
});

describe("Shadowsocks import", () => {
  it("imports SIP002 and Unicode labels without storing the original URI", () => {
    const [profile] = importProfiles(
      `${ss("密碼:secret")}#${encodeURIComponent("東京 🇯🇵")}`,
    );
    expect(profile).toMatchObject({
      name: "東京 🇯🇵",
      protocol: "shadowsocks",
      server: "proxy.example",
      port: 8388,
      outbound: {
        type: "shadowsocks",
        server: "proxy.example",
        server_port: 8388,
        method: "aes-256-gcm",
        password: "密碼:secret",
      },
    });
    expect(profile).not.toHaveProperty("uri");
    expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(profile.createdAt))).toBe(false);
  });

  it("accepts unpadded URL-safe Base64 and an optional slash", () => {
    const user = base64("chacha20-ietf-poly1305:a:/?雪")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(
      importProfiles(`ss://${user}@proxy.example:8388/`)[0].outbound.password,
    ).toBe("a:/?雪");
  });

  it("decodes plain percent-encoded credentials exactly once", () => {
    const password = "abc@:/?#%+雪%20";
    const [profile] = importProfiles(
      `ss://aes-256-gcm:${encodeURIComponent(password)}@proxy.example:8388`,
    );
    expect(profile.outbound.password).toBe(password);
  });

  it("decodes the legacy whole-authority format preserving password delimiters", () => {
    const [profile] = importProfiles(
      `ss://${base64("chacha20-ietf-poly1305:test/!@#:雪%20@192.168.100.1:8888")}#Legacy`,
    );
    expect(profile.outbound.password).toBe("test/!@#:雪%20");
    expect(profile.server).toBe("192.168.100.1");
    expect(profile.port).toBe(8888);
  });

  it("supports bracketed IPv6 in SIP002 and legacy links", () => {
    expect(importProfiles(ss("secret", "[2001:db8::1]:8388"))[0].server).toBe(
      "2001:db8::1",
    );
    const [legacy] = importProfiles(
      `ss://${base64("aes-256-gcm:secret@[::1]:8388")}`,
    );
    expect(legacy.server).toBe("::1");
  });

  it("validates AEAD-2022 keys and preserves identity chains", () => {
    const key = base64("0123456789abcdef");
    const [profile] = importProfiles(
      `ss://2022-blake3-aes-128-gcm:${encodeURIComponent(`${key}:${key}`)}@proxy.example:8388`,
    );
    expect(profile.outbound.password).toBe(`${key}:${key}`);
    expect(() =>
      importProfiles(
        `ss://2022-blake3-aes-256-gcm:${encodeURIComponent(key)}@proxy.example:8388`,
      ),
    ).toThrow("wrong length");
    expect(() =>
      importProfiles(
        `ss://${base64(`2022-blake3-aes-128-gcm:${key}`)}@proxy.example:8388`,
      ),
    ).toThrow("must use plain");
  });

  it.each([
    ["ss://!@proxy.example:8388", "Base64"],
    ["ss://Zg=@proxy.example:8388", "Base64"],
    ["ss://wA==@proxy.example:8388", "UTF-8"],
    ["ss://unsupported:password@proxy.example:8388", "method"],
    ["ss://aes-256-gcm:@proxy.example:8388", "nonempty"],
    [`${ss()}?plugin=v2ray-plugin%3Btls`, "plugins"],
    [`${ss()}?udp-over-tcp=true`, "unsupported query"],
  ])("rejects incompatible or malformed Shadowsocks link %#", (uri, reason) => {
    expect(() => importProfiles(uri)).toThrow(reason);
  });
});

describe("VLESS and Trojan import", () => {
  it("builds a canonical VLESS TLS outbound", () => {
    const [profile] = importProfiles(
      vless(
        "encryption=none&security=tls&sni=TLS.EXAMPLE&alpn=h2%2Chttp%2F1.1&fp=firefox",
      ),
    );
    expect(profile.outbound).toEqual({
      type: "vless",
      server: "proxy.example",
      server_port: 443,
      uuid: UUID,
      tls: {
        enabled: true,
        server_name: "tls.example",
        alpn: ["h2", "http/1.1"],
        utls: { enabled: true, fingerprint: "firefox" },
      },
    });
  });

  it("preserves Reality and Vision fields", () => {
    const [profile] = importProfiles(
      vless(
        `type=tcp&security=reality&fp=chrome&pbk=${REALITY_KEY}&sid=01A2&flow=xtls-rprx-vision&sni=example.com`,
      ),
    );
    expect(profile.outbound.flow).toBe("xtls-rprx-vision");
    expect(profile.outbound.tls).toEqual({
      enabled: true,
      server_name: "example.com",
      utls: { enabled: true, fingerprint: "chrome" },
      reality: { enabled: true, public_key: REALITY_KEY, short_id: "01a2" },
    });
    expect(getProfileSecurity(profile)).toBe("Reality");
  });

  it("supports an explicitly empty Reality short ID", () => {
    const [profile] = importProfiles(
      vless(`security=reality&fp=chrome&pbk=${REALITY_KEY}&sid=`),
    );
    expect(
      (profile.outbound.tls as { reality: { short_id: string } }).reality
        .short_id,
    ).toBe("");
  });

  it("keeps WebSocket Host and TLS server name independent", () => {
    const [profile] = importProfiles(
      vless(
        "type=ws&security=tls&host=cdn.example%3A8443&path=%2Fgateway%3Ftoken%3Dx%252Fy",
      ),
    );
    expect(profile.outbound.transport).toEqual({
      type: "ws",
      path: "/gateway?token=x%2Fy",
      headers: { Host: "cdn.example:8443" },
    });
    expect(profile.outbound.tls).toMatchObject({
      server_name: "proxy.example",
    });
  });

  it("converts Xray WebSocket early data while retaining the rest of the path", () => {
    const [profile] = importProfiles(
      vless(
        `type=ws&path=${encodeURIComponent("/gateway?token=a%2Fb&ed=2048&extra=1")}`,
      ),
    );
    expect(profile.outbound.transport).toEqual({
      type: "ws",
      path: "/gateway?token=a%2Fb&extra=1",
      max_early_data: 2048,
      early_data_header_name: "Sec-WebSocket-Protocol",
    });
  });

  it("supports standard gRPC", () => {
    const [profile] = importProfiles(
      vless("type=grpc&mode=gun&serviceName=my.service-name&security=tls"),
    );
    expect(profile.outbound.transport).toEqual({
      type: "grpc",
      service_name: "my.service-name",
    });
    expect(profileSummary(profile)).toBe("VLESS · gRPC · TLS");
  });

  it("defaults Trojan to TLS and decodes special password characters", () => {
    const password = "x:@?#/%+雪";
    const [profile] = importProfiles(
      `trojan://${encodeURIComponent(password)}@proxy.example:443`,
    );
    expect(profile.outbound).toEqual({
      type: "trojan",
      server: "proxy.example",
      server_port: 443,
      password,
      tls: { enabled: true, server_name: "proxy.example" },
    });
  });

  it("retains an explicit insecure TLS flag so the UI can show it", () => {
    const [profile] = importProfiles(
      "trojan://password@proxy.example:443?allowInsecure=1",
    );
    expect(profile.outbound.tls).toMatchObject({ insecure: true });
    expect(getProfileSecurity(profile)).toBe("TLS (unverified)");
  });

  it("normalizes IPv6, domain case, IDNs, and UUID case", () => {
    expect(importProfiles(vless("", "[2001:DB8::1]:443"))[0].server).toBe(
      "2001:db8::1",
    );
    expect(importProfiles(vless("", "PROXY.Example.:443"))[0].server).toBe(
      "proxy.example",
    );
    expect(importProfiles(vless("", "例子.测试:443"))[0].server).toBe(
      "xn--fsqu00a.xn--0zwm56d",
    );
    expect(
      importProfiles(vless().replace(UUID, UUID.toUpperCase()))[0].outbound
        .uuid,
    ).toBe(UUID);
  });

  it.each([
    ["type=xhttp", "transport"],
    ["type=kcp", "transport"],
    ["type=tcp&headerType=http", "obfuscation"],
    ["type=tcp&path=%2F", "plain TCP"],
    ["type=ws&serviceName=service", "gRPC options"],
    ["type=ws&path=relative", "path must start"],
    ["type=ws&host=example.com%0D%0AX-Header%3Abad", "control character"],
    [`type=ws&path=${encodeURIComponent("/?ed=8193")}`, "early data"],
    [`type=ws&path=${encodeURIComponent("/?ed=1&ed=2")}`, "more than once"],
    ["type=grpc&mode=multi", "standard gRPC"],
    ["type=grpc&authority=example.com", "unsupported query"],
    ["type=grpc&serviceName=%2Fcustom%2Fmethod", "custom method path"],
    ["type=grpc&host=example.com", "cannot be translated"],
    ["security=xtls", "TLS/security"],
    ["security=tls&fp=chrome_pq", "fingerprint"],
    ["security=tls&alpn=h2%2C", "ALPN"],
    ["security=tls&insecure=maybe", "verification options"],
    ["security=tls&insecure=1&allowInsecure=1", "only one"],
    ["security=tls&ech=secret", "unsupported query"],
    ["security=none&sni=example.com", "TLS options require"],
    ["security=tls&sid=abcd", "require security=reality"],
    ["security=reality&fp=chrome", "public key"],
    [`security=reality&pbk=${REALITY_KEY}`, "explicit fp"],
    [`security=reality&fp=chrome&pbk=${REALITY_KEY}&sid=abc`, "short ID"],
    [
      `security=reality&fp=chrome&pbk=${REALITY_KEY}&spx=%2F`,
      "unsupported query",
    ],
    [`security=reality&fp=chrome&pbk=${REALITY_KEY}&insecure=1`, "disabling"],
    ["encryption=mlkem768x25519.secret", "encryption mode"],
    ["flow=xtls-rprx-direct", "VLESS flow"],
    ["flow=xtls-rprx-vision&security=none", "requires TCP"],
    ["flow=xtls-rprx-vision&security=tls&type=ws", "requires TCP"],
    ["security=tls&security=none", "more than once"],
    ["security=tls&unknownRoutingOption=secret", "unsupported query"],
  ])(
    "rejects unsupported or contradictory protocol options %#",
    (query, reason) => {
      expect(() => importProfiles(vless(query))).toThrow(reason);
    },
  );

  it.each([
    ["vless://not-a-uuid@proxy.example:443", "UUID"],
    ["trojan://@proxy.example:443", "credential"],
    ["trojan://%00@proxy.example:443", "control characters"],
    ["trojan://secret@proxy.example:443?security=none", "require TLS"],
    ["trojan://secret@proxy.example:443?encryption=none", "unsupported query"],
  ])("rejects invalid credentials or Trojan security %#", (uri, reason) => {
    expect(() => importProfiles(uri)).toThrow(reason);
  });
});

describe("batch imports, validation, and deduplication", () => {
  it("imports multiple protocols while ignoring blank lines", () => {
    const profiles = importProfiles(
      `\n ${ss()} \r\n\r\n${vless()}\n trojan://secret@proxy.example:443 \n`,
    );
    expect(profiles.map((profile) => profile.protocol)).toEqual([
      "shadowsocks",
      "vless",
      "trojan",
    ]);
  });

  it("provides source line numbers and never leaks input credentials", () => {
    const secret = "super-sensitive-password";
    try {
      importProfiles(`${ss()}\n\n${vless("security=tls")}&${secret}=value\n`);
      expect.fail("Expected import to fail");
    } catch (error) {
      expect(String(error)).toContain("Line 3:");
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain(UUID);
    }
    expect(() =>
      importProfiles(`\n trojan://${secret}@host.invalid:999999`),
    ).toThrow("Line 2:");
  });

  it("deduplicates renamed links and canonical option order", () => {
    const first = `${vless("security=tls&fp=chrome")}#First`;
    const second = `${vless("fp=chrome&security=tls")}#Renamed`;
    expect(importProfiles(`${first}\n${second}`)).toHaveLength(1);
    expect(importProfiles(`${first}\n${second}`)[0].name).toBe("First");
  });

  it("fingerprints are stable under object key order and tag changes, but retain nested details", () => {
    const [profile] = importProfiles(vless("security=tls"));
    const reordered = {
      ...profile,
      name: "New name",
      outbound: {
        tls: profile.outbound.tls,
        ...profile.outbound,
        tag: "another-tag",
      },
    };
    expect(profileFingerprint(profile)).toBe(profileFingerprint(reordered));
    expect(
      profileFingerprint({
        ...profile,
        outbound: { ...profile.outbound, server_port: 8443 },
      }),
    ).not.toBe(profileFingerprint(profile));
    expect(
      profileFingerprint({
        ...profile,
        outbound: {
          ...profile.outbound,
          tls: { enabled: true, server_name: "different.example" },
        },
      }),
    ).not.toBe(profileFingerprint(profile));
  });

  it.each([
    "proxy.example",
    "proxy.example:0",
    "proxy.example:65536",
    "proxy.example:-1",
    "proxy.example:443/path",
    "[invalid]:443",
    "2001:db8::1:443",
    "1.2.3.999:443",
    "127.01.0.1:443",
    "0x7f000001:443",
    "-bad.example:443",
    "bad_example:443",
  ])("rejects an invalid endpoint: %s", (host) => {
    expect(() => importProfiles(vless("", host))).toThrow("Line 1:");
  });

  it("keeps plus signs in profile names and accepts a readable default name", () => {
    expect(importProfiles(`${vless()}#US+West`)[0].name).toBe("US+West");
    expect(importProfiles(vless())[0].name).toBe("VLESS · proxy.example");
    expect(formatProtocol("shadowsocks")).toBe("Shadowsocks");
    expect(getProfileSecurity(importProfiles(vless())[0])).toBe(
      "No encryption",
    );
  });

  it.each([
    "",
    "\r\n  \n",
    "https://subscriptions.example/config",
    "vmess://unsupported",
    `${vless()}#%ZZ`,
    `${vless()}#name%0Ainjection`,
  ])(
    "rejects empty input, subscriptions, unsupported links, or invalid names %#",
    (input) => {
      expect(() => importProfiles(input)).toThrow();
    },
  );
});
