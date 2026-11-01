import { useEffect, useState } from "react";
import { Gamepad2 } from "lucide-react";
import { gameArtwork, gameLogo } from "../game-art";

export function GameArtwork({
  title,
  steamId,
  icon,
}: {
  title: string;
  steamId?: number | null;
  icon?: string | null;
}) {
  const poster = gameArtwork(title, steamId);
  const logo = gameLogo(title);
  const [failed, setFailed] = useState(0);
  useEffect(() => setFailed(0), [poster, icon, logo]);
  const source = [poster, icon, logo].filter(
    (value): value is string => !!value,
  )[failed];
  return (
    <div className={`pk-real-art ${source === poster ? "poster" : "icon"}`}>
      {source ? (
        <img
          src={source}
          alt={`${title} ${source === poster ? "poster" : "icon"}`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed((count) => count + 1)}
        />
      ) : (
        <Gamepad2 size={42} aria-label="Artwork unavailable" />
      )}
    </div>
  );
}
