import { create } from "zustand";
import {
  checkMegabugsAccess,
  getMegabugsIdentity,
  setMegabugsIdentity,
  fetchTickets,
  fetchTicketDetail,
  submitTicket,
  replyToTicket,
  updateTicketStatus,
  deleteTicket as apiDeleteTicket,
  type MegaBugsAccess,
  type UserIdentity,
  type TicketSummary,
  type Ticket,
  type ImageData,
} from "../lib/tauri-api";

// ── Unread tracking via localStorage ──────────────────────────────
const UNREAD_KEY = "megabugs_last_read";

function getLastReadMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(UNREAD_KEY) || "{}");
  } catch {
    return {};
  }
}

function setLastRead(ticketId: string) {
  const map = getLastReadMap();
  map[ticketId] = new Date().toISOString();
  localStorage.setItem(UNREAD_KEY, JSON.stringify(map));
}

export function hasUnread(ticket: TicketSummary): boolean {
  const map = getLastReadMap();
  const lastRead = map[ticket.id];
  if (!lastRead) return ticket.message_count > 1; // never opened = unread if replies exist
  return ticket.updated_at > lastRead;
}

// ── Cooldown ──────────────────────────────────────────────────────
const COOLDOWN_MS = 60_000;

interface BugState {
  access: MegaBugsAccess | null;
  identity: UserIdentity | null;
  tickets: TicketSummary[];
  activeTicket: Ticket | null;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  /** Whether the GitHub API appears unreachable */
  offline: boolean;
  /** Epoch ms of last successful submit — drives cooldown UI */
  lastSubmitTime: number;
  /** Open ticket count for notification badges (admin: all open, user: own unread) */
  notificationCount: number;

  checkAccess: (bepinexPath: string) => Promise<void>;
  loadIdentity: () => Promise<void>;
  saveIdentity: (displayName: string) => Promise<void>;
  loadTickets: () => Promise<void>;
  loadTicketDetail: (ticketId: string) => Promise<void>;
  submit: (
    ticketType: string,
    title: string,
    description: string,
    images: ImageData[],
    bepinexPath: string,
  ) => Promise<void>;
  reply: (ticketId: string, text: string, images: ImageData[]) => Promise<void>;
  setStatus: (ticketId: string, status: string, labels: string[]) => Promise<void>;
  deleteTicket: (ticketId: string) => Promise<void>;
  markTicketRead: (ticketId: string) => void;
  clearActiveTicket: () => void;
  clearError: () => void;
  /** Seconds remaining on cooldown (0 = ready) */
  cooldownRemaining: () => number;
  /** Start background polling for notification badges */
  startNotificationPolling: () => void;
  /** Stop background polling */
  stopNotificationPolling: () => void;
}

function isOfflineError(e: unknown): boolean {
  const msg = String(e).toLowerCase();
  return msg.includes("network") || msg.includes("dns") || msg.includes("connect") || msg.includes("unreachable") || msg.includes("timed out");
}

let _notifInterval: ReturnType<typeof setInterval> | null = null;

function computeNotificationCount(tickets: TicketSummary[], isAdmin: boolean): number {
  if (isAdmin) return tickets.filter((t) => t.status === "open").length;
  return tickets.filter((t) => hasUnread(t)).length;
}

