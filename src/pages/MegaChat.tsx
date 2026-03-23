import { useEffect, useRef, useState } from "react";
import { useChatStore, DAILY_TOKEN_LIMIT } from "../stores/chatStore";
import { useIdentityStore } from "../stores/identityStore";
import { cn } from "../lib/utils";
import {
  MessageCircle,
  Send,
  Loader2,
  Trash2,
  AlertCircle,
  ChevronDown,
  Bot,
  User,
  Zap,
  ShieldOff,
} from "lucide-react";

export function MegaChat() {
  const {
    messages,
    loading,
    error,
    usage,
    debugEnabled,
    sendMessage,
    clearChat,
    fetchUsage,
    fetchDebug,
    loadHistory,
  } = useChatStore();

  const isBanned = useIdentityStore((s) => s.isBanned);

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchUsage();
    fetchDebug();
    loadHistory();
  }, [fetchUsage, fetchDebug, loadHistory]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Track scroll position for "scroll to bottom" button
  const handleScroll = () => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowScrollBtn(!nearBottom);
  };

  const handleSend = () => {
    if (!input.trim() || loading) return;
    sendMessage(input);
    setInput("");
    // Refocus input
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const usagePercent = usage
    ? Math.min(100, (usage.total_tokens / DAILY_TOKEN_LIMIT) * 100)
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-500/15 flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">MegaChat</h1>
            <p className="text-[11px] text-zinc-500">AI Assistant powered by Claude</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Debug: usage stats */}
          {debugEnabled && usage && (
            <div className="flex items-center gap-2 text-[10px] text-zinc-500">
              <Zap className="w-3 h-3" />
              <span>
                {usage.total_tokens.toLocaleString()} / {DAILY_TOKEN_LIMIT.toLocaleString()} tokens
              </span>
              <div className="w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    usagePercent > 80 ? "bg-red-500" : usagePercent > 50 ? "bg-amber-500" : "bg-brand-500"
                  )}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
            </div>
          )}
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/50 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div
        ref={scrollAreaRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
      >
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-brand-500/10 flex items-center justify-center">
              <Bot className="w-8 h-8 text-brand-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-200 mb-1">G'day! I'm MegaChat</h2>
              <p className="text-sm text-zinc-500 max-w-md">
                Ask me anything about Valheim — items, creatures, biomes, recipes, mod configs,
                troubleshooting, or your character data. I've got context from your MegaLoad setup.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {[
                "What are the best foods for the Plains?",
                "How do I configure MegaQoL auto-repair?",
                "What bosses do I still need to defeat?",
                "Explain the fermenter recipes",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q);
                    inputRef.current?.focus();
                  }}
                  className="px-3 py-2 rounded-lg text-xs text-zinc-400 bg-zinc-800/50 hover:bg-zinc-700/50 hover:text-zinc-200 transition-colors border border-zinc-700/50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex gap-3",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-lg bg-brand-500/15 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-4 h-4 text-brand-400" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[75%] rounded-xl px-4 py-3 text-sm leading-relaxed",
                msg.role === "user"
                  ? "bg-brand-500/15 text-zinc-200"
                  : "glass border border-zinc-800/50 text-zinc-300"
              )}
            >
              {msg.role === "assistant" ? (
                <div
                  className="prose prose-invert prose-sm max-w-none [&_pre]:bg-zinc-900 [&_pre]:rounded-lg [&_pre]:p-3 [&_code]:text-brand-400 [&_a]:text-brand-400"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
              {/* Debug: per-message token info */}
              {debugEnabled && msg.inputTokens !== undefined && (
                <div className="mt-2 pt-2 border-t border-zinc-700/50 text-[10px] text-zinc-600 flex items-center gap-2">
                  <Zap className="w-2.5 h-2.5" />
                  {msg.inputTokens}in / {msg.outputTokens}out
                </div>
              )}
            </div>
            {msg.role === "user" && (
              <div className="w-7 h-7 rounded-lg bg-zinc-700/50 flex items-center justify-center shrink-0 mt-0.5">
                <User className="w-4 h-4 text-zinc-400" />
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="flex gap-3 justify-start">
            <div className="w-7 h-7 rounded-lg bg-brand-500/15 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-brand-400" />
            </div>
            <div className="glass border border-zinc-800/50 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Thinking...
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
          <button
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-zinc-800 border border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 shadow-lg transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            Scroll to bottom
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="px-5 py-3 border-t border-zinc-800/50">
        {isBanned ? (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <ShieldOff className="w-5 h-5 text-red-400 shrink-0" />
            <p className="text-sm text-red-300">
              Your account has been suspended. Contact support if you believe this is in error.
            </p>
          </div>
        ) : (
        <>
        <div className="flex gap-3 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask MegaChat anything about Valheim..."
            rows={1}
            className="flex-1 resize-none rounded-xl bg-zinc-800/50 border border-zinc-700/50 px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500/50 transition-colors"
            style={{ maxHeight: 120, minHeight: 44 }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className={cn(
              "flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-200",
              input.trim() && !loading
                ? "bg-brand-500 hover:bg-brand-400 text-zinc-950 shadow-lg shadow-brand-500/20"
                : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
            )}
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
        <p className="text-[10px] text-zinc-600 mt-1.5 text-center">
          Shift+Enter for new line &middot; Enter to send
        </p>
        </>
        )}
      </div>
    </div>
  );
}

/** Lightweight markdown → HTML for assistant messages */
function renderMarkdown(text: string): string {
  let html = text
    // Escape HTML
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    })
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-zinc-200 mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h3 class="text-base font-semibold text-zinc-200 mt-3 mb-1">$1</h3>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // Line breaks
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");

  return `<p>${html}</p>`;
}
