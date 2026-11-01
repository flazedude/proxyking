import { describe, expect, it, vi } from "vitest";
import {
  inspectServerImport,
  isYamlDownloadUrl,
  serverImportError,
} from "./server-import";

const yaml = `proxies:
  - { name: Imported, type: socks5, server: proxy.example, port: 1080 }
`;

describe("server import input routing", () => {
  it.each([
    "https://config.example/config.yaml",
    " https://config.example:443/config.yml?token=test-only-secret ",
    "https://config.example/api?target=clash",
    "https://config.example",
    "http://config.example/config.yaml",
  ])(
    "recognizes a document download instead of a direct proxy: %s",
    (input) => {
      expect(isYamlDownloadUrl(input)).toBe(true);
    },
  );

  it.each([
    "https://proxy.example:443/",
    "HTTP://proxy.example:80#Name",
    "https://user:password@proxy.example:443",
    "socks5://[2001:db8::1]:1080",
    "https://proxy.example:443\nhttp://proxy.example:80",
    yaml,
  ])(
    "keeps explicit direct links and YAML out of the download path: %s",
    (input) => {
      expect(isYamlDownloadUrl(input)).toBe(false);
    },
  );

  it.each(["http", "https"])(
    "fetches a %s YAML URL once, reviews nodes, and never includes the URL in the result",
    async (scheme) => {
      const fetchYaml = vi.fn().mockResolvedValue(yaml);
      const url = `${scheme}://config.example/config.yaml?token=test-only-secret`;
      const result = await inspectServerImport(` ${url} `, "auto", fetchYaml);
      expect(fetchYaml.mock.calls).toEqual([[url]]);
      expect(result.kind).toBe("review");
      if (result.kind !== "review") throw new Error("Expected review");
      expect(result.report.profiles).toHaveLength(1);
      expect(result.report.profiles[0].outbound).toMatchObject({
        type: "socks",
        server_port: 1080,
      });
      expect(JSON.stringify(result)).not.toContain("test-only-secret");
    },
  );

  it("supports an explicit URL source for an address also shaped like a proxy", async () => {
    const fetchYaml = vi.fn().mockResolvedValue(yaml);
    const result = await inspectServerImport(
      "https://config.example:443/",
      "url",
      fetchYaml,
    );
    expect(fetchYaml).toHaveBeenCalledOnce();
    expect(result.kind).toBe("review");
  });

  it("retains direct proxy links and pasted YAML without any download", async () => {
    const fetchYaml = vi.fn();
    const direct = await inspectServerImport(
      "https://proxy.example:443/",
      "auto",
      fetchYaml,
    );
    expect(direct.kind).toBe("links");
    if (direct.kind !== "links") throw new Error("Expected proxy links");
    expect(direct.profiles[0].outbound).toMatchObject({
      type: "http",
      server_port: 443,
    });
    expect((await inspectServerImport(yaml, "auto", fetchYaml)).kind).toBe(
      "review",
    );
    expect(fetchYaml).not.toHaveBeenCalled();
  });

  it("does not follow downloaded URLs or imported external providers", async () => {
    const fetchYaml = vi
      .fn()
      .mockResolvedValue("https://config.example/second.yaml");
    await expect(
      inspectServerImport(
        "https://config.example/first.yaml",
        "auto",
        fetchYaml,
      ),
    ).rejects.toThrow("Clash YAML");
    expect(fetchYaml).toHaveBeenCalledOnce();
    fetchYaml.mockReset().mockResolvedValue(`proxy-providers:
  remote: { type: http, url: 'https://config.example/second.yaml', path: ./config.yaml }
`);
    const result = await inspectServerImport(
      "https://config.example/first.yaml",
      "auto",
      fetchYaml,
    );
    expect(result.kind).toBe("review");
    if (result.kind !== "review") throw new Error("Expected review");
    expect(result.report.externalProviders).toBe(1);
    expect(fetchYaml).toHaveBeenCalledOnce();
  });

  it("propagates a safe download failure without attempting to parse it", async () => {
    const fetchYaml = vi
      .fn()
      .mockRejectedValue(
        new Error("Could not download the YAML configuration."),
      );
    await expect(
      inspectServerImport(
        "https://config.example/config.yaml",
        "auto",
        fetchYaml,
      ),
    ).rejects.toThrow("Could not download");
    expect(fetchYaml).toHaveBeenCalledOnce();
  });
});

describe("import error display", () => {
  it("shows native string errors and parser errors instead of a generic failure", () => {
    const message = "The YAML download was empty.";
    expect(serverImportError(message, "Import failed.")).toBe(message);
    expect(
      serverImportError(new Error("Invalid Clash YAML."), "Import failed."),
    ).toBe("Invalid Clash YAML.");
    for (const error of [null, undefined, {}, "", " "]) {
      expect(serverImportError(error, "Import failed.")).toBe("Import failed.");
    }
  });
});
