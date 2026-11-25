/**
 * End-to-end automated verification for:
 *  - Egypt (Africa/Cairo) timezone & DST math
 *  - workTime.ts effectiveSessionWorkMs caps & break handling
 *  - shiftLifecycle.ts exact 2h check-in, 15m warning, shift complete, & +6h auto clock-out
 *  - hrReports.ts Cairo lateness & payroll consistency
 *  - pushTransport.ts VAPID validation, APNs 4KB limit, Web Push & Expo Push payloads
 *  - public/sw.js, manifest.webmanifest, layout.tsx, vercel.json verification
 *  - reconcileActiveShifts() server cron integration (auto clock-out, dedupe, dead token pruning)
 *
 * Run:  node scripts/verify-time-and-cron.mts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(rootDir, "src");

// Resolve `@/*` and extensionless relative `.ts` imports natively in Node >= 22.15 / 24
module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(srcDir, specifier.slice(2));
      for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
        const candidate = base + ext;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const base = path.resolve(parentDir, specifier);
      for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
        const candidate = base + ext;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const cairoTime = await import("../src/lib/admin/cairoTime.ts");
const shiftLifecycle = await import("../src/lib/admin/shiftLifecycle.ts");
const workTime = await import("../src/lib/admin/workTime.ts");
const hrReports = await import("../src/lib/admin/hrReports.ts");
const pushTransport = await import("../src/lib/server/pushTransport.ts");
const firestoreRest = await import("../src/lib/server/firestoreRest.ts");
const reconcileMod = await import("../src/lib/server/reconcileShifts.ts");

let passed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  \u2717 ${name}\n      ${(e as Error).message.split("\n").join("\n      ")}`);
  }
}

const HOUR = 3_600_000;
const MIN = 60_000;

/* ─────────────────────────── [1] Cairo Timezone ─────────────────────────── */
console.log("\n[1] Africa/Cairo timezone & DST handling");

await test("00:30 Cairo in winter (22:30Z previous UTC day) resolves to Cairo date & minute 30", () => {
  const d = new Date("2026-11-24T22:30:00Z"); // 2026-11-25 00:30 Cairo (UTC+2)
  assert.equal(cairoTime.cairoYmd(d), "2026-11-25");
  assert.equal(cairoTime.cairoMinutesOfDay(d), 30);
});

await test("00:30 Cairo in summer DST (21:30Z previous UTC day) resolves to Cairo date & minute 30", () => {
  const d = new Date("2026-07-14T21:30:00Z"); // 2026-07-15 00:30 Cairo (UTC+3)
  assert.equal(cairoTime.cairoYmd(d), "2026-07-15");
  assert.equal(cairoTime.cairoMinutesOfDay(d), 30);
});

await test("cairoWallTimeToDate roundtrips both winter (+02) and summer DST (+03)", () => {
  const winter10 = cairoTime.cairoWallTimeToDate(2026, 11, 25, 10, 0, 0);
  assert.equal(winter10.toISOString(), "2026-11-25T08:00:00.000Z");
  assert.equal(cairoTime.cairoMinutesOfDay(winter10), 600);

  const summer10 = cairoTime.cairoWallTimeToDate(2026, 7, 15, 10, 0, 0);
  assert.equal(summer10.toISOString(), "2026-07-15T07:00:00.000Z");
  assert.equal(cairoTime.cairoMinutesOfDay(summer10), 600);
});

await test("cairoEndOfDayMs returns exact 23:59:59.999 Cairo", () => {
  const eod = cairoTime.cairoEndOfDayMs("2026-11-25");
  assert.equal(new Date(eod).toISOString(), "2026-11-25T21:59:59.999Z");
});

await test("cairoDayOfWeek & addDaysToYmd are TZ-independent", () => {
  assert.equal(cairoTime.cairoDayOfWeek("2026-11-27"), 5); // Friday
  assert.equal(cairoTime.cairoDayOfWeek("2026-11-28"), 6); // Saturday
  assert.equal(cairoTime.addDaysToYmd("2026-11-30", 1), "2026-12-01");
});

/* ─────────────────────────── [2] workTime.ts ─────────────────────────── */
console.log("\n[2] workTime.ts effectiveSessionWorkMs caps & breaks");

const t10 = cairoTime.cairoWallTimeToDate(2026, 11, 25, 10, 0, 0).getTime();

await test("Active today shift computes exact live elapsed ms", () => {
  const ms = workTime.effectiveSessionWorkMs(
    {
      date: "2026-11-25",
      isActive: true,
      startTime: new Date(t10),
      segmentStartAt: new Date(t10),
      bankedWorkTime: 0,
      totalWorkTime: 1 * HOUR,
    },
    t10 + 3.5 * HOUR,
  );
  assert.equal(ms, 3.5 * HOUR);
});

await test("Active today shift with midday break adds bankedWorkTime + current segment", () => {
  const resumeAt = t10 + 5 * HOUR; // 15:00 after 1h break
  const ms = workTime.effectiveSessionWorkMs(
    {
      date: "2026-11-25",
      isActive: true,
      startTime: new Date(t10),
      segmentStartAt: new Date(resumeAt),
      bankedWorkTime: 4 * HOUR,
      totalWorkTime: 4 * HOUR,
    },
    resumeAt + 2 * HOUR,
  );
  assert.equal(ms, 6 * HOUR);
});

