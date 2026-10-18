"use client";

import type { ReactNode } from "react";
import s from "./lab.module.css";
import { toArabicDigits } from "@/lib/admin/hrPolicy2026";

export { s };

export const ar = (v: number | string) => toArabicDigits(v);
export const money = (n: number) =>
  `${toArabicDigits(Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }))} ج.م`;

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Icon({ d, size = 18, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export const LAB_ICONS = {
  finger:
    "M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4",
  exit: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
  gauge: "M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z",
  calendar: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  moon: "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z",
  receipt: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z",
  terminal: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  check: "M5 13l4 4L19 7",
  undo: "M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6",
  coffee: "M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zm4-7v3m4-3v3m4-3v3",
  stay: "M5 13l4 4L19 7",
  warn: "M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  upload: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12",
  sun: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
  close: "M6 18L18 6M6 6l12 12",
};

export function Panel({ id, title, hint, tag, children, className }: { id: string; title: string; hint?: string; tag?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={cx(s.panel, className)}>
      <div className={s.panelHead}>
        <div>
          <h2 className={s.panelTitle}>{title}</h2>
          {hint && <p className={s.panelHint}>{hint}</p>}
        </div>
        {tag && <span className={s.tag}>{tag}</span>}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className={s.stat}>
      <p className={s.statLabel}>{label}</p>
      <p className={cx(s.statValue, s.mono)} style={tone ? { color: tone } : undefined}>
        {value}
      </p>
    </div>
  );
}

/** Animated circular gauge (used for the 4 permissions / 240 minutes quota). */
export function Ring({ value, max, label, sub, size = 132 }: { value: number; max: number; label: string; sub?: string; size?: number }) {
  const r = (size - 16) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const color = pct >= 1 ? "#ef4444" : pct >= 0.75 ? "#f5b942" : "#34d399";
  return (
    <div className={s.ringWrap}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={10} className={s.ringTrack} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={10}
            strokeLinecap="round"
            stroke={color}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            className={s.ringBar}
            style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
          <div>
            <div className={cx(s.ringCenter, s.mono)}>
              {ar(value)}
              <span style={{ fontSize: 13, color: "var(--dim)" }}> / {ar(max)}</span>
            </div>
            {sub && <div style={{ fontSize: 11, color: "var(--muted)" }}>{sub}</div>}
          </div>
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)" }}>{label}</p>
    </div>
  );
}
