"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import CommandPalette from "@/components/admin/CommandPalette";
import AdminAiDrawer from "@/components/admin/AdminAiDrawer";
import {
  NAV_GROUPS,
  ICONS,
  FILTERED_LINKS,
  NAVIGATE_EVENT,
  findNavItem,
  getAdminRole,
  getAdminRoleMeta,
  getNavGroupsForRole,
  isPathAllowedForRole,
  type NavItem,
} from "@/lib/admin/nav";
import {
  useAdminBadges,
  desktopNotifyEnabled,
  desktopNotifySupported,
  setDesktopNotify,
  testAdminLockScreenPush,
} from "@/lib/admin/useAdminBadges";
import { markAdminNotificationRead, markAllAdminNotificationsRead } from "@/lib/adminNotifications";
import { isSoundEnabled, playAdminSound, setSoundEnabled } from "@/lib/admin/sound";
import { FeedbackHost, confirmDialog, toast } from "@/lib/admin/feedback";
import { useTheme, type ThemePref } from "@/lib/admin/theme";
import { logActivity } from "@/lib/admin/activity";
import { CAIRO_TZ, cairoYmd, formatCairoTime } from "@/lib/admin/cairoTime";
import { URL_SYNC_EVENT } from "@/lib/admin/useUrlState";

function Icon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

