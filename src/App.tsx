import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Crown,
  FileUp,
  Globe2,
  Layers,
  LayoutDashboard,
  ListFilter,
  Loader2,
  LockKeyhole,
  Monitor,
  Network,
  Pencil,
  Plus,
  Power,
  Search,
  Settings2,
  ShieldCheck,
  Signal,
  Trash2,
  X,
} from "lucide-react";
import { backend, defaultState, defaultStatus, isDesktop } from "./lib/backend";
import { Dialog } from "./components/Dialog";
import { ServerDialog } from "./components/ServerDialog";
import { ProcessRouting } from "./components/ProcessRouting";
import { AppUpdater } from "./components/AppUpdater";
import { version as appVersion } from "../package.json";
import {
  formatProtocol,
  getProfileSecurity,
  importProfiles,
  profileFingerprint,
  profileSummary,
} from "./lib/profiles";
import type {
  AppSettings,
  LogEntry,
  Profile,
  RoutingMode,
  SavedState,
} from "./types";

type Page = "overview" | "profiles" | "processes" | "activity" | "settings";
const navigation = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "profiles" as const, label: "Profiles", icon: Layers },
  { id: "processes" as const, label: "Processes", icon: ListFilter },
  { id: "activity" as const, label: "Activity", icon: Activity },
  { id: "settings" as const, label: "Settings", icon: Settings2 },
];
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const modeLabel = (mode: RoutingMode) =>
  mode === "processes"
    ? "Selected processes"
    : mode === "system"
      ? "System proxy"
      : "Local proxy";
const endpoint = (profile: Profile) =>
  `${profile.server.includes(":") ? `[${profile.server}]` : profile.server}:${profile.port}`;
