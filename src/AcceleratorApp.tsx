import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  ArrowRight,
  Check,
  ChevronRight,
  Crown,
  FileUp,
  Gamepad2,
  Globe2,
  Layers3,
  Loader2,
  Minus,
  Monitor,
  Plus,
  Power,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { backend, defaultState, defaultStatus, isDesktop } from "./lib/backend";
import { profileFingerprint, formatProtocol } from "./lib/profiles";
import {
  executableKey,
  validateExecutable,
  launchers,
} from "./accelerator/library";
import { GameArtwork } from "./components/GameArtwork";
import { ServerDialog } from "./components/ServerDialog";
import { ServerImportDialog } from "./components/ServerImportDialog";
import { Dialog } from "./components/Dialog";
import { ProcessRouting } from "./components/ProcessRouting";
import { AppUpdater } from "./components/AppUpdater";
import { SettingsPanel } from "./App";
import type {
  InstalledGame,
  LogEntry,
  ProcessTarget,
  Profile,
  SavedState,
} from "./types";
import { version } from "../package.json";
import { launcherLogo } from "./game-art";
import { updateGameSelection } from "./lib/game-selection";

type Page = "play" | "library" | "servers" | "activity" | "settings";
const navigation = [
  { id: "play", label: "Play", icon: Gamepad2 },
  { id: "library", label: "Library", icon: Layers3 },
  { id: "servers", label: "Servers", icon: Globe2 },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;
const labelForMode = (mode: string) =>
  mode === "processes"
    ? "Selected executables"
    : mode === "local"
      ? "Local proxy · manual setup"
      : "Windows system proxy";
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "This action could not be completed.";
const basename = (path: string) =>
  path.replaceAll("/", "\\").split("\\").at(-1) || path;

export default function AcceleratorApp() {
  const [data, setData] = useState<SavedState>(structuredClone(defaultState));
  const [status, setStatus] = useState(defaultStatus);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [page, setPage] = useState<Page>("play");
  const [filter, setFilter] = useState<"games" | "launchers" | "processes">(
    "games",
  );
  const [catalog, setCatalog] = useState<InstalledGame[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [clash, setClash] = useState(false);
  const [environmentError, setEnvironmentError] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEpoch = useRef(0);
  const [showServer, setShowServer] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [chooseGame, setChooseGame] = useState<InstalledGame | null>(null);
  const [chosenPaths, setChosenPaths] = useState<string[]>([]);
  const [includeChildren, setIncludeChildren] = useState(false);
  const [childrenEdited, setChildrenEdited] = useState(false);
  const [review, setReview] = useState(false);
  const [custom, setCustom] = useState(false);
  const [customPath, setCustomPath] = useState("");
  const [latencies, setLatencies] = useState<Record<string, number>>({});
  const [testing, setTesting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const connected = status.state === "connected";
  const locked =
    busy ||
    connected ||
    status.state === "connecting" ||
    !loaded ||
    !!loadError;
  const mode = connected ? status.routingMode : data.settings.routingMode;
  const server = data.profiles.find(
    (item) =>
      item.id === (connected ? status.profileId : data.selectedProfileId),
  );
  const targets = data.settings.selectedProcesses;
  const selectedKeys = new Set(
    targets.map((target) => executableKey(target.path)),
  );
  const gameSelected = (game: InstalledGame) =>
    game.executables.some((path) => selectedKeys.has(executableKey(path)));
  const games = catalog.filter(
    (game) =>
      game.kind === "game" &&
      `${game.title} ${game.launcher}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const installedLaunchers = catalog.filter((game) => game.kind === "launcher");
  const alive = useRef(true);
  const scanningRef = useRef(false);

  async function scan() {
    if (!isDesktop || scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    setScanError("");
    try {
      const result = await backend.games();
      if (alive.current) setCatalog(result);
    } catch (error) {
      if (alive.current) setScanError(errorText(error));
    } finally {
      scanningRef.current = false;
      if (alive.current) setScanning(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    let active = true;
    let polling = false;
    Promise.all([backend.load(), backend.status(), backend.logs()])
      .then(([saved, runtime, entries]) => {
        if (active) {
          setData(saved);
          setStatus(runtime);
          setLogs(entries);
        }
      })
      .catch((error) => {
        if (active) setLoadError(errorText(error));
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    const startup = setTimeout(() => {
      void scan();
    }, 100);
    const poll = async () => {
      if (!active || polling || !isDesktop) return;
      polling = true;
      const epoch = logsEpoch.current;
      try {
        const [runtime, entries, conflict] = await Promise.all([
          backend.status(),
          backend.logs(),
          backend.routingConflict(),
        ]);
        if (active) {
          setStatus(runtime);
          if (epoch === logsEpoch.current) setLogs(entries);
          setClash(conflict);
          setEnvironmentError("");
        }
      } catch (error) {
        if (active) setEnvironmentError(errorText(error));
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      setNow(Date.now());
      void poll();
    }, 2000);
    return () => {
      active = false;
      alive.current = false;
      clearInterval(timer);
      clearTimeout(startup);
    };
  }, []);

  async function attempt(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      setNotice(errorText(error));
    }
  }
  async function persist(next: SavedState) {
    if (loadError || !loaded)
      throw new Error("Resolve the storage error before saving.");
    setBusy(true);
    try {
      await backend.save(next);
      setData(next);
    } finally {
      setBusy(false);
    }
  }
  async function saveTargets(next: ProcessTarget[]) {
    await persist({
      ...data,
      settings: { ...data.settings, selectedProcesses: next },
    });
  }
  async function addProfiles(profiles: Profile[]) {
    const seen = new Set(data.profiles.map(profileFingerprint));
    const unique = profiles.filter((profile) => {
      const key = profileFingerprint(profile);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!unique.length)
      throw new Error("These servers are already in your library.");
    await persist({
      ...data,
      profiles: [...data.profiles, ...unique],
      selectedProfileId: data.selectedProfileId || unique[0].id,
    });
    setNotice(
      `${unique.length} server${unique.length === 1 ? "" : "s"} added.`,
    );
  }
  async function connect() {
    setBusy(true);
    try {
      if (connected) setStatus(await backend.disconnect());
      else if (server) setStatus(await backend.connect(server, data.settings));
    } finally {
      setBusy(false);
    }
  }
  function editGame(game: InstalledGame) {
    setChildrenEdited(false);
    setNotice("");
    setChooseGame(game);
    setChosenPaths(
      game.executables.filter((path) => selectedKeys.has(executableKey(path))),
    );
    setIncludeChildren(
      game.executables.some((path) => selectedKeys.has(executableKey(path))) &&
        game.executables
          .filter((path) => selectedKeys.has(executableKey(path)))
          .every((path) =>
            targets.some(
              (target) =>
                executableKey(target.path) === executableKey(path) &&
                target.includeChildren,
            ),
          ),
    );
  }
  async function applyGame() {
    if (!chooseGame) return;
    const next = updateGameSelection(
      targets,
      chooseGame.executables,
      chosenPaths,
      childrenEdited ? includeChildren : null,
    );
    await saveTargets(next);
    setChooseGame(null);
  }
  async function windowAction(action: "minimize" | "maximize" | "close") {
    if (!isDesktop) return;
    const window = getCurrentWindow();
    if (action === "minimize") await window.minimize();
    else if (action === "maximize") await window.toggleMaximize();
    else await window.close();
  }
  const cannotStart =
    !isDesktop ||
    busy ||
    !loaded ||
    !!loadError ||
    (!connected &&
      (!server ||
        !status.engineAvailable ||
        (mode === "processes" && (!targets.length || !status.isElevated)) ||
        (mode !== "local" && (clash || !!environmentError))));
  const seconds = Math.floor(
    Math.max(0, now - (status.connectedAt || now)) / 1000,
  );
  return (
    <div className="pk-app pk-native">
      <a className="pk-skip" href="#pk-main">
        Skip to content
      </a>
      <aside className="pk-sidebar">
        <div className="pk-brand">
          <span className="pk-brand-mark">
            <Crown size={25} />
          </span>
          <span>
            PROXYKING<small>GAME ACCELERATOR</small>
          </span>
        </div>
        <div className="pk-sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "active" : ""}
              aria-current={page === item.id ? "page" : undefined}
              onClick={() => {
                setPage(item.id);
                setQuery("");
              }}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="pk-sidebar-bottom">
          <div className="pk-version">
            WINDOWS X64 <span>v{version}</span>
          </div>
        </div>
      </aside>
      <div className="pk-workspace">
        <header className="pk-header" data-tauri-drag-region>
          <div className="pk-breadcrumb" data-tauri-drag-region>
            Workspace <ChevronRight size={13} />
            <strong>
              {page === "play"
                ? "Game accelerator"
                : navigation.find((item) => item.id === page)?.label}
            </strong>
          </div>
          <div className="pk-native-window-controls">
            {(["minimize", "maximize", "close"] as const).map((action) => (
              <button
                className="pk-icon"
                key={action}
                aria-label={
                  action === "maximize"
                    ? "Maximize or restore window"
                    : `${action[0].toUpperCase()}${action.slice(1)} window`
                }
                disabled={!isDesktop || (action === "close" && busy)}
                onClick={() => void attempt(() => windowAction(action))}
              >
                {action === "minimize" ? (
                  <Minus size={15} />
                ) : action === "maximize" ? (
                  <Square size={13} />
                ) : (
                  <X size={17} />
                )}
              </button>
            ))}
          </div>
        </header>
        <div className="pk-content-layout">
          <main className="pk-main" id="pk-main">
            {!isDesktop && (
              <div className="pk-callout">
                Browser preview · scanning, connections, persistent credentials,
                and update downloads are disabled.
              </div>
            )}
            {loadError && (
              <div className="pk-error" role="alert">
                Could not load saved settings. {loadError}{" "}
                <button
                  className="pk-button"
                  onClick={() => window.location.reload()}
                >
                  Retry
                </button>
              </div>
            )}
            {(notice || status.error) && (
              <div className="pk-notice" role="status">
                <span>{notice || status.error}</span>
                {status.error && (
                  <button
                    className="pk-button"
                    disabled={busy}
                    onClick={() =>
                      void attempt(async () => {
                        setStatus(await backend.disconnect());
                      })
                    }
                  >
                    Retry cleanup
                  </button>
                )}
                <button
                  className="pk-icon"
                  aria-label="Dismiss notification"
                  onClick={() => setNotice("")}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <div className="pk-page-heading">
              <div>
                <h1>
                  {page === "play"
                    ? "Game accelerator"
                    : page === "library"
                      ? "Library"
                      : page === "servers"
                        ? "Server library"
                        : page === "activity"
                          ? "Session activity"
                          : "Preferences"}
                </h1>
              </div>
              {(page === "play" || page === "library") && (
                <button
                  className="pk-button"
                  disabled={locked}
                  onClick={() => {
                    setNotice("");
                    setCustomPath("");
                    setCustom(true);
                  }}
                >
                  <Plus size={15} /> Add .exe
                </button>
              )}
            </div>
            {page === "play" && (
              <section className="pk-hero">
                <div className="pk-hero-copy">
                  <h2>Select apps</h2>
                  <p>
                    Select a game or launcher below.
                    <br />
                    Review its executable scope before connecting.
                  </p>
                  <button
                    className="pk-button pk-primary"
                    onClick={() => {
                      setPage("library");
                      setFilter("games");
                    }}
                  >
                    Open library <ArrowRight size={15} />
                  </button>
                </div>
                <div className="pk-hero-art" aria-hidden="true">
                  <div className="pk-orbit pk-orbit-one" />
                  <div className="pk-orbit pk-orbit-two" />
                  <div className="pk-reticle">
                    <Gamepad2 size={85} strokeWidth={1} />
                  </div>
                </div>
              </section>
            )}
            {(page === "play" || page === "library") && (
              <section>
                <div className="pk-section-heading">
                  <h2>
                    Games & apps{" "}
                    <span>
                      {catalog.filter((game) => game.kind === "game").length}
                    </span>
                  </h2>
                  <button
                    className="pk-button"
                    disabled={!isDesktop || scanning}
                    onClick={() => void scan()}
                  >
                    <RefreshCw size={14} className={scanning ? "spin" : ""} />
                    {scanning ? "Scanning…" : "Scan computer"}
                  </button>
                </div>
                <div className="pk-library-tools">
                  <div className="pk-tabs" aria-label="Library categories">
                    {(["games", "launchers", "processes"] as const).map(
                      (tab) => (
                        <button
                          key={tab}
                          aria-pressed={filter === tab}
                          className={filter === tab ? "active" : ""}
                          onClick={() => {
                            setFilter(tab);
                            setQuery("");
                          }}
                        >
                          {tab === "games" ? (
                            <Gamepad2 size={14} />
                          ) : tab === "launchers" ? (
                            <Layers3 size={14} />
                          ) : (
                            <Monitor size={14} />
                          )}
                          {tab[0].toUpperCase() + tab.slice(1)}
                        </button>
                      ),
                    )}
                  </div>
                  <label className="pk-search">
                    <Search size={15} />
                    <input
                      aria-label="Search library"
                      placeholder="Search library…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                </div>
                {scanError && <p className="pk-error">{scanError}</p>}
                {filter === "games" && (
                  <>
                    <div className="pk-game-grid">
                      {games.map((game) => (
                        <article
                          className={`pk-game-card ${gameSelected(game) ? "selected" : ""}`}
                          key={game.id}
                        >
                          <button
                            className="pk-card-select"
                            aria-label={`Configure ${game.title}`}
                            aria-pressed={gameSelected(game)}
                            disabled={locked}
                            onClick={() => editGame(game)}
                          >
                            <div className="pk-cover">
                              <GameArtwork
                                title={game.title}
                                steamId={game.steamId}
                                icon={game.icon}
                              />
                              <span
                                className={`pk-card-check ${gameSelected(game) ? "checked" : ""}`}
                              >
                                {gameSelected(game) ? (
                                  <Check size={15} />
                                ) : (
                                  <Plus size={15} />
                                )}
                              </span>
                            </div>
                            <div className="pk-game-info">
                              <span>
                                {launchers.find(
                                  (item) => item.id === game.launcher,
                                )?.name || game.launcher}
                              </span>
                              <h3>{game.title}</h3>
                            </div>
                          </button>
                          <div className="pk-card-bottom">
                            <span>
                              {gameSelected(game) ? "Selected" : "Installed"}
                            </span>
                            <button
                              className="pk-icon"
                              disabled={locked}
                              aria-label={`Executable details for ${game.title}`}
                              onClick={() => editGame(game)}
                            >
                              <ChevronRight size={16} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                    {!games.length && (
                      <div className="pk-empty">
                        <Gamepad2 size={32} />
                        <h3>
                          {scanning
                            ? "Finding installed games…"
                            : query
                              ? "No matches"
                              : "No games found"}
                        </h3>
                        <p>
                          {isDesktop
                            ? "Scan Steam libraries, Epic manifests, and registered Battle.net, Ubisoft, Riot, EA and GOG installations. You can also add an executable manually."
                            : "Open the Windows app to discover installed games."}
                        </p>
                      </div>
                    )}
                  </>
                )}
                {filter === "launchers" && (
                  <div className="pk-launcher-grid">
                    {launchers
                      .filter((launcher) =>
                        launcher.name
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((launcher) => {
                        const matches = installedLaunchers.filter(
                          (entry) => entry.launcher === launcher.id,
                        );
                        const found = matches[0];
                        return (
                          <button
                            key={launcher.id}
                            className={`pk-launcher-card pk-tone-${launcher.tone} ${matches.some(gameSelected) ? "selected" : ""}`}
                            disabled={locked || !found}
                            onClick={() => found && editGame(found)}
                          >
                            <img
                              className="pk-brand-logo"
                              src={launcherLogo(launcher.id)}
                              alt={`${launcher.name} logo`}
                            />
                            <strong>{launcher.name}</strong>
                            <small>
                              {found
                                ? "Installed · choose scope"
                                : "Not detected"}
                            </small>
                            <span className="pk-launcher-arrow">
                              {matches.some(gameSelected) ? (
                                <Check size={16} />
                              ) : (
                                <Plus size={16} />
                              )}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                )}
                {filter === "processes" && (
                  <ProcessRouting
                    targets={targets}
                    mode={data.settings.routingMode}
                    disabled={locked}
                    isElevated={status.isElevated}
                    inheritedProcesses={status.inheritedProcesses}
                    save={saveTargets}
                    enable={() =>
                      persist({
                        ...data,
                        settings: {
                          ...data.settings,
                          routingMode: "processes",
                          systemProxy: false,
                        },
                      })
                    }
                    restart={() => backend.restartElevated()}
                  />
                )}
                <p className="pk-library-footer">
                  <span>
                    <ShieldCheck size={14} /> Discovery does not launch games or
                    select their traffic automatically.
                  </span>
                  <span>
                    {targets.length} executable{targets.length === 1 ? "" : "s"}{" "}
                    selected
                  </span>
                </p>
              </section>
            )}
            {page === "servers" && (
              <section>
                <div className="pk-server-import">
                  <span className="pk-import-symbol">
                    <FileUp size={25} />
                  </span>
                  <div>
                    <h2>Import servers</h2>
                    <p>Add servers manually or import YAML and share links.</p>
                  </div>
                </div>
                <div className="pk-action-row">
                  <button
                    className="pk-button pk-primary"
                    disabled={locked}
                    onClick={() => setShowServer(true)}
                  >
                    <Plus size={15} /> Add server
                  </button>
                  <button
                    className="pk-button"
                    disabled={locked}
                    onClick={() => setShowImport(true)}
                  >
                    <FileUp size={15} /> Import YAML / links
                  </button>
                </div>
                <label className="pk-search pk-server-search">
                  <Search size={15} />
                  <input
                    aria-label="Search servers"
                    placeholder="Search servers…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <div className="pk-server-list">
                  {data.profiles
                    .filter((profile) =>
                      `${profile.name} ${profile.protocol}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((profile) => (
                      <div
                        key={profile.id}
                        className={`pk-server-row ${server?.id === profile.id ? "selected" : ""}`}
                      >
                        <button
                          className="pk-server-select"
                          disabled={locked}
                          aria-pressed={server?.id === profile.id}
                          onClick={() =>
                            void attempt(() =>
                              persist({
                                ...data,
                                selectedProfileId: profile.id,
                              }),
                            )
                          }
                        >
                          <Globe2 size={20} />
                          <span>
                            <strong>{profile.name}</strong>
                            <small>
                              {formatProtocol(profile.protocol)}
                              {profile.protocol === "http"
                                ? " · TCP only"
                                : " · UDP depends on server"}
                            </small>
                          </span>
                        </button>
                        <button
                          className="pk-button"
                          disabled={!isDesktop || testing || busy}
                          onClick={() =>
                            void attempt(async () => {
                              setTesting(true);
                              try {
                                const result = await backend.test(profile);
                                setLatencies((items) => ({
                                  ...items,
                                  [profile.id]: result.latencyMs,
                                }));
                              } finally {
                                setTesting(false);
                              }
                            })
                          }
                        >
                          {latencies[profile.id]
                            ? `${latencies[profile.id]} ms · TCP`
                            : "Test TCP"}
                        </button>
                        <button
                          className="pk-icon"
                          disabled={locked}
                          aria-label={`Rename ${profile.name}`}
                          onClick={() => {
                            const name = window.prompt(
                              "Server name",
                              profile.name,
                            );
                            if (name?.trim())
                              void attempt(() =>
                                persist({
                                  ...data,
                                  profiles: data.profiles.map((item) =>
                                    item.id === profile.id
                                      ? { ...item, name: name.trim() }
                                      : item,
                                  ),
                                }),
                              );
                          }}
                        >
                          ✎
                        </button>
                        <button
                          className="pk-icon"
                          disabled={locked}
                          aria-label={`Delete ${profile.name}`}
                          onClick={() => {
                            if (
                              window.confirm(`Delete server “${profile.name}”?`)
                            )
                              void attempt(() =>
                                persist({
                                  ...data,
                                  profiles: data.profiles.filter(
                                    (item) => item.id !== profile.id,
                                  ),
                                  selectedProfileId:
                                    data.selectedProfileId === profile.id
                                      ? data.profiles.find(
                                          (item) => item.id !== profile.id,
                                        )?.id || null
                                      : data.selectedProfileId,
                                }),
                              );
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                </div>
                {!data.profiles.length && (
                  <div className="pk-empty">
                    <Globe2 size={32} />
                    <h3>Add your first server</h3>
                    <p>
                      Import Clash YAML, supported share links, or add a
                      SOCKS5/HTTP server manually.
                    </p>
                  </div>
                )}
                <p className="pk-muted pk-small">
                  TCP tests measure reachability, not game latency or working
                  credentials.
                </p>
              </section>
            )}
            {page === "activity" && (
              <section className="pk-activity-panel">
                <div className="pk-section-heading">
                  <h2>Usage logging</h2>
                  <button
                    role="switch"
                    aria-label="Usage logging"
                    aria-checked={data.settings.usageLogging}
                    className={`pk-switch ${data.settings.usageLogging ? "on" : ""}`}
                    disabled={busy || !loaded || !!loadError}
                    onClick={() =>
                      void attempt(() =>
                        persist({
                          ...data,
                          settings: {
                            ...data.settings,
                            usageLogging: !data.settings.usageLogging,
                          },
                        }),
                      )
                    }
                  >
                    <span />
                  </button>
                </div>
                <p className="pk-muted">
                  Selected executable activity only. History stays in memory.
                </p>
                <div className="pk-action-row">
                  <button
                    className="pk-button"
                    onClick={() =>
                      void attempt(async () => {
                        logsEpoch.current++;
                        await backend.clearLogs();
                        setLogs([]);
                      })
                    }
                  >
                    Clear history
                  </button>
                </div>
                <div className="pk-event-list">
                  {[...logs].reverse().map((entry, index) => (
                    <div key={`${entry.timestamp}:${index}`}>
                      <time>
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </time>
                      <span>{entry.message}</span>
                    </div>
                  ))}
                </div>
                {!logs.length && (
                  <div className="pk-empty">
                    <Activity size={32} />
                    <h3>No session activity</h3>
                    <p>
                      Connect and enable logging to inspect selected-app
                      activity.
                    </p>
                  </div>
                )}
              </section>
            )}
            {page === "settings" && (
              <SettingsPanel
                settings={data.settings}
                disabled={locked}
                save={(settings) => persist({ ...data, settings })}
                engineAvailable={status.engineAvailable}
                engineVersion={status.engineVersion}
              />
            )}
            <div className="pk-updater">
              <AppUpdater
                disabled={busy || !loaded || !!loadError}
                onBegin={() => setBusy(true)}
                disconnect={async () => {
                  setStatus(await backend.disconnect());
                }}
                onEnd={() => setBusy(false)}
              />
            </div>
            <footer className="pk-main-footer">
              <span>PROXYKING / GAME ACCELERATOR</span>
              <span>
                v{version} ·{" "}
                {isDesktop ? "Windows account encryption" : "Browser preview"}
              </span>
            </footer>
          </main>
          <aside className="pk-session" aria-label="Session configuration">
            <div className="pk-session-header">
              <span>SESSION</span>
              <span className="pk-offline">
                {connected
                  ? "Engine running"
                  : status.state === "connecting"
                    ? "Connecting"
                    : "Offline"}
              </span>
            </div>
            <div className="pk-session-body">
              <div className="pk-session-title">
                <h2>Connection</h2>
                <p>{labelForMode(mode)}</p>
              </div>
              <label className="pk-server-picker-label" htmlFor="active-server">
                01 <span>CHOOSE A SERVER</span>
              </label>
              <div className="pk-server-picker">
                <Globe2 size={19} />
                <select
                  id="active-server"
                  value={server?.id || ""}
                  disabled={locked}
                  onChange={(event) =>
                    void attempt(() =>
                      persist({
                        ...data,
                        selectedProfileId: event.target.value,
                      }),
                    )
                  }
                >
                  <option value="" disabled>
                    No server selected
                  </option>
                  {data.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="pk-import-link"
                disabled={locked}
                onClick={() => setShowImport(true)}
              >
                <FileUp size={14} /> Import Clash config{" "}
                <ArrowRight size={14} />
              </button>
              <div className="pk-session-divider" />
              <div className="pk-targets-label">
                <span>
                  02 <strong>YOUR EXECUTABLES</strong>
                </span>
                <span>{targets.length}</span>
              </div>
              <div className="pk-session-targets">
                {targets.map((target) => (
                  <div key={executableKey(target.path)}>
                    <span className="pk-target-icon">
                      <Gamepad2 size={17} />
                    </span>
                    <span>
                      <strong>{target.name}</strong>
                      <small>
                        {target.includeChildren
                          ? "Includes child processes"
                          : "Executable only"}
                      </small>
                    </span>
                    <button
                      className="pk-icon"
                      disabled={locked}
                      aria-label={`Remove ${target.name}`}
                      onClick={() =>
                        void attempt(() =>
                          saveTargets(
                            targets.filter(
                              (item) =>
                                executableKey(item.path) !==
                                executableKey(target.path),
                            ),
                          ),
                        )
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {!targets.length && (
                  <div className="pk-session-empty">
                    <Gamepad2 size={26} />
                    <p>No executables selected</p>
                    <small>Choose a game from your library.</small>
                  </div>
                )}
              </div>
              <button
                className="pk-review-link"
                disabled={!targets.length}
                onClick={() => setReview(true)}
              >
                Review executable paths <ChevronRight size={14} />
              </button>
              <div className="pk-session-divider" />
              {mode === "processes" && !status.isElevated && isDesktop && (
                <button
                  className="pk-button pk-elevate"
                  disabled={busy || connected}
                  onClick={() => void attempt(() => backend.restartElevated())}
                >
                  <ShieldCheck size={16} /> Restart as administrator
                </button>
              )}
              {mode !== "local" && (clash || environmentError) && (
                <p className="pk-conflict" role="status">
                  {clash
                    ? "Clash is running. This version pauses new TUN/system-proxy connections to avoid a conflict. Exit Clash yourself before connecting."
                    : "Cannot verify other proxy applications. Try again before connecting."}
                </p>
              )}
              <div className="pk-session-metrics">
                <div>
                  <span>Session time</span>
                  <strong>
                    {connected
                      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>TCP reachability</span>
                  <strong>
                    {server && latencies[server.id]
                      ? `${latencies[server.id]} ms`
                      : "—"}
                  </strong>
                </div>
              </div>
              <p className="pk-unmeasured">No in-game latency measurement</p>
              <button
                className="pk-start"
                disabled={cannotStart}
                onClick={() => void attempt(connect)}
              >
                {busy ? (
                  <Loader2 size={17} className="spin" />
                ) : (
                  <Power size={17} />
                )}
                {connected
                  ? "Disconnect"
                  : mode === "processes"
                    ? "Start acceleration"
                    : "Connect proxy"}
                <ArrowRight size={15} />
              </button>
              <p className="pk-start-note">
                {mode === "processes"
                  ? "Selected apps use your server. Other traffic goes direct through the TUN. Windows DNS is unchanged."
                  : labelForMode(mode)}
              </p>
            </div>
          </aside>
        </div>
      </div>
      {showServer && (
        <ServerDialog close={() => setShowServer(false)} save={addProfiles} />
      )}
      {showImport && (
        <ServerImportDialog
          close={() => setShowImport(false)}
          save={addProfiles}
        />
      )}
      {chooseGame && (
        <Dialog
          title={chooseGame.title}
          close={() => {
            if (!busy) setChooseGame(null);
          }}
          wide
        >
          <p className="pk-muted">
            Choose the exact executable files to proxy. Selecting a launcher
            does not select its games automatically.
          </p>
          <div className="pk-executable-options">
            {chooseGame.executables.map((path) => (
              <label key={path}>
                <input
                  type="checkbox"
                  checked={chosenPaths.includes(path)}
                  disabled={busy}
                  onChange={(event) =>
                    setChosenPaths((previous) =>
                      event.target.checked
                        ? [...previous, path]
                        : previous.filter((item) => item !== path),
                    )
                  }
                />
                <span>
                  <strong>{basename(path)}</strong>
                  <small>{path}</small>
                </span>
              </label>
            ))}
          </div>
          <label className="pk-child-option">
            <input
              type="checkbox"
              checked={includeChildren}
              disabled={busy}
              onChange={(event) => {
                setChildrenEdited(true);
                setIncludeChildren(event.target.checked);
              }}
            />{" "}
            Include child processes{" "}
            <small>
              Broader scope: may include other games, helpers, and downloads.
            </small>
          </label>
          {notice && (
            <p className="pk-error" role="alert">
              {notice}
            </p>
          )}
          <div className="pk-modal-actions">
            <button
              className="pk-button"
              disabled={busy}
              onClick={() => setChooseGame(null)}
            >
              Cancel
            </button>
            <button
              className="pk-button pk-primary"
              disabled={busy}
              onClick={() => void attempt(applyGame)}
            >
              Save {chosenPaths.length} executable
              {chosenPaths.length === 1 ? "" : "s"}
            </button>
          </div>
        </Dialog>
      )}
      {review && (
        <Dialog
          title="Selected executable paths"
          close={() => setReview(false)}
          wide
        >
          <div className="pk-review-targets">
            {targets.map((target) => (
              <div key={target.path}>
                <strong>{target.name}</strong>
                <code>{target.path}</code>
                <small>
                  {target.includeChildren
                    ? "Includes child processes"
                    : "Exact executable path · all instances"}
                </small>
              </div>
            ))}
          </div>
        </Dialog>
      )}
      {custom && (
        <Dialog
          title="Add an executable"
          close={() => {
            if (!busy) setCustom(false);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void attempt(async () => {
                const path = validateExecutable(customPath);
                if (selectedKeys.has(executableKey(path)))
                  throw new Error("This executable is already selected.");
                await saveTargets([
                  ...targets,
                  { name: basename(path), path, includeChildren: false },
                ]);
                setCustom(false);
              });
            }}
          >
            <label className="pk-field">
              Full Windows executable path
              <input
                value={customPath}
                onChange={(event) => setCustomPath(event.target.value)}
                placeholder="C:\Games\My Game\game.exe"
                required
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <p className="pk-muted pk-small">
              Or select a running application from Library → Processes. All
              instances at the saved path match.
            </p>
            {notice && (
              <p className="pk-error" role="alert">
                {notice}
              </p>
            )}
            <div className="pk-modal-actions">
              <button
                className="pk-button"
                type="button"
                disabled={busy}
                onClick={() => setCustom(false)}
              >
                Cancel
              </button>
              <button className="pk-button pk-primary" disabled={busy}>
                Add executable
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
