// Publisher/store artwork is fetched as images, never executable content.
export function gameArtwork(
  title: string,
  steamId?: number | null,
): string | null {
  if (steamId && Number.isInteger(steamId) && steamId > 0)
    return `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamId}/library_600x900.jpg`;
  const name = title.toLowerCase();
  if (/warcraft|魔兽|燃烧的远征/.test(name))
    return "https://bnetproduct-a.akamaihd.net/fab/a25ed0ddd3225929bc3ad5139ebc7483-prod-card-tall.jpg";
  if (/diablo iii|暗黑破坏神iii/.test(name))
    return "https://bnetproduct-a.akamaihd.net/fbd/bafaafcfb7c6c620067662a04409ba66-prod-card-tall.jpg";
  const known: [RegExp, number][] = [
    [/diablo iv|暗黑破坏神.*iv/, 2344520],
    [/overwatch|守望先锋/, 2357570],
    [/cyberpunk|赛博朋克/, 1091500],
    [/fortnite/, 0],
    [/apex/, 1172470],
    [/counter.strike/, 730],
    [/anno 1800/, 916440],
    [/dead island 2/, 934700],
    [/deathloop/, 1252330],
    [/zombie army 4/, 694280],
  ];
  const id = known.find(([pattern]) => pattern.test(name))?.[1];
  return id ? gameArtwork(title, id) : null;
}

export function launcherLogo(id: string): string {
  const names: Record<string, string> = {
    steam: "steam",
    battlenet: "battledotnet",
    epic: "epicgames",
    riot: "riotgames",
    ea: "ea",
    ubisoft: "ubisoft",
    gog: "gogdotcom",
  };
  return `/brands/${names[id] || "steam"}.svg`;
}

export function gameLogo(title: string): string | null {
  if (/valorant/i.test(title)) return "/brands/valorant.svg";
  if (/fortnite/i.test(title)) return "/brands/fortnite.svg";
  if (/warcraft|魔兽|燃烧的远征/i.test(title))
    return "https://blznav.akamaized.net/img/games/logo-wow-3dd2cfe06df74407.png";
  if (/diablo iii|暗黑破坏神iii/i.test(title))
    return "https://blznav.akamaized.net/img/games/logo-d3-ab08e4045fed09ee.png";
  return null;
}
