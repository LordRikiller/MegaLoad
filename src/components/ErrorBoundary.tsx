import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { logFromFrontend } from "../lib/tauri-api";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

// Catches render-time exceptions in the route subtree so a single bad page
// doesn't white-screen the whole shell. Stack lands in megaload.log
// (ungated — render crashes are always serious enough to record).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    const stack = (error.stack || error.message).split("\n").slice(0, 8).join(" | ");
    const compStack = (info.componentStack || "").split("\n").slice(0, 6).join(" | ");
    logFromFrontend(`UI ERROR ${error.name}: ${error.message} | stack: ${stack} | component: ${compStack}`).catch(() => {
      console.error("[ErrorBoundary] failed to log to backend", error);
    });
  }

  reset = () => this.setState({ error: null, info: null });

  render() {
    if (!this.state.error) return this.props.children;
    const { error, info } = this.state;
    return (
      <div className="flex flex-col items-start gap-4 p-6 max-w-3xl">
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="w-5 h-5" />
          <h2 className="text-lg font-semibold">This page crashed</h2>
        </div>
        <p className="text-sm text-zinc-400">
          MegaLoad caught the error so the rest of the app keeps working. The full stack
          has been written to <code className="text-zinc-300">megaload.log</code>.
        </p>
        <div className="w-full glass rounded-lg border border-red-900/40 p-3 text-xs font-mono text-red-300 whitespace-pre-wrap break-words">
          <div className="font-semibold mb-1">{error.name}: {error.message}</div>
          {error.stack && (
            <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap">{error.stack}</pre>
          )}
          {info?.componentStack && (
            <pre className="text-[11px] text-zinc-500 mt-2 whitespace-pre-wrap">{info.componentStack}</pre>
          )}
        </div>
        <button
          onClick={this.reset}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg glass border border-zinc-700 text-sm text-zinc-200 hover:border-brand-500/50 hover:text-brand-300 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Try again
        </button>
      </div>
    );
  }
}
