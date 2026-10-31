import { describe, expect, it, vi } from "vitest";
import { checkForUpdates, installVerifiedUpdate } from "./updater";

describe("safe update installation", () => {
  it("never checks update feeds in browser preview", async () => {
    expect(await checkForUpdates()).toBeNull();
  });
  it("verifies the download before disconnecting and disconnects before installing", async () => {
    const steps: string[] = [];
    await installVerifiedUpdate(
      {
        download: async () => {
          steps.push("verified");
        },
        install: async () => {
          steps.push("installed");
        },
      },
      async () => {
        steps.push("disconnected");
      },
    );
    expect(steps).toEqual(["verified", "disconnected", "installed"]);
  });

  it("keeps the connection running when download or signature verification fails", async () => {
    const disconnect = vi.fn();
    const install = vi.fn();
    await expect(
      installVerifiedUpdate(
        {
          download: async () => {
            throw new Error("Invalid signature");
          },
          install,
        },
        disconnect,
      ),
    ).rejects.toThrow("Invalid signature");
    expect(disconnect).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it("does not exit into an installer when proxy restoration fails", async () => {
    const install = vi.fn();
    await expect(
      installVerifiedUpdate({ download: vi.fn(), install }, async () => {
        throw new Error("Proxy restoration failed");
      }),
    ).rejects.toThrow("Proxy restoration failed");
    expect(install).not.toHaveBeenCalled();
  });
});
