export const launchers = [
  {
    id: "steam",
    name: "Steam",
    short: "S",
    executable: "steam.exe",
    tone: "blue",
  },
  {
    id: "battlenet",
    name: "Battle.net",
    short: "B",
    executable: "Battle.net.exe",
    tone: "cyan",
  },
  {
    id: "epic",
    name: "Epic Games",
    short: "E",
    executable: "EpicGamesLauncher.exe",
    tone: "slate",
  },
  {
    id: "riot",
    name: "Riot Client",
    short: "R",
    executable: "RiotClientServices.exe",
    tone: "red",
  },
  {
    id: "ea",
    name: "EA app",
    short: "EA",
    executable: "EADesktop.exe",
    tone: "orange",
  },
  {
    id: "ubisoft",
    name: "Ubisoft Connect",
    short: "U",
    executable: "UbisoftConnect.exe",
    tone: "violet",
  },
  {
    id: "gog",
    name: "GOG Galaxy",
    short: "G",
    executable: "GalaxyClient.exe",
    tone: "violet",
  },
] as const;

export type LauncherId = (typeof launchers)[number]["id"];
export interface LibraryEntry {
  id: string;
  title: string;
  launcher: LauncherId | "custom";
  category: string;
  mark: string;
  tone: string;
  path: string;
  custom?: boolean;
  steamId?: number;
}

// Deliberately fictional install paths. The browser never enumerates installed apps.
export const sampleGames: LibraryEntry[] = [
  {
    id: "cs2",
    steamId: 730,
    title: "Counter-Strike 2",
    launcher: "steam",
    category: "TACTICAL SHOOTER",
    mark: "CS₂",
    tone: "orange",
    path: "C:\\Example Games\\Counter-Strike 2\\game\\bin\\win64\\cs2.exe",
  },
  {
    id: "diablo",
    steamId: 2344520,
    title: "Diablo IV",
    launcher: "battlenet",
    category: "ACTION RPG",
    mark: "IV",
    tone: "red",
    path: "C:\\Example Games\\Diablo IV\\Diablo IV.exe",
  },
  {
    id: "valorant",
    title: "VALORANT",
    launcher: "riot",
    category: "TACTICAL SHOOTER",
    mark: "V",
    tone: "rose",
    path: "C:\\Example Games\\VALORANT\\live\\ShooterGame\\Binaries\\Win64\\VALORANT-Win64-Shipping.exe",
  },
  {
    id: "wow",
    title: "World of Warcraft",
    launcher: "battlenet",
    category: "MMORPG",
    mark: "W",
    tone: "gold",
    path: "C:\\Example Games\\World of Warcraft\\_retail_\\Wow.exe",
  },
  {
    id: "apex",
    steamId: 1172470,
    title: "Apex Legends",
    launcher: "steam",
    category: "BATTLE ROYALE",
    mark: "A",
    tone: "slate",
    path: "C:\\Example Games\\Apex Legends\\r5apex.exe",
  },
  {
    id: "fortnite",
    title: "Fortnite",
    launcher: "epic",
    category: "BATTLE ROYALE",
    mark: "F",
    tone: "violet",
    path: "C:\\Example Games\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe",
  },
];

export interface Selection {
  id: string;
  includeChildren: boolean;
}
export interface ExecutableTarget {
  name: string;
  path: string;
  includeChildren: boolean;
}

export function launcherPath(id: LauncherId): string {
  const launcher = launchers.find((entry) => entry.id === id)!;
  return `C:\\Example Launchers\\${launcher.name}\\${launcher.executable}`;
}

export function executableKey(path: string): string {
  return path.replaceAll("/", "\\").toLowerCase();
}

export function validateExecutable(path: string): string {
  const normalized = path.trim().replaceAll("/", "\\");
  if (
    normalized.length > 32767 ||
    !/^[a-z]:\\.+\.exe$/i.test(normalized) ||
    /[\x00-\x1f*?"<>|]/.test(normalized) ||
    normalized.slice(2).includes(":") ||
    normalized
      .slice(3)
      .split("\\")
      .some(
        (part) => !part || part === "." || part === ".." || /[ .]$/.test(part),
      )
  )
    throw new Error(
      "Enter an absolute Windows .exe path, such as C:\\Games\\Game\\game.exe.",
    );
  return normalized;
}

export function selectedTargets(
  entries: LibraryEntry[],
  selection: Selection[],
): ExecutableTarget[] {
  const targets = new Map<string, ExecutableTarget>();
  for (const item of selection) {
    const game = entries.find((entry) => entry.id === item.id);
    const launcher = launchers.find(
      (entry) => `launcher:${entry.id}` === item.id,
    );
    const path =
      game?.path ?? (launcher ? launcherPath(launcher.id) : undefined);
    if (!path) continue;
    const key = executableKey(path);
    const existing = targets.get(key);
    targets.set(key, {
      name: game?.title ?? launcher!.name,
      path,
      includeChildren: !!existing?.includeChildren || item.includeChildren,
    });
  }
  return [...targets.values()];
}
