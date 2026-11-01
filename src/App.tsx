import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  Check,
  CheckCircle2,
  Copy,
  Crown,
  Minus,
  Square,
  FileUp,
  Globe2,
  Loader2,
  LockKeyhole,
  Network,
  Pencil,
  Plus,
  Power,
  Search,
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
} from "./lib/profiles";
import type {
  AppSettings,
  LogEntry,
  Profile,
  RoutingMode,
  SavedState,
} from "./types";

type Page = "overview" | "processes" | "activity" | "settings";
const navigation = [
  { id: "overview" as const, label: "Connection" },
  { id: "processes" as const, label: "Processes" },
  { id: "activity" as const, label: "Activity" },
  { id: "settings" as const, label: "Settings" },
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
      <p className="muted">One share link per line.</p>
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
            <FileUp size={16} /> Import file
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
          {isDesktop ? "Windows account encryption." : "Preview: memory only."}
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
            Import
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
            <h2>Connection settings</h2>
          </div>
          <Network size={21} />
        </div>
        <div className="setting-row">
          <div>
            <h3>Routing mode</h3>
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
              ? "Administrator required. Other processes go direct; DNS stays with Windows."
              : draft.routingMode === "system"
                ? "Uses Windows proxy settings. Restored on disconnect."
                : "Configure each app to use the local HTTP/SOCKS5 proxy."}
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
          <Check size={16} /> Save
        </button>
      </form>
      <div className="panel settings-panel">
        <div className="section-heading">
          <div>
            <h2>About</h2>
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
    if (loadError) throw new Error("Resolve the storage error before saving.");
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
    if (!unique.length) throw new Error("Profiles already added.");
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
        text: `TCP reachable: ${result.latencyMs} ms. Credentials untested.`,
      });
    } catch (err) {
      setLatencies((items) => ({ ...items, [profile.id]: "failed" }));
      setNotice({ text: errorMessage(err), error: true });
    } finally {
      setTesting(null);
    }
  }
  async function windowAction(action: "minimize" | "maximize" | "close") {
    if (!isDesktop) return;
    try {
      const window = getCurrentWindow();
      if (action === "minimize") await window.minimize();
      if (action === "maximize") await window.toggleMaximize();
      if (action === "close") await window.close();
    } catch (err) {
      setNotice({ text: errorMessage(err), error: true });
    }
  }
  const connectDisabled =
    (!connected && !selected) ||
    busy ||
    !loaded ||
    !!loadError ||
    (!!selected && !connected && (!isDesktop || !status.engineAvailable));
  return (
    <div className="app-shell">
      <header className="window-titlebar" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          <Crown size={17} /> ProxyKing
        </span>
        <div className="window-controls">
          <button
            aria-label="Minimize window"
            disabled={!isDesktop}
            onClick={() => void windowAction("minimize")}
          >
            <Minus size={15} />
          </button>
          <button
            aria-label="Maximize or restore window"
            disabled={!isDesktop}
            onClick={() => void windowAction("maximize")}
          >
            <Square size={13} />
          </button>
          <button
            aria-label="Close window"
            disabled={!isDesktop || busy}
            onClick={() => void windowAction("close")}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="app-toolbar">
        <button
          className="button primary"
          disabled={connectDisabled}
          onClick={() => void connect()}
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Power size={15} />}
          {connected ? "Disconnect" : "Connect"}
        </button>
        <span className="toolbar-separator" />
        <button
          className="button secondary"
          disabled={locked}
          onClick={() => setShowServer(true)}
        >
          <Plus size={15} /> Add server
        </button>
        <button
          className="button secondary"
          disabled={locked}
          onClick={() => setShowImport(true)}
        >
          <FileUp size={15} /> Import
        </button>
        <AppUpdater
          disabled={busy || !loaded || !!loadError}
          onBegin={() => setBusy(true)}
          disconnect={async () => setStatus(await backend.disconnect())}
          onEnd={() => setBusy(false)}
        />
      </div>
      <main className="xp-workspace">
        <aside className="profile-master" aria-label="Profiles">
          <h2>Profiles</h2>
          <div className="search-field">
            <Search size={14} />
            <input
              aria-label="Search profiles"
              placeholder="Search profiles"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="profile-list">
            {filteredProfiles.map((profile) => (
              <div
                className={`profile-row ${profile.id === selected?.id ? "selected" : ""}`}
                key={profile.id}
              >
                <button
                  className="profile-select"
                  disabled={locked}
                  aria-pressed={profile.id === selected?.id}
                  onClick={() => void select(profile)}
                >
                  <Globe2 size={19} />
                  <span>
                    <strong>{profile.name}</strong>
                    <small>{formatProtocol(profile.protocol)}</small>
                  </span>
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
                    <Pencil size={13} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Delete ${profile.name}`}
                    disabled={locked}
                    onClick={() => setDeleting(profile)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
            {!filteredProfiles.length && (
              <p className="empty-profiles">
                {query ? "No matching profiles." : "No profiles."}
              </p>
            )}
          </div>
          <p className="profile-count">
            {data.profiles.length} profile
            {data.profiles.length === 1 ? "" : "s"}
          </p>
        </aside>
        <div className="workspace-detail">
          <nav className="page-tabs" aria-label="Main navigation">
            {navigation.map((item) => (
              <button
                key={item.id}
                className={page === item.id ? "active" : ""}
                aria-current={page === item.id ? "page" : undefined}
                onClick={() => setPage(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="content">
            {!isDesktop && (
              <div className="preview-banner">
                Browser preview. Connections are disabled; profiles are
                temporary.
              </div>
            )}
            {loadError && (
              <div className="alert error" role="alert">
                Could not load profiles: {loadError}
                <button
                  className="button secondary"
                  onClick={() => window.location.reload()}
                >
                  Retry
                </button>
              </div>
            )}
            {status.error && (
              <div className="alert error" role="alert">
                {status.error}
                <button
                  className="button secondary"
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
              </div>
            )}
            {page === "overview" && (
              <>
                <div className="profile-heading">
                  <Network size={31} />
                  <div>
                    <h1>{selected?.name || "Connection"}</h1>
                    <p>
                      {selected
                        ? formatProtocol(selected.protocol)
                        : "Add a server to connect."}
                    </p>
                  </div>
                </div>
                <section className="panel">
                  <div className="section-heading">
                    <h2>Connection</h2>
                  </div>
                  <dl className="details-list">
                    <div>
                      <dt>Status</dt>
                      <dd>
                        <span
                          className={`mini-dot ${connected ? "available" : ""}`}
                        />
                        {status.state === "connecting"
                          ? "Connecting"
                          : connected
                            ? "Proxy running"
                            : status.state === "error"
                              ? "Error"
                              : "Disconnected"}
                      </dd>
                    </div>
                    <div>
                      <dt>Server</dt>
                      <dd className="mono">
                        {selected ? endpoint(selected) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Security</dt>
                      <dd>{selected ? getProfileSecurity(selected) : "—"}</dd>
                    </div>
                    <div>
                      <dt>Routing</dt>
                      <dd>{modeLabel(activeMode)}</dd>
                    </div>
                    <div>
                      <dt>Local proxy</dt>
                      <dd className="mono">
                        127.0.0.1:
                        {connected ? status.localPort : data.settings.localPort}
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
                      <dt>Engine</dt>
                      <dd>
                        {status.engineAvailable
                          ? "Ready"
                          : isDesktop
                            ? "Unavailable"
                            : "Desktop only"}
                      </dd>
                    </div>
                  </dl>
                  <div className="panel-actions">
                    <span className="muted small">
                      {selected && latencies[selected.id] === "failed"
                        ? "Unreachable"
                        : selected && typeof latencies[selected.id] === "number"
                          ? `${latencies[selected.id]} ms · TCP only`
                          : "TCP reachability only."}
                    </span>
                    <button
                      className="button secondary"
                      disabled={
                        !isDesktop || !selected || testing !== null || busy
                      }
                      onClick={() => selected && void test(selected)}
                    >
                      {testing ? (
                        <Loader2 className="spin" size={14} />
                      ) : (
                        <Signal size={14} />
                      )}
                      Test server
                    </button>
                  </div>
                </section>
                <section className="panel">
                  <div className="section-heading">
                    <h2>Selected processes</h2>
                    <button
                      className="button secondary"
                      onClick={() => setPage("processes")}
                    >
                      Edit
                    </button>
                  </div>
                  {data.settings.selectedProcesses.length ? (
                    <div className="summary-processes">
                      {data.settings.selectedProcesses.map((target) => (
                        <div key={target.path}>
                          <strong>{target.name}</strong>
                          <span>
                            {target.includeChildren
                              ? "Includes children"
                              : "Selected"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="panel-footnote">No processes selected.</p>
                  )}
                  <p className="panel-footnote">
                    {activeMode === "processes"
                      ? "Other processes go direct. Windows DNS is unchanged."
                      : modeLabel(activeMode)}
                  </p>
                </section>
              </>
            )}
            {page === "processes" && (
              <ProcessRouting
                targets={data.settings.selectedProcesses}
                mode={data.settings.routingMode}
                disabled={locked}
                isElevated={status.isElevated}
                inheritedProcesses={status.inheritedProcesses}
                save={async (targets) =>
                  persist({
                    ...data,
                    settings: { ...data.settings, selectedProcesses: targets },
                  })
                }
                enable={async () =>
                  persist({
                    ...data,
                    settings: {
                      ...data.settings,
                      routingMode: "processes",
                      systemProxy: false,
                    },
                  })
                }
                restart={restartElevated}
              />
            )}
            {page === "settings" && (
              <SettingsPanel
                settings={data.settings}
                disabled={locked}
                save={async (settings) => {
                  await persist({ ...data, settings });
                  setNotice({ text: "Settings saved." });
                  record("Connection settings updated.");
                }}
                engineVersion={status.engineVersion}
                engineAvailable={status.engineAvailable}
              />
            )}
            {page === "activity" && (
              <section className="panel activity-panel">
                <div className="section-heading">
                  <h2>Session activity</h2>
                  <button
                    className="button secondary"
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
                    <Trash2 size={14} />
                    Clear
                  </button>
                </div>
                <div className="activity-controls">
                  <label className="logging-checkbox">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="Usage logging"
                      checked={data.settings.usageLogging}
                      disabled={busy || !loaded || !!loadError}
                      onChange={async (event) => {
                        const enabled = event.target.checked;
                        try {
                          await persist({
                            ...data,
                            settings: {
                              ...data.settings,
                              usageLogging: enabled,
                            },
                          });
                        } catch (err) {
                          setNotice({ text: errorMessage(err), error: true });
                        }
                      }}
                    />
                    Usage logging
                  </label>
                  <p role="status">
                    {!isDesktop
                      ? "Available in the Windows app."
                      : !data.settings.usageLogging
                        ? "Logging off."
                        : !connected
                          ? "Disconnected. Connect to record."
                          : !data.settings.selectedProcesses.length
                            ? "No processes selected."
                            : "Recording selected processes and included children."}
                  </p>
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
                  <p className="empty-profiles">No activity.</p>
                )}
              </section>
            )}
          </div>
        </div>
      </main>
      <footer className="statusbar">
        <span aria-live="polite">
          {connected
            ? "Proxy running"
            : status.state === "connecting"
              ? "Connecting"
              : "Disconnected"}
        </span>
        <span>
          {modeLabel(activeMode)} · 127.0.0.1:
          {connected ? status.localPort : data.settings.localPort}
        </span>
        <span>v{appVersion}</span>
      </footer>
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
