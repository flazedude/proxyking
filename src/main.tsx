import React from "react";
import ReactDOM from "react-dom/client";
import App from "./AcceleratorApp";
import "./styles.css";
import "./accelerator/preview.css";
import "./native.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
