import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ desktop: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => native.desktop,
  invoke: native.invoke,
}));

beforeEach(() => {
  native.desktop = false;
  native.invoke.mockReset();
  vi.resetModules();
});

describe("usage logging preference", () => {
  it("blocks browser URL imports without invoking native code or fetching", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      const { backend } = await import("./backend");
      await expect(
        backend.fetchYaml("https://config.example/config.yaml"),
      ).rejects.toThrow("Windows app");
      expect(native.invoke).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it("passes an explicit native YAML download through without storing the URL", async () => {
    native.desktop = true;
    native.invoke.mockResolvedValueOnce("proxies: []");
    const { backend } = await import("./backend");
    const url = "https://config.example/config.yaml?token=test-only-secret";
    expect(await backend.fetchYaml(url)).toBe("proxies: []");
    expect(native.invoke.mock.calls).toEqual([
      ["fetch_yaml_subscription", { url }],
    ]);
  });

  it("defaults off and keeps browser changes in memory without native calls", async () => {
    const { backend } = await import("./backend");
    const state = await backend.load();
    expect(state.settings.usageLogging).toBe(false);
    state.settings.usageLogging = true;
    await backend.save(state);
    expect((await backend.load()).settings.usageLogging).toBe(true);
    expect(await backend.logs()).toEqual([]);
    expect(await backend.games()).toEqual([]);
    expect(await backend.routingConflict()).toBe(false);
    expect(native.invoke).not.toHaveBeenCalled();
    vi.resetModules();
    const fresh = await import("./backend");
    expect((await fresh.backend.load()).settings.usageLogging).toBe(false);
  });

  it("requests native discovery and coexistence checks only in the desktop app", async () => {
    native.desktop = true;
    const { backend } = await import("./backend");
    native.invoke.mockResolvedValueOnce([]).mockResolvedValueOnce(true);
    expect(await backend.games()).toEqual([]);
    expect(await backend.routingConflict()).toBe(true);
    expect(native.invoke.mock.calls).toEqual([
      ["scan_games"],
      ["routing_conflict"],
    ]);
  });

  it("migrates desktop settings with usage logging off and preserves an explicit preference", async () => {
    native.desktop = true;
    const { backend, defaultState } = await import("./backend");
    const legacy = structuredClone(defaultState);
    const { usageLogging: _removed, ...settings } = legacy.settings;
    native.invoke.mockResolvedValueOnce({ ...legacy, settings });
    expect((await backend.load()).settings.usageLogging).toBe(false);
    native.invoke.mockResolvedValueOnce({
      ...legacy,
      settings: { ...settings, usageLogging: true },
    });
    expect((await backend.load()).settings.usageLogging).toBe(true);
  });
});