await test("Unclosed active shift NEVER inflates past allowedMs (8h default, not 16h!)", () => {
  const ms = workTime.effectiveSessionWorkMs(
    {
      date: "2026-11-25",
      isActive: true,
      startTime: new Date(t10),
      segmentStartAt: new Date(t10),
      bankedWorkTime: 0,
      totalWorkTime: 13 * HOUR, // even corrupted stored value is clamped
    },
    t10 + 13.5 * HOUR,
  );
  assert.equal(ms, 8 * HOUR);
});

await test("Active shift with approved overtime allows up to standardHours + overtimeMinutes", () => {
  const ms = workTime.effectiveSessionWorkMs(
    {
      date: "2026-11-25",
      isActive: true,
      startTime: new Date(t10),
      segmentStartAt: new Date(t10),
      bankedWorkTime: 0,
      overtimeMinutes: 120,
    },
    t10 + 9.5 * HOUR,
  );
  assert.equal(ms, 9.5 * HOUR);
});

await test("Past-day unclosed session does not runaway-count and clamps corrupted storedMs", () => {
  const yesterday10 = cairoTime.cairoWallTimeToDate(2026, 11, 24, 10, 0, 0).getTime();
  const nextDayNoon = cairoTime.cairoWallTimeToDate(2026, 11, 25, 12, 0, 0).getTime();
  const ms = workTime.effectiveSessionWorkMs(
    {
      date: "2026-11-24",
      isActive: true,
      startTime: new Date(yesterday10),
      segmentStartAt: new Date(yesterday10),
      totalWorkTime: 14 * HOUR,
    },
    nextDayNoon,
  );
  assert.equal(ms, 8 * HOUR);
});

/* ─────────────────────────── [3] shiftLifecycle.ts ─────────────────────────── */
console.log("\n[3] shiftLifecycle.ts 2h check-in, shift warnings, & +6h auto clock-out");

await test("Active shift at 1h 50m triggers 2h check-in push with 10m countdown (deduped after)", () => {
  const baseSession = {
    id: "w1_2026-11-25",
    workerId: "w1",
    date: "2026-11-25",
    isActive: true,
    startTime: new Date(t10),
    segmentStartAt: new Date(t10),
    bankedWorkTime: 0,
    lastActiveCheckAtMs: t10,
  };
  const r1 = shiftLifecycle.evaluateShiftLifecycle(baseSession, {
    nowMs: t10 + 110 * MIN,
    todayCairoYmd: "2026-11-25",
  });
  assert.equal(r1.action, "checkin_due");
  assert.equal(r1.shouldSendCheckInPush, true);
  assert.equal(r1.shouldMarkIdle, false);
  assert.equal(r1.checkInSecondsRemaining, 600);

  const r2 = shiftLifecycle.evaluateShiftLifecycle(
    { ...baseSession, checkInNotifiedForAtMs: t10 },
    { nowMs: t10 + 115 * MIN, todayCairoYmd: "2026-11-25" },
  );
  assert.equal(r2.action, "checkin_due");
  assert.equal(r2.shouldSendCheckInPush, false);
  assert.equal(r2.shouldMarkIdle, false);

  const rIdle = shiftLifecycle.evaluateShiftLifecycle(
    { ...baseSession, checkInNotifiedForAtMs: t10 },
    { nowMs: t10 + 121 * MIN, todayCairoYmd: "2026-11-25" },
  );
  assert.equal(rIdle.action, "checkin_due");
  assert.equal(rIdle.checkInSecondsRemaining, 0);
  assert.equal(rIdle.shouldMarkIdle, true);
});

await test("7h 50m into 8h shift suppresses 2h check-in and triggers 15m shift warning instead", () => {
  const r = shiftLifecycle.evaluateShiftLifecycle(
    {
      date: "2026-11-25",
      isActive: true,
      startTime: new Date(t10),
      segmentStartAt: new Date(t10),
      bankedWorkTime: 0,
      lastActiveCheckAtMs: t10 + 6 * HOUR, // 16:00 -> 1h 50m ago at 17:50!
    },
    { nowMs: t10 + 7 * HOUR + 50 * MIN, todayCairoYmd: "2026-11-25" },
  );
  assert.equal(r.action, "shift_warning_15m");
  assert.equal(r.shouldSendWarningPush, true);
  assert.equal(r.shouldSendCheckInPush, false);
  assert.equal(r.shouldMarkIdle, false);
});

await test("Shift complete at 8h 00m 30s starts wall-clock grace deadline and suppresses 2h check-in", () => {
  const r = shiftLifecycle.evaluateShiftLifecycle(
    {
      date: "2026-11-25",
      isActive: true,
      startTime: new Date(t10),
      segmentStartAt: new Date(t10),
      bankedWorkTime: 0,
      lastActiveCheckAtMs: t10 + 5 * HOUR,
    },
    { nowMs: t10 + 8 * HOUR + 30_000, todayCairoYmd: "2026-11-25" },
  );
  assert.equal(r.action, "shift_complete");
  assert.equal(r.autoClockOutDeadlineMs, t10 + 8 * HOUR + 2 * MIN);
  assert.equal(r.shouldSendShiftCompletePush, true);
  assert.equal(r.shouldSendCheckInPush, false);
});

