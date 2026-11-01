import { expect, it } from "vitest";
import { updateGameSelection } from "./game-selection";

it("preserves individual saved child preferences unless the user explicitly changes them", () => {
  const current = [
    { name: "a.exe", path: "C:\\Games\\a.exe", includeChildren: true },
    { name: "b.exe", path: "C:\\Games\\b.exe", includeChildren: false },
    { name: "other.exe", path: "C:\\Other\\other.exe", includeChildren: true },
  ];
  const candidates = [
    "C:\\Games\\a.exe",
    "C:\\Games\\b.exe",
    "C:\\Games\\c.exe",
  ];
  const next = updateGameSelection(current, candidates, candidates, null);
  expect(next.map((target) => [target.name, target.includeChildren])).toEqual([
    ["other.exe", true],
    ["a.exe", true],
    ["b.exe", false],
    ["c.exe", false],
  ]);
  expect(
    updateGameSelection(current, candidates, candidates, false).every(
      (target) => target.name === "other.exe" || !target.includeChildren,
    ),
  ).toBe(true);
});
it("uses only the chosen game's paths without selecting its launcher or siblings", () => {
  const candidates = ["C:\\Games\\game.exe", "C:\\Games\\helper.exe"];
  expect(updateGameSelection([], candidates, [candidates[0]], null)).toEqual([
    { name: "game.exe", path: candidates[0], includeChildren: false },
  ]);
  expect(() =>
    updateGameSelection([], candidates, ["C:\\Other\\game.exe"], null),
  ).toThrow("verified list");
});
