import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useProfileStore } from "../stores/profileStore";
import { useBugStore, hasUnread } from "../stores/bugStore";
import { useToastStore } from "../stores/toastStore";
import { fetchAttachment } from "../lib/tauri-api";
import type { ImageData, TicketSummary } from "../lib/tauri-api";
import { cn } from "../lib/utils";
import {
  Bug,
  Lightbulb,
  Plus,
  ArrowLeft,
  Send,
  Loader2,
  Image as ImageIcon,
  X,
  AlertCircle,
  CheckCircle2,
  Clock,
  Tag,
  Monitor,
  ScrollText,
  ChevronDown,
  WifiOff,
  ZoomIn,
  Trash2,
} from "lucide-react";

type View = "list" | "new" | "detail";
type TicketType = "bug" | "feature";
type FilterStatus = "all" | "open" | "in-progress" | "closed";

const statusColors: Record<string, string> = {
  open: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  "in-progress": "text-amber-400 bg-amber-500/10 border-amber-500/20",
  closed: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",
};

const statusIcons: Record<string, typeof AlertCircle> = {
  open: AlertCircle,
  "in-progress": Clock,
  closed: CheckCircle2,
};

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function formatTimestamp(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-AU", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ── Image cache — avoid refetching the same attachment per session ──
const imageCache = new Map<string, string>();

async function loadGitHubImage(path: string): Promise<string | null> {
  if (imageCache.has(path)) return imageCache.get(path)!;
  try {
    const b64 = await fetchAttachment(path);
    const ext = path.split(".").pop()?.toLowerCase() || "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "gif" ? "image/gif"
      : ext === "webp" ? "image/webp"
      : "image/png";
    const dataUrl = `data:${mime};base64,${b64}`;
    imageCache.set(path, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

export function MegaBugs() {
  const { activeProfile } = useProfileStore();
  const profile = activeProfile();
  const {
    access,
    identity,
    tickets,
    activeTicket,
    loading,
    submitting,
    error,
    offline,
    checkAccess,
    loadIdentity,
    loadTickets,
    loadTicketDetail,
    submit,
    reply,
    setStatus,
    deleteTicket,
    markTicketRead,
    clearActiveTicket,
    clearError,
    cooldownRemaining,
  } = useBugStore();
  const addToast = useToastStore((s) => s.addToast);

  const location = useLocation();
  const [view, setView] = useState<View>("list");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset to list view when navigating to this page
  useEffect(() => {
    setView("list");
    clearActiveTicket();
  }, [location.key, clearActiveTicket]);

  // New ticket form
  const [ticketType, setTicketType] = useState<TicketType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<ImageData[]>([]);
  const [formShake, setFormShake] = useState(false);

  // Reply
  const [replyText, setReplyText] = useState("");
  const [replyImages, setReplyImages] = useState<ImageData[]>([]);

  // Cooldown countdown
  const [cooldown, setCooldown] = useState(0);

  // Lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check access + load identity on mount
  useEffect(() => {
    if (profile?.bepinex_path) {
      checkAccess(profile.bepinex_path);
      loadIdentity();
    }
  }, [profile?.bepinex_path, checkAccess, loadIdentity]);

  // Load tickets once identity is resolved
  useEffect(() => {
    if (identity) {
      loadTickets();
    }
  }, [identity, loadTickets]);

  // Clear error after 5s
  useEffect(() => {
    if (error) {
      const t = setTimeout(clearError, 5000);
      return () => clearTimeout(t);
    }
  }, [error, clearError]);

  // Auto-refresh ticket detail every 60s when viewing a ticket
  useEffect(() => {
    if (view !== "detail" || !activeTicket) return;
    const interval = setInterval(() => {
      loadTicketDetail(activeTicket.id);
    }, 60_000);
    return () => clearInterval(interval);
  }, [view, activeTicket?.id, loadTicketDetail]);

  // Auto-refresh ticket list every 60s on the list view
  useEffect(() => {
    if (view !== "list" || !identity) return;
    const interval = setInterval(loadTickets, 60_000);
    return () => clearInterval(interval);
  }, [view, identity, loadTickets]);

  // Cooldown countdown tick
  useEffect(() => {
    const remaining = cooldownRemaining();
    if (remaining <= 0) { setCooldown(0); return; }
    setCooldown(remaining);
    const interval = setInterval(() => {
      const r = cooldownRemaining();
      setCooldown(r);
      if (r <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownRemaining, useBugStore.getState().lastSubmitTime]);

  // Scroll to bottom of messages when ticket loads or new message added
  useEffect(() => {
    if (view === "detail" && activeTicket) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [view, activeTicket?.messages.length]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Escape to go back
      if (e.key === "Escape") {
        if (lightboxSrc) { setLightboxSrc(null); return; }
        if (view === "detail" || view === "new") { goBack(); return; }
      }
      // Ctrl+Enter to submit
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        if (view === "new" && title.trim() && description.trim() && !submitting) {
          handleSubmit();
        } else if (view === "detail" && replyText.trim() && !submitting) {
          handleReply();
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [view, lightboxSrc, title, description, replyText, submitting]);

  // Image paste handler for textarea
  const handlePaste = useCallback(
    (setter: typeof setImages) => (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) addImageFile(file, setter);
        }
      }
    },
    [],
  );

  // Image drop handler
  const handleDrop = useCallback(
    (setter: typeof setImages) => (e: React.DragEvent) => {
      e.preventDefault();
      for (const file of e.dataTransfer.files) {
        if (file.type.startsWith("image/")) {
          addImageFile(file, setter);
        }
      }
    },
    [],
  );

  function addImageFile(file: File, setter: typeof setImages) {
    if (file.size > 5 * 1024 * 1024) {
      addToast({ type: "warning", title: "Image too large", message: "Max 5MB per image" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      if (!base64) return;
      setter((prev) => {
        if (prev.length >= 5) {
          addToast({ type: "warning", title: "Max images", message: "Maximum 5 images allowed" });
          return prev;
        }
        return [...prev, { filename: file.name, base64_data: base64 }];
      });
    };
    reader.readAsDataURL(file);
  }

  function addImagesFromInput(files: FileList | null, setter: typeof setImages) {
    if (!files) return;
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        addImageFile(file, setter);
      }
    }
  }

  function removeImage(index: number, setter: typeof setImages) {
    setter((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!profile?.bepinex_path) return;
    if (!title.trim() || !description.trim()) {
      setFormShake(true);
      setTimeout(() => setFormShake(false), 500);
      return;
    }
    await submit(ticketType, title, description, images, profile.bepinex_path);
    if (!useBugStore.getState().error) {
      addToast({ type: "success", title: "Ticket submitted!" });
      setTitle("");
      setDescription("");
      setImages([]);
      setView("list");
    }
  }

  async function handleReply() {
    if (!activeTicket) return;
    await reply(activeTicket.id, replyText, replyImages);
    if (!useBugStore.getState().error) {
      setReplyText("");
      setReplyImages([]);
    }
  }

  function openTicket(ticketId: string) {
    markTicketRead(ticketId);
    loadTicketDetail(ticketId);
    setView("detail");
    setReplyText("");
    setReplyImages([]);
  }

  function goBack() {
    clearActiveTicket();
    setLightboxSrc(null);
    setView("list");
    loadTickets();
  }

  // Filter tickets
  const filteredTickets =
    filterStatus === "all" ? tickets : tickets.filter((t) => t.status === filterStatus);

  // Still checking access
  if (!access) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  // Identity setup — handled by app-level IdentityGate; this is a fallback
  if (!identity) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  // ─── Ticket Detail View ────────────────────────────────────────────
  if (view === "detail" && activeTicket) {
    const StatusIcon = statusIcons[activeTicket.status] || AlertCircle;
    return (
      <div className="-m-6 flex flex-col h-[calc(100vh-2.5rem)] animate-in">
        {/* Header (pinned top) */}
        <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-sm z-10">
          <button onClick={goBack} className="text-zinc-400 hover:text-zinc-200 transition-colors" aria-label="Go back">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border",
                  statusColors[activeTicket.status] || statusColors.open,
                )}
              >
                <StatusIcon className="w-3 h-3" />
                {activeTicket.status}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-800/50 text-zinc-400 border border-zinc-700/50">
                {activeTicket.type === "bug" ? (
                  <Bug className="w-3 h-3" />
                ) : (
                  <Lightbulb className="w-3 h-3" />
                )}
                {activeTicket.type}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-zinc-200 truncate mt-1">
              {activeTicket.title}
            </h2>
            <p className="text-xs text-zinc-500">
              by {activeTicket.author_name} · {formatDate(activeTicket.created_at)}
            </p>
          </div>
          {/* Admin status controls */}
          {access.is_admin && (
            <div className="flex items-center gap-2">
              <AdminStatusDropdown
                currentStatus={activeTicket.status}
                labels={activeTicket.labels}
                onUpdate={(status, labels) => setStatus(activeTicket.id, status, labels)}
              />
              <div className="relative">
                <button
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/20 hover:bg-red-900/40 text-xs text-red-400 hover:text-red-300 transition-colors border border-red-800/30"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
                {confirmDelete && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-900 border border-zinc-700/50 rounded-lg shadow-xl z-20 p-3">
                    <p className="text-xs text-zinc-300 mb-2">Delete this ticket permanently?</p>
                    <div className="flex gap-2">
                      <button
                        className="flex-1 px-2 py-1.5 rounded bg-red-600 hover:bg-red-500 text-xs text-white font-medium transition-colors"
                        onClick={() => {
                          setConfirmDelete(false);
                          deleteTicket(activeTicket.id);
                          goBack();
                        }}
                      >
                        Delete
                      </button>
                      <button
                        className="flex-1 px-2 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-300 transition-colors"
                        onClick={() => setConfirmDelete(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* System info collapsible */}
        <SystemInfoPanel info={activeTicket.system_info} hasLog={activeTicket.has_log} />

        {/* Offline banner */}
        {offline && <OfflineBanner />}

        {/* Messages (chat-style: chronological, gravity to bottom) */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col justify-end min-h-full px-6 py-4 space-y-4">
            {loading && (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
              </div>
            )}
            {activeTicket.messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "rounded-xl p-4 max-w-[85%]",
                  msg.is_admin
                    ? "ml-auto bg-brand-500/10 border border-brand-500/20"
                    : "bg-zinc-800/50 border border-zinc-700/30",
                )}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-zinc-300">
                    {msg.author_name}
                    {msg.is_admin && (
                      <span className="ml-1.5 text-[10px] text-brand-400 font-semibold">ADMIN</span>
                    )}
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    {formatTimestamp(msg.timestamp)}
                  </span>
                </div>
                <p className="text-sm text-zinc-300 whitespace-pre-wrap">{msg.text}</p>
                {msg.images.length > 0 && (
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {msg.images.map((path, i) => (
                      <AttachmentThumb key={i} path={path} onClick={(src) => setLightboxSrc(src)} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Lightbox */}
        {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

        {/* Reply box (pinned to bottom) */}
        <div className="shrink-0 mt-auto px-6 py-4 border-t border-zinc-800/50 bg-zinc-950/80 backdrop-blur-sm shadow-[0_-4px_12px_rgba(0,0,0,0.3)]">
          {error && (
            <div className="mb-3 text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
            </div>
          )}
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={replyRef}
                className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand-500/50 resize-none"
                rows={2}
                placeholder="Write a reply... (paste images with Ctrl+V)"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onPaste={handlePaste(setReplyImages)}
                onDrop={handleDrop(setReplyImages)}
                onDragOver={(e) => e.preventDefault()}
              />
              {replyImages.length > 0 && (
                <div className="flex gap-1.5 mt-2">
                  {replyImages.map((_img, i) => (
                    <div key={i} className="relative group">
                      <div className="w-12 h-12 rounded bg-zinc-800 border border-zinc-700/50 flex items-center justify-center">
                        <ImageIcon className="w-4 h-4 text-zinc-500" />
                      </div>
                      <button
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeImage(i, setReplyImages)}
                        aria-label="Remove image"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button
                className="p-2.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-200 transition-colors"
                onClick={() => replyFileInputRef.current?.click()}
                title="Attach image"
              >
                <ImageIcon className="w-4 h-4" />
              </button>
              <button
                className="p-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white transition-colors disabled:opacity-40"
                disabled={!replyText.trim() || submitting}
                onClick={handleReply}
                title="Send reply"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
          <input
            ref={replyFileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-label="Attach images to reply"
            onChange={(e) => addImagesFromInput(e.target.files, setReplyImages)}
          />
        </div>
      </div>
    );
  }

  // ─── New Ticket Form ───────────────────────────────────────────────
  if (view === "new") {
    return (
      <div className={cn("flex-1 flex flex-col min-h-0 animate-in", formShake && "animate-shake")}>
        <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800/50">
          <button
            onClick={() => setView("list")}
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-semibold text-zinc-200">New Ticket</h2>
        </div>

        {offline && <OfflineBanner />}

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {error && (
            <div className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
            </div>
          )}

          {/* Type toggle */}
          <div className="flex gap-2">
            <button
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                ticketType === "bug"
                  ? "bg-red-500/10 text-red-400 border-red-500/30"
                  : "bg-zinc-800/30 text-zinc-400 border-zinc-700/30 hover:border-zinc-600/50",
              )}
              onClick={() => setTicketType("bug")}
            >
              <Bug className="w-4 h-4" />
              Bug Report
            </button>
            <button
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                ticketType === "feature"
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  : "bg-zinc-800/30 text-zinc-400 border-zinc-700/30 hover:border-zinc-600/50",
              )}
              onClick={() => setTicketType("feature")}
            >
              <Lightbulb className="w-4 h-4" />
              Feature Request
            </button>
          </div>

          {/* Title */}
          <input
            className={cn(
              "w-full bg-zinc-900/50 border rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand-500/50 transition-colors",
              formShake && !title.trim() ? "border-red-500/60" : "border-zinc-700/50",
            )}
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            autoFocus
          />

          {/* Description */}
          <div>
            <textarea
              ref={descRef}
              className={cn(
                "w-full bg-zinc-900/50 border rounded-lg px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand-500/50 resize-none transition-colors",
                formShake && !description.trim() ? "border-red-500/60" : "border-zinc-700/50",
              )}
              rows={6}
              placeholder="Describe the bug or feature... (paste images with Ctrl+V)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onPaste={handlePaste(setImages)}
              onDrop={handleDrop(setImages)}
              onDragOver={(e) => e.preventDefault()}
            />
            <p className="text-[11px] text-zinc-500 mt-1.5">
              Drag & drop or paste (Ctrl+V) images directly. Max 5 images, 5MB each.
            </p>
          </div>

          {/* Image previews */}
          {images.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {images.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={`data:image/png;base64,${img.base64_data}`}
                    alt={img.filename}
                    className="w-20 h-20 rounded-lg object-cover border border-zinc-700/30 cursor-pointer"
                    onClick={() => setLightboxSrc(`data:image/png;base64,${img.base64_data}`)}
                  />
                  <button
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeImage(i, setImages)}
                    aria-label="Remove image"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Attach button */}
          <button
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-200 text-sm transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon className="w-4 h-4" /> Attach Images
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-label="Attach images"
            onChange={(e) => addImagesFromInput(e.target.files, setImages)}
          />

          {/* Auto log notice */}
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-800/30 border border-zinc-700/20 text-xs text-zinc-400">
            <ScrollText className="w-4 h-4 shrink-0 text-zinc-500" />
            Your BepInEx log and system info will be automatically attached.
          </div>
        </div>

        {/* Submit bar */}
        <div className="px-6 py-4 border-t border-zinc-800/50 flex items-center justify-between">
          <span className="text-[11px] text-zinc-500">Ctrl+Enter to submit</span>
          <div className="flex items-center gap-3">
            {cooldown > 0 && (
              <span className="text-xs text-amber-400/80">
                <Clock className="w-3.5 h-3.5 inline mr-1" />
                Wait {cooldown}s
              </span>
            )}
            <button
              className="px-6 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-2"
              disabled={!title.trim() || !description.trim() || submitting || cooldown > 0}
              onClick={handleSubmit}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" /> Submit
                </>
              )}
            </button>
          </div>
        </div>

        {/* Lightbox */}
        {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      </div>
    );
  }

  // ─── Ticket List View ──────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col min-h-0 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/50">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">MegaBugs</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            {access.is_admin ? "Admin — all tickets" : `Reporting as ${identity.display_name}`}
          </p>
        </div>
        <button
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors"
          onClick={() => {
            setView("new");
            clearError();
          }}
        >
          <Plus className="w-4 h-4" /> New Ticket
        </button>
      </div>

      {/* Offline banner */}
      {offline && <OfflineBanner />}

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-800/30">
        {(["all", "open", "in-progress", "closed"] as FilterStatus[]).map((status) => (
          <button
            key={status}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
              filterStatus === status
                ? "bg-brand-500/15 text-brand-400 border-brand-500/30"
                : "bg-zinc-800/30 text-zinc-400 border-zinc-700/30 hover:text-zinc-300",
            )}
            onClick={() => setFilterStatus(status)}
          >
            {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-500">
          {filteredTickets.length} ticket{filteredTickets.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Ticket list */}
      <div className="flex-1 overflow-y-auto">
        {loading && tickets.length === 0 ? (
          <div className="divide-y divide-zinc-800/30">
            {[1, 2, 3].map((i) => (
              <TicketRowSkeleton key={i} />
            ))}
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Bug className="w-10 h-10 text-zinc-600 mb-3" />
            <p className="text-sm text-zinc-500">
              {tickets.length === 0 ? "No tickets yet. Submit your first!" : "No tickets match this filter."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            {filteredTickets.map((ticket) => (
              <TicketRow key={ticket.id} ticket={ticket} onClick={() => openTicket(ticket.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function TicketRow({ ticket, onClick }: { ticket: TicketSummary; onClick: () => void }) {
  const StatusIcon = statusIcons[ticket.status] || AlertCircle;
  const unread = hasUnread(ticket);
  return (
    <button
      className="w-full text-left px-6 py-4 hover:bg-zinc-800/30 transition-colors flex items-start gap-4"
      onClick={onClick}
    >
      <div className="mt-0.5 relative">
        {ticket.type === "bug" ? (
          <Bug className="w-4.5 h-4.5 text-red-400" />
        ) : (
          <Lightbulb className="w-4.5 h-4.5 text-amber-400" />
        )}
        {unread && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-brand-400 ring-2 ring-zinc-950" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn("text-sm font-medium truncate", unread ? "text-zinc-100" : "text-zinc-200")}>
            {ticket.title}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border shrink-0",
              statusColors[ticket.status] || statusColors.open,
            )}
          >
            <StatusIcon className="w-2.5 h-2.5" />
            {ticket.status}
          </span>
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          {ticket.author_name} · {formatDate(ticket.created_at)} · {ticket.message_count} message
          {ticket.message_count !== 1 ? "s" : ""}
        </p>
      </div>
    </button>
  );
}

function TicketRowSkeleton() {
  return (
    <div className="px-6 py-4 flex items-start gap-4 animate-pulse">
      <div className="w-5 h-5 rounded bg-zinc-800 mt-0.5" />
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-4 w-48 rounded bg-zinc-800" />
          <div className="h-4 w-16 rounded-full bg-zinc-800" />
        </div>
        <div className="h-3 w-36 rounded bg-zinc-800/60" />
      </div>
    </div>
  );
}

function AttachmentThumb({ path, onClick }: { path: string; onClick: (src: string) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadGitHubImage(path).then((url) => {
      if (!cancelled) {
        setSrc(url);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [path]);

  if (loading) {
    return (
      <div className="w-20 h-20 rounded-lg bg-zinc-900/60 border border-zinc-700/30 flex items-center justify-center animate-pulse">
        <Loader2 className="w-4 h-4 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (!src) {
    return (
      <div className="w-20 h-20 rounded-lg bg-zinc-900/60 border border-zinc-700/30 flex items-center justify-center">
        <ImageIcon className="w-5 h-5 text-zinc-600" />
      </div>
    );
  }

  return (
    <button
      className="w-20 h-20 rounded-lg overflow-hidden border border-zinc-700/30 relative group cursor-pointer"
      onClick={() => onClick(src)}
      aria-label="View image"
    >
      <img src={src} alt="" className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <ZoomIn className="w-5 h-5 text-white" />
      </div>
    </button>
  );
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 animate-in fade-in"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-zinc-800/80 text-zinc-300 hover:text-white flex items-center justify-center transition-colors"
        onClick={onClose}
        aria-label="Close lightbox"
      >
        <X className="w-5 h-5" />
      </button>
      <img
        src={src}
        alt="Enlarged attachment"
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function OfflineBanner() {
  return (
    <div className="flex items-center gap-2 px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-400">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      Unable to reach MegaBugs — check your internet connection.
    </div>
  );
}

function SystemInfoPanel({ info, hasLog }: { info: { megaload_version: string; os: string; profile_name: string; installed_mods: string[] }; hasLog: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-zinc-800/30">
      <button
        className="w-full flex items-center gap-2 px-6 py-2.5 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <Monitor className="w-3.5 h-3.5" />
        System Info
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform ml-auto", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-6 pb-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          <div>
            <span className="text-zinc-500">MegaLoad:</span>{" "}
            <span className="text-zinc-300">{info.megaload_version}</span>
          </div>
          <div>
            <span className="text-zinc-500">OS:</span>{" "}
            <span className="text-zinc-300">{info.os}</span>
          </div>
          <div>
            <span className="text-zinc-500">Profile:</span>{" "}
            <span className="text-zinc-300">{info.profile_name}</span>
          </div>
          <div>
            <span className="text-zinc-500">Log attached:</span>{" "}
            <span className="text-zinc-300">{hasLog ? "Yes" : "No"}</span>
          </div>
          <div className="col-span-2">
            <span className="text-zinc-500">Mods ({info.installed_mods.length}):</span>{" "}
            <span className="text-zinc-300">{info.installed_mods.join(", ") || "None"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminStatusDropdown({
  currentStatus,
  labels,
  onUpdate,
}: {
  currentStatus: string;
  labels: string[];
  onUpdate: (status: string, labels: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const statuses = ["open", "in-progress", "closed"];
  return (
    <div className="relative">
      <button
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-700/50 text-xs text-zinc-400 hover:text-zinc-200 transition-colors border border-zinc-700/30"
        onClick={() => setOpen(!open)}
      >
        <Tag className="w-3.5 h-3.5" />
        Status
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-zinc-900 border border-zinc-700/50 rounded-lg shadow-xl z-20 py-1">
          {statuses.map((s) => (
            <button
              key={s}
              className={cn(
                "w-full text-left px-3 py-2 text-xs hover:bg-zinc-800/50 transition-colors",
                s === currentStatus ? "text-brand-400" : "text-zinc-400",
              )}
              onClick={() => {
                onUpdate(s, labels);
                setOpen(false);
              }}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
              {s === currentStatus && " ✓"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
