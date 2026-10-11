"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { logActivity } from "@/lib/admin/activity";

const LAST_EMAIL_KEY = "mft.admin.lastEmail";

function authErrorMessage(err: unknown): string {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  switch (code) {
    case "auth/invalid-email":
      return "That doesn't look like a valid email address.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact the workspace owner.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a minute, or reset your password.";
    case "auth/network-request-failed":
      return "Can't reach the server. Check your connection and try again.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "Incorrect email or password. Please try again.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [checking, setChecking] = useState(true);
  const submitting = useRef(false);
  const router = useRouter();

  useEffect(() => {
    try {
      const last = localStorage.getItem(LAST_EMAIL_KEY);
      if (last) setEmail(last);
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Already signed in? Go straight to the dashboard.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u && !submitting.current) router.replace("/admin");
      else setChecking(false);
    });
    return () => unsub();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    submitting.current = true;
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      try {
        localStorage.setItem(LAST_EMAIL_KEY, email.trim());
      } catch {
        /* ignore */
      }
      void logActivity({ action: "signed-in", entity: "auth", label: email.trim() });
      router.replace("/admin");
      return;
    } catch (err) {
      setError(authErrorMessage(err));
    }
    submitting.current = false;
    setLoading(false);
  };

  const handleReset = async () => {
    setError("");
    setInfo("");
    const addr = email.trim();
    if (!addr) {
      setError("Enter your email above, then choose “Forgot password?”.");
      return;
    }
    setResetting(true);
    try {
      await sendPasswordResetEmail(auth, addr);
      setInfo(`If an account exists for ${addr}, a reset link is on its way.`);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setResetting(false);
    }
  };

  const onPwKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.("CapsLock") ?? false);

  const [showPw, setShowPw] = useState(false);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--mft-bg)]" role="status" aria-label="Checking session">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="grid min-h-screen bg-[var(--mft-bg)] lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-900 to-red-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-red-600/30 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-72 w-72 rounded-full bg-red-500/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 font-oswald text-lg font-bold shadow-lg shadow-red-900/40">M</div>
          <span className="font-oswald text-xl font-bold tracking-wider">MFT</span>
        </div>
        <div className="relative">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Run projects, people and clients from one place.</h2>
          <p className="mt-4 max-w-md text-zinc-300">Projects, tasks, attendance, HR and client leads — all live and in sync with your field team&apos;s mobile app.</p>
        </div>
        <p className="relative text-xs text-zinc-500">© {new Date().getFullYear()} MFT Operations · Restricted access</p>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm animate-slide-up">
          <div className="mb-8 lg:hidden flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 font-oswald text-lg font-bold text-white">M</div>
            <span className="font-oswald text-xl font-bold tracking-wider">MFT</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Welcome back</h1>
          <p className="mt-1 text-sm text-zinc-500">Sign in to the admin dashboard.</p>

          <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 space-y-5">
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-zinc-700">Email</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="admin@mft.com"
                className="brutal-input h-11"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="login-password" className="block text-sm font-medium text-zinc-700">Password</label>
                <button
                  type="button"
                  id="login-forgot"
                  onClick={() => void handleReset()}
                  disabled={resetting}
                  className="text-xs font-medium text-zinc-500 transition-colors hover:text-red-600 disabled:opacity-60 cursor-pointer"
                >
                  {resetting ? "Sending…" : "Forgot password?"}
                </button>
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={onPwKey}
                  onKeyUp={onPwKey}
                  onBlur={() => setCapsLock(false)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="brutal-input h-11 pr-16"
                  aria-describedby={capsLock ? "login-caps" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 cursor-pointer"
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
              {capsLock && (
                <p id="login-caps" className="mt-1.5 text-xs font-medium text-amber-600">Caps Lock is on</p>
              )}
            </div>

            {info && (
              <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 animate-fade-in">
                <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                {info}
              </div>
            )}

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 animate-fade-in">
                <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                {error}
              </div>
            )}

            <button id="login-submit" type="submit" disabled={loading} className="brutal-btn h-11 w-full text-sm normal-case tracking-normal disabled:opacity-60">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Signing in…
                </span>
              ) : (
                "Sign in"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
