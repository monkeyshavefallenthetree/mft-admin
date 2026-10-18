"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import CommandPalette from "@/components/admin/CommandPalette";
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
import { useAdminBadges, desktopNotifyEnabled, desktopNotifySupported, setDesktopNotify, testAdminLockScreenPush } from "@/lib/admin/useAdminBadges";
import { markAdminNotificationRead, markAllAdminNotificationsRead } from "@/lib/adminNotifications";
import { isSoundEnabled, playAdminSound, setSoundEnabled } from "@/lib/admin/sound";
import { FeedbackHost, confirmDialog, toast } from "@/lib/admin/feedback";
import { useTheme, type ThemePref } from "@/lib/admin/theme";
import { logActivity } from "@/lib/admin/activity";
import { URL_SYNC_EVENT } from "@/lib/admin/useUrlState";

function Icon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

function timeAgo(d?: Date) {
  if (!d) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ email: string | null } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const role = getAdminRole(user?.email);
  const roleMeta = getAdminRoleMeta(role);
  const navGroups = getNavGroupsForRole(role);

  const badges = useAdminBadges(!!user, role);
  const { theme, setTheme } = useTheme();
  const [desktopOn, setDesktopOn] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => {
    setDesktopOn(desktopNotifyEnabled());
    setSoundOn(isSoundEnabled());
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

  // Redirect to the role's default tab if the current route is not allowed for this admin account.
  const routeAllowed = !user || isPathAllowedForRole(pathname, role);
  useEffect(() => {
    if (!loading && user && pathname !== "/admin/login" && !routeAllowed) {
      router.replace(roleMeta.defaultHref);
    }
  }, [loading, user, pathname, routeAllowed, roleMeta.defaultHref, router]);

  // Persist sidebar collapse
  useEffect(() => {
    setCollapsed(localStorage.getItem("mft.sidebar.collapsed") === "1");
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem("mft.sidebar.collapsed", c ? "0" : "1");
      return !c;
    });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === "Escape") {
        setBellOpen(false);
        setUserMenuOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => setMobileOpen(false), [pathname]);

  /** Navigate in-app; when only the query changes, tell URL-backed filters to re-read. */
  const go = useCallback(
    (href: string) => {
      const target = new URL(href, window.location.origin);
      if (!isPathAllowedForRole(target.pathname, role)) {
        router.push(roleMeta.defaultHref);
        return;
      }
      const samePage = target.pathname === window.location.pathname;
      router.push(href);
      if (samePage) window.setTimeout(() => window.dispatchEvent(new Event(URL_SYNC_EVENT)), 60);
    },
    [router, role, roleMeta.defaultHref],
  );

  // Toasts / desktop notifications route through here (see navigateTo in nav.ts).
  useEffect(() => {
    const onNav = (e: Event) => {
      const href = (e as CustomEvent<string>).detail;
      if (typeof href !== "string") return;
      e.preventDefault();
      go(href);
    };
    window.addEventListener(NAVIGATE_EVENT, onNav);
    return () => window.removeEventListener(NAVIGATE_EVENT, onNav);
  }, [go]);

  // Connectivity banner
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

  // Tab title: "(3) Tasks · MFT Admin" so pending work is visible from other tabs.
  const pendingTotal =
    badges.unreadChats +
    badges.pendingWorkers +
    badges.pendingExceptions +
    badges.pendingApprovals +
    badges.newSubmissions +
    badges.pendingReimbursements +
    badges.unreadAdminNotifs;
  useEffect(() => {
    if (pathname === "/admin/login") {
      document.title = "Sign in · MFT Admin";
      return;
    }
    const label = findNavItem(pathname)?.label ?? "Dashboard";
    document.title = `${pendingTotal > 0 ? `(${pendingTotal > 99 ? "99+" : pendingTotal}) ` : ""}${label} · MFT Admin`;
  }, [pathname, pendingTotal]);

  if (pathname === "/admin/login") return <>{children}</>;

  if (loading || !routeAllowed) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--mft-bg)]">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-600 font-oswald text-lg font-bold text-white shadow-lg shadow-red-600/30">
            M
          </div>
          <div className="h-1 w-40 overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-red-600" />
          </div>
          <p className="text-xs font-medium text-zinc-500">Loading workspace…</p>
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    setUserMenuOpen(false);
    const ok = await confirmDialog({ title: "Sign out?", message: "You'll need to sign in again to access the admin workspace.", confirmLabel: "Sign out" });
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
    if (!desktopOn && !next) toast.error("Permission denied", { description: "Allow notifications for this site in your browser settings." });
    else if (next) toast.success("Desktop alerts enabled", { description: "You'll be notified even when this tab is in the background." });
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
  const readerKey = auth.currentUser?.uid || user?.email || "admin";

  const alertRows = [
    { key: "approvals", count: badges.pendingApprovals, label: "Task approvals waiting", href: FILTERED_LINKS.pendingApprovals, tone: "amber", icon: "M5 13l4 4L19 7" },
    { key: "workers", count: badges.pendingWorkers, label: "Workers awaiting approval", href: FILTERED_LINKS.pendingWorkers, tone: "blue", icon: ICONS.workers },
    { key: "exceptions", count: badges.pendingExceptions, label: "Exception requests pending", href: FILTERED_LINKS.pendingExceptions, tone: "orange", icon: ICONS.exceptions },
    { key: "reimb", count: badges.pendingReimbursements, label: "Reimbursement claims to review", href: FILTERED_LINKS.pendingReimbursements, tone: "amber", icon: ICONS.reimbursements },
    { key: "subs", count: badges.newSubmissions, label: "New client submissions", href: FILTERED_LINKS.newSubmissions, tone: "emerald", icon: ICONS.submissions },
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
      (item.href === "/admin" || item.href === "/admin/hr" ? pathname === item.href : pathname.startsWith(item.href));
    const count = item.badge ? badges[item.badge] : 0;
    return (
      <Link
        key={item.href}
        href={item.href}
        target={item.external ? "_blank" : undefined}
        rel={item.external ? "noopener noreferrer" : undefined}
        title={collapsed ? item.label : undefined}
        className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all ${
          isActive ? "bg-red-50 text-red-700" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
        } ${collapsed ? "lg:justify-center lg:px-2" : ""}`}
      >
        {isActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-red-600" />}
        <Icon d={item.icon} className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-red-600" : "text-zinc-400 group-hover:text-zinc-700"}`} />
        <span className={`truncate ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
        {count > 0 && (
          <span
            className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
              item.badge === "unreadChats" ? "bg-red-600 text-white" : "bg-zinc-900 text-white"
            } ${collapsed ? "lg:absolute lg:-right-0.5 lg:-top-0.5 lg:h-4 lg:min-w-4 lg:px-1 lg:text-[9px]" : ""}`}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
        {item.external && !collapsed && <Icon d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" className="ml-auto h-3.5 w-3.5 text-zinc-300" />}
      </Link>
    );
  };

  const initials = (user?.email || "A").slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-screen bg-[var(--mft-bg)] text-zinc-900">
      {mobileOpen && <div className="fixed inset-0 z-30 bg-zinc-950/40 backdrop-blur-sm lg:hidden animate-fade-in" onClick={() => setMobileOpen(false)} />}

      {/* ── Sidebar ── */}
      <aside
        className={`fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-zinc-200 bg-white transition-all duration-200 lg:sticky ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${collapsed ? "w-64 lg:w-[72px]" : "w-64"}`}
      >
        {/* Brand */}
        <div className={`flex h-16 items-center gap-3 border-b border-zinc-100 px-4 ${collapsed ? "lg:justify-center lg:px-2" : ""}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-red-700 font-oswald text-base font-bold text-white shadow-md shadow-red-600/25">
            M
          </div>
          <div className={`min-w-0 ${collapsed ? "lg:hidden" : ""}`}>
            <p className="font-oswald text-lg font-bold leading-none tracking-wider text-zinc-900">MFT</p>
            <p className="mt-0.5 truncate text-[11px] font-medium text-zinc-500">{roleMeta.label}</p>
          </div>
        </div>

        {/* Search trigger */}
        <div className={`px-3 pt-3 ${collapsed ? "lg:px-2" : ""}`}>
          <button
            type="button"
            id="sidebar-search"
            onClick={() => setPaletteOpen(true)}
            className={`flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-[13px] text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-white cursor-pointer ${
              collapsed ? "lg:justify-center lg:px-0" : ""
            }`}
          >
            <Icon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" className="h-4 w-4 shrink-0" />
            <span className={`flex-1 ${collapsed ? "lg:hidden" : ""}`}>Search…</span>
            <span className={`ui-kbd ${collapsed ? "lg:hidden" : ""}`}>Ctrl K</span>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Admin navigation">
          {navGroups.map((group) => (
            <div key={group.title}>
              <p className={`mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 ${collapsed ? "lg:hidden" : ""}`}>
                {group.title}
              </p>
              {collapsed && <div className="mx-auto mb-2 hidden h-px w-6 bg-zinc-200 lg:block" />}
              <div className="space-y-0.5">{group.items.map(renderNavItem)}</div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-zinc-100 p-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            className={`hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 lg:flex cursor-pointer ${
              collapsed ? "lg:justify-center lg:px-2" : ""
            }`}
          >
            <Icon d={collapsed ? "M13 5l7 7-7 7M5 5l7 7-7 7" : "M11 19l-7-7 7-7m8 14l-7-7 7-7"} className="h-4 w-4" />
            <span className={collapsed ? "lg:hidden" : ""}>Collapse sidebar</span>
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-zinc-200 bg-white/85 px-4 backdrop-blur-md md:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 lg:hidden cursor-pointer"
            aria-label="Open navigation"
          >
            <Icon d="M4 6h16M4 12h16M4 18h16" className="h-5 w-5" />
          </button>

          {/* Breadcrumb / title */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
              <Link href={roleMeta.defaultHref} className="hover:text-zinc-700">Admin</Link>
              {currentGroup && current?.href !== "/admin" && (
                <>
                  <span>/</span>
                  <span>{currentGroup.title}</span>
                </>
              )}
            </div>
            {pathname === "/admin" || pathname.startsWith("/admin/projects") ? (
              <p className="truncate text-[15px] font-semibold text-zinc-900">{current?.label ?? "Dashboard"}</p>
            ) : (
              <h1 className="truncate text-[15px] font-semibold text-zinc-900">{current?.label ?? "Dashboard"}</h1>
            )}
          </div>

          {/* Role badge */}
          <span
            className={`hidden items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold md:flex ${roleMeta.badgeClass}`}
            title={`Signed in with ${roleMeta.label} permissions`}
          >
            {roleMeta.label}
          </span>

          {/* Live */}
          <span
            className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:flex ${
              online ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
            title={online ? "Receiving real-time updates" : "You're offline — changes will sync when reconnected"}
          >
            <span className="relative flex h-2 w-2">
              {online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`} />
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

          {/* Notifications */}
          <div className="relative" ref={bellRef}>
            <button
              type="button"
              id="notifications-bell"
              onClick={() => setBellOpen((o) => !o)}
              className="relative rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer"
              aria-label="Notifications"
            >
              <Icon d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" className="h-5 w-5" />
              {totalAlerts > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white ring-2 ring-white">
                  {totalAlerts > 99 ? "99+" : totalAlerts}
                </span>
              )}
            </button>

            {bellOpen && (
              <div className="absolute right-0 mt-2 w-[24rem] overflow-hidden rounded-xl border border-zinc-200 bg-white animate-scale-in" style={{ boxShadow: "var(--mft-shadow-lg)" }}>
                <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">Notifications</p>
                    <p className="text-[10px] text-zinc-500">{roleMeta.label}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {badges.unreadAdminNotifs > 0 && (
                      <button
                        type="button"
                        onClick={() => void markAllAdminNotificationsRead(db, badges.adminNotifications, readerKey)}
                        className="text-[11px] font-semibold text-red-600 hover:text-red-700 cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                    <span className="text-xs text-zinc-500">{totalAlerts} open</span>
                  </div>
                </div>
                <div className="flex w-full items-center gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 text-left">
                  <Icon d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" className="h-4 w-4 text-zinc-500" />
                  <span className="flex-1 text-xs text-zinc-700">Lock screen &amp; mobile push</span>
                  <button
                    type="button"
                    onClick={async () => {
                      toast.info("🔒 Lock your phone screen now!", {
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
                    className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer ${desktopOn ? "bg-red-600" : "bg-zinc-300"}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${desktopOn ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                </div>
                <div className="flex w-full items-center gap-3 border-b border-zinc-100 bg-zinc-50/70 px-4 py-2 text-left">
                  <Icon d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" className="h-4 w-4 text-zinc-500" />
                  <span className="flex-1 text-xs text-zinc-700">Notification sound (mobile &amp; desktop)</span>
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
                    className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer ${soundOn ? "bg-red-600" : "bg-zinc-300"}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${soundOn ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  {alertRows.length === 0 && badges.chatNotifications.length === 0 && badges.adminNotifications.length === 0 && (
                    <div className="px-4 py-10 text-center">
                      <p className="text-sm font-medium text-zinc-700">You&apos;re all caught up 🎉</p>
                      <p className="mt-1 text-xs text-zinc-500">Nothing needs your attention right now.</p>
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
                      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${toneClass[r.tone]}`}>
                        <Icon d={r.icon} className="h-4 w-4" />
                      </span>
                      <span className="flex-1 text-[13px] text-zinc-700">{r.label}</span>
                      <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-bold text-white">{r.count}</span>
                    </Link>
                  ))}
                  {badges.chatNotifications.length > 0 && (
                    <>
                      <p className="bg-zinc-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Unread messages</p>
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
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-[11px] font-bold text-red-700">
                              {(n.senderName || "?").slice(0, 2).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate text-[13px] font-semibold text-zinc-900">{n.senderName}</span>
                                <span className="shrink-0 text-[10px] text-zinc-400">{timeAgo(n.createdAt?.toDate())}</span>
                              </span>
                              <span className="block truncate text-[11px] text-zinc-500">on {n.taskTitle}</span>
                              <span className="mt-0.5 block truncate text-xs text-zinc-700">{n.messagePreview}</span>
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
                        const isUnread = !Array.isArray(ev.readBy) || !ev.readBy.includes(readerKey);
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
                            <span className={`mt-0.5 flex h-7 shrink-0 items-center justify-center rounded px-1.5 text-[9px] font-bold uppercase ${catBadge}`}>
                              {ev.category}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className={`truncate text-xs ${isUnread ? "font-bold text-zinc-900" : "font-medium text-zinc-700"}`}>
                                  {ev.title}
                                </span>
                                <span className="shrink-0 text-[10px] text-zinc-400">
                                  {timeAgo(ev.createdAt?.toDate?.())}
                                </span>
                              </span>
                              <span className="mt-0.5 block line-clamp-2 text-[11px] text-zinc-600">{ev.body}</span>
                            </span>
                            {isUnread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-600" />}
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
            className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Icon d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" className="h-5 w-5" />
            ) : (
              <Icon d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" className="h-5 w-5" />
            )}
          </button>

          {/* User */}
          <div className="relative" ref={userRef}>
            <button
              type="button"
              id="user-menu"
              onClick={() => setUserMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg p-1 pr-2 transition-colors hover:bg-zinc-100 cursor-pointer"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-bold text-white">{initials}</span>
              <Icon d="M19 9l-7 7-7-7" className="hidden h-3.5 w-3.5 text-zinc-400 sm:block" />
            </button>
            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-zinc-200 bg-white animate-scale-in" style={{ boxShadow: "var(--mft-shadow-lg)" }}>
                <div className="border-b border-zinc-100 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-zinc-500">Signed in as</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${roleMeta.badgeClass}`}>
                      {roleMeta.label}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm font-medium text-zinc-900">{user?.email ?? "—"}</p>
                </div>
                <div className="border-b border-zinc-100 px-4 py-3">
                  <p className="mb-2 text-[11px] font-medium text-zinc-500">Appearance</p>
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1">
                    {([
                      ["light", "Light", "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"],
                      ["dark", "Dark", "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"],
                      ["system", "Auto", "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"],
                    ] as [ThemePref, string, string][]).map(([key, label, icon]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setTheme(key)}
                        className={`flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] font-semibold transition-all cursor-pointer ${
                          theme === key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
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
                    Activity log
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="flex w-full items-center gap-2 border-t border-zinc-100 px-4 py-2.5 text-left text-sm text-red-600 transition-colors hover:bg-red-50 cursor-pointer"
                >
                  <Icon d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        {!online && (
          <div role="status" className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800">
            <Icon d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728M12 12h.01M3 3l18 18" className="h-4 w-4" />
            You&apos;re offline. Live counters are paused and edits will sync once you reconnect.
          </div>
        )}

        <main key={pathname} className="mft-admin-content mx-auto w-full max-w-[1440px] flex-1 p-4 md:p-6 lg:p-8 animate-fade-in">
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
      />
      <FeedbackHost />
    </div>
  );
}
