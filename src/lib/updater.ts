import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

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
