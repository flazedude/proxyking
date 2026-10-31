import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { Channel, invoke, Resource } from "@tauri-apps/api/core";
import { isDesktop } from "./backend";

export class AppUpdate extends Resource {
  version: string;
  constructor(metadata: { rid: number; version: string }) {
    super(metadata.rid);
    this.version = metadata.version;
  }
  async download(onProgress?: (event: DownloadEvent) => void) {
    const onEvent = new Channel<DownloadEvent>();
    onEvent.onmessage = (event) => onProgress?.(event);
    await invoke("download_update", { rid: this.rid, onEvent });
  }
  async install() {
    await invoke("install_update", { rid: this.rid });
  }
}

export async function checkForUpdates(): Promise<AppUpdate | null> {
  if (!isDesktop) return null;
  const metadata = await invoke<{ rid: number; version: string } | null>(
    "check_updates",
  );
  return metadata ? new AppUpdate(metadata) : null;
}

// Windows' updater exits the process without Tauri's normal shutdown events.
// Stop the engine and restore owned proxy settings after signature verification,
// before handing control to the installer. Cleanup errors must stop installation.
export async function installVerifiedUpdate(
  update: Pick<Update, "download" | "install">,
  disconnect: () => Promise<unknown>,
  onProgress?: (event: DownloadEvent) => void,
) {
  await update.download(onProgress);
  await disconnect();
  await update.install();
}
