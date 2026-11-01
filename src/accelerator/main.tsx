import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { AcceleratorPreview } from "./AcceleratorPreview";
import "./preview.css";
import "../native.css";

// This entry point must never become a second native connection surface.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isTauri() ? (
      <p className="native-unavailable">
        Open this design preview in a browser. Native acceleration is not
        enabled here.
      </p>
    ) : (
      <AcceleratorPreview />
    )}
  </React.StrictMode>,
);
