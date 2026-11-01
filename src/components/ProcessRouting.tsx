import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  FolderCode,
  ListFilter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { backend, isDesktop } from "../lib/backend";
import type {
  ProcessTarget,
  RoutingMode,
  RunningProcess,
  RuntimeStatus,
} from "../types";
import { Dialog } from "./Dialog";

const keyFor = (path: string) => path.toLowerCase();
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
interface ProcessGroup extends Omit<ProcessTarget, "includeChildren"> {
  pids: number[];
}

function ProcessPicker({
  targets,
  close,
  save,
}: {
  targets: ProcessTarget[];
  close: () => void;
  save: (targets: ProcessTarget[]) => Promise<void>;
}) {
  const [processes, setProcesses] = useState<RunningProcess[]>([]);
  const [selection, setSelection] = useState(
    new Map(targets.map((target) => [keyFor(target.path), target])),
  );
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setProcesses(await backend.processes());
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let alive = true;
    backend
      .processes()
      .then((result) => {
        if (alive) setProcesses(result);
      })
      .catch((err) => {
        if (alive) setError(message(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  const groups = new Map<string, ProcessGroup>();
  for (const process of processes) {
    const key = keyFor(process.path);
    const existing = groups.get(key);
    if (existing) existing.pids.push(process.pid);
    else
      groups.set(key, {
        name: process.name,
        path: process.path,
        pids: [process.pid],
      });
  }
  const query = search.toLowerCase();
  const visible = [...groups.values()]
    .filter((group) =>
      `${group.name} ${group.path} ${group.pids.join(" ")}`
        .toLowerCase()
        .includes(query),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Dialog
      title="Add from running processes"
      wide
      close={() => {
        if (!saving) close();
      }}
    >
      <p className="muted">
        Select executable files to send through your chosen proxy. Selection
        applies to all instances, including future launches.
      </p>
      <div className="process-toolbar">
        <div className="search-field">
          <Search size={17} />
          <input
            aria-label="Search running processes"
            placeholder="Search name, PID, or executable path…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button
          className="button secondary small-button"
          disabled={loading || saving}
          onClick={() => void refresh()}
          aria-label="Refresh process list"
        >
          <RefreshCw size={16} className={loading ? "spin" : undefined} />
          Refresh
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="process-picker-list" aria-busy={loading}>
        {loading ? (
          <div className="process-empty">
            <Loader2 className="spin" size={22} />
            Reading running processes…
          </div>
        ) : visible.length ? (
          visible.map((process) => (
            <label
              className={`process-option ${selection.has(keyFor(process.path)) ? "chosen" : ""}`}
              key={keyFor(process.path)}
            >
              <input
                type="checkbox"
                aria-label={`Select ${process.name} at ${process.path}`}
                checked={selection.has(keyFor(process.path))}
                disabled={saving}
                onChange={(event) =>
                  setSelection((previous) => {
                    const next = new Map(previous);
                    if (event.target.checked)
                      next.set(keyFor(process.path), {
                        name: process.name,
                        path: process.path,
                        includeChildren: false,
                      });
                    else next.delete(keyFor(process.path));
                    return next;
                  })
                }
              />
              <FolderCode size={21} />
              <span>
                <strong>{process.name}</strong>
                <small>{process.path}</small>
                <em>PID {process.pids.join(", ")}</em>
              </span>
            </label>
          ))
        ) : (
          <div className="process-empty">
            {error
              ? "Process list unavailable."
              : search
                ? "No processes match your search."
                : "No accessible processes found. Start the app you want to add, then refresh."}
          </div>
        )}
      </div>
      <p className="muted small">
        Child processes are opt-in. Protected processes may be unavailable.
      </p>
      <div className="dialog-actions">
        <span className="selection-total">
          {selection.size} executable{selection.size === 1 ? "" : "s"} selected
        </span>
        <button className="button secondary" disabled={saving} onClick={close}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={saving || loading}
          onClick={async () => {
            setSaving(true);
            setError("");
            try {
              await save([...selection.values()]);
              close();
            } catch (err) {
              setError(message(err));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <Check size={16} />
          )}
          Save selection
        </button>
      </div>
    </Dialog>
  );
}

export function ProcessRouting({
  targets,
  mode,
  disabled,
  isElevated,
  inheritedProcesses,
  save,
  enable,
  restart,
}: {
  targets: ProcessTarget[];
  mode: RoutingMode;
  disabled: boolean;
  isElevated: boolean;
  inheritedProcesses: RuntimeStatus["inheritedProcesses"];
  save: (targets: ProcessTarget[]) => Promise<void>;
  enable: () => Promise<void>;
  restart: () => Promise<void>;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState("");
  async function attempt(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (err) {
      setError(message(err));
    }
  }
  return (
    <>
      <div className="process-mode-banner">
        <span className="stat-icon">
          <ListFilter size={21} />
        </span>
        <div>
          <h2>
            {mode === "processes"
              ? "Selected-process routing"
              : "Selected-process routing off"}
          </h2>
          <p>
            {mode === "processes"
              ? "Other processes go direct."
              : "Enable to proxy the selected processes."}
          </p>
        </div>
        {mode !== "processes" && (
          <button
            className="button primary"
            disabled={disabled}
            onClick={() => void attempt(enable)}
          >
            Use selected processes
            <ArrowRight size={15} />
          </button>
        )}
      </div>
      {isDesktop && !isElevated && (
        <div className="elevation-banner">
          <ShieldCheck size={21} />
          <div>
            <strong>Administrator access required.</strong>
            <p>Approve the Windows prompt, then connect.</p>
          </div>
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() => void attempt(restart)}
          >
            Restart as administrator
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <section className="panel selected-processes">
        <div className="section-heading">
          <div className="section-title">
            <h2>Selected processes</h2>
            <span className="count">{targets.length}</span>
          </div>
          <button
            className="button primary small-button"
            disabled={disabled || !isDesktop}
            onClick={() => setShowPicker(true)}
          >
            <Plus size={16} />
            Add from process list
          </button>
        </div>
        {targets.length ? (
          <div className="process-targets">
            {targets.map((target) => (
              <div className="process-target" key={keyFor(target.path)}>
                <span className="server-symbol">
                  <FolderCode size={21} />
                </span>
                <div>
                  <strong>{target.name}</strong>
                  <small>{target.path}</small>
                  <label className="include-children">
                    <input
                      type="checkbox"
                      checked={target.includeChildren}
                      disabled={disabled}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        void attempt(() =>
                          save(
                            targets.map((item) =>
                              keyFor(item.path) === keyFor(target.path)
                                ? { ...item, includeChildren: checked }
                                : item,
                            ),
                          ),
                        );
                      }}
                    />
                    Include child processes
                  </label>
                </div>
                <span className="target-route">
                  {mode === "processes"
                    ? "Via selected proxy"
                    : "Saved rule · inactive"}
                </span>
                <button
                  className="icon-button delete"
                  disabled={disabled}
                  aria-label={`Remove ${target.name}`}
                  onClick={() =>
                    void attempt(() =>
                      save(
                        targets.filter(
                          (item) => keyFor(item.path) !== keyFor(target.path),
                        ),
                      ),
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-profiles">
            <h3>No processes selected.</h3>
            <p>Start an app, then add its process.</p>
            <button
              className="text-button"
              disabled={disabled || !isDesktop}
              onClick={() => setShowPicker(true)}
            >
              Add processes <ArrowRight size={16} />
            </button>
          </div>
        )}
        <div className="panel-footnote">
          <ShieldCheck size={15} />
          Rules match executable paths, not temporary process IDs.
        </div>
      </section>
      {targets.some((target) => target.includeChildren) && (
        <section className="panel inherited-processes">
          <div className="section-heading">
            <div>
              <h2>
                Automatically included children{" "}
                <span className="count">{inheritedProcesses.length}</span>
              </h2>
              <p>Detected while connected.</p>
            </div>
          </div>
          {inheritedProcesses.length ? (
            <div className="process-targets">
              {inheritedProcesses.map((child) => (
                <div className="process-target" key={keyFor(child.path)}>
                  <FolderCode size={19} />
                  <div>
                    <strong>{child.name}</strong>
                    <small>{child.path}</small>
                    <small>
                      From{" "}
                      {targets.find(
                        (target) =>
                          keyFor(target.path) === keyFor(child.launcherPath),
                      )?.name || "selected launcher"}
                    </small>
                  </div>
                  <span className="target-route">Auto included</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="child-discovery-note">No child processes detected.</p>
          )}
          <p className="child-discovery-note">
            Discovery can be delayed; initial connections may go direct. Add
            service-launched apps explicitly.
          </p>
        </section>
      )}
      <p className="panel-footnote">
        Windows DNS is unchanged. Unidentified processes go direct.
      </p>
      {showPicker && (
        <ProcessPicker
          targets={targets}
          close={() => setShowPicker(false)}
          save={save}
        />
      )}
    </>
  );
}