await test("CRITICAL REGRESSION: +6 hours after shift end auto clocks out capped at 18:00 (8h) and NEVER fires 2h check-in", () => {
  // 10:00 + 8h = 18:00 shift end. +5h55m later = 23:55 same Cairo day
  const almostMidnight = t10 + 13 * HOUR + 55 * MIN;
  const rSameDay = shiftLifecycle.evaluateShiftLifecycle(
    {
      date: "2026-11-25",
      isActive: true,
      startTime: new Date(t10),
      segmentStartAt: new Date(t10),
      bankedWorkTime: 0,
      lastActiveCheckAtMs: t10 + 6 * HOUR,
    },
    { nowMs: almostMidnight, todayCairoYmd: "2026-11-25" },
  );
  assert.equal(rSameDay.action, "auto_clock_out");
  assert.equal(rSameDay.autoClockOutReason, "shift_limit_reached");
  assert.equal(rSameDay.cappedLogoutMs, t10 + 8 * HOUR);
  assert.equal(rSameDay.cappedTotalWorkTimeMs, 8 * HOUR);
  assert.equal(rSameDay.shouldSendAutoClockOutPush, true);
  assert.equal(rSameDay.shouldSendCheckInPush, false);
  assert.equal(rSameDay.shouldMarkIdle, false);
  assert.equal(rSameDay.shouldSendWarningPush, false);
  assert.equal(rSameDay.shouldSendShiftCompletePush, false);

  // +6h later = 00:00 next Cairo day ("2026-11-26")
  const nextDayMidnight = t10 + 14 * HOUR;
  const rNextDay = shiftLifecycle.evaluateShiftLifecycle(
    {
      date: "2026-11-25",
      isActive: true,
      startTime: new Date(t10),
      segmentStartAt: new Date(t10),
      bankedWorkTime: 0,
      lastActiveCheckAtMs: t10 + 6 * HOUR,
    },
    { nowMs: nextDayMidnight, todayCairoYmd: "2026-11-26" },
  );
  assert.equal(rNextDay.action, "auto_clock_out");
  assert.equal(rNextDay.autoClockOutReason, "past_day_unclosed");
  assert.equal(rNextDay.cappedLogoutMs, t10 + 8 * HOUR);
  assert.equal(rNextDay.cappedTotalWorkTimeMs, 8 * HOUR);
  assert.equal(rNextDay.shouldSendCheckInPush, false);
});

await test("Early arrival (09:00) is NOT prematurely auto-clocked-out at 17:02; closes cleanly at 18:02 with logout 18:00 & 8h", () => {
  const t09 = cairoTime.cairoWallTimeToDate(2026, 11, 25, 9, 0, 0).getTime();
  const at1715 = cairoTime.cairoWallTimeToDate(2026, 11, 25, 17, 15, 0).getTime();
  const rMid = shiftLifecycle.evaluateShiftLifecycle(
    {
      date: "2026-11-25",
      isActive: true,
      startTime: new Date(t09),
      segmentStartAt: new Date(t09),
      bankedWorkTime: 0,
      lastActiveCheckAtMs: at1715 - 30 * MIN,
    },
    { nowMs: at1715, todayCairoYmd: "2026-11-25", policySettings: { policy2026Enabled: true, shiftStartTime: "10:00" } },
  );
  assert.equal(rMid.action, "ok");

  const at1802 = cairoTime.cairoWallTimeToDate(2026, 11, 25, 18, 2, 0).getTime();
  const rEnd = shiftLifecycle.evaluateShiftLifecycle(
    {
      date: "2026-11-25",
      isActive: true,
      startTime: new Date(t09),
      segmentStartAt: new Date(t09),
      bankedWorkTime: 0,
    },
    { nowMs: at1802, todayCairoYmd: "2026-11-25", policySettings: { policy2026Enabled: true, shiftStartTime: "10:00" } },
  );
  assert.equal(rEnd.action, "auto_clock_out");
  assert.equal(rEnd.cappedLogoutMs, cairoTime.cairoWallTimeToDate(2026, 11, 25, 18, 0, 0).getTime());
  assert.equal(rEnd.cappedTotalWorkTimeMs, 8 * HOUR);
});

await test("Overtime extension re-arms 15m warning and extends auto clock-out cap", () => {
  const rWarn = shiftLifecycle.evaluateShiftLifecycle(
    {
      date: "2026-11-25",
      isActive: true,
      startTime: new Date(t10),
      segmentStartAt: new Date(t10),
      bankedWorkTime: 0,
      shiftWarningNotifiedForMs: 8 * HOUR, // already notified for 8h shift
    },
    { nowMs: t10 + 9 * HOUR + 45 * MIN, todayCairoYmd: "2026-11-25", overtimeMinutes: 120 },
  );
  assert.equal(rWarn.action, "shift_warning_15m");
  assert.equal(rWarn.allowedMs, 10 * HOUR);
  assert.equal(rWarn.shouldSendWarningPush, true);
});

/* ─────────────────────────── [4] hrReports.ts ─────────────────────────── */
console.log("\n[4] hrReports.ts Cairo lateness & payroll consistency");

await test("calculateAttendancePolicy & isLateTodayHtml use Cairo whole-minute comparison + startTime fallback", () => {
  const onTime110059 = cairoTime.cairoWallTimeToDate(2026, 11, 25, 11, 0, 59);
  const late1101 = cairoTime.cairoWallTimeToDate(2026, 11, 25, 11, 1, 0);
  const veryLate1201 = cairoTime.cairoWallTimeToDate(2026, 11, 25, 12, 1, 0);

  assert.equal(hrReports.isLateTodayHtml({ startTime: { toDate: () => onTime110059 } }), false);
  assert.equal(hrReports.isLateTodayHtml({ startTime: { toDate: () => late1101 } }), true);

  const pOn = hrReports.calculateAttendancePolicy(
    { startTime: { toDate: () => onTime110059 }, isActive: true, date: "2026-11-25" },
    hrReports.DEFAULT_HR_SETTINGS,
    onTime110059.getTime() + 4 * HOUR,
  );
  assert.equal(pOn.isLate, false);
  assert.equal(pOn.attendanceStatus, "on-time");
  assert.equal(pOn.totalHours, 4);

  const pLate = hrReports.calculateAttendancePolicy(
    { loginTime: { toDate: () => late1101 }, totalWorkTime: 8 * HOUR, date: "2026-11-25" },
  );
  assert.equal(pLate.isLate, true);
  assert.equal(pLate.attendanceStatus, "late");
  assert.equal(pLate.latePenalty, 0.25);

  const pVeryLate = hrReports.calculateAttendancePolicy(
    { loginTime: { toDate: () => veryLate1201 }, totalWorkTime: 8 * HOUR, date: "2026-11-25" },
  );
  assert.equal(pVeryLate.attendanceStatus, "very-late");
  assert.equal(pVeryLate.latePenalty, 0.5);
});

