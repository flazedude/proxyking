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
  it("defaults off and keeps browser changes in memory without native calls", async () => {
    const { backend } = await import("./backend");
    const state = await backend.load();
    expect(state.settings.usageLogging).toBe(false);
    state.settings.usageLogging = true;
    await backend.save(state);
    expect((await backend.load()).settings.usageLogging).toBe(true);
    expect(await backend.logs()).toEqual([]);
    expect(native.invoke).not.toHaveBeenCalled();
    vi.resetModules();
    const fresh = await import("./backend");
    expect((await fresh.backend.load()).settings.usageLogging).toBe(false);
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
