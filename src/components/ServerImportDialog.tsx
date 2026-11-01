import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Dialog } from "./Dialog";
import { backend } from "../lib/backend";
import {
  inspectServerImport,
  isYamlDownloadUrl,
  serverImportError,
} from "../lib/server-import";
import type { ImportSource } from "../lib/server-import";
import type { ClashProfiles } from "../lib/clash-profiles";
import type { Profile } from "../types";

export function ServerImportDialog({
  close,
  save,
}: {
  close: () => void;
  save: (profiles: Profile[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<ImportSource>("auto");
  const [report, setReport] = useState<ClashProfiles | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const downloading = source === "url" || isYamlDownloadUrl(text);
  return (
    <Dialog
      title="Import servers"
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      <p className="pk-muted">
        Paste share links, Clash YAML, or an HTTP/HTTPS YAML URL.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          setBusy(true);
          try {
            const result = await inspectServerImport(
              text,
              source,
              backend.fetchYaml,
            );
            if (result.kind === "links") {
              await save(result.profiles);
              close();
            } else setReport(result.report);
          } catch (err) {
            setError(
              serverImportError(err, "Could not import this configuration."),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div
          className="pk-tabs pk-import-sources"
          role="group"
          aria-label="Import source"
        >
          {(["auto", "url"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={source === value ? "active" : ""}
              aria-pressed={source === value}
              disabled={busy}
              onClick={() => {
                setSource(value);
                setReport(null);
                setError("");
              }}
            >
              {value === "auto" ? "Paste / file" : "YAML URL"}
            </button>
          ))}
        </div>
        <label className="pk-field">
          {source === "url"
            ? "YAML download URL"
            : "Configuration, share links, or YAML URL"}
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setReport(null);
              setError("");
            }}
            rows={source === "url" ? 3 : 9}
            maxLength={source === "url" ? 8192 : 512 * 1024}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            required
            aria-describedby="import-source-help"
          />
        </label>
        <p id="import-source-help" className="pk-small pk-muted">
          {downloading
            ? "Download once and review servers before importing. The URL is not saved."
            : "Paste the YAML contents or choose a local file. Download URLs are detected automatically; direct HTTP/SOCKS proxy links need an explicit port."}
        </p>
        {downloading && /^\s*http:\/\//i.test(text) && (
          <p className="pk-callout" role="note">
            HTTP is unencrypted. The link and server credentials can be read or
            changed in transit. Use HTTPS if available.
          </p>
        )}
        <button
          type="button"
          className="pk-button pk-file-button"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          <FileUp size={15} /> Choose YAML / text file
        </button>
        <input
          ref={file}
          type="file"
          hidden
          accept=".yaml,.yml,.txt"
          onChange={async (event) => {
            const chosen = event.target.files?.[0];
            if (!chosen) return;
            setReport(null);
            if (chosen.size > 512 * 1024) {
              setError("Choose a file smaller than 512 KB.");
              return;
            }
            setBusy(true);
            try {
              setText(await chosen.text());
              setSource("auto");
              setError("");
            } catch {
              setError("Could not read this file.");
            } finally {
              setBusy(false);
            }
          }}
        />
        {report && (
          <div className="pk-import-report">
            <strong>{report.profiles.length} supported servers ready</strong>
            <p>
              {report.skipped} unsupported, invalid, or incompatible entries
              excluded. VMess, Hysteria, TUIC, plugins, and unsupported node
              options cannot be imported in this version.
            </p>
            <p>
              {report.externalProviders} external providers were not fetched.
              Export a self-contained proxies list from Clash.
            </p>
            <p>
              ProxyKing uses individual servers, not imported group logic or
              routing rules. TUN, DNS, ports, controllers, and scripts are
              excluded.
            </p>
          </div>
        )}
        {error && (
          <p className="pk-error" role="alert">
            {error}
          </p>
        )}
        <p className="pk-small pk-muted">
          Saved servers use Windows account encryption. Downloads use your
          current network. External providers and imported routing settings are
          never applied.
        </p>
        <div className="pk-modal-actions">
          <button
            className="pk-button"
            type="button"
            onClick={close}
            disabled={busy}
          >
            Cancel
          </button>
          {report ? (
            <button
              type="button"
              className="pk-button pk-primary"
              disabled={busy || !report.profiles.length}
              onClick={async () => {
                setBusy(true);
                try {
                  await save(report.profiles);
                  close();
                } catch (err) {
                  setError(serverImportError(err, "Could not save servers."));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Import {report.profiles.length} supported servers
            </button>
          ) : (
            <button
              className="pk-button pk-primary"
              disabled={busy || !text.trim()}
            >
              {busy
                ? downloading
                  ? "Downloading…"
                  : "Inspecting…"
                : downloading
                  ? "Download & inspect"
                  : "Inspect / import"}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
