import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Dialog } from "./Dialog";
import { importProfiles } from "../lib/profiles";
import { importClashProfiles } from "../lib/clash-profiles";
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
  const [report, setReport] = useState<ClashProfiles | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      title="Import servers"
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      <p className="pk-muted">
        Paste share links or your Clash YAML. Supported servers are copied into
        ProxyKing; Clash settings and files stay untouched.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          setBusy(true);
          try {
            if (/^\s*(ss|vless|trojan|https?|socks5):\/\//i.test(text)) {
              await save(importProfiles(text));
              close();
            } else setReport(importClashProfiles(text));
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Could not import this configuration.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="pk-field">
          Configuration or share links
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setReport(null);
              setError("");
            }}
            rows={9}
            maxLength={512 * 1024}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            required
          />
        </label>
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
          Saved with Windows account encryption. No subscription URL is fetched.
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
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Could not save servers.",
                  );
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
              Inspect / import
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
