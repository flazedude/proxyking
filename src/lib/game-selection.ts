import type { ProcessTarget } from "../types";
import { executableKey } from "../accelerator/library";

export function updateGameSelection(
  current: ProcessTarget[],
  candidates: string[],
  chosen: string[],
  childrenOverride: boolean | null,
): ProcessTarget[] {
  const allowed = new Set(candidates.map(executableKey));
  if (chosen.some((path) => !allowed.has(executableKey(path))))
    throw new Error("Select executables from this game's verified list.");
  const next = current.filter(
    (target) => !allowed.has(executableKey(target.path)),
  );
  const added = new Set<string>();
  for (const path of chosen) {
    const key = executableKey(path);
    if (added.has(key)) continue;
    added.add(key);
    const existing = current.find(
      (target) => executableKey(target.path) === key,
    );
    next.push({
      name: path.replaceAll("/", "\\").split("\\").at(-1)!,
      path,
      includeChildren: childrenOverride ?? existing?.includeChildren ?? false,
    });
  }
  return next;
}
