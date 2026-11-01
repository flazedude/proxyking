import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Crown,
  FileUp,
  FolderOpen,
  Gamepad2,
  Globe2,
  Layers3,
  LockKeyhole,
  Monitor,
  Plus,
  Power,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Signal,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { inspectClashConfig, MAX_CONFIG_BYTES } from "./clash-import";
import type { ImportedServer, ImportReport } from "./clash-import";
import {
  executableKey,
  launchers,
  sampleGames,
  selectedTargets,
  validateExecutable,
} from "./library";
import type { LauncherId, LibraryEntry, Selection } from "./library";
import { GameArtwork } from "../components/GameArtwork";
import { launcherLogo } from "../game-art";

type Page = "play" | "library" | "servers" | "activity" | "settings";
type Filter = "games" | "launchers" | "processes";
type Server = Omit<ImportedServer, "origin"> & {
  origin: "imported" | "example";
};
const exampleServers: Server[] = [
  {
    id: "example:hk",
    name: "Hong Kong · 01",
    type: "hysteria2",
    udp: "unverified",
    origin: "example",
  },
  {
    id: "example:sg",
    name: "Singapore · 02",
    type: "ss",
    udp: "unverified",
    origin: "example",
  },
  {
    id: "example:jp",
    name: "Tokyo · 03",
    type: "vless",
    udp: "unverified",
    origin: "example",
  },
];
const nav = [
  { id: "play", label: "Play", icon: Gamepad2 },
  { id: "library", label: "Library", icon: Layers3 },
  { id: "servers", label: "Servers", icon: Globe2 },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;
const titles: Record<Page, string> = {
  play: "Game accelerator",
  library: "Your library",
  servers: "Server library",
  activity: "Session activity",
  settings: "Preferences",
};

function Modal({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`pk-modal ${wide ? "pk-modal-wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === ref.current) close();
      }}
    >
      <div className="pk-modal-head">
        <h2 id={titleId}>{title}</h2>
        <button className="pk-icon" onClick={close} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function ImportDialog({
  close,
  add,
}: {
  close: () => void;
  add: (report: ImportReport) => void;
}) {
  const [text, setText] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const readVersion = useRef(0);
  useEffect(
    () => () => {
      readVersion.current++;
    },
    [],
  );
  function inspect(event: FormEvent) {
    event.preventDefault();
    setError("");
    setReport(null);
    try {
      setReport(inspectClashConfig(text));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not inspect this configuration.",
      );
    }
  }
  return (
    <Modal title="Import Clash configuration" close={close} wide>
      <p className="pk-muted">
        Preview the servers in your YAML. Importing keeps only server labels in
        this browser session.
      </p>
      <form onSubmit={inspect}>
        <label className="pk-file-input">
          <FileUp size={23} />
          <span>
            <strong>Choose a YAML file</strong>
            <small>.yaml or .yml · up to 512 KB</small>
          </span>
          <input
            type="file"
            accept=".yaml,.yml,text/yaml,application/yaml"
            aria-label="Choose Clash YAML file"
            disabled={reading}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const version = ++readVersion.current;
              setReport(null);
              setError("");
              setText("");
              if (file.size > MAX_CONFIG_BYTES) {
                setError("Choose a YAML configuration smaller than 512 KB.");
                event.target.value = "";
                return;
              }
              setReading(true);
              try {
                const value = await file.text();
                if (version === readVersion.current) setText(value);
              } catch {
                if (version === readVersion.current)
                  setError("Could not read this file.");
              } finally {
                if (version === readVersion.current) setReading(false);
              }
            }}
          />
        </label>
        <label className="pk-field">
          Or paste your configuration
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setReport(null);
              setError("");
            }}
            rows={8}
            maxLength={MAX_CONFIG_BYTES}
            placeholder={
              "proxies:\n  - name: My game server\n    type: ss\n    server: server.example\n    port: 443\n    cipher: aes-128-gcm\n    password: …"
            }
            spellCheck={false}
            autoComplete="off"
            disabled={reading}
          />
        </label>
        {error && (
          <p className="pk-error" role="alert">
            {error}
          </p>
        )}
        {report && (
          <section className="pk-import-report" aria-live="polite">
            <div className="pk-report-count">
              <Check size={18} />
              <strong>{report.servers.length} server labels found</strong>
            </div>
            <p>
              {report.groups} groups detected. Group execution and server
              compatibility are not validated in this preview.
            </p>
            {report.providers > 0 && (
              <p>
                {report.providers} external or incomplete providers need a
                self-contained export. No files or URLs were opened.
              </p>
            )}
            {report.unresolvedGroups > 0 && (
              <p>
                {report.unresolvedGroups} groups contain references that are not
                resolved by this preview.
              </p>
            )}
            {report.skipped > 0 && (
              <p>
                {report.skipped} invalid, duplicate, unsupported, or sensitive
                labels excluded.
              </p>
            )}
            {report.ignored.length > 0 && (
              <p>Excluded from preview: {report.ignored.join(", ")}.</p>
            )}
            <div className="pk-import-labels">
              {report.servers.slice(0, 8).map((server) => (
                <span key={server.id}>{server.name}</span>
              ))}
              {report.servers.length > 8 && (
                <span>+{report.servers.length - 8} more</span>
              )}
            </div>
          </section>
        )}
        <p className="pk-small pk-muted">
          <LockKeyhole size={13} /> No credentials are saved. Connection
          settings, scripts, and routing rules are never applied.
        </p>
        <div className="pk-modal-actions">
          <button type="button" className="pk-button" onClick={close}>
            Cancel
          </button>
          {report ? (
            <button
              type="button"
              className="pk-button pk-primary"
              disabled={!report.servers.length}
              onClick={() => {
                add(report);
                setText("");
                close();
              }}
            >
              Add labels to preview <ArrowRight size={15} />
            </button>
          ) : (
            <button
              className="pk-button pk-primary"
              disabled={!text.trim() || reading}
            >
              Inspect configuration <ArrowRight size={15} />
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

function AddExecutable({
  close,
  add,
  existing,
}: {
  close: () => void;
  add: (entry: LibraryEntry) => void;
  existing: LibraryEntry[];
}) {
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal title="Add your own executable" close={close}>
      <p className="pk-muted">
        Add a game or app by its full Windows path. The browser cannot verify
        files on your PC.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          try {
            const valid = validateExecutable(path);
            if (
              existing.some(
                (entry) => executableKey(entry.path) === executableKey(valid),
              )
            )
              throw new Error("This executable is already in your library.");
            add({
              id: `custom:${crypto.randomUUID()}`,
              title: title.trim() || valid.split("\\").at(-1)!,
              path: valid,
              launcher: "custom",
              category: "CUSTOM EXECUTABLE",
              mark: "+",
              tone: "lime",
              custom: true,
            });
            close();
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Check this executable path.",
            );
          }
        }}
      >
        <label className="pk-field">
          Display name
          <input
            autoFocus
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="My game"
          />
        </label>
        <label className="pk-field">
          Executable path
          <input
            value={path}
            maxLength={32767}
            onChange={(event) => setPath(event.target.value)}
            placeholder="C:\Games\My Game\game.exe"
            spellCheck={false}
            autoComplete="off"
            required
          />
        </label>
        {error && (
          <p className="pk-error" role="alert">
            {error}
          </p>
        )}
        <p className="pk-small pk-muted">
          The installed app will offer a native .exe picker. This preview keeps
          your entry in memory until reload.
        </p>
        <div className="pk-modal-actions">
          <button type="button" className="pk-button" onClick={close}>
            Cancel
          </button>
          <button className="pk-button pk-primary">
            Add to library <Plus size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LauncherDialog({
  id,
  entries,
  selection,
  close,
  save,
}: {
  id: LauncherId;
  entries: LibraryEntry[];
  selection: Selection[];
  close: () => void;
  save: (items: Selection[]) => void;
}) {
  const launcher = launchers.find((entry) => entry.id === id)!;
  const current = selection.find((entry) => entry.id === `launcher:${id}`);
  const [scope, setScope] = useState<"launcher" | "games" | "children">(
    current?.includeChildren ? "children" : "launcher",
  );
  const games = entries.filter((entry) => entry.launcher === id);
  const [chosen, setChosen] = useState(
    new Set(
      games
        .filter((game) => selection.some((entry) => entry.id === game.id))
        .map((game) => game.id),
    ),
  );
  return (
    <Modal title={`${launcher.name} routing scope`} close={close}>
      <p className="pk-muted">Choose exactly what belongs in your session.</p>
      <div className="pk-scope-options">
        {[
          {
            id: "launcher" as const,
            title: "Launcher only",
            description: launcher.executable,
          },
          {
            id: "games" as const,
            title: "Choose specific games",
            description:
              "Select games individually. The launcher stays excluded.",
          },
          {
            id: "children" as const,
            title: "Launcher + child processes",
            description:
              "Broader scope: may include other games, helpers, and downloads.",
          },
        ].map((option) => (
          <label
            key={option.id}
            className={scope === option.id ? "chosen" : ""}
          >
            <input
              type="radio"
              name="launcher-scope"
              checked={scope === option.id}
              onChange={() => setScope(option.id)}
            />
            <span>
              <strong>{option.title}</strong>
              <small>{option.description}</small>
            </span>
          </label>
        ))}
      </div>
      {scope === "games" && (
        <div className="pk-scope-games">
          {games.length ? (
            games.map((game) => (
              <label key={game.id}>
                <input
                  type="checkbox"
                  checked={chosen.has(game.id)}
                  onChange={() =>
                    setChosen((previous) => {
                      const next = new Set(previous);
                      if (next.has(game.id)) next.delete(game.id);
                      else next.add(game.id);
                      return next;
                    })
                  }
                />
                {game.title}
              </label>
            ))
          ) : (
            <p>
              No sample games for this launcher. Add your own executable from
              the library.
            </p>
          )}
        </div>
      )}
      {scope === "children" && (
        <p className="pk-callout">
          Child discovery is broader than selecting one game. Native discovery
          and live routing are not enabled in this preview.
        </p>
      )}
      <p className="pk-small pk-muted">
        Example paths only. Existing game selections stay selected when adding
        the launcher.
      </p>
      <div className="pk-modal-actions">
        <button className="pk-button" onClick={close}>
          Cancel
        </button>
        <button
          className="pk-button pk-primary"
          onClick={() => {
            let next = selection.filter(
              (entry) => entry.id !== `launcher:${id}`,
            );
            if (scope === "games") {
              next = next.filter(
                (entry) => !games.some((game) => game.id === entry.id),
              );
              next.push(
                ...[...chosen].map((gameId) => ({
                  id: gameId,
                  includeChildren: false,
                })),
              );
            } else
              next.push({
                id: `launcher:${id}`,
                includeChildren: scope === "children",
              });
            save(next);
            close();
          }}
        >
          Apply selection <Check size={15} />
        </button>
      </div>
    </Modal>
  );
}

export function AcceleratorPreview() {
  const [page, setPage] = useState<Page>("play");
  const [filter, setFilter] = useState<Filter>("games");
  const [query, setQuery] = useState("");
  const [launcherFilter, setLauncherFilter] = useState("all");
  const [entries, setEntries] = useState<LibraryEntry[]>(sampleGames);
  const [selection, setSelection] = useState<Selection[]>([]);
  const [servers, setServers] = useState<Server[]>(exampleServers);
  const [serverId, setServerId] = useState(exampleServers[0].id);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [scope, setScope] = useState<LauncherId | null>(null);
  const [details, setDetails] = useState<LibraryEntry | null>(null);
  const [review, setReview] = useState(false);
  const [logging, setLogging] = useState(false);
  const [notice, setNotice] = useState("");
  const [serverQuery, setServerQuery] = useState("");
  const targets = selectedTargets(entries, selection);
  const server = servers.find((item) => item.id === serverId);
  const isSelected = (id: string) => selection.some((item) => item.id === id);
  const toggle = (id: string) =>
    setSelection((previous) =>
      previous.some((item) => item.id === id)
        ? previous.filter((item) => item.id !== id)
        : [...previous, { id, includeChildren: false }],
    );
  const visible = entries.filter(
    (entry) =>
      (filter !== "processes" || entry.custom) &&
      (launcherFilter === "all" || entry.launcher === launcherFilter) &&
      `${entry.title} ${entry.category} ${entry.launcher} ${entry.path}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const visibleLaunchers = launchers.filter((entry) =>
    entry.name.toLowerCase().includes(query.toLowerCase()),
  );
  const addImport = (report: ImportReport) => {
    const token = crypto.randomUUID();
    const imported = report.servers.map((entry, index) => ({
      ...entry,
      id: `import:${token}:${index}`,
    }));
    setServers((previous) =>
      [
        ...previous.filter((entry) => entry.origin !== "example"),
        ...imported,
      ].slice(-500),
    );
    if (imported.length) setServerId(imported[0].id);
    setNotice(
      `${imported.length} server labels added for this preview. No connections were made.`,
    );
  };
  return (
    <div className="pk-app">
      <a className="pk-skip" href="#pk-main">
        Skip to content
      </a>
      <aside className="pk-sidebar">
        <a
          className="pk-brand"
          href="/accelerator.html"
          aria-label="ProxyKing preview home"
        >
          <span className="pk-brand-mark">
            <Crown size={25} strokeWidth={2.2} />
          </span>
          <span>
            PROXYKING<small>GAME ACCELERATOR</small>
          </span>
        </a>
        <div className="pk-sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
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
              {item.id === "library" && <small>{entries.length}</small>}
            </button>
          ))}
        </nav>
        <div className="pk-sidebar-bottom">
          <div className="pk-local-card">
            <LockKeyhole size={18} />
            <strong>
              Your servers.
              <br />
              Your session.
            </strong>
            <p>
              Bring your own config.
              <br />
              Choose your own games.
            </p>
          </div>
          <button
            className="pk-help"
            onClick={() => {
              setPage("settings");
            }}
          >
            <CircleHelp size={17} /> About this preview{" "}
            <ChevronRight size={14} />
          </button>
          <div className="pk-version">
            <span className="pk-mini-dot" /> DESIGN PREVIEW <span>01</span>
          </div>
        </div>
      </aside>
      <div className="pk-workspace">
        <header className="pk-header">
          <div className="pk-breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>{titles[page]}</strong>
          </div>
          <div className="pk-header-actions">
            <span className="pk-preview-badge">
              <span /> BROWSER PREVIEW
            </span>
            <button
              className="pk-icon"
              aria-label="Open preferences"
              onClick={() => setPage("settings")}
            >
              <SlidersHorizontal size={19} />
            </button>
          </div>
        </header>
        <div className="pk-mobile-preview">
          Browser design preview · Sample library · No traffic routing
        </div>
        <div className="pk-content-layout">
          <main id="pk-main" className="pk-main" tabIndex={-1}>
            <div className="pk-page-heading">
              <div>
                <div className="pk-eyebrow">
                  {page === "play"
                    ? "YOUR NEXT SESSION"
                    : "PROXYKING / WORKSPACE"}
                </div>
                <h1>
                  {titles[page]}
                  <span>.</span>
                </h1>
                <p>
                  {page === "play" || page === "library"
                    ? "Select the games and apps you want to accelerate."
                    : page === "servers"
                      ? "Bring your own servers. Keep your setup independent."
                      : page === "activity"
                        ? "Connection details belong here when native routing is ready."
                        : "A preview of your next game acceleration workspace."}
                </p>
              </div>
              {(page === "play" || page === "library") && (
                <button className="pk-button" onClick={() => setShowAdd(true)}>
                  <Plus size={16} /> Add .exe
                </button>
              )}
              {page === "servers" && (
                <button
                  className="pk-button pk-primary"
                  onClick={() => setShowImport(true)}
                >
                  <FileUp size={16} /> Import config
                </button>
              )}
            </div>
            {notice && (
              <div className="pk-notice" role="status">
                <Check size={16} />
                <span>{notice}</span>
                <button
                  className="pk-icon"
                  aria-label="Dismiss notification"
                  onClick={() => setNotice("")}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            {page === "play" && (
              <section className="pk-hero">
                <div className="pk-hero-copy">
                  <span className="pk-hero-tag">
                    <Crosshair size={13} /> BUILT AROUND YOUR GAMES
                  </span>
                  <h2>
                    One session.
                    <br />
                    <span>Your selection.</span>
                  </h2>
                  <p>
                    Games, launchers, or individual apps.
                    <br />
                    You choose what joins the session.
                  </p>
                  <button
                    className="pk-button pk-primary"
                    onClick={() => {
                      setPage("library");
                      setFilter("games");
                    }}
                  >
                    Explore your library <ArrowRight size={16} />
                  </button>
                </div>
                <div className="pk-hero-art" aria-hidden="true">
                  <div className="pk-orbit pk-orbit-one" />
                  <div className="pk-orbit pk-orbit-two" />
                  <div className="pk-reticle">
                    <Crosshair size={90} strokeWidth={1} />
                  </div>
                  <span className="pk-art-coordinate">PXK // 001</span>
                  <span className="pk-art-caption">SELECT / ROUTE / PLAY</span>
                </div>
              </section>
            )}
            {(page === "play" || page === "library") && (
              <section className="pk-library">
                <div className="pk-section-heading">
                  <h2>
                    {page === "play"
                      ? "Build your session"
                      : "All games & apps"}
                    <span>{entries.length}</span>
                  </h2>
                  <span className="pk-sample-label">Sample library</span>
                </div>
                <div className="pk-library-tools">
                  <div
                    className="pk-tabs"
                    role="tablist"
                    aria-label="Library type"
                  >
                    {(
                      [
                        { id: "games", label: "Games", icon: Gamepad2 },
                        { id: "launchers", label: "Launchers", icon: Layers3 },
                        { id: "processes", label: "Processes", icon: Monitor },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        role="tab"
                        id={`tab-${tab.id}`}
                        aria-selected={filter === tab.id}
                        aria-controls={`panel-${filter}`}
                        tabIndex={filter === tab.id ? 0 : -1}
                        className={filter === tab.id ? "active" : ""}
                        onKeyDown={(event) => {
                          const tabs: Filter[] = [
                            "games",
                            "launchers",
                            "processes",
                          ];
                          const index = tabs.indexOf(filter);
                          const next =
                            event.key === "ArrowRight"
                              ? tabs[(index + 1) % tabs.length]
                              : event.key === "ArrowLeft"
                                ? tabs[(index + tabs.length - 1) % tabs.length]
                                : event.key === "Home"
                                  ? tabs[0]
                                  : event.key === "End"
                                    ? tabs[2]
                                    : null;
                          if (!next) return;
                          event.preventDefault();
                          setFilter(next);
                          setQuery("");
                          setLauncherFilter("all");
                          document.getElementById(`tab-${next}`)?.focus();
                        }}
                        onClick={() => {
                          setFilter(tab.id);
                          setQuery("");
                          setLauncherFilter("all");
                        }}
                      >
                        <tab.icon size={14} />
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <label className="pk-search">
                    <Search size={16} />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      aria-label="Search library"
                      placeholder="Search library…"
                    />
                  </label>
                </div>
                {filter === "games" && (
                  <div className="pk-filter-row">
                    <button
                      className={launcherFilter === "all" ? "active" : ""}
                      onClick={() => setLauncherFilter("all")}
                    >
                      All platforms
                    </button>
                    {launchers.slice(0, 4).map((launcher) => (
                      <button
                        key={launcher.id}
                        className={
                          launcherFilter === launcher.id ? "active" : ""
                        }
                        onClick={() => setLauncherFilter(launcher.id)}
                      >
                        {launcher.name}
                      </button>
                    ))}
                  </div>
                )}
                <div
                  id={`panel-${filter}`}
                  role="tabpanel"
                  aria-labelledby={`tab-${filter}`}
                >
                  {filter === "launchers" ? (
                    <div className="pk-launcher-grid">
                      {visibleLaunchers.map((launcher) => (
                        <button
                          className={`pk-launcher-card pk-tone-${launcher.tone} ${isSelected(`launcher:${launcher.id}`) ? "selected" : ""}`}
                          key={launcher.id}
                          onClick={() => setScope(launcher.id)}
                        >
                          <img
                            className="pk-brand-logo"
                            src={launcherLogo(launcher.id)}
                            alt={`${launcher.name} logo`}
                          />
                          <strong>{launcher.name}</strong>
                          <small>
                            {isSelected(`launcher:${launcher.id}`)
                              ? selection.find(
                                  (entry) =>
                                    entry.id === `launcher:${launcher.id}`,
                                )?.includeChildren
                                ? "Launcher + children"
                                : "Launcher selected"
                              : "Choose routing scope"}
                          </small>
                          <span className="pk-launcher-arrow">
                            {isSelected(`launcher:${launcher.id}`) ? (
                              <Check size={16} />
                            ) : (
                              <Plus size={16} />
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="pk-game-grid">
                      {visible.map((game) => (
                        <article
                          className={`pk-game-card pk-tone-${game.tone} ${isSelected(game.id) ? "selected" : ""}`}
                          key={game.id}
                        >
                          <button
                            className="pk-card-select"
                            aria-label={`${isSelected(game.id) ? "Deselect" : "Select"} ${game.title}`}
                            aria-pressed={isSelected(game.id)}
                            onClick={() => toggle(game.id)}
                          >
                            <div className="pk-cover">
                              <span className="pk-cover-label">
                                {game.custom ? "CUSTOM APP" : game.category}
                              </span>
                              <GameArtwork
                                title={game.title}
                                steamId={game.steamId}
                              />
                              <span className="pk-cover-lines" />
                              <span
                                className={`pk-card-check ${isSelected(game.id) ? "checked" : ""}`}
                              >
                                {isSelected(game.id) ? (
                                  <Check size={15} />
                                ) : (
                                  <Plus size={15} />
                                )}
                              </span>
                              <span className="pk-cover-number">
                                {game.custom
                                  ? "EXE"
                                  : `0${sampleGames.findIndex((entry) => entry.id === game.id) + 1}`}
                              </span>
                            </div>
                            <div className="pk-game-info">
                              <span>
                                {game.launcher === "custom"
                                  ? "CUSTOM EXECUTABLE"
                                  : launchers.find(
                                      (launcher) =>
                                        launcher.id === game.launcher,
                                    )?.name}
                              </span>
                              <h3>{game.title}</h3>
                            </div>
                          </button>
                          <div className="pk-card-bottom">
                            <span>
                              <span
                                className={`pk-mini-dot ${isSelected(game.id) ? "lime" : ""}`}
                              />
                              {isSelected(game.id)
                                ? "Selected"
                                : game.custom
                                  ? "Path not verified"
                                  : "Example game"}
                            </span>
                            <button
                              className="pk-icon"
                              aria-label={`Details for ${game.title}`}
                              onClick={() => setDetails(game)}
                            >
                              <ChevronRight size={16} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  {((filter === "launchers" && !visibleLaunchers.length) ||
                    (filter !== "launchers" && !visible.length)) && (
                    <div className="pk-empty">
                      <FolderOpen size={32} />
                      <h3>
                        {filter === "processes" && !query
                          ? "Add an executable"
                          : "No matches"}
                      </h3>
                      <p>
                        {filter === "processes"
                          ? "The browser cannot enumerate processes. Add a Windows path to explore selection."
                          : "Try a different game name or platform."}
                      </p>
                      {filter === "processes" && (
                        <button
                          className="pk-button"
                          onClick={() => setShowAdd(true)}
                        >
                          <Plus size={15} /> Add .exe
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="pk-library-footer">
                  <span>
                    <ShieldCheck size={14} /> Select games individually.
                    Launcher children are opt-in.
                  </span>
                  <span>{targets.length} selected</span>
                </div>
              </section>
            )}
            {page === "servers" && (
              <section className="pk-server-library">
                <div className="pk-server-import">
                  <span className="pk-import-symbol">
                    <FileUp size={28} />
                  </span>
                  <div>
                    <h2>Your Clash config. A separate setup.</h2>
                    <p>
                      Preview server labels without opening Clash Verge or
                      changing its configuration.
                    </p>
                  </div>
                  <button
                    className="pk-button"
                    onClick={() => setShowImport(true)}
                  >
                    Import YAML <ArrowRight size={15} />
                  </button>
                </div>
                <label className="pk-search pk-server-search">
                  <Search size={16} />
                  <input
                    aria-label="Search servers"
                    placeholder="Search servers…"
                    value={serverQuery}
                    onChange={(event) => setServerQuery(event.target.value)}
                  />
                </label>
                <div className="pk-server-list">
                  {servers
                    .filter((item) =>
                      `${item.name} ${item.type}`
                        .toLowerCase()
                        .includes(serverQuery.toLowerCase()),
                    )
                    .map((item) => (
                      <button
                        key={item.id}
                        className={`pk-server-row ${serverId === item.id ? "selected" : ""}`}
                        aria-pressed={serverId === item.id}
                        onClick={() => setServerId(item.id)}
                      >
                        <span className="pk-server-icon">
                          <Globe2 size={20} />
                        </span>
                        <span>
                          <strong>{item.name}</strong>
                          <small>
                            {item.type.toUpperCase()} ·{" "}
                            {item.origin === "example"
                              ? "Example server"
                              : "Imported label"}
                          </small>
                        </span>
                        <span className="pk-server-capability">
                          {item.udp === "disabled"
                            ? "UDP unavailable"
                            : "UDP unverified"}
                        </span>
                        <span className="pk-server-latency">
                          —<small>Not tested</small>
                        </span>
                        {serverId === item.id ? (
                          <Check size={17} />
                        ) : (
                          <span className="pk-radio" />
                        )}
                      </button>
                    ))}
                </div>
                {!servers.some((item) =>
                  `${item.name} ${item.type}`
                    .toLowerCase()
                    .includes(serverQuery.toLowerCase()),
                ) && (
                  <div className="pk-empty">
                    <Search size={28} />
                    <h3>No matching servers</h3>
                    <p>Try a different name or protocol.</p>
                  </div>
                )}
                <p className="pk-small pk-muted">
                  Server labels are temporary. The preview does not retain
                  server credentials, fetch subscriptions, or test connectivity.
                </p>
              </section>
            )}
            {page === "activity" && (
              <section className="pk-activity-panel">
                <div className="pk-section-heading">
                  <h2>Usage logging</h2>
                  <button
                    role="switch"
                    aria-checked={logging}
                    aria-label="Usage logging preview"
                    className={`pk-switch ${logging ? "on" : ""}`}
                    onClick={() => setLogging((value) => !value)}
                  >
                    <span />
                  </button>
                </div>
                <p className="pk-muted">
                  {logging
                    ? "Logging preference is on for this preview session."
                    : "Logging is off. You control whether activity is collected."}
                </p>
                <div className="pk-empty pk-activity-empty">
                  <Activity size={38} />
                  <h3>No session activity</h3>
                  <p>
                    This browser preview never monitors traffic.
                    <br />
                    Native sessions will show selected app connections here.
                  </p>
                  <div className="pk-activity-columns">
                    <span>APP</span>
                    <span>DESTINATION</span>
                    <span>ROUTE</span>
                    <span>TRANSFER</span>
                  </div>
                </div>
              </section>
            )}
            {page === "settings" && (
              <div className="pk-settings">
                <section>
                  <span className="pk-eyebrow">APPEARANCE</span>
                  <h2>After dark</h2>
                  <p>
                    Graphite surfaces, sharp details, and electric lime accents.
                  </p>
                  <div className="pk-theme-swatches">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                </section>
                <section>
                  <span className="pk-eyebrow">APP ISOLATION</span>
                  <h2>Separate by design</h2>
                  <p>
                    The intended native architecture owns its engine, encrypted
                    data, private ports, and executable rules. This preview does
                    not connect to Clash Verge.
                  </p>
                  <div className="pk-settings-row">
                    <span>Executable routing backend</span>
                    <strong>Under evaluation</strong>
                  </div>
                  <div className="pk-settings-row">
                    <span>Live game latency</span>
                    <strong>Not measured</strong>
                  </div>
                </section>
                <section>
                  <span className="pk-eyebrow">ABOUT THIS BUILD</span>
                  <h2>A preview you can explore</h2>
                  <p>
                    Sample games and server labels demonstrate the design.
                    Selection, custom entries, imports, and preferences live in
                    browser memory and reset on reload.
                  </p>
                  <button
                    className="pk-button"
                    onClick={() => window.location.reload()}
                  >
                    Reset preview
                  </button>
                </section>
              </div>
            )}
            <footer className="pk-main-footer">
              <span>
                PROXYKING <span>/</span> GAME ACCELERATOR
              </span>
              <span>Independent setup. Explicit selection.</span>
            </footer>
          </main>
          <aside className="pk-session" aria-label="Session configuration">
            <div className="pk-session-header">
              <span>
                <Radio size={15} /> YOUR SESSION
              </span>
              <span className="pk-offline">
                <span /> Offline
              </span>
            </div>
            <div className="pk-session-body">
              <div className="pk-session-title">
                <h2>Set your route.</h2>
                <p>A server. Your selected apps.</p>
              </div>
              <label
                className="pk-server-picker-label"
                htmlFor="pk-server-picker"
              >
                01 <span>CHOOSE A SERVER</span>
              </label>
              <div className="pk-server-picker">
                <Globe2 size={20} />
                <select
                  id="pk-server-picker"
                  value={serverId}
                  onChange={(event) => setServerId(event.target.value)}
                >
                  {servers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
              <div className="pk-selected-server-meta">
                <span>{server?.type.toUpperCase()}</span>
                <span>
                  {server?.origin === "example" ? "Example" : "Imported label"}
                </span>
              </div>
              <button
                className="pk-import-link"
                onClick={() => setShowImport(true)}
              >
                <FileUp size={14} /> Import Clash config{" "}
                <ArrowRight size={13} />
              </button>
              <div className="pk-session-divider" />
              <div className="pk-targets-label">
                <span>
                  02 <strong>SELECT YOUR APPS</strong>
                </span>
                <span>{targets.length.toString().padStart(2, "0")}</span>
              </div>
              <div className="pk-session-targets">
                {targets.length ? (
                  targets.map((target) => (
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
                        aria-label={`Remove ${target.name} from session`}
                        onClick={() =>
                          setSelection((previous) =>
                            previous.filter(
                              (item) =>
                                !selectedTargets(entries, [item]).some(
                                  (entry) =>
                                    executableKey(entry.path) ===
                                    executableKey(target.path),
                                ),
                            ),
                          )
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="pk-session-empty">
                    <Crosshair size={25} />
                    <p>No apps selected</p>
                    <small>
                      Choose a game from your library
                      <br />
                      to build your session.
                    </small>
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
              <div className="pk-session-metrics">
                <div>
                  <Signal size={15} />
                  <span>Server latency</span>
                  <strong>
                    — <small>ms</small>
                  </strong>
                </div>
                <div>
                  <ArrowDownToLine size={15} />
                  <span>Session traffic</span>
                  <strong>
                    — <small>MB</small>
                  </strong>
                </div>
              </div>
              <p className="pk-unmeasured">
                No measurements in browser preview
              </p>
              <button
                className="pk-start"
                disabled
                title="Native routing must pass the coexistence release gate before acceleration is enabled."
              >
                <Power size={18} /> Start acceleration <ArrowRight size={17} />
              </button>
              <p className="pk-start-note">
                Native acceleration is not enabled in this preview.
              </p>
            </div>
            <div className="pk-isolation-note">
              <span className="pk-isolation-icon">
                <ShieldCheck size={20} />
              </span>
              <div>
                <strong>Clash Verge stays yours</strong>
                <p>This preview never reads or changes its configuration.</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
      {showImport && (
        <ImportDialog close={() => setShowImport(false)} add={addImport} />
      )}
      {showAdd && (
        <AddExecutable
          close={() => setShowAdd(false)}
          existing={entries}
          add={(entry) => {
            setEntries((previous) => [...previous, entry]);
            setPage("library");
            setFilter("processes");
            setQuery("");
            setLauncherFilter("all");
          }}
        />
      )}
      {scope && (
        <LauncherDialog
          id={scope}
          entries={entries}
          selection={selection}
          close={() => setScope(null)}
          save={setSelection}
        />
      )}
      {details && (
        <Modal title={details.title} close={() => setDetails(null)}>
          <p className="pk-muted">
            {details.custom
              ? "Custom executable. This path has not been verified."
              : "Example executable path. No installation was detected."}
          </p>
          <div className="pk-path">
            <Monitor size={17} />
            <code>{details.path}</code>
          </div>
          <p className="pk-small pk-muted">
            Selection applies to all instances at this full path. Child
            processes are excluded.
          </p>
          <div className="pk-modal-actions">
            {details.custom && (
              <button
                className="pk-button pk-danger"
                onClick={() => {
                  setEntries((previous) =>
                    previous.filter((entry) => entry.id !== details.id),
                  );
                  setSelection((previous) =>
                    previous.filter((entry) => entry.id !== details.id),
                  );
                  setDetails(null);
                }}
              >
                <Trash2 size={15} /> Remove entry
              </button>
            )}
            <button
              className="pk-button pk-primary"
              onClick={() => {
                toggle(details.id);
                setDetails(null);
              }}
            >
              {isSelected(details.id)
                ? "Deselect executable"
                : "Select executable"}
            </button>
          </div>
        </Modal>
      )}
      {review && (
        <Modal
          title="Review your selection"
          close={() => setReview(false)}
          wide
        >
          <p className="pk-muted">
            These are the paths represented by your selection. Sample entries do
            not point to detected installations.
          </p>
          <div className="pk-review-targets">
            {targets.map((target) => (
              <div key={executableKey(target.path)}>
                <strong>{target.name}</strong>
                <code>{target.path}</code>
                <small>
                  {target.includeChildren
                    ? "Includes child processes · broader scope"
                    : "Exact executable path · all instances"}
                </small>
              </div>
            ))}
          </div>
          <div className="pk-callout">
            <ShieldCheck size={18} />
            <span>
              Live routing and Clash coexistence are still under evaluation. No
              application traffic is routed by this preview.
            </span>
          </div>
          <div className="pk-modal-actions">
            <button
              className="pk-button pk-primary"
              onClick={() => setReview(false)}
            >
              Done <Check size={15} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
