import { useEffect, useState, useCallback } from "react";
import { useIdentityStore } from "../stores/identityStore";
import {
  adminListUsers,
  adminBanUser,
  adminUnbanUser,
  adminGetUserChatHistory,
  type AdminUserInfo,
  type ChatHistoryFile,
} from "../lib/tauri-api";
import { cn } from "../lib/utils";
import {
  Shield,
  Users,
  Loader2,
  Ban,
  CheckCircle2,
  MessageCircle,
  ArrowLeft,
  AlertCircle,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";

type View = "list" | "chat-history";

export function AdminPanel() {
  const isAdmin = useIdentityStore((s) => s.isAdmin);
  const [users, setUsers] = useState<AdminUserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [selectedUser, setSelectedUser] = useState<AdminUserInfo | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatHistoryFile | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await adminListUsers();
      // Sort: admins first, then by last_active desc
      list.sort((a, b) => {
        if (a.is_admin !== b.is_admin) return a.is_admin ? -1 : 1;
        return b.last_active.localeCompare(a.last_active);
      });
      setUsers(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin, loadUsers]);

  const handleBan = async (userId: string) => {
    setActionLoading(userId);
    try {
      await adminBanUser(userId);
      await loadUsers();
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnban = async (userId: string) => {
    setActionLoading(userId);
    try {
      await adminUnbanUser(userId);
      await loadUsers();
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const handleViewChat = async (user: AdminUserInfo) => {
    setSelectedUser(user);
    setChatHistory(null);
    setView("chat-history");
    try {
      const history = await adminGetUserChatHistory(user.user_id);
      setChatHistory(history);
    } catch {
      setChatHistory({ user_id: user.user_id, messages: [], last_updated: "" });
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <Shield className="w-10 h-10 text-red-400 mx-auto" />
          <p className="text-sm text-zinc-400">Admin access required</p>
        </div>
      </div>
    );
  }

  // Chat history view
  if (view === "chat-history" && selectedUser) {
    return (
      <div className="flex-1 flex flex-col min-h-0 animate-in">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800/50">
          <button
            onClick={() => setView("list")}
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-zinc-200">
              Chat History — {selectedUser.display_name}
            </h2>
            <p className="text-xs text-zinc-500">
              {chatHistory
                ? `${chatHistory.messages.length} messages`
                : "Loading..."}
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!chatHistory && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
            </div>
          )}
          {chatHistory && chatHistory.messages.length === 0 && (
            <p className="text-center text-sm text-zinc-500 py-8">
              No chat history found for this user.
            </p>
          )}
          {chatHistory?.messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "rounded-lg p-3 text-sm max-w-[85%]",
                msg.role === "user"
                  ? "bg-brand-500/10 border border-brand-500/20 ml-auto"
                  : "bg-zinc-800/50 border border-zinc-700/30"
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-medium text-zinc-500 uppercase">
                  {msg.role}
                </span>
                <span className="text-[10px] text-zinc-600">
                  {msg.timestamp}
                </span>
                {msg.input_tokens && (
                  <span className="text-[10px] text-zinc-600">
                    {msg.input_tokens}+{msg.output_tokens} tokens
                  </span>
                )}
              </div>
              <p className="text-zinc-300 whitespace-pre-wrap break-words leading-relaxed">
                {msg.content.length > 2000
                  ? msg.content.slice(0, 2000) + "... (truncated)"
                  : msg.content}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // User list
  return (
    <div className="flex-1 flex flex-col min-h-0 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/50">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-brand-400" />
          <div>
            <h1 className="text-base font-bold text-zinc-100">Admin Panel</h1>
            <p className="text-xs text-zinc-500">
              {users.length} registered user{users.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <button
          onClick={loadUsers}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/50 hover:bg-zinc-700/50 transition-all disabled:opacity-40"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="px-6 py-2">
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        </div>
      )}

      {loading && users.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-zinc-500 uppercase border-b border-zinc-800/50">
                <th className="text-left px-6 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Registered</th>
                <th className="text-left px-4 py-3 font-medium">Last Active</th>
                <th className="text-right px-4 py-3 font-medium">Chat Tokens</th>
                <th className="text-right px-4 py-3 font-medium">Tickets</th>
                <th className="text-right px-6 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isBanned = user.flags.includes("banned");
                return (
                  <tr
                    key={user.user_id}
                    className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors"
                  >
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        {user.is_admin ? (
                          <ShieldCheck className="w-4 h-4 text-brand-400 shrink-0" />
                        ) : (
                          <Users className="w-4 h-4 text-zinc-500 shrink-0" />
                        )}
                        <span
                          className={cn(
                            "font-medium",
                            user.is_admin
                              ? "text-brand-400"
                              : isBanned
                              ? "text-red-400 line-through"
                              : "text-zinc-200"
                          )}
                        >
                          {user.display_name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {user.is_admin ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-brand-500/10 text-brand-400 border border-brand-500/20">
                          Admin
                        </span>
                      ) : isBanned ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                          <Ban className="w-3 h-3" /> Banned
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">
                      {formatDate(user.registered_at)}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">
                      {formatDate(user.last_active)}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-400 text-xs tabular-nums">
                      {user.megachat_usage.total_tokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-400 text-xs tabular-nums">
                      {user.megabugs_tickets}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleViewChat(user)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
                          title="View chat history"
                        >
                          <MessageCircle className="w-4 h-4" />
                        </button>
                        {!user.is_admin &&
                          (isBanned ? (
                            <button
                              onClick={() => handleUnban(user.user_id)}
                              disabled={actionLoading === user.user_id}
                              className="p-1.5 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                              title="Unban user"
                            >
                              {actionLoading === user.user_id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-4 h-4" />
                              )}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleBan(user.user_id)}
                              disabled={actionLoading === user.user_id}
                              className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                              title="Ban user"
                            >
                              {actionLoading === user.user_id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Ban className="w-4 h-4" />
                              )}
                            </button>
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
