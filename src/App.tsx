import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { startValheimDataPoll, stopValheimDataPoll } from "./lib/valheimDataLoader";
import { Dashboard } from "./pages/Dashboard";
import { Mods } from "./pages/Mods";
import { Browse } from "./pages/Browse";
import { ConfigEditor } from "./pages/ConfigEditor";
import { Profiles } from "./pages/Profiles";
import { Settings } from "./pages/Settings";
import { LogViewer } from "./pages/LogViewer";
import { Trainer } from "./pages/Trainer";
import { ValheimData } from "./pages/ValheimData";
import { PlayerData } from "./pages/PlayerData";
import { Cart } from "./pages/Cart";
import { MegaList } from "./pages/MegaList";
import { MegaListDetail } from "./pages/MegaListDetail";
import { MegaBugs } from "./pages/MegaBugs";
import { MegaChat } from "./pages/MegaChat";
import { AdminPanel } from "./pages/AdminPanel";

function App() {
  // Remote Valheim data: fire an immediate fetch, then poll every 15 min.
  // Cleanup tears the timer down on unmount (in practice only fires in dev).
  useEffect(() => {
    startValheimDataPoll();
    return () => stopValheimDataPoll();
  }, []);

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/mods" element={<Mods />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/config" element={<ConfigEditor />} />
        <Route path="/trainer" element={<Trainer />} />
        <Route path="/valheim-data" element={<ValheimData />} />
        <Route path="/player-data" element={<PlayerData />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/megalist" element={<MegaList />} />
        <Route path="/megalist/:id" element={<MegaListDetail />} />
        <Route path="/bugs" element={<MegaBugs />} />
        <Route path="/chat" element={<MegaChat />} />
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="/logs" element={<LogViewer />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default App;
