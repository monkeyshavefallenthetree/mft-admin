"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";

/* ═══════════════════════════════════════════════════════════════════════════
   MFT Studio Executive Analytics & Charting Kit
   Combines:
   1. 21st.dev Layro System (id: 33507) — AreaTrend, BarCompare, DonutBreakdown,
      Sparkline & KpiStatCard with directional delta semantics + sr-only tables.
   2. ConcentricRingsChart — Multi-ring radial velocity & compliance gauge.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  fillOpacity?: number;
  dashed?: boolean;
}

export interface ChartCardProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function ChartCard({
  title,
  subtitle,
  description,
  badge,
  actions,
  footer,
  children,
  className = "",
  noPadding = false,
}: ChartCardProps) {
  const subText = subtitle ?? description;
  return (
    <figure className={`ui-card m-0 flex flex-col justify-between overflow-hidden ${className}`}>
      <figcaption className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-bold tracking-tight text-zinc-900">{title}</h3>
            {badge}
          </div>
          {subText && <p className="mt-0.5 text-xs text-zinc-500">{subText}</p>}
        </div>
        {actions && <div className="mft-no-print flex shrink-0 items-center gap-2">{actions}</div>}
      </figcaption>
      <div className={`flex-1 ${noPadding ? "" : "p-5"}`}>{children}</div>
      {footer && (
        <div className="border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 text-xs text-zinc-500">
          {footer}
        </div>
      )}
    </figure>
  );
}

/* ───────────────────────── Accessible Hidden Data Table ───────────────────────── */
function DataTableFallback<T extends Record<string, unknown>>({
  caption,
  data,
  xKey,
  series,
  format = (v: number) => v.toLocaleString(),
}: {
  caption: string;
  data: T[];
  xKey: string;
  series: ChartSeries[];
  format?: (v: number) => string;
}) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{xKey}</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={idx}>
              <th scope="row">{String(row[xKey] ?? idx)}</th>
              {series.map((s) => (
                <td key={s.key}>{format(Number(row[s.key] ?? 0))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   2. Concentric Rings Radial Gauge (Attendance · Velocity · Client Sign-Off)
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RadialRingItem {
  key: string;
  label: string;
  sublabel: string;
  pct: number;
  color: string;
  href?: string;
}

export function ConcentricRingsChart({ rings }: { rings: RadialRingItem[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const radii = [50, 38, 26];
  const activeRing = rings.find((r) => r.key === hovered) ?? rings[0];

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div
        className="relative h-40 w-40 shrink-0"
        onMouseLeave={() => setHovered(null)}
      >
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          {rings.slice(0, 3).map((ring, idx) => {
            const r = radii[idx] ?? 26;
            const c = 2 * Math.PI * r;
            const clamped = Math.max(0, Math.min(100, ring.pct));
            const offset = c - (clamped / 100) * c;
            const isHot = hovered === ring.key;
            return (
              <g key={ring.key}>
                <circle
                  cx="60"
                  cy="60"
                  r={r}
                  fill="none"
                  stroke="currentColor"
                  className="text-zinc-100"
                  strokeWidth={8}
                />
                <circle
                  cx="60"
                  cy="60"
                  r={r}
                  fill="none"
                  stroke={ring.color}
                  strokeWidth={isHot ? 9.5 : 8}
                  strokeLinecap="round"
                  strokeDasharray={c}
                  strokeDashoffset={offset}
                  className="cursor-pointer transition-all duration-500"
                  style={{ opacity: hovered === null || isHot ? 1 : 0.35 }}
                  onMouseEnter={() => setHovered(ring.key)}
                />
              </g>
            );
          })}
        </svg>
        {activeRing && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="font-code text-lg font-bold tabular-nums text-zinc-900">
              {activeRing.pct}%
            </span>
            <span className="max-w-[72px] truncate text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
              {activeRing.label}
            </span>
          </div>
        )}
      </div>

      <div className="w-full flex-1 space-y-2.5">
        {rings.map((ring) => {
          const isHot = hovered === ring.key;
          const row = (
            <div
              onMouseEnter={() => setHovered(ring.key)}
              onMouseLeave={() => setHovered(null)}
              className={`rounded-xl border p-2.5 transition-all ${
                isHot
                  ? "border-zinc-300 bg-zinc-50"
                  : "border-zinc-100 bg-zinc-50/40 hover:bg-zinc-50"
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-semibold text-zinc-800">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: ring.color }}
                  />
                  {ring.label}
                </span>
                <span className="font-code font-bold tabular-nums text-zinc-900">
                  {ring.pct}%
                </span>
              </div>
              <p className="mt-0.5 pl-4.5 text-[11px] text-zinc-500">{ring.sublabel}</p>
            </div>
          );
          return ring.href ? (
            <Link key={ring.key} href={ring.href} className="block">
              {row}
            </Link>
          ) : (
            <div key={ring.key}>{row}</div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────── Smooth SVG Cubic-Bezier Path Builder ───────────────────────── */
function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cpx1 = p0.x + (p1.x - p0.x) * 0.42;
    const cpy1 = p0.y;
    const cpx2 = p0.x + (p1.x - p0.x) * 0.58;
    const cpy2 = p1.y;
    d += ` C ${cpx1.toFixed(1)} ${cpy1.toFixed(1)}, ${cpx2.toFixed(1)} ${cpy2.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  return d;
}

/* ───────────────────────── Sparkline ───────────────────────── */
export function Sparkline({
  data,
  color = "#dc2626",
  height = 34,
  width = 88,
  className = "",
}: {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  className?: string;
}) {
  const gradId = useId().replace(/:/g, "");
  const { linePath, areaPath, lastPt } = useMemo(() => {
    const clean = data.length >= 2 ? data : [0, ...(data.length ? data : [0])];
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const span = max - min || 1;
    const padX = 3;
    const padY = 4;
    const w = width - padX * 2;
    const h = height - padY * 2;
    const pts = clean.map((v, i) => ({
      x: padX + (i / Math.max(1, clean.length - 1)) * w,
      y: padY + h - ((v - min) / span) * h,
    }));
    const line = buildSmoothPath(pts);
    const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${(height - 1).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(height - 1).toFixed(1)} Z`;
    return { linePath: line, areaPath: area, lastPt: pts[pts.length - 1] };
  }, [data, width, height]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`shrink-0 overflow-visible ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0.0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${gradId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.85}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {lastPt && (
        <circle cx={lastPt.x} cy={lastPt.y} r={2.5} fill={color} className="ring-2 ring-white" />
      )}
    </svg>
  );
}

/* ───────────────────────── KPI Stat Card (with Delta + Sparkline) ───────────────────────── */
const TONE_MAP = {
  red: { bg: "bg-red-50", fg: "text-red-600", hex: "#dc2626", ring: "ring-red-200/70" },
  blue: { bg: "bg-blue-50", fg: "text-blue-600", hex: "#2563eb", ring: "ring-blue-200/70" },
  amber: { bg: "bg-amber-50", fg: "text-amber-600", hex: "#d97706", ring: "ring-amber-200/70" },
  emerald: { bg: "bg-emerald-50", fg: "text-emerald-600", hex: "#059669", ring: "ring-emerald-200/70" },
  violet: { bg: "bg-violet-50", fg: "text-violet-600", hex: "#7c3aed", ring: "ring-violet-200/70" },
  sky: { bg: "bg-sky-50", fg: "text-sky-600", hex: "#0284c7", ring: "ring-sky-200/70" },
  orange: { bg: "bg-orange-50", fg: "text-orange-600", hex: "#ea580c", ring: "ring-orange-200/70" },
  zinc: { bg: "bg-zinc-100", fg: "text-zinc-700", hex: "#52525b", ring: "ring-zinc-200/70" },
} as const;

export type KpiTone = keyof typeof TONE_MAP;

export interface KpiStatCardProps {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon?: string;
  tone?: KpiTone;
  href?: string;
  alert?: boolean;
  delta?: number | null;
  good?: "up" | "down";
  period?: string;
  trend?: number[];
}

export function KpiStatCard({
  label,
  value,
  sub,
  icon,
  tone = "zinc",
  href,
  alert,
  delta,
  good = "up",
  period = "vs prior 7d",
  trend,
}: KpiStatCardProps) {
  const t = TONE_MAP[tone];
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const isUp = (delta ?? 0) >= 0;
  const isZero = Math.abs(delta ?? 0) < 0.005;
  const isPositive = isZero ? null : (isUp && good === "up") || (!isUp && good === "down");

  const inner = (
    <div
      className={`ui-card relative flex h-full flex-col justify-between overflow-hidden p-4 transition-all duration-200 ${
        href ? "ui-card-hover group" : ""
      } ${alert ? "ring-1 ring-amber-400/70" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-zinc-500">{label}</p>
          <p className="mt-1.5 font-code text-2xl font-bold tracking-tight tabular-nums text-zinc-900">
            {value}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {alert && (
            <span className="relative flex h-2.5 w-2.5" title="Needs attention">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
          )}
          {icon && (
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${t.bg} ${t.fg}`}>
              <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
              </svg>
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2 pt-1">
        <div className="min-w-0 flex-1 space-y-1">
          {hasDelta && !isZero ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span
                className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-code font-semibold tabular-nums ${
                  isPositive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                }`}
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d={isUp ? "M7 17L17 7M17 7H8M17 7V16" : "M7 7L17 17M17 17H8M17 17V8"}
                  />
                </svg>
                {Math.min(999, Math.round(Math.abs((delta ?? 0) * 100)))}%
              </span>
              {period && <span className="truncate text-zinc-400">{period}</span>}
            </div>
          ) : null}
          {sub && <p className="truncate text-[11px] font-medium text-zinc-500">{sub}</p>}
        </div>

        {trend && trend.length > 1 && <Sparkline data={trend} color={t.hex} width={82} height={30} />}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {inner}
      </Link>
    );
  }
  return inner;
}

/* ───────────────────────── Interactive Multi-Series SVG Area Chart ───────────────────────── */
export function InteractiveAreaChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 230,
  format = (v: number) => `${v}`,
  referenceValue,
  referenceLabel,
  description,
}: {
  data: T[];
  xKey: keyof T & string;
  series: ChartSeries[];
  height?: number;
  format?: (v: number) => string;
  referenceValue?: number;
  referenceLabel?: string;
  description: string;
}) {
  const chartId = useId().replace(/:/g, "");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 720;
  const H = height;
  const padL = 44;
  const padR = 14;
  const padT = 16;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const { maxVal, yTicks, seriesPaths } = useMemo(() => {
    let max = 1;
    for (const row of data) {
      for (const s of series) {
        const v = Number(row[s.key] ?? 0);
        if (v > max) max = v;
      }
    }
    if (referenceValue && referenceValue > max) max = referenceValue;
    const niceMax = max <= 5 ? 5 : Math.ceil(max * 1.12);
    const ticks = [0, Math.round(niceMax * 0.33 * 10) / 10, Math.round(niceMax * 0.66 * 10) / 10, niceMax];

    const paths = series.map((s) => {
      const pts = data.map((row, i) => {
        const val = Number(row[s.key] ?? 0);
        const x = padL + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
        const y = padT + innerH - (val / niceMax) * innerH;
        return { x, y, val };
      });
      const line = buildSmoothPath(pts);
      const area =
        pts.length > 0
          ? `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${(padT + innerH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(padT + innerH).toFixed(1)} Z`
          : "";
      return { series: s, pts, line, area };
    });

    return { maxVal: niceMax, yTicks: ticks, seriesPaths: paths };
  }, [data, series, referenceValue, innerW, innerH]);

  const activeRow = hoverIdx !== null ? data[hoverIdx] : null;
  const activeX =
    hoverIdx !== null && data.length > 0
      ? padL + (data.length <= 1 ? innerW / 2 : (hoverIdx / (data.length - 1)) * innerW)
      : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 font-medium text-zinc-600">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
          {referenceValue !== undefined && referenceValue > 0 && (
            <span className="inline-flex items-center gap-1.5 text-zinc-400">
              <span className="h-0 w-3.5 border-t border-dashed border-zinc-400" />
              {referenceLabel ?? "Avg"}:{" "}
              <strong className="font-code font-semibold text-zinc-600">{format(referenceValue)}</strong>
            </span>
          )}
        </div>
      </div>

      <div
        role="img"
        aria-label={description}
        className="relative select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" style={{ height }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`area-${chartId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={s.fillOpacity ?? 0.22} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.01} />
              </linearGradient>
            ))}
          </defs>

          {yTicks.map((t, idx) => {
            const y = padT + innerH - (t / maxVal) * innerH;
            return (
              <g key={idx}>
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  className="text-zinc-100"
                  strokeWidth={1}
                />
                <text x={padL - 8} y={y + 3.5} textAnchor="end" className="fill-zinc-400 font-code text-[10px]">
                  {format(t)}
                </text>
              </g>
            );
          })}

          {referenceValue !== undefined && referenceValue > 0 && referenceValue <= maxVal && (
            <line
              x1={padL}
              x2={W - padR}
              y1={padT + innerH - (referenceValue / maxVal) * innerH}
              y2={padT + innerH - (referenceValue / maxVal) * innerH}
              stroke="#a1a1aa"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}

          {seriesPaths.map(({ series: s, line, area }) => (
            <g key={s.key}>
              {!s.dashed && <path d={area} fill={`url(#area-${chartId}-${s.key})`} />}
              <path
                d={line}
                fill="none"
                stroke={s.color}
                strokeWidth={2.2}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ))}

          {data.map((row, i) => {
            const stride = data.length > 20 ? Math.ceil(data.length / 7) : data.length > 10 ? 2 : 1;
            if (i % stride !== 0 && i !== data.length - 1) return null;
            const x = padL + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
            return (
              <text
                key={i}
                x={x}
                y={H - 6}
                textAnchor="middle"
                className={`text-[10px] font-medium ${
                  hoverIdx === i ? "fill-zinc-900 font-bold" : "fill-zinc-400"
                }`}
              >
                {String(row[xKey] ?? "")}
              </text>
            );
          })}

          {activeX !== null && hoverIdx !== null && (
            <g>
              <line
                x1={activeX}
                x2={activeX}
                y1={padT}
                y2={padT + innerH}
                stroke="#71717a"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {seriesPaths.map(({ series: s, pts }) => {
                const pt = pts[hoverIdx];
                if (!pt) return null;
                return (
                  <g key={s.key}>
                    <circle cx={pt.x} cy={pt.y} r={6} fill={s.color} fillOpacity={0.18} />
                    <circle cx={pt.x} cy={pt.y} r={3.5} fill={s.color} stroke="#ffffff" strokeWidth={1.75} />
                  </g>
                );
              })}
            </g>
          )}

          {data.map((_, i) => {
            const colW = innerW / Math.max(1, data.length);
            const x = padL + i * colW;
            return (
              <rect
                key={i}
                x={x}
                y={padT}
                width={colW}
                height={innerH}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIdx(i)}
              />
            );
          })}
        </svg>

        {activeRow && hoverIdx !== null && (
          <div
            className="pointer-events-none absolute top-2 z-20 min-w-[165px] rounded-xl border border-zinc-200 bg-white/95 px-3 py-2.5 text-xs backdrop-blur-md"
            style={{
              boxShadow: "var(--mft-shadow-lg)",
              left:
                hoverIdx > data.length * 0.65
                  ? "auto"
                  : `${Math.max(8, Math.min(72, (hoverIdx / Math.max(1, data.length - 1)) * 100))}%`,
              right:
                hoverIdx > data.length * 0.65
                  ? `${Math.max(4, (1 - hoverIdx / Math.max(1, data.length - 1)) * 100)}%`
                  : "auto",
            }}
          >
            <p className="mb-1.5 border-b border-zinc-100 pb-1 font-semibold text-zinc-900">
              {String(activeRow[xKey] ?? "")}
            </p>
            <ul className="space-y-1">
              {series.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-zinc-500">
                    <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-code font-semibold tabular-nums text-zinc-900">
                    {format(Number(activeRow[s.key] ?? 0))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <DataTableFallback caption={description} data={data} xKey={xKey} series={series} format={format} />
    </div>
  );
}

/* ───────────────────────── Interactive Stacked / Grouped Bar Chart ───────────────────────── */
export function InteractiveBarChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 220,
  format = (v: number) => `${v}`,
  stacked = false,
  referenceValue,
  referenceLabel,
  description,
}: {
  data: T[];
  xKey: keyof T & string;
  series: ChartSeries[];
  height?: number;
  format?: (v: number) => string;
  stacked?: boolean;
  referenceValue?: number;
  referenceLabel?: string;
  description: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const maxVal = useMemo(() => {
    let m = 1;
    for (const row of data) {
      if (stacked) {
        const sum = series.reduce((acc, s) => acc + Number(row[s.key] ?? 0), 0);
        if (sum > m) m = sum;
      } else {
        for (const s of series) {
          const v = Number(row[s.key] ?? 0);
          if (v > m) m = v;
        }
      }
    }
    if (referenceValue && referenceValue > m) m = referenceValue;
    return m <= 5 ? 5 : Math.ceil(m * 1.12);
  }, [data, series, stacked, referenceValue]);

  const refPct =
    referenceValue && referenceValue > 0 ? Math.min(98, (referenceValue / maxVal) * 100) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 font-medium text-zinc-600">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        {referenceValue !== undefined && referenceValue > 0 && (
          <span className="inline-flex items-center gap-1.5 text-zinc-400">
            <span className="h-0 w-3.5 border-t border-dashed border-zinc-400" />
            {referenceLabel ?? "Target"}:{" "}
            <strong className="font-code font-semibold text-zinc-600">{format(referenceValue)}</strong>
          </span>
        )}
      </div>

      <div
        role="img"
        aria-label={description}
        className="relative pt-4"
        style={{ height }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <div className="pointer-events-none absolute inset-x-0 top-4 bottom-7 flex flex-col justify-between">
          {[1, 0.66, 0.33, 0].map((ratio) => (
            <div key={ratio} className="flex items-center gap-2">
              <span className="w-9 text-right font-code text-[10px] text-zinc-400">
                {format(Math.round(maxVal * ratio * 10) / 10)}
              </span>
              <div className="flex-1 border-b border-dashed border-zinc-100" />
            </div>
          ))}
        </div>

        {refPct !== null && (
          <div
            className="pointer-events-none absolute right-0 left-11 z-10 border-t border-dashed border-red-400/70"
            style={{ bottom: `calc(28px + (100% - 44px) * ${refPct / 100})` }}
          />
        )}

        <div className="relative ml-11 flex h-[calc(100%-28px)] items-end gap-1.5 sm:gap-2.5">
          {data.map((row, idx) => {
            const isHovered = hoverIdx === idx;
            const total = series.reduce((acc, s) => acc + Number(row[s.key] ?? 0), 0);
            return (
              <div
                key={idx}
                className="group relative flex h-full flex-1 flex-col items-center justify-end"
                onMouseEnter={() => setHoverIdx(idx)}
              >
                <div className="relative flex h-full w-full max-w-[38px] flex-col justify-end overflow-hidden rounded-t-lg bg-zinc-100/70 p-[2px]">
                  {stacked ? (
                    <div className="flex h-full w-full flex-col-reverse justify-start overflow-hidden rounded-t-md">
                      {series.map((s) => {
                        const v = Number(row[s.key] ?? 0);
                        const hPct = (v / maxVal) * 100;
                        if (v <= 0) return null;
                        return (
                          <div
                            key={s.key}
                            className="w-full transition-all duration-300"
                            style={{
                              height: `${Math.max(4, hPct)}%`,
                              backgroundColor: s.color,
                              opacity: hoverIdx === null || isHovered ? 1 : 0.65,
                            }}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex h-full w-full items-end gap-[2px]">
                      {series.map((s) => {
                        const v = Number(row[s.key] ?? 0);
                        const hPct = (v / maxVal) * 100;
                        return (
                          <div
                            key={s.key}
                            className="flex-1 rounded-t-[4px] transition-all duration-300"
                            style={{
                              height: `${v > 0 ? Math.max(6, hPct) : 2}%`,
                              backgroundColor: v > 0 ? s.color : "transparent",
                              opacity: hoverIdx === null || isHovered ? 1 : 0.65,
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>

                {isHovered && (
                  <div
                    className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 min-w-[145px] -translate-x-1/2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs"
                    style={{ boxShadow: "var(--mft-shadow-lg)" }}
                  >
                    <p className="mb-1 border-b border-zinc-100 pb-1 font-semibold text-zinc-900">
                      {String(row[xKey] ?? "")}
                    </p>
                    {series.map((s) => (
                      <div key={s.key} className="flex items-center justify-between gap-3 py-0.5">
                        <span className="flex items-center gap-1.5 text-zinc-500">
                          <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: s.color }} />
                          {s.label}
                        </span>
                        <span className="font-code font-semibold tabular-nums text-zinc-900">
                          {format(Number(row[s.key] ?? 0))}
                        </span>
                      </div>
                    ))}
                    {series.length > 1 && stacked && (
                      <div className="mt-1 flex items-center justify-between border-t border-zinc-100 pt-1 font-semibold text-zinc-900">
                        <span>Total</span>
                        <span className="font-code tabular-nums">{format(Math.round(total * 10) / 10)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="ml-11 mt-2 flex items-center justify-between text-[10px] font-medium text-zinc-400">
          {data.map((row, idx) => {
            const stride = data.length > 16 ? Math.ceil(data.length / 6) : 1;
            if (stride > 1 && idx % stride !== 0 && idx !== data.length - 1) {
              return <span key={idx} className="flex-1" />;
            }
            return (
              <span
                key={idx}
                className={`flex-1 truncate text-center ${
                  hoverIdx === idx ? "font-bold text-zinc-900" : ""
                }`}
              >
                {String(row[xKey] ?? "")}
              </span>
            );
          })}
        </div>
      </div>

      <DataTableFallback caption={description} data={data} xKey={xKey} series={series} format={format} />
    </div>
  );
}

/* ───────────────────────── Interactive Donut Breakdown Chart ───────────────────────── */
export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
  href?: string;
}

export function DonutBreakdownChart({
  slices,
  centerLabel = "Total",
  centerValue,
  format = (v: number) => v.toLocaleString(),
  size = 156,
  description,
}: {
  slices: DonutSlice[];
  centerLabel?: string;
  centerValue?: string | number;
  format?: (v: number) => string;
  size?: number;
  description: string;
}) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const total = slices.reduce((acc, s) => acc + Math.max(0, s.value), 0);
  const safeTotal = Math.max(1, total);
  const r = 46;
  const circumference = 2 * Math.PI * r;

  const hoveredSlice = slices.find((s) => s.key === hoverKey) ?? null;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div
        role="img"
        aria-label={description}
        className="relative shrink-0"
        style={{ width: size, height: size }}
        onMouseLeave={() => setHoverKey(null)}
      >
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke="currentColor"
            className="text-zinc-100"
            strokeWidth={13}
          />
          {(() => {
            let acc = 0;
            return slices.map((s) => {
              if (s.value <= 0) return null;
              const dash = (s.value / safeTotal) * circumference;
              const offset = -(acc / safeTotal) * circumference;
              acc += s.value;
              const isHovered = hoverKey === s.key;
              return (
                <circle
                  key={s.key}
                  cx="60"
                  cy="60"
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={isHovered ? 16 : 13}
                  strokeDasharray={`${Math.max(0, dash - 1.5)} ${circumference}`}
                  strokeDashoffset={offset}
                  className="cursor-pointer transition-all duration-300"
                  style={{ opacity: hoverKey === null || isHovered ? 1 : 0.45 }}
                  onMouseEnter={() => setHoverKey(s.key)}
                />
              );
            });
          })()}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
          <span className="max-w-full truncate text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            {hoveredSlice ? hoveredSlice.label : centerLabel}
          </span>
          <span className="mt-0.5 font-code text-xl font-bold tracking-tight tabular-nums text-zinc-900">
            {hoveredSlice
              ? format(hoveredSlice.value)
              : centerValue !== undefined
                ? centerValue
                : format(total)}
          </span>
          {hoveredSlice && (
            <span className="font-code text-[10px] font-semibold tabular-nums text-zinc-500">
              {Math.round((hoveredSlice.value / safeTotal) * 100)}% share
            </span>
          )}
        </div>
      </div>

      <ul className="w-full flex-1 space-y-2.5">
        {slices.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          const isHovered = hoverKey === s.key;
          return (
            <li
              key={s.key}
              onMouseEnter={() => setHoverKey(s.key)}
              onMouseLeave={() => setHoverKey(null)}
              className={`rounded-lg px-2 py-1.5 text-xs transition-colors ${
                isHovered ? "bg-zinc-50" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} />
                <span className="flex-1 truncate font-medium text-zinc-700">{s.label}</span>
                <span className="font-code font-bold tabular-nums text-zinc-900">{format(s.value)}</span>
                <span className="w-9 text-right font-code text-[11px] tabular-nums text-zinc-400">
                  {pct}%
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: s.color }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ───────────────────────── 28-Day Workforce Activity Heatmap ───────────────────────── */
export interface HeatmapDay {
  date: string;
  label: string;
  hours: number;
  sessions: number;
  late: number;
}

export function AttendanceHeatmap({ days }: { days: HeatmapDay[] }) {
  const maxH = Math.max(1, ...days.map((d) => d.hours));

  const getIntensityClass = (h: number) => {
    if (h <= 0) return "bg-zinc-100 text-zinc-400 border-zinc-200/60";
    const ratio = h / maxH;
    if (ratio < 0.28) return "bg-red-100 text-red-900 border-red-200";
    if (ratio < 0.55) return "bg-red-300 text-red-950 border-red-400/50";
    if (ratio < 0.8) return "bg-red-500 text-white border-red-600";
    return "bg-red-600 text-white border-red-700 shadow-xs";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>Daily workspace hours intensity — last {days.length} days</span>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span>Less</span>
          <span className="h-3 w-3 rounded-[3px] border border-zinc-200 bg-zinc-100" />
          <span className="h-3 w-3 rounded-[3px] bg-red-100" />
          <span className="h-3 w-3 rounded-[3px] bg-red-300" />
          <span className="h-3 w-3 rounded-[3px] bg-red-500" />
          <span className="h-3 w-3 rounded-[3px] bg-red-600" />
          <span>Peak ({maxH}h)</span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {days.map((d) => (
          <div
            key={d.date}
            className={`group relative flex flex-col justify-between rounded-xl border p-2.5 transition-transform hover:-translate-y-0.5 ${getIntensityClass(
              d.hours,
            )}`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-semibold opacity-80">{d.label}</span>
              {d.late > 0 && (
                <span
                  className="h-2 w-2 rounded-full bg-amber-400 ring-2 ring-white"
                  title={`${d.late} late`}
                />
              )}
            </div>
            <p className="mt-2 font-code text-sm font-bold tabular-nums">{d.hours}h</p>
            <p className="text-[10px] opacity-75">{d.sessions} sess.</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarCompare<T extends Record<string, unknown>>(props: React.ComponentProps<typeof InteractiveBarChart<T>>) {
  return <InteractiveBarChart {...props} />;
}
export const DonutBreakdown = DonutBreakdownChart;
export const AreaTrend = InteractiveAreaChart;
