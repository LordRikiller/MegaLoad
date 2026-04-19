import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Titlebar } from "./Titlebar";
import { Sidebar } from "./Sidebar";
import { IdentityGate } from "./IdentityGate";
import { ToastContainer } from "../ToastContainer";
import { useLiveUpdateChecks } from "../../hooks/useLiveUpdateChecks";
import { useAutoSync } from "../../hooks/useAutoSync";
import { useAutoPlayerSync } from "../../hooks/useAutoPlayerSync";
import { useMegaListStore } from "../../stores/megaListStore";

export function AppShell() {
  useLiveUpdateChecks();
  useAutoSync();
  useAutoPlayerSync();

  // Hydrate MegaList blob from localStorage on app start.
  useEffect(() => {
    useMegaListStore.getState().init();
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <Titlebar />
      <IdentityGate>
        <div className="flex flex-1 min-h-0">
          <Sidebar />
          <main className="flex-1 overflow-y-auto p-6">
            <Outlet />
          </main>
        </div>
      </IdentityGate>
      <ToastContainer />
    </div>
  );
}
