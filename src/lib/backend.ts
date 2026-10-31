import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AppSettings,
  LogEntry,
  Profile,
  RuntimeStatus,
  SavedState,
  RunningProcess,
} from "../types";

export const isDesktop = isTauri();
export const defaultState: SavedState = {
  profiles: [],
  selectedProfileId: null,
  settings: {
    systemProxy: false,
    localPort: 2080,
    routingMode: "processes",
    selectedProcesses: [],
    usageLogging: false,
  },
};
export const defaultStatus: RuntimeStatus = {
  state: "disconnected",
  profileId: null,
  connectedAt: null,
  engineAvailable: false,
  engineVersion: null,
  localPort: 2080,
  systemProxy: false,
  routingMode: "processes",
  isElevated: false,
  inheritedProcesses: [],
  error: null,
};
let previewState = structuredClone(defaultState);

export const backend = {
  load: async (): Promise<SavedState> => {
    const data = isDesktop
      ? await invoke<SavedState>("load_state")
      : structuredClone(previewState);
    return {
      ...data,
      settings: {
        ...data.settings,
        usageLogging: data.settings.usageLogging ?? false,
        routingMode:
          data.settings.routingMode ??
          (data.settings.systemProxy ? "system" : "local"),
        selectedProcesses: (data.settings.selectedProcesses ?? []).map(
          (target) => ({
            ...target,
            includeChildren: target.includeChildren ?? false,
          }),
        ),
      },
    };
  },
  save: async (data: SavedState): Promise<void> => {
    if (isDesktop) await invoke("save_state", { data });
    else previewState = structuredClone(data);
  },
  status: (): Promise<RuntimeStatus> =>
    isDesktop ? invoke("get_status") : Promise.resolve(defaultStatus),
  connect: (
    profile: Profile,
    settings: AppSettings,
  ): Promise<RuntimeStatus> => {
    if (!isDesktop)
      return Promise.reject(
        new Error(
          "Open the Windows app to connect. This browser preview does not route traffic.",
        ),
      );
    return invoke("connect", { profile, settings });
  },
  disconnect: (): Promise<RuntimeStatus> => invoke("disconnect"),
  test: (profile: Profile): Promise<{ latencyMs: number }> => {
    if (!isDesktop)
      return Promise.reject(
        new Error("Server checks are available in the Windows app."),
      );
    return invoke("test_profile", { profile });
  },
  logs: (): Promise<LogEntry[]> =>
    isDesktop ? invoke("get_logs") : Promise.resolve([]),
  clearLogs: (): Promise<void> =>
    isDesktop ? invoke("clear_logs") : Promise.resolve(),
  processes: (): Promise<RunningProcess[]> =>
    isDesktop
      ? invoke("list_processes")
      : Promise.reject(
          new Error(
            "The running process list is available in the Windows app.",
          ),
        ),
  restartElevated: (): Promise<void> =>
    isDesktop
      ? invoke("restart_elevated")
      : Promise.reject(
          new Error("Open the Windows app to restart as administrator."),
        ),
};