export const useBugStore = create<BugState>((set, get) => ({
  access: null,
  identity: null,
  tickets: [],
  activeTicket: null,
  loading: false,
  submitting: false,
  error: null,
  offline: false,
  lastSubmitTime: 0,
  notificationCount: 0,

  checkAccess: async (bepinexPath: string) => {
    try {
      const access = await checkMegabugsAccess(bepinexPath);
      set({ access });
    } catch (e) {
      set({ access: { enabled: false, is_admin: false } });
    }
  },

  loadIdentity: async () => {
    try {
      const identity = await getMegabugsIdentity();
      set({ identity });
    } catch {
      set({ identity: null });
    }
  },

  saveIdentity: async (displayName: string) => {
    try {
      const identity = await setMegabugsIdentity(displayName);
      set({ identity, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadTickets: async () => {
    const { identity, access } = get();
    if (!identity) return;
    set({ loading: true, error: null });
    try {
      const userId = access?.is_admin ? undefined : identity.user_id;
      const tickets = await fetchTickets(userId);
      const isAdmin = access?.is_admin ?? false;
      set({ tickets, loading: false, offline: false, notificationCount: computeNotificationCount(tickets, isAdmin) });
    } catch (e) {
      const offline = isOfflineError(e);
      set({ error: offline ? "Unable to reach MegaBugs — check your internet connection." : String(e), loading: false, offline });
    }
  },

  loadTicketDetail: async (ticketId: string) => {
    set({ loading: true, error: null });
    try {
      const ticket = await fetchTicketDetail(ticketId);
      set({ activeTicket: ticket, loading: false, offline: false });
    } catch (e) {
      const offline = isOfflineError(e);
      set({ error: offline ? "Unable to reach MegaBugs — check your internet connection." : String(e), loading: false, offline });
    }
  },

  submit: async (
    ticketType: string,
    title: string,
    description: string,
    images: ImageData[],
    bepinexPath: string,
  ) => {
    const { identity, cooldownRemaining } = get();
    if (!identity) return;
    if (cooldownRemaining() > 0) {
      set({ error: `Please wait ${cooldownRemaining()}s before submitting another ticket.` });
      return;
    }
    set({ submitting: true, error: null });
    try {
      const summary = await submitTicket(
        ticketType,
        title,
        description,
        images,
        bepinexPath,
        identity.user_id,
        identity.display_name,
      );
      set((s) => ({
        tickets: [summary, ...s.tickets],
        submitting: false,
        offline: false,
        lastSubmitTime: Date.now(),
      }));
    } catch (e) {
      const offline = isOfflineError(e);
      set({ error: offline ? "Unable to reach MegaBugs — check your internet connection." : String(e), submitting: false, offline });
    }
  },

  reply: async (ticketId: string, text: string, images: ImageData[]) => {
    const { identity, access } = get();
    if (!identity) return;
    set({ submitting: true, error: null });
    try {
      await replyToTicket(
        ticketId,
        text,
        images,
        identity.user_id,
        identity.display_name,
        access?.is_admin ?? false,
      );
      const ticket = await fetchTicketDetail(ticketId);
      set({ activeTicket: ticket, submitting: false, offline: false });
    } catch (e) {
      const offline = isOfflineError(e);
      set({ error: offline ? "Unable to reach MegaBugs — check your internet connection." : String(e), submitting: false, offline });
    }
  },

  setStatus: async (ticketId: string, status: string, labels: string[]) => {
    set({ error: null });
    // Optimistically update the ticket list so the UI reflects the change immediately
    // (GitHub CDN may serve stale index.json on re-fetch)
    const { tickets, access } = get();
    const isAdmin = access?.is_admin ?? false;
    const updatedTickets = tickets.map((t) =>
      t.id === ticketId ? { ...t, status, labels, updated_at: new Date().toISOString() } : t
    );
    set({ tickets: updatedTickets, notificationCount: computeNotificationCount(updatedTickets, isAdmin) });
    try {
      await updateTicketStatus(ticketId, status, labels);
      const ticket = await fetchTicketDetail(ticketId);
      set({ activeTicket: ticket, offline: false });
      // Background re-fetch to sync with server (non-blocking)
      get().loadTickets();
    } catch (e) {
      const offline = isOfflineError(e);
      set({ error: offline ? "Unable to reach MegaBugs — check your internet connection." : String(e), offline });
      // Revert optimistic update on failure
      get().loadTickets();
    }
  },

  deleteTicket: async (ticketId: string) => {
    // Optimistic removal from UI
    set((s) => ({
      tickets: s.tickets.filter((t) => t.id !== ticketId),
      activeTicket: s.activeTicket?.id === ticketId ? null : s.activeTicket,
      error: null,
    }));
    try {
      await apiDeleteTicket(ticketId);
    } catch (e) {
      const offline = isOfflineError(e);
      set({ error: offline ? "Unable to reach MegaBugs — check your internet connection." : String(e), offline });
      // Re-fetch to restore state on failure
      get().loadTickets();
    }
  },

  markTicketRead: (ticketId: string) => {
    setLastRead(ticketId);
    // Recompute notification count after marking as read
    const { tickets, access } = get();
    const isAdmin = access?.is_admin ?? false;
    set({ notificationCount: computeNotificationCount(tickets, isAdmin) });
  },

  clearActiveTicket: () => set({ activeTicket: null }),
  clearError: () => set({ error: null }),

  cooldownRemaining: () => {
    const elapsed = Date.now() - get().lastSubmitTime;
    return Math.max(0, Math.ceil((COOLDOWN_MS - elapsed) / 1000));
  },

  startNotificationPolling: () => {
    if (_notifInterval) return;
    // Do an initial fetch
    get().loadTickets();
    // Poll every 60s for badge updates
    _notifInterval = setInterval(() => {
      const { identity } = get();
      if (identity) get().loadTickets();
    }, 60_000);
  },

  stopNotificationPolling: () => {
    if (_notifInterval) {
      clearInterval(_notifInterval);
      _notifInterval = null;
    }
  },
}));
