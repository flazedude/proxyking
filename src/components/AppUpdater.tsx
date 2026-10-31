import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { ArrowDownToLine, Loader2, RefreshCw } from "lucide-react";
import { isDesktop } from "../lib/backend";
import { installVerifiedUpdate } from "../lib/updater";

export function AppUpdater({
  disabled,
  onBegin,
  disconnect,
  onEnd,
}: {
  disabled: boolean;
  onBegin: () => void;
  disconnect: () => Promise<void>;
  onEnd: () => void;
}) {
  const pending = useRef<Update | null>(null);
  const checking = useRef(false);
  const installing = useRef(false);
  const mounted = useRef(false);
  const [version, setVersion] = useState<string | null>(null);
  const [phase, setPhase] = useState("Automatic update checks are enabled.");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  async function checkNow(isAlive = () => mounted.current) {
    if (!isDesktop || checking.current || installing.current) return;
    checking.current = true;
    setWorking(true);
    setError("");
    setPhase("Checking GitHub for updates…");
    try {
      const update = await check({ timeout: 20000 });
      if (!isAlive()) {
        await update?.close();
        return;
      }
      await pending.current?.close();
      pending.current = update;
      setVersion(update?.version ?? null);
      setPhase(
        update
          ? `Version ${update.version} is available.`
          : "You’re up to date.",
      );
    } catch {
      if (isAlive()) {
        setPhase("Automatic checks retry every 6 hours.");
        setError(
          "Could not check GitHub. Check your connection and try again.",
        );
      }
    } finally {
      checking.current = false;
      if (isAlive()) setWorking(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    // Defer to avoid duplicate native requests during React StrictMode's probe.
    const startup = setTimeout(() => void checkNow(() => alive), 1500);
    const timer = setInterval(
      () => void checkNow(() => alive),
      6 * 60 * 60 * 1000,
    );
    return () => {
      alive = false;
      mounted.current = false;
      clearTimeout(startup);
      clearInterval(timer);
      void pending.current?.close();
      pending.current = null;
    };
  }, []);

  async function install() {
    const update = pending.current;
    if (!update || disabled || installing.current || checking.current) return;
    installing.current = true;
    setWorking(true);
    setError("");
    setPhase("Downloading and verifying the update…");
    onBegin();
    let downloaded = 0;
    let total = 0;
    try {
      await installVerifiedUpdate(
        update,
        async () => {
          setPhase("Disconnecting before installation…");
          await disconnect();
          setPhase("Installing… ProxyKing will close and restart.");
        },
        (event) => {
          if (event.event === "Started") total = event.data.contentLength ?? 0;
          if (event.event === "Progress") {
            downloaded += event.data.chunkLength;
            if (total)
              setPhase(
                `Downloading update… ${Math.min(100, Math.round((downloaded / total) * 100))}%`,
              );
          }
        },
      );
    } catch (err) {
      setError(
        `Update failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      setPhase("Check again to retry the update.");
      pending.current = null;
      setVersion(null);
      await update.close().catch(() => {});
    } finally {
      installing.current = false;
      setWorking(false);
      onEnd();
    }
  }

  if (!isDesktop) return null;
  return (
    <div className="update-banner">
      <div aria-live="polite">
        <strong>{phase}</strong>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : (
          <p>
            Signed updates from flazedude/proxyking. Installation disconnects
            the proxy.
          </p>
        )}
      </div>
      <button
        className="button secondary small-button"
        disabled={working || disabled}
        onClick={() => void checkNow()}
      >
        {working ? (
          <Loader2 size={15} className="spin" />
        ) : (
          <RefreshCw size={15} />
        )}{" "}
        Check for updates
      </button>
      {version && (
        <button
          className="button primary small-button"
          disabled={working || disabled}
          onClick={() => void install()}
        >
          <ArrowDownToLine size={15} /> Install {version} and restart
        </button>
      )}
    </div>
  );
}
