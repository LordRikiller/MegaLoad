import { Outlet } from "react-router-dom";
import { Titlebar } from "./Titlebar";
import { Sidebar } from "./Sidebar";
import { IdentityGate } from "./IdentityGate";
import { ToastContainer } from "../ToastContainer";
import { useLiveUpdateChecks } from "../../hooks/useLiveUpdateChecks";

export function AppShell() {
  useLiveUpdateChecks();

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
