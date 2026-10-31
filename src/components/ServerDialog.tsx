import { useState } from "react";
import type { FormEvent } from "react";
import { LockKeyhole, Plus, Loader2 } from "lucide-react";
import { createManualProfile } from "../lib/profiles";
import { isDesktop } from "../lib/backend";
import type { Profile } from "../types";
import { Dialog } from "./Dialog";

export function ServerDialog({
  close,
  save,
}: {
  close: () => void;
  save: (profiles: Profile[]) => Promise<void>;
}) {
  const [protocol, setProtocol] = useState<"http" | "socks">("socks");
  const [name, setName] = useState("");
  const [server, setServer] = useState("");
  const [port, setPort] = useState("1080");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tls, setTls] = useState(false);
  const [serverName, setServerName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (!/^\d+$/.test(port))
        throw new Error("Enter a port between 1 and 65535.");
      const profile = createManualProfile({
        name,
        protocol,
        server,
        port: Number(port),
        username,
        password,
        tls: protocol === "http" && tls,
        serverName: protocol === "http" && tls ? serverName : undefined,
      });
      await save([profile]);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Add proxy server"
      close={() => {
        if (!busy) close();
      }}
    >
      <p className="muted">
        Use a proxy server address and credentials from your provider.
      </p>
      <form onSubmit={submit} className="server-form">
        <div className="form-grid">
          <label>
            Protocol
            <select
              value={protocol}
              onChange={(event) => {
                const next = event.target.value as "http" | "socks";
                setProtocol(next);
                if (port === "1080" || port === "8080")
                  setPort(next === "socks" ? "1080" : "8080");
              }}
            >
              <option value="socks">SOCKS5</option>
              <option value="http">HTTP / HTTPS</option>
            </select>
          </label>
          <label>
            Name <span className="optional">optional</span>
            <input
              autoComplete="off"
              maxLength={200}
              placeholder="My proxy server"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </div>
        <div className="form-grid server-address">
          <label>
            Server address
            <input
              autoFocus
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="proxy.example.com or IP address"
              value={server}
              onChange={(event) => setServer(event.target.value)}
            />
          </label>
          <label>
            Port
            <input
              required
              inputMode="numeric"
              value={port}
              onChange={(event) => setPort(event.target.value)}
              maxLength={5}
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Username <span className="optional">optional</span>
            <input
              autoComplete="off"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Password <span className="optional">optional</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        </div>
        {protocol === "http" && (
          <>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={tls}
                onChange={(event) => setTls(event.target.checked)}
              />
              Use TLS to connect to this proxy (HTTPS)
            </label>
            {tls && (
              <label className="standalone-label">
                TLS server name <span className="optional">optional</span>
                <input
                  placeholder="Defaults to server address"
                  autoComplete="off"
                  spellCheck={false}
                  value={serverName}
                  onChange={(event) => setServerName(event.target.value)}
                />
              </label>
            )}
            <p className="muted small">
              HTTP proxies support TCP connections. Use SOCKS5 or a supported
              VPN profile if you need UDP.
            </p>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <p className="privacy-note">
          <LockKeyhole size={15} />
          {isDesktop
            ? "Credentials are encrypted for your Windows account."
            : "Browser preview only. Profiles are held in memory."}
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
            Add server
          </button>
        </div>
      </form>
    </Dialog>
  );
}