function duration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function ImportDialog({
  close,
  onImport,
}: {
  close: () => void;
  onImport: (profiles: Profile[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onImport(importProfiles(text));
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Import profiles"
      close={() => {
        if (!busy) close();
      }}
    >
      <p className="muted">
        Paste the share links from your provider, one per line.
      </p>
      <div className="protocol-pills">
        <span>Shadowsocks</span>
        <span>VLESS</span>
        <span>Trojan</span>
        <span>HTTP</span>
        <span>SOCKS5</span>
      </div>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="profile-links">
          Profile links
        </label>
        <textarea
          id="profile-links"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"vless://…\ntrojan://…\nss://…\nsocks5://server:1080"}
          rows={7}
          required
          maxLength={300000}
        />
        <div className="file-row">
          <button
            className="text-button"
            type="button"
            onClick={() => file.current?.click()}
          >
            <FileUp size={16} /> Import a .txt file
          </button>
          <span>Share links only</span>
        </div>
        <input
          hidden
          ref={file}
          type="file"
          accept=".txt,text/plain"
          onChange={async (e) => {
            const selected = e.target.files?.[0];
            if (!selected) return;
            if (selected.size > 300000) {
              setError("Choose a text file smaller than 300 KB.");
              return;
            }
            try {
              setText(await selected.text());
              setError("");
            } catch {
              setError("Could not read this file.");
            }
          }}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <p className="privacy-note">
          <LockKeyhole size={15} />{" "}
          {isDesktop
            ? "Saved credentials are encrypted for your Windows account."
            : "Preview profiles stay in memory and clear when you reload."}
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            onClick={close}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="button primary" disabled={!text.trim() || busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}{" "}
            Import profiles
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function SettingsPanel({
  settings,
  disabled,
  save,
  engineVersion,
  engineAvailable,
}: {
  settings: AppSettings;
  disabled: boolean;
  save: (settings: AppSettings) => Promise<void>;
  engineVersion: string | null;
  engineAvailable: boolean;
}) {
  const [draft, setDraft] = useState(settings);
  const [port, setPort] = useState(String(settings.localPort));
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(settings);
    setPort(String(settings.localPort));
  }, [settings]);
  const changed =
    draft.routingMode !== settings.routingMode ||
    port !== String(settings.localPort);
  return (
    <div className="settings-grid">
      <form
        className="panel settings-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          const value = Number(port);
          if (!/^\d+$/.test(port) || value < 1024 || value > 65535) {
            setError("Choose a port between 1024 and 65535.");
            return;
          }
          try {
            await save({ ...draft, localPort: value });
            setError("");
          } catch (err) {
            setError(errorMessage(err));
          }
        }}
      >
        <div className="section-heading">
          <div>
            <h2>Connection preferences</h2>
            <p>Make ProxyKing work your way.</p>
          </div>
          <Network size={21} />
        </div>
        <div className="setting-row">
          <div>
            <h3>Routing mode</h3>
            <p>Choose which apps use your selected server.</p>
          </div>
          <select
            aria-label="Routing mode"
            disabled={disabled}
            value={draft.routingMode}
            onChange={(event) =>
              setDraft({
                ...draft,
                routingMode: event.target.value as RoutingMode,
                systemProxy: event.target.value === "system",
              })
            }
          >
            <option value="processes">Selected processes only</option>
            <option value="system">Windows system proxy</option>
            <option value="local">Local proxy · manual setup</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <h3>Local proxy port</h3>
            <p>HTTP and SOCKS5 on 127.0.0.1.</p>
          </div>
          <input
            className="port-input"
            aria-label="Local proxy port"
            inputMode="numeric"
            value={port}
            disabled={disabled}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>
        <div className="setting-note">
          <ShieldCheck size={18} />
          <p>
            {draft.routingMode === "processes"
              ? "Choose apps on the Processes page. Administrator access is required. Other processes go direct; DNS stays with Windows."
              : draft.routingMode === "system"
                ? "Apps that honor Windows proxy settings use the server. Your previous proxy settings are restored on disconnect."
                : "Configure individual apps to use the local HTTP/SOCKS5 listener. Windows proxy settings stay unchanged."}
          </p>
        </div>
        {disabled && (
          <p className="muted small">
            Disconnect before changing connection preferences.
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={disabled || !changed}>
          <Check size={16} /> Save preferences
        </button>
      </form>
      <div className="panel settings-panel">
        <div className="section-heading">
          <div>
            <h2>Made for your desktop</h2>
            <p>ProxyKing for Windows · {appVersion}</p>
          </div>
          <Crown size={23} />
        </div>
        <dl className="details-list">
          <div>
            <dt>Connection engine</dt>
            <dd>sing-box</dd>
          </div>
          <div>
            <dt>Engine version</dt>
            <dd>{engineVersion || "—"}</dd>
          </div>
          <div>
            <dt>Engine status</dt>
            <dd className={engineAvailable ? "green-text" : ""}>
              {engineAvailable
                ? "Available"
                : isDesktop
                  ? "Unavailable"
                  : "Desktop only"}
            </dd>
          </div>
          <div>
            <dt>Profile storage</dt>
            <dd>{isDesktop ? "Windows encryption" : "Preview memory"}</dd>
          </div>
          <div>
            <dt>On window close</dt>
            <dd>Disconnect and quit</dd>
          </div>
        </dl>
        <div className="roadmap">
          <span className="eyebrow">WHAT’S NEXT</span>
          <h3>One app. More places.</h3>
          <p>
            macOS, then Android, then iOS. Each platform will get its own native
            network integration.
          </p>
          <div>
            <span className="current-platform">Windows</span>
            <ChevronRight size={13} />
            <span>macOS</span>
            <ChevronRight size={13} />
            <span>Android</span>
            <ChevronRight size={13} />
            <span>iOS</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [data, setData] = useState<SavedState>(defaultState);
  const [status, setStatus] = useState(defaultStatus);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEpoch = useRef(0);
  const [appLogs, setAppLogs] = useState<LogEntry[]>([]);
  const [latencies, setLatencies] = useState<Record<string, number | "failed">>(
    {},
  );
  const [testing, setTesting] = useState<string | null>(null);
  const [rename, setRename] = useState<Profile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [now, setNow] = useState(Date.now());
  const connected = status.state === "connected";
  const activeMode = connected ? status.routingMode : data.settings.routingMode;
  const locked =
    busy ||
    connected ||
    status.state === "connecting" ||
    !loaded ||
    !!loadError;
  const selected = data.profiles.find(
    (p) => p.id === (connected ? status.profileId : data.selectedProfileId),
  );
  const filteredProfiles = data.profiles.filter((p) =>
    `${p.name} ${p.server} ${p.protocol}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const allLogs = [...appLogs, ...logs].sort(
    (a, b) => b.timestamp - a.timestamp,
  );

  useEffect(() => {
    let alive = true;
    Promise.all([backend.load(), backend.status(), backend.logs()])
      .then(([saved, runtime, entries]) => {
        if (alive) {
          setData(saved);
          setStatus(runtime);
          setLogs(entries);
        }
      })
      .catch((err) => {
        if (alive) setLoadError(errorMessage(err));
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    let polling = false;
    const timer = setInterval(async () => {
      if (alive) setNow(Date.now());
      if (!isDesktop || polling) return;
      polling = true;
      const epoch = logsEpoch.current;
      try {
        const [runtime, entries] = await Promise.all([
          backend.status(),
          backend.logs(),
        ]);
        if (alive) {
          setStatus(runtime);
          if (epoch === logsEpoch.current) setLogs(entries);
        }
      } catch (err) {
        if (alive)
          setNotice({
            text: `Could not read connection status: ${errorMessage(err)}`,
            error: true,
          });
      } finally {
        polling = false;
      }
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  function record(message: string) {
    setAppLogs((items) => [
      ...items.slice(-199),
      { timestamp: Date.now(), level: "info", message },
    ]);
  }
  async function persist(next: SavedState) {
    if (loadError)
      throw new Error(
        "Resolve the profile storage error before saving changes.",
      );
    setBusy(true);
    try {
      await backend.save(next);
      setData(next);
    } finally {
      setBusy(false);
    }
  }
  async function addProfiles(imported: Profile[]) {
    const fingerprints = new Set(data.profiles.map(profileFingerprint));
    const unique = imported.filter((p) => {
      const key = profileFingerprint(p);
      if (fingerprints.has(key)) return false;
      fingerprints.add(key);
      return true;
    });
    if (!unique.length)
      throw new Error("These profiles are already in your library.");
    await persist({
      ...data,
      profiles: [...data.profiles, ...unique],
      selectedProfileId: data.selectedProfileId || unique[0].id,
    });
    const message = `Imported ${unique.length} profile${unique.length === 1 ? "" : "s"}${unique.length < imported.length ? `; skipped ${imported.length - unique.length} duplicate(s)` : ""}.`;
    setNotice({ text: message });
    record(message);
  }
  async function connect() {
    if (!selected && !connected) {
      setShowServer(true);
      return;
    }
    if (!connected && data.settings.routingMode === "processes") {
      if (!data.settings.selectedProcesses.length || !status.isElevated) {
        setPage("processes");
        setNotice({
          text: !data.settings.selectedProcesses.length
            ? "Add the processes you want to tunnel before connecting."
            : "Restart ProxyKing as administrator to start selected-process routing.",
          error: true,
        });
        return;
      }
    }
    setBusy(true);
    try {
      const result = connected
        ? await backend.disconnect()
        : await backend.connect(selected!, data.settings);
      setStatus(result);
    } catch (err) {
      setNotice({ text: errorMessage(err), error: true });
    } finally {
      setBusy(false);
    }
  }
  async function restartElevated() {
    setBusy(true);
    try {
      await backend.restartElevated();
    } finally {
      setBusy(false);
    }
  }
  async function select(profile: Profile) {
    try {
      await persist({ ...data, selectedProfileId: profile.id });
    } catch (err) {
      setNotice({ text: errorMessage(err), error: true });
    }
  }
  async function test(profile: Profile) {
    setTesting(profile.id);
    try {
      const result = await backend.test(profile);
      setLatencies((items) => ({ ...items, [profile.id]: result.latencyMs }));
      setNotice({
        text: `Server reachable in ${result.latencyMs} ms. This TCP check does not verify credentials.`,
      });
    } catch (err) {
      setLatencies((items) => ({ ...items, [profile.id]: "failed" }));
      setNotice({ text: errorMessage(err), error: true });
    } finally {
      setTesting(null);
    }
  }
  const profilesPanel = (
    <section className="panel profiles-panel">
      <div className="section-heading">
        <div className="section-title">
          <h2>Your profiles</h2>
          <span className="count">{data.profiles.length}</span>
        </div>
        <div className="header-actions">
          <button
            className="button primary small-button"
            disabled={locked}
            onClick={() => setShowServer(true)}
          >
            <Plus size={16} /> Add server
          </button>
          <button
            className="button secondary small-button"
            disabled={locked}
            onClick={() => setShowImport(true)}
          >
            <FileUp size={16} /> Import profiles
          </button>
        </div>
      </div>
      {data.profiles.length > 0 ? (
        <>
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search profiles"
              placeholder="Search by name, server, or protocol…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="profile-table">
            <div className="table-heading">
              <span>PROFILE / SERVER</span>
              <span>PROTOCOL</span>
              <span>TCP LATENCY</span>
              <span />
            </div>
            {filteredProfiles.map((profile) => (
              <div
                className={`profile-row ${profile.id === data.selectedProfileId ? "selected" : ""}`}
                key={profile.id}
              >
                <button
                  className="profile-select"
                  disabled={locked}
                  onClick={() => void select(profile)}
                  aria-label={`Select ${profile.name}`}
                  aria-pressed={profile.id === data.selectedProfileId}
                >
                  <span
                    className={`selection-radio ${profile.id === data.selectedProfileId ? "checked" : ""}`}
                  />
                  <span className="server-symbol">
                    <Globe2 size={19} />
                  </span>
                  <span className="profile-name">
                    <strong>{profile.name}</strong>
                    <small title={endpoint(profile)}>{endpoint(profile)}</small>
                  </span>
                </button>
                <span className={`protocol-label protocol-${profile.protocol}`}>
                  {formatProtocol(profile.protocol)}
                </span>
                <button
                  className="latency-button"
                  title="Check TCP reachability, not authentication"
                  disabled={!isDesktop || testing !== null || busy}
                  onClick={() => void test(profile)}
                >
                  {testing === profile.id ? (
                    <Loader2 className="spin" size={14} />
                  ) : (
                    <Signal size={14} />
                  )}
                  {latencies[profile.id] === "failed"
                    ? "Unreachable"
                    : typeof latencies[profile.id] === "number"
                      ? `${latencies[profile.id]} ms`
                      : "Test"}
                </button>
                <div className="row-actions">
                  <button
                    className="icon-button"
                    aria-label={`Rename ${profile.name}`}
                    disabled={locked}
                    onClick={() => {
                      setRename(profile);
                      setRenameValue(profile.name);
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-button delete"
                    aria-label={`Delete ${profile.name}`}
                    disabled={locked}
                    onClick={() => setDeleting(profile)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
            {!filteredProfiles.length && (
              <div className="empty-search">No profiles match “{query}”.</div>
            )}
          </div>
          <div className="panel-footnote">
            <LockKeyhole size={14} />
            {isDesktop
              ? "Profiles are stored on this device with Windows account encryption."
              : "Preview only. Profiles clear when this page reloads."}
          </div>
        </>
      ) : (
        <div className="empty-profiles">
          <div className="empty-art">
            <span />
            <div>
              <Layers size={30} strokeWidth={1.4} />
            </div>
            <span />
          </div>
          <h3>A home for your connections.</h3>
          <p>
            Add an HTTP or SOCKS5 server, or import your provider’s profiles.
            <br />
            We’ll keep them organized and ready to go.
          </p>
          <button
            className="text-button"
            disabled={locked}
            onClick={() => setShowServer(true)}
          >
            Add your first server <ArrowRight size={17} />
          </button>
          <div className="supported">
            <span>SHADOWSOCKS</span>
            <i />
            <span>VLESS</span>
            <i />
            <span>TROJAN</span>
            <i />
            <span>HTTP</span>
            <i />
            <span>SOCKS5</span>
          </div>
        </div>
      )}
    </section>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          aria-label="ProxyKing home"
          onClick={(e) => {
            e.preventDefault();
            setPage("overview");
          }}
        >
          <span className="brand-icon">
            <Crown size={25} strokeWidth={1.8} />
          </span>
          <span>
            Proxy<span className="brand-king">King</span>
            <small>YOUR NETWORK. YOUR RULES.</small>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              onClick={() => setPage(item.id)}
              className={`nav-item ${page === item.id ? "active" : ""}`}
              aria-current={page === item.id ? "page" : undefined}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === "profiles" && (
                <span className="nav-count">{data.profiles.length}</span>
              )}
              {page === item.id && item.id !== "profiles" && (
                <span className="nav-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <ShieldCheck size={21} />
            <h3>Yours, by design.</h3>
            <p>Your profiles stay on your device. No account required.</p>
            <span>
              LOCAL FIRST <span />
            </span>
          </div>
          <div className="app-version">
            <Monitor size={16} />
            <span>Windows preview</span>
            <span>v{appVersion}</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{navigation.find((n) => n.id === page)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="platform-badge">
              <Monitor size={14} /> WINDOWS
            </span>
            <span className="avatar">
              <Crown size={17} />
            </span>
          </div>
        </header>
        <div className="content">
          <AppUpdater
            disabled={busy || !loaded || !!loadError}
            onBegin={() => setBusy(true)}
            disconnect={async () => {
              setStatus(await backend.disconnect());
            }}
            onEnd={() => setBusy(false)}
          />
          {!isDesktop && (
            <div className="preview-banner">
              <Monitor size={15} />
              <span>
                Browser preview · Open the Windows app to connect. Profiles here
                are temporary.
              </span>
            </div>
          )}
          {loadError && (
            <div className="alert error" role="alert">
              <span>Could not load your saved profiles: {loadError}</span>
              <button
                className="text-button"
                onClick={() => window.location.reload()}
              >
                Retry
              </button>
            </div>
          )}
          {status.error && (
            <div className="alert error" role="alert">
              <span>{status.error}</span>
              {isDesktop && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setStatus(await backend.disconnect());
                    } catch (err) {
                      setNotice({ text: errorMessage(err), error: true });
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Retry cleanup
                </button>
              )}
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "overview"
                  ? "A LITTLE MORE FREEDOM"
                  : "YOUR NETWORK, IN FOCUS"}
              </div>
              <h1>
                {page === "overview"
                  ? "Your connection, in command."
                  : page === "profiles"
                    ? "A place for every connection."
                    : page === "processes"
                      ? "Only the apps you choose."
                      : page === "activity"
                        ? "Behind the connection."
                        : "Make yourself at home."}
              </h1>
              <p>
                {page === "overview"
                  ? "A clear view of your network. Everything right where you need it."
                  : page === "profiles"
                    ? "Import, organize, and choose where you connect."
                    : page === "processes"
                      ? "Choose executable files to tunnel through your selected proxy server."
                      : page === "activity"
                        ? "Connection events from this session, without your credentials."
                        : "Simple controls for the way you connect."}
              </p>
            </div>
            {page === "overview" && (
              <span className="build-tag">
                EARLY ACCESS <span>01</span>
              </span>
            )}
          </div>
          {page === "overview" && (
            <>
              <div className="scope-summary">
                <ListFilter size={19} />
                <div>
                  <strong>{modeLabel(activeMode)}</strong>
                  <span>
                    {activeMode === "processes"
                      ? `${data.settings.selectedProcesses.length} selected executable${data.settings.selectedProcesses.length === 1 ? "" : "s"} · other processes go direct`
                      : "Choose selected-process mode to tunnel only specific apps."}
                  </span>
                </div>
                <button
                  className="text-button"
                  onClick={() => setPage("processes")}
                >
                  Manage processes <ArrowRight size={16} />
                </button>
              </div>
              <div className="connection-grid">
                <section
                  className={`connection-card ${connected ? "is-connected" : ""}`}
                >
                  <svg
                    className="orbital-art"
                    viewBox="0 0 420 330"
                    aria-hidden="true"
                  >
                    <g fill="none" stroke="currentColor" strokeWidth=".8">
                      <circle cx="290" cy="150" r="115" />
                      <circle cx="290" cy="150" r="145" />
                      <circle cx="290" cy="150" r="180" />
                      <ellipse cx="290" cy="150" rx="55" ry="115" />
                      <ellipse cx="290" cy="150" rx="90" ry="115" />
                      <path d="M175 150h230M184 105h212M185 195h210M215 63q75 20 150 0M215 236q75-20 150 0" />
                      <path d="M66 240Q230 250 349 59" strokeDasharray="4 7" />
                    </g>
                    <circle cx="198" cy="219" r="6" fill="currentColor" />
                    <circle cx="349" cy="59" r="4" fill="currentColor" />
                  </svg>
                  <div className="connection-status">
                    <span className={`status-dot ${connected ? "live" : ""}`} />
                    {busy
                      ? "WORKING…"
                      : connected
                        ? "PROXY RUNNING"
                        : "DISCONNECTED"}
                    <span className="connection-mode">
                      {modeLabel(activeMode)}
                    </span>
                  </div>
                  <div className="connection-main">
                    <div>
                      <h2>
                        {connected ? (
                          <>
                            A connection.
                            <br />
                            On your terms.
                          </>
                        ) : (
                          <>
                            Ready when
                            <br />
                            you are.
                          </>
                        )}
                      </h2>
                      <p>
                        {connected
                          ? `Running with ${selected?.name || "your selected profile"}.`
                          : selected
                            ? `${selected.name} is selected and ready.`
                            : "Your next connection starts with a profile."}
                      </p>
                    </div>
                    <button
                      className={`power-button ${connected ? "powered" : ""}`}
                      aria-label={
                        connected
                          ? "Disconnect proxy"
                          : selected
                            ? "Connect proxy"
                            : "Add a server to connect"
                      }
                      onClick={() => void connect()}
                      disabled={
                        busy ||
                        !loaded ||
                        !!loadError ||
                        (!!selected &&
                          !connected &&
                          (!isDesktop || !status.engineAvailable))
                      }
                    >
                      {busy ? (
                        <Loader2 size={34} className="spin" />
                      ) : (
                        <Power size={34} strokeWidth={1.6} />
                      )}
                    </button>
                  </div>
                  <div className="connection-bottom">
                    <div className="connection-hint">
                      <span className="tiny-icon">
                        <Network size={17} />
                      </span>
                      <span>
                        {connected ? (
                          <>
                            <strong>
                              {activeMode === "processes"
                                ? "Selected-process tunnel"
                                : status.systemProxy
                                  ? "Windows proxy enabled"
                                  : "Local listener enabled"}
                            </strong>
                            <small>127.0.0.1:{status.localPort}</small>
                          </>
                        ) : (
                          <>
                            <strong>
                              {selected
                                ? formatProtocol(selected.protocol)
                                : "Let’s get you set up"}
                            </strong>
                            <small>
                              {selected
                                ? endpoint(selected)
                                : "Add a server to begin"}
                            </small>
                          </>
                        )}
                      </span>
                    </div>
                    <button
                      className="card-action"
                      disabled={
                        busy ||
                        !loaded ||
                        !!loadError ||
                        (!!selected &&
                          !connected &&
                          (!isDesktop || !status.engineAvailable))
                      }
                      onClick={() => void connect()}
                    >
                      {connected
                        ? "Disconnect"
                        : selected
                          ? "Connect"
                          : "Get started"}
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                </section>
                <section className="panel details-panel">
                  <div className="section-heading">
                    <h2>Connection details</h2>
                    <span className="details-icon">
                      <Network size={17} />
                    </span>
                  </div>
                  <dl className="details-list">
                    <div>
                      <dt>Active profile</dt>
                      <dd>{connected ? selected?.name : "Not connected"}</dd>
                    </div>
                    <div>
                      <dt>Protocol</dt>
                      <dd>
                        {selected ? formatProtocol(selected.protocol) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Session time</dt>
                      <dd className="mono">
                        {connected && status.connectedAt
                          ? duration(now - status.connectedAt)
                          : "00:00:00"}
                      </dd>
                    </div>
                    <div>
                      <dt>Local endpoint</dt>
                      <dd className="mono">
                        127.0.0.1:
                        {connected ? status.localPort : data.settings.localPort}
                      </dd>
                    </div>
                    <div>
                      <dt>Connection engine</dt>
                      <dd>
                        <span
                          className={`mini-dot ${status.engineAvailable ? "available" : ""}`}
                        />
                        {status.engineAvailable
                          ? "Ready"
                          : isDesktop
                            ? "Unavailable"
                            : "Desktop only"}
                      </dd>
                    </div>
                  </dl>
                  <div className="details-footer">
                    <span>
                      {connected
                        ? "Server authentication occurs when traffic flows."
                        : "A fresh start. Connect when you’re ready."}
                    </span>
                  </div>
                </section>
              </div>
              <div className="quick-stats">
                <div>
                  <span className="stat-icon">
                    <Layers size={19} />
                  </span>
                  <div>
                    <span>Saved profiles</span>
                    <strong>
                      {data.profiles.length.toString().padStart(2, "0")}
                      <small>in your library</small>
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="stat-icon">
                    <ShieldCheck size={19} />
                  </span>
                  <div>
                    <span>Routing mode</span>
                    <strong>
                      {modeLabel(activeMode)}
                      <small>
                        {activeMode === "processes"
                          ? "Other processes direct"
                          : data.settings.systemProxy
                            ? "Proxy-aware apps"
                            : "Manual app setup"}
                      </small>
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="stat-icon">
                    <LockKeyhole size={18} />
                  </span>
                  <div>
                    <span>Profile storage</span>
                    <strong>
                      {isDesktop ? "On this device" : "Preview session"}
                      <small>
                        {isDesktop
                          ? "Encrypted with Windows"
                          : "In memory only"}
                      </small>
                    </strong>
                  </div>
                </div>
              </div>
              {profilesPanel}
              <div className="getting-started">
                <span className="eyebrow">
                  THREE STEPS TO YOUR NEXT CONNECTION
                </span>
                <div>
                  {[
                    {
                      number: "01",
                      icon: ArrowDownToLine,
                      title: "Bring your profiles",
                      text: "Add a proxy server or import a share link.",
                    },
                    {
                      number: "02",
                      icon: Globe2,
                      title: "Choose your apps",
                      text: "Select executables on the Processes page.",
                    },
                    {
                      number: "03",
                      icon: Power,
                      title: "Make the connection",
                      text: "Start your proxy with a single click.",
                    },
                  ].map((step) => (
                    <div className="setup-step" key={step.number}>
                      <span className="step-number">{step.number}</span>
                      <div>
                        <h3>{step.title}</h3>
                        <p>{step.text}</p>
                      </div>
                      <step.icon size={18} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {page === "profiles" && (
            <>
              {profilesPanel}
              {selected && (
                <div className="selected-info">
                  <CheckCircle2 size={19} />
                  <span>
                    <strong>{selected.name}</strong> is selected ·{" "}
                    {profileSummary(selected)} · {getProfileSecurity(selected)}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => setPage("overview")}
                  >
                    Overview <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
          {page === "processes" && (
            <ProcessRouting
              targets={data.settings.selectedProcesses}
              mode={data.settings.routingMode}
              disabled={locked}
              isElevated={status.isElevated}
              inheritedProcesses={status.inheritedProcesses}
              save={async (targets) => {
                await persist({
                  ...data,
                  settings: { ...data.settings, selectedProcesses: targets },
                });
              }}
              enable={async () => {
                await persist({
                  ...data,
                  settings: {
                    ...data.settings,
                    routingMode: "processes",
                    systemProxy: false,
                  },
                });
              }}
              restart={restartElevated}
            />
          )}
          {page === "settings" && (
            <SettingsPanel
              settings={data.settings}
              disabled={locked}
              save={async (settings) => {
                await persist({ ...data, settings });
                setNotice({ text: "Preferences saved." });
                record("Connection preferences updated.");
              }}
              engineVersion={status.engineVersion}
              engineAvailable={status.engineAvailable}
            />
          )}
          {page === "activity" && (
            <section className="panel activity-panel">
              <div className="section-heading">
                <div>
                  <h2>Session activity</h2>
                  <p>
                    Newest first. Recent history stays in memory until cleared
                    or the app closes.
                  </p>
                </div>
                <button
                  className="button secondary small-button"
                  disabled={busy || !allLogs.length}
                  onClick={async () => {
                    try {
                      logsEpoch.current += 1;
                      await backend.clearLogs();
                      logsEpoch.current += 1;
                      setLogs([]);
                      setAppLogs([]);
                    } catch (err) {
                      setNotice({ text: errorMessage(err), error: true });
                    }
                  }}
                >
                  <Trash2 size={15} /> Clear
                </button>
              </div>
              <div className="activity-controls">
                <div>
                  <h3>Usage logging</h3>
                  <p id="usage-logging-description">
                    Record observed app connections, destination addresses and
                    ports, and Proxy or Direct routing. No page URLs, traffic
                    contents, or credentials are recorded. Very short
                    connections may be missed; app names may be unavailable.
                  </p>
                  <p>
                    {isDesktop
                      ? data.settings.usageLogging
                        ? "Logging is on. Existing connections may appear when logging starts."
                        : "Logging is off. Existing history is kept; Clear removes it."
                      : "Browser preview only. Usage is recorded in the Windows app."}
                  </p>
                </div>
                <div className="activity-toggle">
                  <span>{data.settings.usageLogging ? "On" : "Off"}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-label="Usage logging"
                    aria-checked={data.settings.usageLogging}
                    aria-describedby="usage-logging-description"
                    className={`toggle ${data.settings.usageLogging ? "on" : ""}`}
                    disabled={busy || !loaded || !!loadError}
                    onClick={async () => {
                      try {
                        await persist({
                          ...data,
                          settings: {
                            ...data.settings,
                            usageLogging: !data.settings.usageLogging,
                          },
                        });
                      } catch (err) {
                        setNotice({ text: errorMessage(err), error: true });
                      }
                    }}
                  >
                    <span />
                  </button>
                </div>
              </div>
              {allLogs.length ? (
                <div className="log-list">
                  {allLogs.map((log, index) => (
                    <div
                      className="log-entry"
                      key={`${log.timestamp}-${index}`}
                    >
                      <span className={`log-level ${log.level}`}>
                        {log.level}
                      </span>
                      <time>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </time>
                      <span>{log.message}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-profiles">
                  <span className="empty-activity">
                    <Activity size={31} />
                  </span>
                  <h3>A quiet network moment.</h3>
                  <p>
                    Connection events appear here as you use ProxyKing. Turn on
                    usage logging to also see observed app connections.
                  </p>
                </div>
              )}
            </section>
          )}
          <footer className="footer">
            <span>
              <span className="mini-dot available" /> Built for a more open
              connection.
            </span>
            <button onClick={() => setPage("settings")}>
              ProxyKing for Windows <ArrowUpRight size={13} />
            </button>
          </footer>
        </div>
      </main>
      {notice && (
        <div
          className={`toast ${notice.error ? "error-toast" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? <Activity size={18} /> : <CheckCircle2 size={18} />}
          <span>{notice.text}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {showImport && (
        <ImportDialog
          close={() => setShowImport(false)}
          onImport={addProfiles}
        />
      )}
      {showServer && (
        <ServerDialog close={() => setShowServer(false)} save={addProfiles} />
      )}
      {rename && (
        <Dialog
          title="Rename profile"
          close={() => {
            if (!busy) setRename(null);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await persist({
                  ...data,
                  profiles: data.profiles.map((p) =>
                    p.id === rename.id ? { ...p, name: renameValue.trim() } : p,
                  ),
                });
                setRename(null);
              } catch (err) {
                setNotice({ text: errorMessage(err), error: true });
              }
            }}
          >
            <label className="field-label" htmlFor="profile-name">
              Profile name
            </label>
            <input
              className="text-input"
              id="profile-name"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={100}
              required
            />
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setRename(null)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy || !renameValue.trim()}
              >
                Save name
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {deleting && (
        <Dialog
          title="Delete profile?"
          close={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <p className="muted">
            Remove <strong>{deleting.name}</strong> from this device? You can
            import the share link again later.
          </p>
          <div className="dialog-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Keep profile
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                try {
                  const profiles = data.profiles.filter(
                    (p) => p.id !== deleting.id,
                  );
                  await persist({
                    ...data,
                    profiles,
                    selectedProfileId:
                      data.selectedProfileId === deleting.id
                        ? profiles[0]?.id || null
                        : data.selectedProfileId,
                  });
                  setDeleting(null);
                  record("A profile was removed.");
                } catch (err) {
                  setNotice({ text: errorMessage(err), error: true });
                }
              }}
            >
              Delete profile
            </button>
          </div>
        </Dialog>
      )}
      {page === "settings" && connected && (
        <button
          className="floating-copy button secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                `127.0.0.1:${status.localPort}`,
              );
              setNotice({ text: "Local proxy endpoint copied." });
            } catch {
              setNotice({
                text: "Could not access the clipboard.",
                error: true,
              });
            }
          }}
        >
          <Copy size={16} /> Copy endpoint
        </button>
      )}
    </div>
  );
}