function formatNotifTimestamp(d?: Date): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  const nowMs = Date.now();
  const s = Math.floor((nowMs - d.getTime()) / 1000);
  if (cairoYmd(d) === cairoYmd(nowMs)) {
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago · ${formatCairoTime(d)}`;
  }
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone: CAIRO_TZ,
    month: "short",
    day: "numeric",
  }).format(d);
  return `${datePart} · ${formatCairoTime(d)}`;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ email: string | null } | null>(null);
  const [mobileOpenPath, setMobileOpenPath] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const mobileOpen = mobileOpenPath === pathname;
  const setMobileOpen = useCallback(
    (next: boolean | ((cur: boolean) => boolean)) => {
      setMobileOpenPath((cur) => {
        const isOpen = cur === pathname;
        const resolved = typeof next === "function" ? next(isOpen) : next;
        return resolved ? pathname : null;
      });
    },
    [pathname],
  );

  const role = getAdminRole(user?.email);
  const roleMeta = getAdminRoleMeta(role);
  const defaultHref = roleMeta.defaultHref;
  const navGroups = getNavGroupsForRole(role);

  const badges = useAdminBadges(!!user, role);
  const { theme, setTheme } = useTheme();
  const [desktopOn, setDesktopOn] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [pushBannerDismissed, setPushBannerDismissed] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDesktopOn(desktopNotifyEnabled());
      setSoundOn(isSoundEnabled());
      setCollapsed(localStorage.getItem("mft.sidebar.collapsed") === "1");
      const ua = window.navigator.userAgent || "";
      const isIOS =
        /iPad|iPhone|iPod/.test(ua) ||
        (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
      const isStandalone =
        window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (isIOS && !isStandalone) {
        setIosNeedsInstall(true);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser && pathname !== "/admin/login") {
        router.replace("/admin/login");
      } else {
        setUser(firebaseUser ? { email: firebaseUser.email } : null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [router, pathname]);

  const routeAllowed = !user || isPathAllowedForRole(pathname, role);
  useEffect(() => {
    if (!loading && user && pathname !== "/admin/login" && !routeAllowed) {
      router.replace(defaultHref);
    }
  }, [loading, user, pathname, routeAllowed, defaultHref, router]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem("mft.sidebar.collapsed", c ? "0" : "1");
      return !c;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAiOpen((o) => !o);
      } else if (e.key === "Escape") {
        setBellOpen(false);
        setUserMenuOpen(false);
        setMobileOpenPath(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (href: string) => {
    const target = new URL(href, window.location.origin);
    if (!isPathAllowedForRole(target.pathname, role)) {
      router.push(defaultHref);
      return;
    }
    const samePage = target.pathname === window.location.pathname;
    router.push(href);
    if (samePage) window.setTimeout(() => window.dispatchEvent(new Event(URL_SYNC_EVENT)), 60);
  };

  useEffect(() => {
    const onNav = (e: Event) => {
      const href = (e as CustomEvent<string>).detail;
      if (typeof href !== "string") return;
      e.preventDefault();
      const target = new URL(href, window.location.origin);
      if (!isPathAllowedForRole(target.pathname, role)) {
        router.push(defaultHref);
        return;
      }
      const samePage = target.pathname === window.location.pathname;
      router.push(href);
      if (samePage) window.setTimeout(() => window.dispatchEvent(new Event(URL_SYNC_EVENT)), 60);
    };
    window.addEventListener(NAVIGATE_EVENT, onNav);
    return () => window.removeEventListener(NAVIGATE_EVENT, onNav);
  }, [router, role, defaultHref]);

  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const readerKey = auth.currentUser?.uid || user?.email || "admin";

  // Avoid double-counting unread `adminNotifications` whose category is already represented
  // in an active non-zero pending queue counter (e.g. pending worker, exception, approval, chat).
  const nonOverlappingUnreadAdminNotifs = badges.adminNotifications.reduce((acc, ev) => {
    const isUnread = !Array.isArray(ev.readBy) || !ev.readBy.includes(readerKey);
    if (!isUnread) return acc;
    const et = ev.eventType;
    const overlapsQueue =
      ((et === "task_chat_message" || et === "project_chat_message") && badges.unreadChats > 0) ||
      (et === "worker_registered" && badges.pendingWorkers > 0) ||
      (et === "exception_submitted" && badges.pendingExceptions > 0) ||
      (et === "task_submitted_approval" && badges.pendingApprovals > 0) ||
      ((et === "reimbursement_submitted" || et === "reimbursement_invoice_uploaded") &&
        badges.pendingReimbursements > 0);
    return overlapsQueue ? acc : acc + 1;
  }, 0);

  const pendingTotal =
    badges.unreadChats +
    badges.pendingWorkers +
    badges.pendingExceptions +
    badges.pendingApprovals +
    badges.newSubmissions +
    badges.pendingReimbursements +
    nonOverlappingUnreadAdminNotifs;

  useEffect(() => {
    if (pathname === "/admin/login") {
      document.title = "Sign in · MFT Studio OS";
      return;
    }
    const label = findNavItem(pathname)?.label ?? "Dashboard";
    document.title = `${pendingTotal > 0 ? `(${pendingTotal > 99 ? "99+" : pendingTotal}) ` : ""}${label} · MFT Studio OS`;
  }, [pathname, pendingTotal]);

  if (pathname === "/admin/login") return <>{children}</>;

  if (loading || !routeAllowed) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#09090b] text-white">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-red-700 font-code text-lg font-bold text-white shadow-lg shadow-red-600/30">
            M
          </div>
          <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-red-500" />
          </div>
          <p className="text-xs font-medium text-zinc-400">Initializing Studio Workspace…</p>
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    setUserMenuOpen(false);
    const ok = await confirmDialog({
      title: "Sign out?",
      message: "You'll need to sign in again to access the admin workspace.",
      confirmLabel: "Sign out",
    });
    if (ok) {
      await logActivity({ action: "signed-out", entity: "auth", label: user?.email ?? "admin" });
      await signOut(auth);
      router.replace("/admin/login");
    }
  };

  const toggleDesktop = async () => {
    if (!desktopNotifySupported()) {
      toast.warning("Desktop notifications aren't supported in this browser");
      return;
    }
    const next = await setDesktopNotify(!desktopOn);
    setDesktopOn(next);
    if (!desktopOn && !next)
      toast.error("Permission denied", {
        description: "Allow notifications for this site in your browser settings.",
      });
    else if (next)
      toast.success("Desktop alerts enabled", {
        description: "You'll be notified even when this tab is in the background.",
      });
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    if (next) {
      playAdminSound({ force: true });
      toast.success("Notification sound enabled");
    } else {
      toast.info("Notification sound muted");
    }
  };

  const current = findNavItem(pathname);
  const currentGroup = NAV_GROUPS.find((g) => g.items.some((i) => i.href === current?.href));

  const totalAlerts = pendingTotal;

  const alertRows = [
    {
      key: "approvals",
      count: badges.pendingApprovals,
      label: "Task approvals waiting",
      href: FILTERED_LINKS.pendingApprovals,
      tone: "amber",
      icon: "M5 13l4 4L19 7",
    },
    {
      key: "workers",
      count: badges.pendingWorkers,
      label: "Workers awaiting approval",
      href: FILTERED_LINKS.pendingWorkers,
      tone: "blue",
      icon: ICONS.workers,
    },
    {
      key: "exceptions",
      count: badges.pendingExceptions,
      label: "Exception requests pending",
      href: FILTERED_LINKS.pendingExceptions,
      tone: "orange",
      icon: ICONS.exceptions,
    },
    {
      key: "reimb",
      count: badges.pendingReimbursements,
      label: "Reimbursement claims to review",
      href: FILTERED_LINKS.pendingReimbursements,
      tone: "amber",
      icon: ICONS.reimbursements,
    },
    {
      key: "subs",
      count: badges.newSubmissions,
      label: "New client submissions",
      href: FILTERED_LINKS.newSubmissions,
      tone: "emerald",
      icon: ICONS.submissions,
    },
  ].filter((r) => r.count > 0);

  const toneClass: Record<string, string> = {
    amber: "bg-amber-100 text-amber-700",
    blue: "bg-blue-100 text-blue-700",
    orange: "bg-orange-100 text-orange-700",
    emerald: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
  };

  const renderNavItem = (item: NavItem) => {
    const isActive =
      !item.external &&
      (item.href === "/admin" || item.href === "/admin/hr"
        ? pathname === item.href
        : pathname.startsWith(item.href));
    const count = item.badge ? badges[item.badge] : 0;
    return (
      <Link
        key={item.href}
        href={item.href}
        target={item.external ? "_blank" : undefined}
        rel={item.external ? "noopener noreferrer" : undefined}
        title={collapsed ? item.label : undefined}
        className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all ${
          isActive
            ? "bg-gradient-to-r from-red-600/20 via-red-500/10 to-transparent font-semibold text-white ring-1 ring-red-500/30"
            : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100"
        } ${collapsed ? "lg:justify-center lg:px-2" : ""}`}
      >
        {isActive && (
          <span
            className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-red-500"
            style={{ boxShadow: "0 0 10px #ef4444" }}
          />
        )}
        <Icon
          d={item.icon}
          className={`h-[18px] w-[18px] shrink-0 transition-colors ${
            isActive ? "text-red-400" : "text-zinc-500 group-hover:text-zinc-200"
          }`}
        />
        <span className={`truncate ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
        {count > 0 && (
          <span
            className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-code text-[10px] font-bold ${
              item.badge === "unreadChats"
                ? "bg-red-600 text-white shadow-xs shadow-red-600/40"
                : "bg-white/15 text-white"
            } ${
              collapsed
                ? "lg:absolute lg:-right-0.5 lg:-top-0.5 lg:h-4 lg:min-w-4 lg:px-1 lg:text-[9px]"
                : ""
            }`}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
        {item.external && !collapsed && (
          <Icon
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            className="ml-auto h-3.5 w-3.5 text-zinc-600"
          />
        )}
      </Link>
    );
  };

  const initials = (user?.email || "A").slice(0, 2).toUpperCase();

  return (
    /* ── Linear / Attio Obsidian App Frame ── */
    <div className="flex min-h-screen bg-[#0b0b0e] text-zinc-900">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-xs lg:hidden animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Sleek Obsidian Sidebar ── */}
      <aside
        className={`fixed left-0 top-0 z-40 flex h-screen flex-col bg-[#0b0b0e] text-zinc-300 transition-all duration-200 lg:sticky ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${collapsed ? "w-64 lg:w-[76px]" : "w-64"}`}
      >
        {/* Brand Identity */}
        <div
          className={`flex h-16 items-center gap-3 px-4 pt-2 ${
            collapsed ? "lg:justify-center lg:px-2" : ""
          }`}
        >
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 via-red-600 to-rose-700 font-code text-sm font-extrabold text-white shadow-lg shadow-red-600/30 ring-1 ring-white/20">
            M
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0b0b0e]" />
          </div>
          <div className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : ""}`}>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold tracking-tight text-white">MFT Studio</p>
              <span className="rounded bg-white/10 px-1.5 py-0.2 font-code text-[9px] font-bold uppercase text-zinc-300">
                OS
              </span>
            </div>
            <p className="truncate text-[11px] font-medium text-zinc-500">{roleMeta.label}</p>
          </div>
        </div>

        {/* Glass Command Search Trigger */}
        <div className={`px-3 pt-2 ${collapsed ? "lg:px-2.5" : ""}`}>
          <button
            type="button"
            id="sidebar-search"
            onClick={() => setPaletteOpen(true)}
            className={`flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-[12.5px] text-zinc-400 transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-zinc-200 cursor-pointer ${
              collapsed ? "lg:justify-center lg:px-0" : ""
            }`}
          >
            <Icon
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              className="h-4 w-4 shrink-0 text-zinc-400"
            />
            <span className={`flex-1 truncate ${collapsed ? "lg:hidden" : ""}`}>
              Quick command…
            </span>
            <kbd
              className={`rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-code text-[10px] font-medium text-zinc-400 ${
                collapsed ? "lg:hidden" : ""
              }`}
            >
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Navigation Groups */}
        <nav
          className="flex-1 space-y-5 overflow-y-auto px-3 py-4"
          aria-label="Admin navigation"
        >
          {navGroups.map((group) => (
            <div key={group.title}>
              <p
                className={`mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 ${
                  collapsed ? "lg:hidden" : ""
                }`}
              >
                {group.title}
              </p>
              {collapsed && (
                <div className="mx-auto mb-2 hidden h-px w-6 bg-white/10 lg:block" />
              )}
              <div className="space-y-0.5">{group.items.map(renderNavItem)}</div>
            </div>
          ))}
        </nav>

        {/* Interactive Sidebar Footer Dock */}
        <div className="space-y-2 border-t border-white/[0.08] p-3">
          {/* Segmented Theme Switcher inside Sidebar */}
          <div
            className={`grid grid-cols-3 gap-1 rounded-xl border border-white/[0.07] bg-white/[0.03] p-1 ${
              collapsed ? "lg:hidden" : ""
            }`}
          >
            {(
              [
                [
                  "light",
                  "Light",
                  "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
                ],
                [
                  "dark",
                  "Dark",
                  "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z",
                ],
                [
                  "system",
                  "Auto",
                  "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
                ],
              ] as [ThemePref, string, string][]
            ).map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTheme(key)}
                className={`flex items-center justify-center gap-1 rounded-lg py-1 text-[10px] font-semibold transition-all cursor-pointer ${
                  theme === key
                    ? "bg-white/15 text-white shadow-2xs"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <Icon d={icon} className="h-3 w-3" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={toggleCollapsed}
            className={`hidden w-full items-center gap-3 rounded-xl px-3 py-2 text-[12px] font-medium text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-white lg:flex cursor-pointer ${
              collapsed ? "lg:justify-center lg:px-2" : ""
            }`}
          >
            <Icon
              d={
                collapsed
                  ? "M13 5l7 7-7 7M5 5l7 7-7 7"
                  : "M11 19l-7-7 7-7m8 14l-7-7 7-7"
              }
              className="h-4 w-4"
            />
            <span className={collapsed ? "lg:hidden" : ""}>Collapse sidebar</span>
          </button>
        </div>
      </aside>

      {/* ── Floating Inset Main Studio Canvas ── */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col bg-[var(--mft-bg)] lg:my-2.5 lg:mr-2.5 lg:min-h-[calc(100vh-20px)] lg:rounded-[22px] lg:border lg:border-zinc-200/80 lg:shadow-2xl overflow-clip">
        {/* Sticky Studio Header Bar */}
        <header className="sticky top-0 z-20 flex h-15 items-center gap-3 border-b border-zinc-200/80 bg-white/85 px-4 backdrop-blur-md md:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 lg:hidden cursor-pointer"
            aria-label="Open navigation"
          >
            <Icon d="M4 6h16M4 12h16M4 18h16" className="h-5 w-5" />
          </button>

          {/* Breadcrumb + Current Section Title */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
              <Link href={roleMeta.defaultHref} className="hover:text-zinc-700">
                MFT Workspace
              </Link>
              {currentGroup && current?.href !== "/admin" && (
                <>
                  <span>/</span>
                  <span>{currentGroup.title}</span>
                </>
              )}
              <span>/</span>
              <span className="font-semibold text-zinc-800">{current?.label ?? "Overview"}</span>
            </div>
          </div>

          {/* Quick Studio Shortcuts */}
          {(role === "super_admin" || role === "ops_admin") && (
            <div className="hidden items-center gap-1.5 lg:flex">
              <Link
                href="/admin/client-portal"
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${
                  pathname.startsWith("/admin/client-portal")
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                <Icon d={ICONS.clientPortal} className="h-3.5 w-3.5 text-red-600" />
                <span>Client Rollout Studio</span>
              </Link>
              <Link
                href="/client"
                target="_blank"
                className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                title="Open external Client Portal view"
              >
                <span>Client View</span>
                <Icon
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  className="h-3 w-3"
                />
              </Link>
            </div>
          )}

          {/* MFT Super AI Copilot Trigger */}
          <button
            type="button"
            id="super-ai-trigger"
            onClick={() => setAiOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-900 bg-zinc-950 px-2.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-all hover:bg-red-600 hover:border-red-600 cursor-pointer"
            title="Open MFT Super AI Assistant (Ctrl/Cmd+J)"
          >
            <Icon
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
              className="h-3.5 w-3.5 text-red-400"
            />
            <span className="hidden sm:inline">Super AI</span>
            <kbd className="hidden rounded bg-white/15 px-1 py-0.5 font-code text-[9px] font-semibold text-zinc-200 md:inline">
              ⌘J
            </kbd>
          </button>

          {/* Live Sync Status Pill */}
          <span
            className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-code text-[10px] font-semibold uppercase tracking-wider sm:flex ${
              online
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
            title={
              online
                ? "Receiving real-time Firestore telemetry"
                : "You're offline — changes will sync when reconnected"
            }
          >
            <span className="relative flex h-2 w-2">
              {online && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  online ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
            </span>
            {online ? "Live" : "Offline"}
          </span>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 md:hidden cursor-pointer"
            aria-label="Search"
          >
            <Icon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" className="h-5 w-5" />
          </button>

          {/* Notifications Center */}
          <div className="relative" ref={bellRef}>
            <button
              type="button"
              id="notifications-bell"
              onClick={() => setBellOpen((o) => !o)}
              className="relative rounded-xl border border-zinc-200/80 bg-white p-2 text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 cursor-pointer"
              aria-label="Notifications"
            >
              <Icon
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                className="h-4.5 w-4.5"
              />
              {totalAlerts > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 font-code text-[9px] font-bold text-white ring-2 ring-white">
                  {totalAlerts > 99 ? "99+" : totalAlerts}
                </span>
              )}
            </button>

            {bellOpen && (
              <div
                className="absolute right-0 mt-2 w-[24rem] overflow-hidden rounded-2xl border border-zinc-200 bg-white animate-scale-in"
                style={{ boxShadow: "var(--mft-shadow-lg)" }}
              >
                <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">Notifications</p>
                    <p className="text-[10px] text-zinc-500">{roleMeta.label}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {badges.unreadAdminNotifs > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          void markAllAdminNotificationsRead(db, badges.adminNotifications, readerKey)
                        }
                        className="text-[11px] font-semibold text-red-600 hover:text-red-700 cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                    <span className="font-code text-xs text-zinc-500">{totalAlerts} open</span>
                  </div>
                </div>
                <div className="flex w-full items-center gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 text-left">
                  <Icon
                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    className="h-4 w-4 text-zinc-500"
                  />
                  <span className="flex-1 text-xs text-zinc-700">Lock screen &amp; mobile push</span>
                  <button
                    type="button"
                    onClick={async () => {
                      toast.info("Lock your phone screen now", {
                        description: "Sending lock-screen push alert in 4 seconds...",
                      });
                      const ok = await testAdminLockScreenPush();
                      setDesktopOn(desktopNotifyEnabled());
                      if (!ok) {
                        toast.warning("Enable push alerts first", {
                          description: "Allow notifications in your browser/phone settings.",
                        });
                      }
                    }}
                    className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-zinc-600 hover:bg-zinc-100 cursor-pointer"
                  >
                    Test (4s)
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleDesktop()}
                    aria-label="Toggle push notifications"
                    className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer ${
                      desktopOn ? "bg-red-600" : "bg-zinc-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                        desktopOn ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
                <div className="flex w-full items-center gap-3 border-b border-zinc-100 bg-zinc-50/70 px-4 py-2 text-left">
                  <Icon
                    d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                    className="h-4 w-4 text-zinc-500"
                  />
                  <span className="flex-1 text-xs text-zinc-700">Notification sound</span>
                  <button
                    type="button"
                    onClick={() => playAdminSound({ force: true })}
                    className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-zinc-600 hover:bg-zinc-100 cursor-pointer"
                  >
                    Test
                  </button>
                  <button
                    type="button"
                    onClick={toggleSound}
                    aria-label="Toggle notification sound"
                    className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer ${
                      soundOn ? "bg-red-600" : "bg-zinc-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                        soundOn ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  {alertRows.length === 0 &&
                    badges.chatNotifications.length === 0 &&
                    badges.adminNotifications.length === 0 && (
                      <div className="px-4 py-10 text-center">
                        <p className="text-sm font-medium text-zinc-700">You&apos;re all caught up</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Nothing needs your attention right now.
                        </p>
                      </div>
                    )}
                  {alertRows.map((r) => (
                    <Link
                      key={r.key}
                      href={r.href}
                      onClick={(e) => {
                        e.preventDefault();
                        setBellOpen(false);
                        go(r.href);
                      }}
                      className="flex items-center gap-3 border-b border-zinc-50 px-4 py-3 transition-colors hover:bg-zinc-50"
                    >
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                          toneClass[r.tone]
                        }`}
                      >
                        <Icon d={r.icon} className="h-4 w-4" />
                      </span>
                      <span className="flex-1 text-[13px] text-zinc-700">{r.label}</span>
                      <span className="rounded-full bg-zinc-900 px-2 py-0.5 font-code text-[11px] font-bold text-white">
                        {r.count}
                      </span>
                    </Link>
                  ))}
                  {badges.chatNotifications.length > 0 && (
                    <>
                      <p className="bg-zinc-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        Unread messages
                      </p>
                      {badges.chatNotifications.slice(0, 8).map((n) => {
                        const nAny = n as typeof n & { projectId?: string };
                        const projId =
                          nAny.projectId ||
                          (typeof n.taskId === "string" && n.taskId.startsWith("project:")
                            ? n.taskId.slice("project:".length)
                            : null);
                        const chatHref = projId
                          ? `/admin/projects?project=${encodeURIComponent(projId)}&view=chat`
                          : n.taskId
                            ? `/admin/tasks?task=${encodeURIComponent(n.taskId)}`
                            : "/admin/tasks";
                        return (
                          <Link
                            key={n.id}
                            href={chatHref}
                            onClick={(e) => {
                              e.preventDefault();
                              setBellOpen(false);
                              go(chatHref);
                            }}
                            className="flex items-start gap-3 border-b border-zinc-50 px-4 py-3 transition-colors hover:bg-zinc-50"
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 font-code text-[11px] font-bold text-red-700">
                              {(n.senderName || "?").slice(0, 2).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate text-[13px] font-semibold text-zinc-900">
                                  {n.senderName}
                                </span>
                                <span className="shrink-0 font-code text-[10px] text-zinc-400">
                                  {formatNotifTimestamp(n.createdAt?.toDate())}
                                </span>
                              </span>
                              <span className="block truncate text-[11px] text-zinc-500">
                                on {n.taskTitle}
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-zinc-700">
                                {n.messagePreview}
                              </span>
                            </span>
                          </Link>
                        );
                      })}
                    </>
                  )}
                  {badges.adminNotifications.length > 0 && (
                    <>
                      <p className="bg-zinc-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        Live System Activity ({badges.unreadAdminNotifs} unread)
                      </p>
                      {badges.adminNotifications.slice(0, 15).map((ev) => {
                        const isUnread =
                          !Array.isArray(ev.readBy) || !ev.readBy.includes(readerKey);
                        const catBadge =
                          ev.category === "hr"
                            ? "bg-emerald-100 text-emerald-800"
                            : ev.category === "project"
                              ? "bg-blue-100 text-blue-800"
                              : ev.category === "task"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-red-100 text-red-800";
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => {
                              void markAdminNotificationRead(db, ev.id, readerKey);
                              setBellOpen(false);
                              go(ev.href || roleMeta.defaultHref);
                            }}
                            className={`flex w-full items-start gap-3 border-b border-zinc-50 px-4 py-3 text-left transition-colors hover:bg-zinc-50 cursor-pointer ${
                              isUnread ? "bg-red-50/35" : ""
                            }`}
                          >
                            <span
                              className={`mt-0.5 flex h-6 shrink-0 items-center justify-center rounded px-1.5 font-code text-[9px] font-bold uppercase ${catBadge}`}
                            >
                              {ev.category}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span
                                  className={`truncate text-xs ${
                                    isUnread
                                      ? "font-bold text-zinc-900"
                                      : "font-medium text-zinc-700"
                                  }`}
                                >
                                  {ev.title}
                                </span>
                                <span className="shrink-0 font-code text-[10px] text-zinc-400">
                                  {formatNotifTimestamp(ev.createdAt?.toDate?.())}
                                </span>
                              </span>
                              <span className="mt-0.5 block line-clamp-2 text-[11px] text-zinc-600">
                                {ev.body}
                              </span>
                            </span>
                            {isUnread && (
                              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-600" />
                            )}
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick Theme Toggle */}
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-xl border border-zinc-200/80 bg-white p-2 text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 cursor-pointer"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Icon
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                className="h-4.5 w-4.5"
              />
            ) : (
              <Icon
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                className="h-4.5 w-4.5"
              />
            )}
          </button>

          {/* User Profile Menu */}
          <div className="relative" ref={userRef}>
            <button
              type="button"
              id="user-menu"
              onClick={() => setUserMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-xl border border-zinc-200/80 bg-white p-1 pr-2.5 transition-colors hover:bg-zinc-50 cursor-pointer"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 font-code text-[11px] font-bold text-white">
                {initials}
              </span>
              <span className="hidden max-w-[110px] truncate text-xs font-semibold text-zinc-700 sm:block">
                {user?.email?.split("@")[0] ?? "Admin"}
              </span>
              <Icon d="M19 9l-7 7-7-7" className="hidden h-3.5 w-3.5 text-zinc-400 sm:block" />
            </button>

            {userMenuOpen && (
              <div
                className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-zinc-200 bg-white animate-scale-in"
                style={{ boxShadow: "var(--mft-shadow-lg)" }}
              >
                <div className="border-b border-zinc-100 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-zinc-500">Signed in as</p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${roleMeta.badgeClass}`}
                    >
                      {roleMeta.label}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm font-semibold text-zinc-900">
                    {user?.email ?? "—"}
                  </p>
                </div>
                <div className="border-b border-zinc-100 px-4 py-3">
                  <p className="mb-2 text-[11px] font-medium text-zinc-500">Appearance</p>
                  <div className="grid grid-cols-3 gap-1 rounded-xl bg-zinc-100 p-1">
                    {(
                      [
                        [
                          "light",
                          "Light",
                          "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
                        ],
                        [
                          "dark",
                          "Dark",
                          "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z",
                        ],
                        [
                          "system",
                          "Auto",
                          "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
                        ],
                      ] as [ThemePref, string, string][]
                    ).map(([key, label, icon]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setTheme(key)}
                        className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-semibold transition-all cursor-pointer ${
                          theme === key
                            ? "bg-white text-zinc-900 shadow-2xs"
                            : "text-zinc-500 hover:text-zinc-800"
                        }`}
                      >
                        <Icon d={icon} className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {role === "super_admin" && (
                  <Link
                    href="/admin/activity"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
                  >
                    <Icon d={ICONS.activity} className="h-4 w-4 text-zinc-400" />
                    Activity audit log
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="flex w-full items-center gap-2 border-t border-zinc-100 px-4 py-2.5 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 cursor-pointer"
                >
                  <Icon
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    className="h-4 w-4"
                  />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        {!pushBannerDismissed && (iosNeedsInstall || !desktopOn) && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-red-200 bg-gradient-to-r from-red-50 via-white to-red-50 px-4 py-2.5 text-xs text-zinc-800 md:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-xs text-white shadow-xs">
                <Icon
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  className="h-3.5 w-3.5"
                />
              </span>
              {iosNeedsInstall ? (
                <p className="font-medium leading-snug text-zinc-800">
                  <strong className="font-bold text-red-700">iPhone / iPad Lock-Screen Push:</strong>{" "}
                  Tap <strong className="font-semibold">Share</strong> →{" "}
                  <strong className="font-semibold">Add to Home Screen</strong>, then open MFT Admin
                  from your Home Screen to enable lock-screen alerts.
                </p>
              ) : (
                <p className="font-medium leading-snug text-zinc-800">
                  <strong className="font-bold text-red-700">
                    Lock-Screen &amp; Background Alerts:
                  </strong>{" "}
                  Enable push notifications on this device to receive real-time alerts for{" "}
                  {roleMeta.label} even when your phone screen is locked.
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!iosNeedsInstall && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = await setDesktopNotify(true);
                      setDesktopOn(next);
                      if (next) {
                        toast.success("Lock-Screen Push Enabled!", {
                          description:
                            "You will now receive background & lock-screen notifications on this device.",
                        });
                      } else {
                        toast.error("Permission denied", {
                          description: "Please allow notifications in your browser/phone settings.",
                        });
                      }
                    }}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-red-700 cursor-pointer"
                  >
                    Enable Lock-Screen Push
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      toast.info("Lock your phone screen now", {
                        description: "Sending test lock-screen push alert in 4 seconds...",
                      });
                      const ok = await testAdminLockScreenPush();
                      setDesktopOn(desktopNotifyEnabled());
                      if (!ok) {
                        toast.warning("Enable push alerts first", {
                          description: "Allow notifications in your browser/phone settings.",
                        });
                      }
                    }}
                    className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 cursor-pointer"
                  >
                    Test (4s)
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setPushBannerDismissed(true)}
                aria-label="Dismiss banner"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {!online && (
          <div
            role="status"
            className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800"
          >
            <Icon
              d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728M12 12h.01M3 3l18 18"
              className="h-4 w-4"
            />
            You&apos;re offline. Live counters are paused and edits will sync once you reconnect.
          </div>
        )}

        <main
          key={pathname}
          className="mft-admin-content mx-auto w-full max-w-[1460px] flex-1 p-4 md:p-6 lg:p-7 animate-fade-in"
        >
          {children}
        </main>
      </div>

      <CommandPalette
        key={paletteOpen ? "palette-open" : "palette-closed"}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={go}
        badges={badges}
        role={role}
        theme={theme}
        onSetTheme={setTheme}
        onSignOut={() => void handleLogout()}
        onToggleSidebar={toggleCollapsed}
        onOpenAi={() => setAiOpen(true)}
      />
      <AdminAiDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onNavigate={go}
        role={role}
        pathname={pathname}
      />
      <FeedbackHost />
    </div>
  );
}