await test("computePayrollForWorker caps unclosed shift at 8h and respects Cairo cycle boundaries", () => {
  const start = cairoTime.cairoWallTimeToDate(2026, 11, 21, 0, 0, 0);
  const end = cairoTime.cairoWallTimeToDate(2026, 11, 25, 23, 59, 59);
  const pay = hrReports.computePayrollForWorker(
    [
      {
        date: "2026-11-25",
        isActive: true,
        startTime: { toDate: () => new Date(t10) },
        loginTime: { toDate: () => new Date(t10) },
        totalWorkTime: 14 * HOUR, // corrupted runaway stored value
      },
    ],
    100,
    start,
    end,
    { settings: hrReports.DEFAULT_HR_SETTINGS, workerStartDate: "2026-11-25", capAtToday: false },
  );
  assert.equal(pay.daysWorked, 1);
  assert.equal(pay.totalHours, 8);
  assert.equal(pay.basePay, 800);
});

await test("getPayrollCycleRange & getHrDateRange produce exact Cairo cycle boundaries even under TZ=UTC", () => {
  const c1 = hrReports.getPayrollCycleRange(new Date("2026-11-25T10:00:00Z"), 21);
  assert.equal(cairoTime.cairoYmd(c1.start), "2026-11-21");
  assert.equal(cairoTime.cairoYmd(c1.end), "2026-12-20");

  const c2 = hrReports.getPayrollCycleRange(new Date("2026-11-15T10:00:00Z"), 21);
  assert.equal(cairoTime.cairoYmd(c2.start), "2026-10-21");
  assert.equal(cairoTime.cairoYmd(c2.end), "2026-11-20");

  const cCal = hrReports.getPayrollCycleRange(new Date("2026-11-25T10:00:00Z"), 1);
  assert.equal(cairoTime.cairoYmd(cCal.start), "2026-11-01");
  assert.equal(cairoTime.cairoYmd(cCal.end), "2026-11-30");

  const todayRange = hrReports.getHrDateRange("today");
  assert.equal(cairoTime.cairoYmd(todayRange.start), cairoTime.cairoYmd(todayRange.end));
});

/* ─────────────────────────── [5] Push Transport & PWA Assets ─────────────────────────── */
console.log("\n[5] Push transport, VAPID validation, APNs 4KB limit & PWA/SW checks");

await test("Default VAPID keypair validates cleanly via P-256 ECDH; mismatched keys fail", () => {
  const ok = pushTransport.validateVapidConfig();
  assert.equal(ok.valid, true, ok.reason);

  const badSubject = pushTransport.validateVapidConfig({
    ...pushTransport.getVapidConfig(),
    subject: "admin@mft.com",
  });
  assert.equal(badSubject.valid, false);

  const badPriv = pushTransport.validateVapidConfig({
    ...pushTransport.getVapidConfig(),
    privateKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  });
  assert.equal(badPriv.valid, false);
});

await test("buildWebPushSerializedPayload defaults requireInteraction=true, preserves dedupe tag, and caps huge Arabic text under 3500 bytes", () => {
  const hugeArabic = "تنبيه مهم جدًا بخصوص نهاية الوردية وتسجيل الخروج التلقائي ".repeat(120);
  const raw = pushTransport.buildWebPushSerializedPayload({
    title: "اختبار إشعار",
    body: hugeArabic,
    tag: "checkin-w1-12345",
    dedupe: true,
  });
  assert.ok(Buffer.byteLength(raw, "utf8") <= 3500, `Expected <= 3500 bytes, got ${Buffer.byteLength(raw, "utf8")}`);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.requireInteraction, true);
  assert.equal(parsed.tag, "checkin-w1-12345");
  assert.equal(parsed.dedupe, true);
});

