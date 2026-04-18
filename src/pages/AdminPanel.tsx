import { useEffect, useState, useCallback, useMemo } from "react";
import { useIdentityStore } from "../stores/identityStore";
import { useBugStore } from "../stores/bugStore";
import {
  adminListUsers,
  adminBanUser,
  adminUnbanUser,
  regenerateLinkCode,
  fetchTickets,
  fetchTicketDetail,
  listCollaborators,
  addCollaborator,
  removeCollaborator,
  type AdminUserInfo,
  type TicketSummary,
  type Ticket,
} from "../lib/tauri-api";
import { cn } from "../lib/utils";
import {
  Shield,
  Users,
  Loader2,
  Ban,
  MessageCircle,
  ArrowLeft,
  AlertCircle,
  ShieldCheck,
  RefreshCw,
  Search,
  Crown,
  Activity,
  Bug,
  UserX,
  UserCheck,
  Key,
  Copy,
  Check,
  Clock,
  ChevronDown,
  ChevronRight,
  Clipboard,
  ExternalLink,
  CircleDot,
} from "lucide-react";

type View = "dashboard" | "ticket-detail";

export function AdminPanel() {
  const isAdmin = useIdentityStore((s) => s.isAdmin);
  const identity = useIdentityStore((s) => s.identity);
  const [users, setUsers] = useState<AdminUserInfo[]>([]);
  const [collaboratorIds, setCollaboratorIds] = useState<Set<string>>(new Set());
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ userId: string; action: "ban" | "unban" } | null>(null);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkCodeCopied, setLinkCodeCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"users" | "tickets">("users");
  const [ticketSearch, setTicketSearch] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [copiedAI, setCopiedAI] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [userList, ticketList, collaborators] = await Promise.all([
        adminListUsers(),
        fetchTickets(), // No userId = admin sees all
        listCollaborators().catch(() => []),
      ]);
      userList.sort((a, b) => {
        if (a.is_admin !== b.is_admin) return a.is_admin ? -1 : 1;
        return b.last_active.localeCompare(a.last_active);
      });
      ticketList.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      setUsers(userList);
      setTickets(ticketList);
      setCollaboratorIds(new Set(collaborators.map((c) => c.user_id)));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadData();
      useBugStore.getState().markUsersSeen();
    }
  }, [isAdmin, loadData]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // Stats
  const stats = useMemo(() => {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const activeRecently = users.filter((u) => {
      try { return now - new Date(u.last_active).getTime() < sevenDays; } catch { return false; }
    }).length;
    const banned = users.filter((u) => u.flags.includes("banned")).length;
    const openTickets = tickets.filter((t) => t.status === "open").length;
    const totalTickets = tickets.length;
    return { total: users.length, activeRecently, banned, openTickets, totalTickets };
  }, [users, tickets]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.toLowerCase();
    return users.filter(
      (u) => u.display_name.toLowerCase().includes(q) || u.user_id.toLowerCase().includes(q)
    );
  }, [users, searchQuery]);

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    if (!ticketSearch.trim()) return tickets;
    const q = ticketSearch.toLowerCase();
    return tickets.filter(
      (t) => t.title.toLowerCase().includes(q) || t.author_name.toLowerCase().includes(q) || t.type.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
    );
  }, [tickets, ticketSearch]);

  const handleBan = async (userId: string) => {
    setActionLoading(userId);
    setConfirmAction(null);
    try {
      await adminBanUser(userId);
      await loadData();
      setToast("User banned");
    } catch (e) { setError(String(e)); }
    finally { setActionLoading(null); }
  };

  const handleUnban = async (userId: string) => {
    setActionLoading(userId);
    setConfirmAction(null);
    try {
      await adminUnbanUser(userId);
      await loadData();
      setToast("User unbanned");
    } catch (e) { setError(String(e)); }
    finally { setActionLoading(null); }
  };

  const handleToggleCollaborator = async (user: AdminUserInfo) => {
    const isCollab = collaboratorIds.has(user.user_id);
    setActionLoading(user.user_id);
    try {
      if (isCollab) {
        await removeCollaborator(user.user_id);
        setToast(`${user.display_name} is no longer a collaborator`);
      } else {
        await addCollaborator(user.user_id, user.display_name);
        setToast(`${user.display_name} promoted to collaborator`);
      }
      // Refresh the collaborator list so the UI stays in sync with the repo.
      const updated = await listCollaborators().catch(() => []);
      setCollaboratorIds(new Set(updated.map((c) => c.user_id)));
      // Also refresh the local role in case Rik is toggling himself.
      useBugStore.getState().refreshRole();
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const handleViewTicket = async (ticketId: string) => {
    setTicketLoading(true);
    setSelectedTicket(null);
    setView("ticket-detail");
    try {
      const detail = await fetchTicketDetail(ticketId);
      setSelectedTicket(detail);
    } catch (e) {
      setError(String(e));
      setView("dashboard");
    } finally {
      setTicketLoading(false);
    }
  };

  const handleSendToAI = async () => {
    if (!selectedTicket) return;
    const t = selectedTicket;
    const messages = t.messages.map((m) =>
      `[${m.author_name}${m.is_admin ? " (Admin)" : ""} — ${m.timestamp}]\n${m.text}`
    ).join("\n\n---\n\n");

    const prompt = `## MegaBugs Ticket: ${t.title}

**Type:** ${t.type} | **Status:** ${t.status} | **Author:** ${t.author_name}
**Created:** ${t.created_at} | **Updated:** ${t.updated_at}
${t.labels.length > 0 ? `**Labels:** ${t.labels.join(", ")}` : ""}

### System Info
- Mods: ${t.system_info?.installed_mods?.join(", ") ?? "N/A"}
- Profile: ${t.system_info?.profile_name ?? "N/A"}

### Conversation

${messages}

---
**Task:** Review this ${t.type} ticket and provide your analysis. If it's a bug, investigate the likely cause in the codebase. If it's a feature request, assess feasibility and suggest implementation approach.`;

    await navigator.clipboard.writeText(prompt);
    setCopiedAI(true);
    setTimeout(() => setCopiedAI(false), 2000);
    setToast("Ticket copied — paste into Claude Code");
  };

  const handleRegenLinkCode = async () => {
    try {
      const code = await regenerateLinkCode();
      setLinkCode(code);
      setToast("Link code regenerated");
    } catch (e) { setToast(`Failed: ${e}`); }
  };

  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
            <Shield className="w-8 h-8 text-red-400" />
          </div>
          <p className="text-sm text-zinc-400">Authorised personnel only</p>
        </div>
      </div>
    );
  }

  // Ticket detail view
  if (view === "ticket-detail") {
    return (
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <Toast message={toast} />
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setView("dashboard"); setSelectedTicket(null); }}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
            title="Back to dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-zinc-100">
              {selectedTicket?.title ?? "Loading..."}
            </h2>
            {selectedTicket && (
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <StatusBadge status={selectedTicket.status} />
                <span>{selectedTicket.type}</span>
                <span>by {selectedTicket.author_name}</span>
              </div>
            )}
          </div>
          {selectedTicket && (
            <button
              onClick={handleSendToAI}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 shadow-lg shadow-amber-500/20 transition-all"
            >
              {copiedAI ? <Check className="w-4 h-4" /> : <Clipboard className="w-4 h-4" />}
              {copiedAI ? "Copied!" : "Send to AI"}
            </button>
          )}
        </div>

        <div className="glass rounded-xl border border-zinc-800/50 overflow-hidden">
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-4 space-y-3">
            {ticketLoading && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
              </div>
            )}
            {selectedTicket?.messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg p-4 text-sm",
                  msg.is_admin
                    ? "bg-amber-500/5 border border-amber-500/15 ml-8"
                    : "bg-zinc-800/50 border border-zinc-700/30 mr-8"
                )}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn(
                    "text-xs font-semibold",
                    msg.is_admin ? "text-amber-400" : "text-zinc-300"
                  )}>
                    {msg.author_name}
                  </span>
                  {msg.is_admin && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-500/15 text-amber-400 border border-amber-500/20">
                      Admin
                    </span>
                  )}
                  <span className="text-[10px] text-zinc-600">{formatDate(msg.timestamp)}</span>
                </div>
                <p className="text-zinc-300 whitespace-pre-wrap break-words leading-relaxed">
                  {msg.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Main dashboard
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Toast message={toast} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/20 flex items-center justify-center">
            <Crown className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <h1 className="font-norse font-bold text-3xl text-zinc-100 tracking-wide">Command Centre</h1>
            <p className="text-sm text-amber-400/70">
              Welcome back, <span className="text-amber-400 font-semibold">{identity?.display_name}</span>
            </p>
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium text-zinc-300 glass border border-zinc-800/50 hover:border-amber-500/30 hover:text-amber-400 transition-all disabled:opacity-40"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-5 gap-3">
        <StatCard icon={Users} label="Total Users" value={stats.total} color="text-amber-400" bg="from-amber-500/15 to-amber-600/5" border="border-amber-500/10" />
        <StatCard icon={Activity} label="Active (7d)" value={stats.activeRecently} color="text-emerald-400" bg="from-emerald-500/15 to-emerald-600/5" border="border-emerald-500/10" />
        <StatCard icon={UserX} label="Banned" value={stats.banned} color="text-red-400" bg="from-red-500/15 to-red-600/5" border="border-red-500/10" />
        <StatCard icon={Bug} label="Open Tickets" value={stats.openTickets} color="text-orange-400" bg="from-orange-500/15 to-orange-600/5" border="border-orange-500/10" onClick={() => { setActiveTab("tickets"); }} />
        <StatCard icon={MessageCircle} label="Total Tickets" value={stats.totalTickets} color="text-purple-400" bg="from-purple-500/15 to-purple-600/5" border="border-purple-500/10" onClick={() => { setActiveTab("tickets"); }} />
      </div>

      {/* Admin Quick Actions */}
      <div className="glass rounded-xl p-5 border border-amber-500/10 space-y-4">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-zinc-300">Admin Tools</h2>
        </div>
        <div className="flex items-center gap-3">
          {!linkCode ? (
            <button
              onClick={handleRegenLinkCode}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
              Regenerate My Link Code
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono font-bold tracking-wider text-amber-400 bg-zinc-900/80 border border-amber-500/20 rounded-lg px-4 py-2">
                {linkCode}
              </span>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(linkCode);
                  setLinkCodeCopied(true);
                  setTimeout(() => setLinkCodeCopied(false), 2000);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {linkCodeCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {linkCodeCopied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center gap-1 bg-zinc-900/50 rounded-xl p-1 border border-zinc-800/50 w-fit">
        <button
          onClick={() => setActiveTab("users")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all",
            activeTab === "users" ? "bg-amber-500/15 text-amber-400 border border-amber-500/20" : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Users ({users.length})
        </button>
        <button
          onClick={() => setActiveTab("tickets")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all",
            activeTab === "tickets" ? "bg-amber-500/15 text-amber-400 border border-amber-500/20" : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          <Bug className="w-3.5 h-3.5" />
          Tickets ({tickets.length})
          {stats.openTickets > 0 && (
            <span className="ml-1 min-w-[18px] h-[18px] rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
              {stats.openTickets}
            </span>
          )}
        </button>
      </div>

      {/* Users Tab */}
      {activeTab === "users" && (
        <div className="glass rounded-xl border border-zinc-800/50 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/50">
            <span className="text-[10px] text-zinc-600">{filteredUsers.length} of {users.length}</span>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="bg-zinc-900/50 border border-zinc-700/50 rounded-lg pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/30 w-52"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {loading && users.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
            </div>
          ) : (
            <div className="max-h-[calc(100vh-580px)] overflow-y-auto">
              {filteredUsers.map((user) => (
                <UserRow
                  key={user.user_id}
                  user={user}
                  isExpanded={expandedUser === user.user_id}
                  onToggle={() => setExpandedUser(expandedUser === user.user_id ? null : user.user_id)}
                  isConfirming={confirmAction?.userId === user.user_id}
                  confirmAction={confirmAction}
                  actionLoading={actionLoading}
                  onBan={(id) => setConfirmAction({ userId: id, action: "ban" })}
                  onUnban={(id) => setConfirmAction({ userId: id, action: "unban" })}
                  onConfirmBan={handleBan}
                  onConfirmUnban={handleUnban}
                  onCancelConfirm={() => setConfirmAction(null)}
                  isCollaborator={collaboratorIds.has(user.user_id)}
                  onToggleCollaborator={handleToggleCollaborator}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tickets Tab */}
      {activeTab === "tickets" && (
        <div className="glass rounded-xl border border-zinc-800/50 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/50">
            <span className="text-[10px] text-zinc-600">{filteredTickets.length} of {tickets.length}</span>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="bg-zinc-900/50 border border-zinc-700/50 rounded-lg pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/30 w-52"
                placeholder="Search tickets..."
                value={ticketSearch}
                onChange={(e) => setTicketSearch(e.target.value)}
              />
            </div>
          </div>

          {loading && tickets.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <Bug className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No tickets found</p>
            </div>
          ) : (
            <div className="max-h-[calc(100vh-580px)] overflow-y-auto">
              {filteredTickets.map((ticket) => (
                <button
                  key={ticket.id}
                  onClick={() => handleViewTicket(ticket.id)}
                  className="w-full flex items-center gap-4 px-5 py-3 border-b border-zinc-800/30 last:border-0 hover:bg-zinc-800/20 transition-colors text-left"
                >
                  <StatusDot status={ticket.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-zinc-200 truncate">{ticket.title}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-medium uppercase bg-zinc-800/50 text-zinc-500 border border-zinc-700/30 shrink-0">
                        {ticket.type}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-zinc-600 mt-0.5">
                      <span>{ticket.author_name}</span>
                      <span>{formatDate(ticket.updated_at)}</span>
                      <span>{ticket.message_count} message{ticket.message_count !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────

function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed top-14 right-6 z-50 px-4 py-2.5 rounded-lg bg-amber-500/90 text-zinc-950 text-sm font-medium shadow-xl animate-in slide-in-from-top-2 duration-300">
      {message}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    closed: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
    "in-progress": "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium border", colors[status] ?? colors.open)}>
      {status}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <div className="relative shrink-0">
      <CircleDot className={cn("w-4 h-4", status === "open" ? "text-emerald-400" : status === "in-progress" ? "text-cyan-400" : "text-zinc-500")} />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, bg, border, onClick }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  color: string;
  bg: string;
  border: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn("rounded-xl p-4 bg-gradient-to-br border", bg, border, onClick && "cursor-pointer hover:brightness-110 transition-all")}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("w-4 h-4", color)} />
        <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className={cn("text-xl font-bold tabular-nums", color)}>{value}</div>
    </div>
  );
}

function DetailItem({ label, value, icon: Icon }: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
      <div>
        <div className="text-[10px] text-zinc-600 uppercase">{label}</div>
        <div className="text-xs text-zinc-300">{value}</div>
      </div>
    </div>
  );
}

function UserRow({ user, isExpanded, onToggle, isConfirming, confirmAction, actionLoading, onBan, onUnban, onConfirmBan, onConfirmUnban, onCancelConfirm, isCollaborator, onToggleCollaborator }: {
  user: AdminUserInfo;
  isExpanded: boolean;
  onToggle: () => void;
  isConfirming: boolean;
  confirmAction: { userId: string; action: "ban" | "unban" } | null;
  actionLoading: string | null;
  onBan: (id: string) => void;
  onUnban: (id: string) => void;
  onConfirmBan: (id: string) => void;
  onConfirmUnban: (id: string) => void;
  onCancelConfirm: () => void;
  isCollaborator: boolean;
  onToggleCollaborator: (user: AdminUserInfo) => void;
}) {
  const isBanned = user.flags.includes("banned");

  return (
    <div className="border-b border-zinc-800/30 last:border-0">
      <div
        className={cn("flex items-center gap-4 px-5 py-3 hover:bg-zinc-800/20 transition-colors cursor-pointer", isExpanded && "bg-zinc-800/20")}
        onClick={onToggle}
      >
        <div className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
          user.is_admin ? "bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/20"
            : isBanned ? "bg-red-500/10 border border-red-500/20"
            : "bg-zinc-800/50 border border-zinc-700/30"
        )}>
          {user.is_admin ? <Crown className="w-4 h-4 text-amber-400" /> : isBanned ? <Ban className="w-4 h-4 text-red-400" /> : <Users className="w-4 h-4 text-zinc-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("font-medium text-sm", user.is_admin ? "text-amber-400" : isBanned ? "text-red-400 line-through" : "text-zinc-200")}>
              {user.display_name}
            </span>
            {user.is_admin && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/20">Admin</span>}
            {!user.is_admin && isCollaborator && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-sky-500/15 text-sky-400 border border-sky-500/20">Collaborator</span>}
            {isBanned && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400 border border-red-500/20">Banned</span>}
          </div>
          <p className="text-[10px] text-zinc-600 font-mono truncate">{user.user_id}</p>
        </div>
        <div className="flex items-center gap-6 text-xs text-zinc-500 shrink-0">
          <div className="text-right w-20">
            <div className="text-zinc-400">{formatDate(user.last_active)}</div>
            <div className="text-[10px]">last active</div>
          </div>
          {isExpanded ? <ChevronDown className="w-4 h-4 text-zinc-600" /> : <ChevronRight className="w-4 h-4 text-zinc-600" />}
        </div>
      </div>

      {isExpanded && (
        <div className="px-5 pb-4 pt-1 bg-zinc-900/30 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <DetailItem label="Registered" value={formatDate(user.registered_at)} icon={Clock} />
            <DetailItem label="Last Active" value={formatDate(user.last_active)} icon={Activity} />
            <DetailItem label="Status" value={user.is_admin ? "Administrator" : isBanned ? "Banned" : "Active"} icon={Shield} />
          </div>
          <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/30">
            {!user.is_admin && !isBanned && !isConfirming && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleCollaborator(user); }}
                disabled={actionLoading === user.user_id}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  isCollaborator
                    ? "bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 border border-sky-500/20"
                    : "bg-zinc-800/50 text-zinc-400 hover:text-sky-400 hover:bg-sky-500/10"
                )}
                title={isCollaborator
                  ? "Revoke collaborator access (can no longer change ticket status)"
                  : "Promote to collaborator (view all tickets, reply, change status — cannot delete or close)"}
              >
                {actionLoading === user.user_id
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <ShieldCheck className="w-3.5 h-3.5" />}
                {isCollaborator ? "Revoke Collaborator" : "Make Collaborator"}
              </button>
            )}
            {!user.is_admin && !isConfirming && (
              <button
                onClick={(e) => { e.stopPropagation(); isBanned ? onUnban(user.user_id) : onBan(user.user_id); }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  isBanned ? "bg-zinc-800/50 text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10" : "bg-zinc-800/50 text-zinc-400 hover:text-red-400 hover:bg-red-500/10"
                )}
              >
                {isBanned ? <UserCheck className="w-3.5 h-3.5" /> : <UserX className="w-3.5 h-3.5" />}
                {isBanned ? "Unban User" : "Ban User"}
              </button>
            )}
            {isConfirming && (
              <div className="flex items-center gap-2 animate-in fade-in duration-150" onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-zinc-500">{confirmAction?.action === "ban" ? "Ban?" : "Unban?"}</span>
                <button
                  onClick={() => confirmAction?.action === "ban" ? onConfirmBan(user.user_id) : onConfirmUnban(user.user_id)}
                  disabled={actionLoading === user.user_id}
                  className={cn("flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    confirmAction?.action === "ban" ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"
                  )}
                >
                  {actionLoading === user.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Confirm
                </button>
                <button onClick={onCancelConfirm} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-colors">
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

