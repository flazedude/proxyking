import { describe, expect, it } from "vitest";
import {
  launcherPath,
  sampleGames,
  selectedTargets,
  validateExecutable,
} from "./library";

describe("explicit executable selection", () => {
  it("selecting a game excludes its launcher, siblings, and child processes", () => {
    const targets = selectedTargets(sampleGames, [
      { id: "diablo", includeChildren: false },
    ]);
    expect(targets).toEqual([
      {
        name: "Diablo IV",
        path: sampleGames.find((entry) => entry.id === "diablo")!.path,
        includeChildren: false,
      },
    ]);
    expect(
      targets.some((target) => target.path === launcherPath("battlenet")),
    ).toBe(false);
    expect(targets.some((target) => target.name === "World of Warcraft")).toBe(
      false,
    );
  });
  it("selecting a launcher requires a separate explicit child scope", () => {
    expect(
      selectedTargets(sampleGames, [
        { id: "launcher:steam", includeChildren: false },
      ]),
    ).toEqual([
      { name: "Steam", path: launcherPath("steam"), includeChildren: false },
    ]);
    expect(
      selectedTargets(sampleGames, [
        { id: "launcher:steam", includeChildren: true },
      ])[0].includeChildren,
    ).toBe(true);
  });
  it("coalesces shared executable paths with case and separator differences", () => {
    const first = {
      ...sampleGames[0],
      id: "first",
      path: "C:\\Games\\shared.exe",
    };
    const second = { ...first, id: "second", path: "c:/GAMES/SHARED.EXE" };
    const targets = selectedTargets(
      [first, second],
      [
        { id: "first", includeChildren: false },
        { id: "second", includeChildren: true },
      ],
    );
    expect(targets).toHaveLength(1);
    expect(targets[0].includeChildren).toBe(true);
    expect(
      selectedTargets([first], [{ id: "removed", includeChildren: true }]),
    ).toEqual([]);
  });
  it("accepts spaces, Unicode, and slash normalization in absolute executable paths", () => {
    expect(validateExecutable(" C:/Games/游戏/game client.exe ")).toBe(
      "C:\\Games\\游戏\\game client.exe",
    );
  });
  it.each([
    "game.exe",
    "C:game.exe",
    "C:\\Games\\..\\game.exe",
    "C:\\Games\\*\\game.exe",
    "C:\\Games\\game.exe:other.exe",
    "C:\\Games\\game.exe\\",
    "C:\\Games.\\game.exe",
    "C:\\\\Games\\game.exe",
    "C:\\Games\\bad\nname.exe",
    "https://example.com/game.exe",
    "C:\\Games\\game.txt",
  ])("rejects non-executable or ambiguous paths: %s", (path) => {
    expect(() => validateExecutable(path)).toThrow(
      "absolute Windows .exe path",
    );
  });
});