await test("sendWebPushBatch sends TTL=86400 + urgency=high and collects 404/410 goneEndpoints", async () => {
  const capturedOpts: Array<{ TTL: number; urgency: string; topic?: string }> = [];
  const res = await pushTransport.sendWebPushBatch(
    [
      { endpoint: "https://push.example/ok", keys: { p256dh: "k1", auth: "a1" } },
      { endpoint: "https://push.example/gone410", keys: { p256dh: "k2", auth: "a2" } },
      { endpoint: "https://push.example/gone404", keys: { p256dh: "k3", auth: "a3" } },
    ],
    { title: "Test", body: "Hello", tag: "shift-1", dedupe: true },
    {
      sender: async (sub, _payload, opts) => {
        capturedOpts.push(opts);
        if (sub.endpoint.endsWith("410")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
        if (sub.endpoint.endsWith("404")) throw Object.assign(new Error("Not Found"), { statusCode: 404 });
      },
    },
  );
  assert.equal(res.sent, 1);
  assert.equal(res.failed, 2);
  assert.deepEqual(res.goneEndpoints.sort(), ["https://push.example/gone404", "https://push.example/gone410"]);
  assert.equal(capturedOpts[0]!.TTL, 86400);
  assert.equal(capturedOpts[0]!.urgency, "high");
  assert.equal(capturedOpts[0]!.topic, "shift-1");
});

await test("sendExpoPushBatch validates tokens, sends high-priority iOS+Android fields, and returns DeviceNotRegistered invalidTokens", async () => {
  let sentBody: unknown[] = [];
  const mockFetch = (async (_url: unknown, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body || "[]"));
    return new Response(
      JSON.stringify({
        data: [
          { status: "ok", id: "ticket-1" },
          { status: "error", message: "Not registered", details: { error: "DeviceNotRegistered" } },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const res = await pushTransport.sendExpoPushBatch(
    [
      { to: "ExponentPushToken[valid-1]", title: "Shift Alert", body: "Clock out", urgent: true, channelId: "alerts" },
      { to: "ExponentPushToken[dead-2]", title: "Shift Alert", body: "Clock out" },
      { to: "webp:[{\"endpoint\":\"x\"}]", title: "Should skip", body: "Not expo" },
    ],
    mockFetch,
  );
  assert.equal(res.sent, 1);
  assert.equal(res.failed, 2);
  assert.deepEqual(res.invalidTokens, ["ExponentPushToken[dead-2]"], "Only DeviceNotRegistered Expo tokens belong in invalidTokens, never legacy webp: strings");
  assert.equal(sentBody.length, 2);
  const first = sentBody[0] as Record<string, unknown>;
  assert.equal(first.priority, "high");
  assert.equal(first.ttl, 86400);
  assert.equal(first.badge, 1);
  assert.equal(first.mutableContent, true);
  assert.equal(first._displayInForeground, true);
  assert.equal(first.interruptionLevel, "time-sensitive");
  assert.equal(first.channelId, "alerts");
  assert.equal("android" in first, false);
});

await test("public/sw.js parses cleanly, handles push (with 3-tier iOS fallback), pushsubscriptionchange, and admin-only notificationclick", async () => {
  const swCode = fs.readFileSync(path.join(rootDir, "public/sw.js"), "utf8");
  const listeners = new Map<string, (ev: any) => void>();
  const shown: Array<{ title: string; opts: Record<string, unknown> }> = [];
  let openedUrl: string | null = null;
  let focusedClientUrl: string | null = null;
  let throwOnce = true;

  const sandbox: any = {
    URL,
    Date,
    Uint8Array,
    atob: (b: string) => Buffer.from(b, "base64").toString("binary"),
    fetch: async () => ({ ok: true, json: async () => ({ publicKey: pushTransport.DEFAULT_VAPID_PUBLIC_KEY }) }),
    self: {
      location: { origin: "https://admin.mft.test" },
      addEventListener: (ev: string, fn: (e: any) => void) => listeners.set(ev, fn),
      skipWaiting: async () => {},
      navigator: { setAppBadge: async () => {}, clearAppBadge: async () => {} },
      registration: {
        showNotification: async (title: string, opts: Record<string, unknown>) => {
          if (throwOnce) {
            throwOnce = false;
            throw new Error("Simulated iOS WebKit unsupported option");
          }
          shown.push({ title, opts });
        },
        pushManager: {
          subscribe: async () => ({ toJSON: () => ({ endpoint: "https://rotated", keys: { p256dh: "p", auth: "a" } }) }),
        },
      },
      clients: {
        claim: async () => {},
        matchAll: async () => [
          {
            url: "https://admin.mft.test/client",
            focus: async () => {
              focusedClientUrl = "https://admin.mft.test/client";
            },
            postMessage: () => {},
          },
        ],
        openWindow: async (u: string) => {
          openedUrl = u;
        },
      },
    },
  };
  sandbox.self.atob = sandbox.atob;
  vm.runInNewContext(swCode, sandbox);

  assert.ok(listeners.has("push"), "missing push listener");
  assert.ok(listeners.has("pushsubscriptionchange"), "missing pushsubscriptionchange listener");
  assert.ok(listeners.has("notificationclick"), "missing notificationclick listener");

  // Simulate push event with first showNotification throwing (tests 3-tier iOS fallback)
  let waitPromise: Promise<unknown> = Promise.resolve();
  listeners.get("push")!({
    data: {
      json: () => ({
        title: "Auto Clocked Out",
        body: "Shift closed cleanly",
        tag: "auto-1",
        dedupe: true,
        url: "/admin/work-sessions",
      }),
    },
    waitUntil: (p: Promise<unknown>) => {
      waitPromise = p;
    },
  });
  await waitPromise;
  assert.equal(shown.length, 1);
  assert.equal(shown[0]!.title, "Auto Clocked Out");
  assert.equal(shown[0]!.opts.tag, "auto-1");

  // Simulate notificationclick — MUST NOT hijack `/client` tab, must open absolute `/admin/work-sessions`
  listeners.get("notificationclick")!({
    notification: { close: () => {}, data: { url: "/admin/work-sessions" } },
    waitUntil: (p: Promise<unknown>) => {
      waitPromise = p;
    },
  });
  await waitPromise;
  assert.equal(focusedClientUrl, null, "SW must never hijack external /client tab");
  assert.equal(openedUrl, "https://admin.mft.test/admin/work-sessions");
});

await test("PWA manifest, PNG icons, layout apple-mobile-web-app-capable meta, & vercel.json are valid", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "public/manifest.webmanifest"), "utf8"));
  assert.equal(manifest.id, "/admin");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 4);
  for (const icon of manifest.icons) {
    assert.notEqual(icon.purpose, "any maskable", "split deprecated combined purpose");
    const filePath = path.join(rootDir, "public", icon.src.replace(/^\//, ""));
    assert.ok(fs.existsSync(filePath), `Missing icon ${icon.src}`);
    const head = fs.readFileSync(filePath).subarray(0, 4);
    assert.deepEqual(Array.from(head), [0x89, 0x50, 0x4e, 0x47], `${icon.src} must be valid PNG`);
  }

  const layout = fs.readFileSync(path.join(rootDir, "src/app/layout.tsx"), "utf8");
  assert.match(layout, /name="apple-mobile-web-app-capable"\s+content="yes"/);

  const vercel = JSON.parse(fs.readFileSync(path.join(rootDir, "vercel.json"), "utf8"));
  assert.equal(vercel.crons[0].path, "/api/cron/reconcile-shifts");
});

await test("verifyAdminFirebaseIdToken allows super_admin/hr_admin emails and rejects ops_admin (mayamahmoud@mft.com)", async () => {
  const mockLookup = (email: string) =>
    (async () =>
      new Response(JSON.stringify({ users: [{ localId: "u1", email }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

  const opsRes = await firestoreRest.verifyAdminFirebaseIdToken(
    "fake-ops-token-12345678901234567890",
    mockLookup("mayamahmoud@mft.com"),
  );
  assert.equal(opsRes.valid, false);

  const hrRes = await firestoreRest.verifyAdminFirebaseIdToken(
    "fake-hr-token-12345678901234567890",
    mockLookup("hr@mft.com"),
  );
  assert.equal(hrRes.valid, true);

  const superRes = await firestoreRest.verifyAdminFirebaseIdToken(
    "fake-admin-token-12345678901234567890",
    mockLookup("admin@mft.com"),
  );
  assert.equal(superRes.valid, true);
});

/* ─────────────────────────── [6] End-to-End Cron Reconciler ─────────────────────────── */
console.log("\n[6] Server-side reconcileActiveShifts() integration");

function createMockFirestore(initialDocs: Record<string, Record<string, unknown>>) {
  const store = new Map<string, Record<string, unknown>>();
  for (const [k, v] of Object.entries(initialDocs)) {
    store.set(k, structuredClone(v));
  }
  let autoId = 1;
  return {
    store,
    client: {
      async getDocument(docPath: string) {
        const clean = docPath.replace(/^\/+/, "");
        const data = store.get(clean);
        if (!data) return null;
        const parts = clean.split("/");
        return { id: parts[parts.length - 1]!, path: clean, data: structuredClone(data) };
      },
      async queryCollection(
        collectionId: string,
        filters: Array<{ field: string; op: "EQUAL" | "LESS_THAN" | "GREATER_THAN"; value: unknown }>,
      ) {
        const out = [];
        for (const [k, data] of store.entries()) {
          if (!k.startsWith(`${collectionId}/`)) continue;
          const id = k.slice(collectionId.length + 1);
          if (id.includes("/")) continue;
          let match = true;
          for (const f of filters) {
            const v = data[f.field];
            if (f.op === "EQUAL" && v !== f.value) match = false;
          }
          if (match) out.push({ id, path: k, data: structuredClone(data) });
        }
        return out;
      },
      async patchDocument(docPath: string, fields: Record<string, unknown>) {
        const clean = docPath.replace(/^\/+/, "");
        const prev = store.get(clean) || {};
        store.set(clean, { ...prev, ...structuredClone(fields) });
      },
      async createDocument(collectionId: string, fields: Record<string, unknown>) {
        const id = `doc_${autoId++}`;
        store.set(`${collectionId}/${id}`, structuredClone(fields));
        return id;
      },
    },
  };
}

await test("Closed app +6h past shift: auto clocks out at 18:00 (8h), sends ONE persistent push, prunes dead endpoints & tokens, never sends 2h check-in", async () => {
  const mockDb = createMockFirestore({
    "settings/hr": { standardHours: 8, autoClockOutGraceMinutes: 2, policy2026Enabled: true, shiftStartTime: "10:00" },
    "workers/w1": {
      firstName: "Ahmed",
      isOnline: true,
      presenceStatus: "active",
      expoPushToken: "ExponentPushToken[dead-token]",
      webPushSubscriptions: [
        { endpoint: "https://push.example/ios-alive", keys: { p256dh: "p1", auth: "a1" } },
        { endpoint: "https://push.example/android-410", keys: { p256dh: "p2", auth: "a2" } },
      ],
    },
    "workSessions/w1_2026-11-25": {
      workerId: "w1",
      workerName: "Ahmed Ali",
      date: "2026-11-25",
      isActive: true,
      startTime: new Date(t10),
      loginTime: new Date(t10),
      segmentStartAt: new Date(t10),
      bankedWorkTime: 0,
      totalWorkTime: 13 * HOUR,
      lastActiveCheckAtMs: t10 + 6 * HOUR,
      overtimeMinutes: 120, // stale OT that was REJECTED below!
    },
    "exceptionRequests/ot_rej_1": {
      workerId: "w1",
      type: "overtime",
      exceptionDate: "2026-11-25",
      lateMinutes: 120,
      status: "rejected",
    },
    "adminPushSubscriptions/admin1": {
      uid: "admin1",
      role: "hr_admin",
      subscriptions: [{ endpoint: "https://push.example/hr-ios", keys: { p256dh: "p3", auth: "a3" } }],
    },
  });

  const webPushes: Array<{ endpoints: string[]; payload: any }> = [];
  const expoPushes: Array<{ tokens: string[]; title: string }> = [];

  const summary = await reconcileMod.reconcileActiveShifts({
    firestore: mockDb.client,
    nowMs: t10 + 13 * HOUR + 55 * MIN, // 23:55 Cairo (+5h55m after 18:00 shift end!)
    sendWebPush: async (subs, payload) => {
      webPushes.push({ endpoints: subs.map((s) => s.endpoint), payload });
      const gone = subs.filter((s) => s.endpoint.includes("410")).map((s) => s.endpoint);
      return { sent: subs.length - gone.length, failed: gone.length, goneEndpoints: gone, errors: [] };
    },
    sendExpoPush: async (msgs) => {
      expoPushes.push({ tokens: msgs.map((m) => m.to), title: msgs[0]!.title });
      return {
        ok: false,
        sent: 0,
        failed: msgs.length,
        invalidTokens: msgs.map((m) => m.to),
        tickets: [],
        data: [],
        errors: [],
      };
    },
  });

  assert.equal(summary.autoClockedOut, 1);
  assert.equal(summary.checkInNotified, 0, "MUST NOT send 2h check-in 6h after shift");
  assert.equal(summary.markedIdle, 0);
  assert.equal(summary.cleanedEndpoints, 1);
  assert.equal(summary.cleanedTokens, 1);

  const patchedSession = mockDb.store.get("workSessions/w1_2026-11-25")!;
  assert.equal(patchedSession.isActive, false);
  assert.equal(patchedSession.autoClockedOut, true);
  assert.equal(patchedSession.autoClockOutReason, "shift_limit_reached");
  assert.equal(patchedSession.totalWorkTime, 8 * HOUR);
  assert.equal((patchedSession.logoutTime as Date).getTime(), t10 + 8 * HOUR);
  assert.equal(patchedSession.overtimeMinutes, 0);

  const patchedWorker = mockDb.store.get("workers/w1")!;
  assert.equal(patchedWorker.isOnline, false);
  assert.equal(patchedWorker.presenceStatus, "offline");
  assert.equal(patchedWorker.expoPushToken, null, "DeviceNotRegistered token pruned");
  assert.equal((patchedWorker.webPushSubscriptions as any[]).length, 1, "410 gone endpoint pruned");

  // Worker received Auto Clocked Out push with requireInteraction=true, dedupe=true, tab=time, & aligned mft-* tag
  const workerPush = webPushes.find((p) => p.endpoints.includes("https://push.example/ios-alive"));
  assert.ok(workerPush, "Worker should receive Web Push");
  assert.match(workerPush!.payload.title, /Auto Clocked Out/);
  assert.equal(workerPush!.payload.url, "/dashboard?tab=time");
  assert.equal(workerPush!.payload.tab, "time");
  assert.equal(workerPush!.payload.tag, "mft-auto-clockout-w1_2026-11-25");
  assert.equal(workerPush!.payload.requireInteraction, true);
  assert.equal(workerPush!.payload.dedupe, true);

  // Re-running immediately is 100% idempotent (0 scanned active sessions)
  const summary2 = await reconcileMod.reconcileActiveShifts({
    firestore: mockDb.client,
    nowMs: t10 + 13 * HOUR + 56 * MIN,
    sendWebPush: async () => {
      throw new Error("Should not send duplicate pushes on second run");
    },
    sendExpoPush: async () => {
      throw new Error("Should not send duplicate expo pushes on second run");
    },
  });
  assert.equal(summary2.scanned, 0);
});

await test("Active shift 2h check-in fires once at 1h 50m, dedupes at 1h 55m, and marks idle at 2h 01m", async () => {
  const mockDb = createMockFirestore({
    "settings/hr": { standardHours: 8 },
    "workers/w2": {
      firstName: "Sara",
      isOnline: true,
      presenceStatus: "active",
      webPushSubscriptions: [{ endpoint: "https://push.example/sara", keys: { p256dh: "p", auth: "a" } }],
    },
    "workSessions/w2_2026-11-25": {
      workerId: "w2",
      workerName: "Sara",
      date: "2026-11-25",
      isActive: true,
      startTime: new Date(t10),
      segmentStartAt: new Date(t10),
      bankedWorkTime: 0,
      lastActiveCheckAtMs: t10,
      presenceStatus: "active",
    },
  });

  let pushCount = 0;
  const capturedPayloads: any[] = [];
  const noopPush = async (subs: any[], payload: any) => {
    pushCount += subs.length;
    capturedPayloads.push(payload);
    return { sent: subs.length, failed: 0, goneEndpoints: [], errors: [] };
  };

  // Run 1 at 11:50 (1h 50m) -> sends check-in push with aligned mft-checkin-* tag & tab=time
  const s1 = await reconcileMod.reconcileActiveShifts({
    firestore: mockDb.client,
    nowMs: t10 + 110 * MIN,
    sendWebPush: noopPush,
  });
  assert.equal(s1.checkInNotified, 1);
  assert.equal(s1.markedIdle, 0);
  assert.equal(pushCount, 1);
  assert.equal(capturedPayloads[0]!.url, "/dashboard?tab=time");
  assert.equal(capturedPayloads[0]!.tab, "time");
  assert.equal(capturedPayloads[0]!.tag, `mft-checkin-w2_2026-11-25-${t10}`);

  // Run 2 at 11:55 -> deduped! 0 new pushes
  const s2 = await reconcileMod.reconcileActiveShifts({
    firestore: mockDb.client,
    nowMs: t10 + 115 * MIN,
    sendWebPush: noopPush,
  });
  assert.equal(s2.checkInNotified, 0);
  assert.equal(s2.markedIdle, 0);
  assert.equal(pushCount, 1);

  // Run 3 at 12:01 (past 2h) -> marks idle (and logs adminNotifications eventType="missed_checkin")
  const s3 = await reconcileMod.reconcileActiveShifts({
    firestore: mockDb.client,
    nowMs: t10 + 121 * MIN,
    sendWebPush: noopPush,
  });
  assert.equal(s3.checkInNotified, 0);
  assert.equal(s3.markedIdle, 1);
  assert.equal(mockDb.store.get("workSessions/w2_2026-11-25")!.presenceStatus, "idle");
  assert.equal(mockDb.store.get("workers/w2")!.presenceStatus, "idle");
  const adminNotif = Array.from(mockDb.store.entries()).find(([k]) => k.startsWith("adminNotifications/"))?.[1];
  assert.equal(adminNotif?.eventType, "missed_checkin");
});

await test("Approved 120m OT extends shift to 10h: warns at 19:45, completes at 20:00, auto clocks out at 20:02 (10h)", async () => {
  const mockDb = createMockFirestore({
    "settings/hr": { standardHours: 8, autoClockOutGraceMinutes: 2 },
    "workers/w3": {
      firstName: "Omar",
      isOnline: true,
      webPushSubscriptions: [{ endpoint: "https://push.example/omar", keys: { p256dh: "p", auth: "a" } }],
    },
    "workSessions/w3_2026-11-25": {
      workerId: "w3",
      workerName: "Omar",
      date: "2026-11-25",
      isActive: true,
      startTime: new Date(t10),
      segmentStartAt: new Date(t10),
      bankedWorkTime: 0,
      lastActiveCheckAtMs: t10 + 8 * HOUR,
    },
    "exceptionRequests/ot_app_1": {
      workerId: "w3",
      type: "overtime",
      exceptionDate: "2026-11-25",
      lateMinutes: 120,
      status: "approved",
    },
  });

  const otPayloads: any[] = [];
  const noopPush = async (subs: any[], payload: any) => {
    otPayloads.push(payload);
    return { sent: subs.length, failed: 0, goneEndpoints: [], errors: [] };
  };

  const sWarn = await reconcileMod.reconcileActiveShifts({
    firestore: mockDb.client,
    nowMs: t10 + 9 * HOUR + 45 * MIN,
    sendWebPush: noopPush,
  });
  assert.equal(sWarn.shiftWarningNotified, 1);
  assert.equal(sWarn.autoClockedOut, 0);
  assert.equal(otPayloads[0]!.tag, `mft-shift-15m-w3_2026-11-25-${10 * HOUR}`);
  assert.equal(otPayloads[0]!.url, "/dashboard?tab=time");

  const sComplete = await reconcileMod.reconcileActiveShifts({
    firestore: mockDb.client,
    nowMs: t10 + 10 * HOUR + 30_000,
    sendWebPush: noopPush,
  });
  assert.equal(sComplete.shiftCompleteNotified, 1);
  assert.equal(sComplete.autoClockedOut, 0);
  assert.equal(otPayloads[1]!.tag, `mft-shift-complete-w3_2026-11-25-${10 * HOUR}`);
  assert.equal(otPayloads[1]!.tab, "time");

  const sOut = await reconcileMod.reconcileActiveShifts({
    firestore: mockDb.client,
    nowMs: t10 + 10 * HOUR + 2 * MIN,
    sendWebPush: noopPush,
  });
  assert.equal(sOut.autoClockedOut, 1);
  assert.equal(mockDb.store.get("workSessions/w3_2026-11-25")!.totalWorkTime, 10 * HOUR);
});

await test("Active session missing `date` derives Cairo date from startTime for OT lookup & past-day closure", async () => {
  const yest10 = cairoTime.cairoWallTimeToDate(2026, 11, 24, 10, 0, 0).getTime();
  const mockDb = createMockFirestore({
    "settings/hr": { standardHours: 8, autoClockOutGraceMinutes: 2 },
    "workers/w4": { firstName: "Nour", isOnline: true },
    "workSessions/legacy_no_date": {
      workerId: "w4",
      workerName: "Nour",
      // date intentionally omitted
      isActive: true,
      startTime: new Date(yest10),
      segmentStartAt: new Date(yest10),
      bankedWorkTime: 0,
    },
    "exceptionRequests/ot_yest": {
      workerId: "w4",
      type: "overtime",
      exceptionDate: "2026-11-24",
      lateMinutes: 60,
      status: "approved",
    },
  });

  const summary = await reconcileMod.reconcileActiveShifts({
    firestore: mockDb.client,
    nowMs: t10, // 2026-11-25 10:00 Cairo
    sendWebPush: async () => ({ sent: 0, failed: 0, goneEndpoints: [], errors: [] }),
  });
  assert.equal(summary.autoClockedOut, 1);
  const closed = mockDb.store.get("workSessions/legacy_no_date")!;
  assert.equal(closed.autoClockOutReason, "past_day_unclosed");
  assert.equal(closed.totalWorkTime, 9 * HOUR, "Should match 2026-11-24 approved 60m OT via derived Cairo date");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failed:\n - " + failures.join("\n - "));
  process.exit(1);
}
