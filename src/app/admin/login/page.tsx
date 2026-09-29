"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace("/admin");
    } catch {
      setError("AUTH FAILED — Invalid credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Header */}
        <div className="mb-10 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-zinc-500 mb-2">
            {"// ADMIN TERMINAL ACCESS"}
          </p>
          <h1 className="text-5xl font-oswald font-bold text-zinc-950 uppercase tracking-widest">
            MFT <span className="text-red-600">ADMIN</span>
          </h1>
          <div className="mt-4 h-px w-full bg-zinc-200" />
        </div>

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="border border-zinc-200 bg-white p-8 space-y-6 shadow-[4px_4px_0px_0px_#09090b]">

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-700 mb-2">
              Operator ID (Email)
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="admin@mft.com"
              className="brutal-input"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-700 mb-2">
              Auth Key (Password)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="brutal-input"
            />
          </div>

          {error && (
            <div className="border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-xs font-bold uppercase tracking-widest">
              [ERR] {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="brutal-btn w-full py-3 disabled:opacity-50"
          >
            {loading ? "[ AUTHENTICATING... ]" : "[ ENTER TERMINAL ]"}
          </button>
        </form>

        <p className="mt-6 text-center text-[9px] uppercase tracking-widest text-zinc-500">
          MFT OPERATIONS — RESTRICTED ACCESS
        </p>
      </div>
    </div>
  );
}
