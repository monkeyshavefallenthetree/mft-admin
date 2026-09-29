"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import AdminHeaderStats from "@/components/admin/AdminHeaderStats";
import { subscribeAdminChatNotifications, type ChatNotification } from "@/lib/chatNotifications";

const STRAPI_CMS_ADMIN =
  process.env.NEXT_PUBLIC_STRAPICMS_ADMIN_URL ?? "http://localhost:1337/admin";

const NAV_ITEMS = [
  { label: "Submissions", href: "/admin", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { label: "Workers", href: "/admin/workers", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" },
  { label: "Projects", href: "/admin/projects", icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" },
  { label: "Work Sessions", href: "/admin/work-sessions", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { label: "HR Dashboard", href: "/admin/hr", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
  { label: "Exceptions", href: "/admin/exceptions", icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" },
  { label: "Strapi CMS", href: STRAPI_CMS_ADMIN, icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
];

function playTerminalBeep() {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    console.error("Audio play failed", e);
  }
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ email: string | null } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const chatNotifCountRef = useRef(-1);
  const router = useRouter();
  const pathname = usePathname();

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

  useEffect(() => {
    let chatUnsub: (() => void) | null = null;

    function startChatListener(uid: string) {
      chatUnsub?.();
      chatUnsub = subscribeAdminChatNotifications(db, (notifs: ChatNotification[]) => {
        if (chatNotifCountRef.current >= 0 && notifs.length > chatNotifCountRef.current) {
          playTerminalBeep();
        }
        setUnreadChatCount(notifs.length);
        chatNotifCountRef.current = notifs.length;
      });
    }

    const authUnsub = onAuthStateChanged(auth, (firebaseUser) => {
      chatUnsub?.();
      chatUnsub = null;
      chatNotifCountRef.current = -1;
      if (!firebaseUser) return;
      startChatListener(firebaseUser.uid);
    });
    return () => {
      authUnsub();
      chatUnsub?.();
    };
  }, []);

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="flex flex-col items-center gap-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-500 animate-pulse">
            INITIALIZING TERMINAL...
          </p>
          <div className="w-48 h-px bg-zinc-300" />
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    if (confirm("Terminate session?")) {
      await signOut(auth);
      router.replace("/admin/login");
    }
  };

  return (
    <div className="min-h-screen bg-white text-zinc-950 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:sticky top-0 left-0 z-40 h-screen w-64 bg-white border-r border-zinc-200 flex flex-col transition-transform duration-150 ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>

        {/* Brand */}
        <div className="p-6 border-b border-zinc-200">
          <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500 mb-1">
            {"SYS.ADMIN //"}
          </p>
          <h1 className="text-2xl font-oswald font-bold text-red-600 uppercase tracking-widest">
            MFT
          </h1>
          <p className="mt-1 text-[10px] uppercase tracking-widest text-zinc-500 truncate">
            {user?.email ?? "—"}
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5" aria-label="Admin navigation">
          {NAV_ITEMS.map((item) => {
            const isExternal = item.href.startsWith("http");
            const isActive = isExternal
              ? false
              : item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 text-xs font-bold uppercase tracking-widest transition-colors border-l-2 ${
                  isActive
                    ? "border-red-600 bg-red-50 text-red-600"
                    : "border-transparent text-zinc-600 hover:border-zinc-300 hover:text-zinc-950 hover:bg-zinc-50"
                }`}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {item.label}
                {item.label === "Projects" && unreadChatCount > 0 && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white px-1 animate-pulse">
                    {unreadChatCount > 9 ? "9+" : unreadChatCount}
                  </span>
                )}
                {isExternal && (
                  <svg className="w-3 h-3 ml-auto opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-4 border-t border-zinc-200">
          <button
            onClick={() => void handleLogout()}
            className="brutal-btn-outline flex items-center gap-3 w-full px-4 py-3"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            [ LOGOUT ]
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen bg-zinc-50/50">
        {/* Mobile header */}
        <header className="lg:hidden sticky top-0 z-20 bg-white border-b border-zinc-200 px-4 py-3 flex items-center justify-between">
          <button onClick={() => setSidebarOpen(true)} className="text-zinc-900 p-1">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="text-lg font-oswald font-bold text-red-600 uppercase tracking-widest">MFT ADMIN</h1>
          <div className="w-6" />
        </header>

        <main className="flex-1 p-4 md:p-8 max-w-[1400px] w-full mx-auto">
          <AdminHeaderStats />
          {children}
        </main>
      </div>
    </div>
  );
}
