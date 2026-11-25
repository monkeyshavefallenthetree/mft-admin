'use client';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

export type TrendMetric = {
  key: string;
  label: string;
  values: number[];
  summary: string;
  delta?: number | null;
  deltaLabel?: string;
  higherIsBetter?: boolean;
  accent?: string;
  format?: (n: number) => string;
  icon?: string;
};

const SPRING_EASE =
  "linear(0,0.009,0.035 2.1%,0.141,0.281 6.7%,0.723 12.9%,0.938 16.7%,1.017,1.077,1.121,1.149 24.3%,1.159,1.163,1.161,1.154 29.9%,1.129 32.8%,1.051 39.6%,1.017 43.1%,0.991,0.977 51%,0.974 53.8%,0.975 57.1%,0.997 69.8%,1.003 76.9%,1)";

function niceAxisMax(max: number) {
  if (!(max > 0)) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) {
    if (m * p >= max) return m * p;
  }
  return 10 * p;
}

function fillCells(values: number[], top: number, rows: number) {
  return values.map((v) =>
    v <= 0 ? 0 : Math.min(rows, Math.max(1, Math.round((v / top) * rows))),
  );
}

export function CellColumnTrend({
  metrics,
  labels,
  ticks,
  rows = 11,
}: {
  metrics: TrendMetric[];
  labels: string[];
  ticks?: string[];
  rows?: number;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(true);
  const [k, setK] = useState(0);
  const [active, setActive] = useState(-1);

  const m = metrics[Math.min(k, metrics.length - 1)];
  const n = m ? m.values.length : 0;
  const fmt = m?.format || ((v: number) => Math.round(v * 10) / 10 + "");
  const top = useMemo(() => niceAxisMax(Math.max(0, ...(m ? m.values : [0]))), [m]);
  const lv = useMemo(() => (m ? fillCells(m.values, top, rows) : []), [m, top, rows]);
  const xs = useMemo(() => {
    if (ticks && ticks.length) return ticks;
    if (labels.length <= 7) return labels;
    const step = Math.max(1, Math.floor(labels.length / 6));
    return labels.filter((_, i) => i % step === 0 || i === labels.length - 1);
  }, [ticks, labels]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!m) return null;
  const accentColor = m.accent || "#dc2626";
  const pct = n > 0 ? ((Math.max(active, 0) + 0.5) / n) * 100 : 0;
  const tipTop = (1 - (active >= 0 ? lv[active] : 0) / rows) * 100;

  return (
    <div
      ref={rootRef}
      className="relative w-full overflow-hidden select-none"
      style={
        {
          "--cct-accent": accentColor,
          "--cct-spring": SPRING_EASE,
        } as React.CSSProperties
      }
    >
      <style>{`
        @keyframes mft-cct-flip-a {
          0% { transform: scaleY(0.15) rotateX(80deg); opacity: 0; }
          100% { transform: none; opacity: 1; }
        }
        @keyframes mft-cct-flip-b {
          0% { transform: scaleY(0.15) rotateX(80deg); opacity: 0; }
          100% { transform: none; opacity: 1; }
        }
        .mft-cct-cell {
          flex: 1;
          border-radius: 3.5px;
          background: rgba(113, 113, 122, 0.11);
          transform-origin: 50% 100%;
          animation: var(--flip) 0.52s var(--cct-spring) both;
          animation-delay: calc(var(--c) * 11ms + var(--r) * 15ms);
          transition: background-color 0.22s ease, opacity 0.22s ease;
        }
        .mft-cct-cell.is-on {
          background: color-mix(in oklab, var(--cct-accent) 84%, #ffffff);
        }
        .mft-cct-cell.is-cap {
          background: color-mix(in oklab, var(--cct-accent) 50%, #ffffff);
        }
        html.dark .mft-cct-cell {
          background: rgba(255, 255, 255, 0.06);
        }
        html.dark .mft-cct-cell.is-on {
          background: color-mix(in oklab, var(--cct-accent) 88%, #000000);
        }
        html.dark .mft-cct-cell.is-cap {
          background: color-mix(in oklab, var(--cct-accent) 62%, #ffffff);
        }
        .mft-cct-plot.is-hot .mft-cct-col {
          opacity: 0.36;
        }
        .mft-cct-plot.is-hot .mft-cct-col.is-active {
          opacity: 1;
        }
        .mft-cct-col.is-active .mft-cct-cell.is-on {
          background: var(--cct-accent);
        }
      `}</style>

      {/* Matrix Plot Area */}
      <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-2.5 px-5 pt-5 pb-2">
        {/* Y-Axis Scale */}
        <div className="relative h-[200px]" aria-hidden="true">
          {[1, 0.75, 0.5, 0.25, 0].map((f) => (
            <span
              key={m.key + f}
              className="absolute right-0 -translate-y-1/2 font-code text-[10px] font-medium text-zinc-400"
              style={{ top: `${(1 - f) * 100}%` }}
            >
              {fmt(Math.round(top * f * 10) / 10)}
            </span>
          ))}
        </div>

        {/* Columns + Dashed Grid + Crosshair + Tooltip */}
        <div
          className={`mft-cct-plot relative flex h-[200px] gap-[3.5px] rounded-lg outline-none ${
            active >= 0 ? "is-hot" : ""
          }`}
          tabIndex={0}
          role="img"
          aria-label={`${m.label}: ${labels.map((l, i) => `${l} ${fmt(m.values[i] ?? 0)}`).join(", ")}`}
          onPointerLeave={() => setActive(-1)}
          onBlur={() => setActive(-1)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setActive(-1);
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              const step = e.key === "ArrowRight" ? 1 : -1;
              setActive((i) => Math.min(n - 1, Math.max(0, i < 0 ? 0 : i + step)));
            }
          }}
        >
          {/* Subtle horizontal dashed gridlines */}
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <span
              key={f}
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-zinc-200/70"
              style={{ top: `${(1 - f) * 100}%` }}
            />
          ))}

          {/* Stacked Cell Columns */}
          {seen &&
            lv.map((level, c) => (
              <div
                key={c}
                onPointerEnter={() => setActive(c)}
                onPointerDown={() => setActive(c)}
                className={`mft-cct-col relative flex flex-1 flex-col-reverse gap-[3px] cursor-crosshair transition-opacity duration-200 ${
                  c === active ? "is-active" : ""
                }`}
              >
                {Array.from({ length: rows }, (_, r) => (
                  <span
                    key={r}
                    className={`mft-cct-cell ${r < level ? "is-on" : ""} ${
                      r === level - 1 && level < rows ? "is-cap" : ""
                    }`}
                    style={
                      {
                        "--c": c,
                        "--r": r,
                        "--flip": k % 2 ? "mft-cct-flip-b" : "mft-cct-flip-a",
                      } as React.CSSProperties
                    }
                  />
                ))}
              </div>
            ))}

          {/* Hairline & Floating Tooltip */}
          {active >= 0 && (
            <>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-1.5 -bottom-1.5 w-0 border-l border-dashed border-zinc-500 transition-all duration-150"
                style={{ left: `${pct}%` }}
              />
              <div
                aria-live="polite"
                className="pointer-events-none absolute z-20 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs whitespace-nowrap transition-all duration-150"
                style={{
                  boxShadow: "var(--mft-shadow-lg)",
                  left: `${pct}%`,
                  top: `clamp(22px, ${tipTop}%, calc(100% - 28px))`,
                  transform:
                    pct > 66 ? "translate(calc(-100% - 12px), -50%)" : "translate(12px, -50%)",
                }}
              >
                <div className="text-[11px] font-medium text-zinc-400">{labels[active]}</div>
                <div className="mt-0.5 flex items-center gap-1.5 font-code text-sm font-bold text-zinc-900">
                  <span
                    className="h-2 w-2 rounded-[2px]"
                    style={{ backgroundColor: accentColor }}
                  />
                  {fmt(m.values[active] ?? 0)}
                </div>
              </div>
            </>
          )}
        </div>

        {/* X-Axis Labels + Active Pin */}
        <div className="relative col-start-2 h-7" aria-hidden="true">
          {xs.map((t, i) => (
            <span
              key={t + i}
              className="absolute top-2 -translate-x-1/2 text-[10px] font-medium text-zinc-400"
              style={{ left: `${((i + 0.5) / xs.length) * 100}%` }}
            >
              {t}
            </span>
          ))}
          {active >= 0 && (
            <span
              className="absolute top-1 z-10 -translate-x-1/2 rounded-full bg-zinc-900 px-2.5 py-0.5 font-code text-[10px] font-semibold text-white shadow-xs transition-all duration-150"
              style={{ left: `${pct}%` }}
            >
              {labels[active]}
            </span>
          )}
        </div>
      </div>

      {/* Bottom Interactive KPI Metric Tabs (Clicking flips the board!) */}
      <div
        role="tablist"
        aria-label="Telemetry metrics"
        className="relative grid grid-cols-2 border-t border-zinc-100 sm:grid-cols-4"
      >
        {metrics.map((item, i) => {
          const isSelected = i === k;
          const hasDelta = typeof item.delta === "number" && Number.isFinite(item.delta);
          const isZero = !hasDelta || Math.abs(item.delta ?? 0) < 0.005;
          const isGood =
            !isZero &&
            ((item.delta! > 0 && item.higherIsBetter !== false) ||
              (item.delta! < 0 && item.higherIsBetter === false));

          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setK(i)}
              className={`mft-tab-btn group relative flex flex-col justify-between border-r border-zinc-100 p-4 text-left transition-colors last:border-r-0 cursor-pointer ${
                isSelected ? "bg-zinc-50/90" : "hover:bg-zinc-50/50"
              }`}
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors"
                  style={{
                    backgroundColor: isSelected ? item.accent || "#dc2626" : "rgba(113,113,122,0.1)",
                    color: isSelected ? "#ffffff" : "#71717a",
                  }}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d={
                        item.icon ||
                        "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10"
                      }
                    />
                  </svg>
                </span>
                <span className="truncate">{item.label}</span>
              </div>

              <div
                className={`mt-2.5 font-code text-2xl font-bold tracking-tight tabular-nums transition-colors ${
                  isSelected ? "text-zinc-900" : "text-zinc-400 group-hover:text-zinc-700"
                }`}
              >
                {item.summary}
              </div>

              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
                {!isZero ? (
                  <span
                    className={`font-code font-semibold tabular-nums ${
                      isGood ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {item.delta! > 0 ? "+" : "−"}
                    {Math.min(999, Math.round(Math.abs(item.delta! * 100)))}%
                  </span>
                ) : null}
                <span className="truncate">{item.deltaLabel || "click to plot"}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Screen-reader data table */}
      <div className="sr-only">
        <table>
          <caption>{m.label}</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">{m.label}</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((l, idx) => (
              <tr key={idx}>
                <th scope="row">{l}</th>
                <td>{fmt(m.values[idx] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

