import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { bootstrapValheimData } from "./lib/valheimDataLoader";
import { bootTheme } from "./theme/apply";
import "./index.css";

// Apply the persisted biome theme's CSS variables before the first paint so
// there's no flash of the default palette.
bootTheme();

// Apply any cached Valheim dataset before the first React paint. Falls back
// to the bundled snapshot silently if no cache exists or it can't be read.
// Wraps the render so a slow/broken Tauri IPC doesn't ever block app start —
// the bootstrap itself is non-throwing.
void bootstrapValheimData().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
});
