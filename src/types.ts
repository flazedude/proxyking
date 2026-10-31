export type ProxyProtocol =
  "shadowsocks" | "vless" | "trojan" | "http" | "socks";

export type RoutingMode = "system" | "local" | "processes";

export interface ProcessTarget {
  name: string;
  path: string;
  includeChildren: boolean;
}

export interface RunningProcess extends Omit<ProcessTarget, "includeChildren"> {
  pid: number;
}

export interface Profile {
  id: string;
  name: string;
  protocol: ProxyProtocol;
  server: string;
  port: number;
  outbound: Record<string, unknown>;
  createdAt: string;
}

export interface AppSettings {
  systemProxy: boolean;
  localPort: number;
  routingMode: RoutingMode;
  selectedProcesses: ProcessTarget[];
}

export interface SavedState {
  profiles: Profile[];
  selectedProfileId: string | null;
  settings: AppSettings;
}

export interface RuntimeStatus {
  state: "disconnected" | "connecting" | "connected" | "error";
  profileId: string | null;
  connectedAt: number | null;
  engineAvailable: boolean;
  engineVersion: string | null;
  localPort: number;
  systemProxy: boolean;
  routingMode: RoutingMode;
  isElevated: boolean;
  inheritedProcesses: { name: string; path: string; launcherPath: string }[];
  error: string | null;
}

export interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
}
