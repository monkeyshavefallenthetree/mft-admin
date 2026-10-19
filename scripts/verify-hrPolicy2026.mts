/**
 * HR-POL-2026 engine verification — every V2.0 edge case as an assertion.
 * Run:  node scripts/verify-hrPolicy2026.mts      (Node ≥ 22.6, native TS stripping)
 */
import assert from "node:assert/strict";
import {
  POLICY_2026_DEFAULTS as CFG,
  auditAttendanceLog,
  chargeableMinutes,
  computeLeaveAccrual,
  evaluateClockIn,
  evaluateEarlyLeave,
  parseAuditLog,
  payableOvertimeForDay,
  policyConfigFromSettings,
  requiredShiftEnd,
  splitOvertimePay,
  usageFromLedger,
  validateLeaveRequest,
  validatePermissionRequest,
  validateReimbursement,
  isPolicy2026Active,
  completedMonthsBetween,
  parseYmd,
} from "../src/lib/admin/hrPolicy2026.ts";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  \u2717 ${name}\n      ${(e as Error).message.split("\n").join("\n      ")}`);
  }
}
const at = (hm: string, day = "2026-10-21", sec = 0) => {
  const [h, m] = hm.split(":").map(Number);
  const d = parseYmd(day)!;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h!, m!, sec);
};
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

console.log("\n[1] Biometric 1-minute rule & rounding");
test("11:00:59 is on time (seconds truncated)", () => {
  assert.equal(evaluateClockIn(at("11:00", undefined, 59)).status, "on-time");
});
test("11:01 is late and charges the 30 min floor", () => {
  const r = evaluateClockIn(at("11:01"));
  assert.equal(r.status, "late-covered");
  assert.equal(r.lateMinutes, 1);
  assert.equal(r.chargedMinutes, 30);
  assert.deepEqual(r.remainingAfter, { count: 3, minutes: 210 });
});
test("rounding: 1→30, 30→30, 31→45, 35→45, 46→60, 106→120", () => {
  assert.deepEqual([1, 30, 31, 35, 46, 106].map((m) => chargeableMinutes(m)), [30, 30, 45, 45, 60, 120]);
});
test("11:35 (35 min late) charges 45 min", () => {
  assert.equal(evaluateClockIn(at("11:35")).chargedMinutes, 45);
});

console.log("\n[2] Quota exhaustion & caps");
test("11:01 after 4 permissions used → uncovered, 0.25 day fallback", () => {
  const r = evaluateClockIn(at("11:01"), { count: 4, minutes: 120 });
  assert.equal(r.status, "late-uncovered");
  assert.equal(r.uncoveredReason, "count_exhausted");
  assert.equal(r.fallbackPenaltyDays, 0.25);
});
test("no partial coverage: 20 min left, 30 needed → uncovered", () => {
  const r = evaluateClockIn(at("11:10"), { count: 3, minutes: 220 });
  assert.equal(r.uncoveredReason, "minutes_exhausted");
});
test("exactly fits: 3 used / 210 min + 30 = 240 → covered", () => {
  const r = evaluateClockIn(at("11:05"), { count: 3, minutes: 210 });
  assert.equal(r.status, "late-covered");
  assert.deepEqual(r.remainingAfter, { count: 0, minutes: 0 });
});
test("uncovered after 12:00 → 0.5 day fallback", () => {
  assert.equal(evaluateClockIn(at("12:01"), { count: 4, minutes: 240 }).fallbackPenaltyDays, 0.5);
});
test("lateness > 120 min (13:05) → over_single_cap, 0.5 day, no quota consumed", () => {
  const r = evaluateClockIn(at("13:05"));
  assert.equal(r.uncoveredReason, "over_single_cap");
  assert.equal(r.fallbackPenaltyDays, 0.5);
  assert.deepEqual(r.usageAfter, { count: 0, minutes: 0 });
});
test("lateness 106 min → charged 120 and covered (boundary)", () => {
  const r = evaluateClockIn(at("12:46"));
  assert.equal(r.status, "late-covered");
  assert.equal(r.chargedMinutes, 120);
});
test("usageFromLedger ignores reversed, uncovered, and 0-min admin excuse entries", () => {
  const u = usageFromLedger([
    { workerId: "w", date: "2026-10-21", kind: "late", actualMinutes: 5, chargedMinutes: 30, covered: true, status: "applied" },
    { workerId: "w", date: "2026-10-22", kind: "late", actualMinutes: 5, chargedMinutes: 30, covered: true, status: "reversed" },
    { workerId: "w", date: "2026-10-23", kind: "late", actualMinutes: 200, chargedMinutes: 0, covered: false, status: "applied" },
    { workerId: "w", date: "2026-10-24", kind: "late", actualMinutes: 45, chargedMinutes: 0, covered: true, status: "applied", source: "admin" },
    { workerId: "w", date: "2026-10-25", kind: "late", actualMinutes: 50, chargedMinutes: 60, covered: true, status: "applied", source: "admin" },
  ]);
  assert.deepEqual(u, { count: 2, minutes: 90 });
});

console.log("\n[3] Flexible shift end");
test("09:00 → 18:00 (clamped to 10:00)", () => assert.equal(hm(requiredShiftEnd(at("09:00"))), "18:00"));
test("10:30 → 18:30", () => assert.equal(hm(requiredShiftEnd(at("10:30"))), "18:30"));
test("11:20 (late) → 19:00", () => assert.equal(hm(requiredShiftEnd(at("11:20"))), "19:00"));

console.log("\n[4] Smart early clock-out");
test("15 min before end → can use permission, charges 30", () => {
  const r = evaluateEarlyLeave(at("18:15"), at("18:30"));
  assert.equal(r.remainingMinutes, 15);
  assert.equal(r.canUsePermission, true);
  assert.equal(r.chargedMinutes, 30);
  assert.match(r.messageAr, /متبقي ١٥ دقيقة على نهاية الشيفت/);
});
test("3h before end → cannot use, full payroll deduction", () => {
  const r = evaluateEarlyLeave(at("15:30"), at("18:30"));
  assert.equal(r.canUsePermission, false);
  assert.equal(r.uncoveredReason, "over_single_cap");
  assert.equal(r.payrollDeductionMinutes, 180);
});
test("after end → not early", () => assert.equal(evaluateEarlyLeave(at("18:31"), at("18:30")).isEarly, false));
test("late + early same day are two permissions", () => {
  const ci = evaluateClockIn(at("11:10"));
  const el = evaluateEarlyLeave(at("18:40"), ci.requiredEnd, ci.usageAfter);
  assert.equal(el.canUsePermission, true);
  assert.deepEqual(el.remainingAfter, { count: 2, minutes: 180 });
});

console.log("\n[5] Annual leave accrual");
const hire = "2026-01-15";
test("before completing 6 months (probation) → 0 days, phase probation", () => {
  const r = computeLeaveAccrual(hire, parseYmd("2026-07-14")!);
  assert.equal(r.phase, "probation");
  assert.equal(r.accruedDays, 0);
  assert.equal(r.probationEndsOn, "2026-07-15");
});
test("after completing 6 months → 7.5 days drop retroactively (6 × 1.25)", () => {
  const r = computeLeaveAccrual(hire, parseYmd("2026-07-15")!);
  assert.equal(r.phase, "year1");
  assert.equal(r.accruedDays, 7.5);
  assert.equal(r.balance, 7.5);
});
test("7 completed months → 7.5 + 1.25 = 8.75", () => {
  assert.equal(computeLeaveAccrual(hire, parseYmd("2026-08-15")!).accruedDays, 8.75);
});
test("12 completed months (end of Year 1) → exactly 15 days (12 × 1.25)", () => {
  const r = computeLeaveAccrual(hire, parseYmd("2027-01-15")!);
  assert.equal(r.accruedDays, 15);
  assert.equal(r.balance, 15);
  assert.equal(r.phase, "year2plus");
  assert.equal(r.tier2StartsOn, "2027-01-15");
});
test("13 months (1st month after Year 1) → 15 carried capped to 7, + 1.75 (21d/yr entitlement + legal carry-over)", () => {
  const r = computeLeaveAccrual(hire, parseYmd("2027-02-15")!);
  assert.equal(r.forfeitedDays, 8);
  assert.equal(r.annualEntitlementDays, 21);
  assert.equal(r.monthlyRate, 1.75);
  assert.equal(r.currentYearAccruedDays, 1.75);
  assert.equal(r.legalCarryOverDays, 7);
  assert.equal(r.totalCarryOverDays, 7);
  assert.equal(r.balance, 8.75);
});
test("13 months with management-approved carry-over adds on top of legal carry-over + 1.75/mo", () => {
  const r = computeLeaveAccrual(hire, parseYmd("2027-02-15")!, { carriedOverApproved: 3 });
  assert.equal(r.annualEntitlementDays, 21);
  assert.equal(r.monthlyRate, 1.75);
  assert.equal(r.legalCarryOverDays, 7);
  assert.equal(r.carriedOverApproved, 3);
  assert.equal(r.totalCarryOverDays, 10);
  assert.equal(r.balance, 11.75);
});
test("24 months (end of Year 2) → 7 + 12 × 1.75 = 28; at month 25 rolls → capped to 7 + 1.75 = 8.75", () => {
  const y2End = computeLeaveAccrual(hire, parseYmd("2028-01-15")!);
  assert.equal(y2End.accruedDays, 15 + 12 * 1.75);
  assert.equal(y2End.currentYearAccruedDays, 21);
  assert.equal(y2End.balance, 28);
  const m25 = computeLeaveAccrual(hire, parseYmd("2028-02-15")!);
  assert.equal(m25.balance, 8.75);
  assert.equal(m25.forfeitedDays, 8 + 21);
});
test("used leave and approved carry-over are applied", () => {
  const r = computeLeaveAccrual(hire, parseYmd("2027-01-15")!, {
    usedLeave: [{ date: "2026-12-01", days: 2.5 }],
    carriedOverApproved: 1,
  });
  // 12 months → 12 × 1.25 = 15 accrued, −2.5 used, +1 carry = 13.5
  assert.equal(r.accruedDays, 15);
  assert.equal(r.balance, 13.5);
});
test("excluded (unpaid) months do not accrue", () => {
  const r = computeLeaveAccrual(hire, parseYmd("2026-09-15")!, { excludedMonths: ["2026-07"] });
  // 8 completed months (6 in probation = 7.5, month 7 excluded = 0, month 8 = 1.25) → 8.75
  assert.equal(r.accruedDays, 8.75);
});
test("hire on Jan 31 → month-end clamping (Feb 28)", () => {
  assert.equal(completedMonthsBetween(parseYmd("2026-01-31")!, parseYmd("2026-02-28")!), 1);
  assert.equal(completedMonthsBetween(parseYmd("2026-01-31")!, parseYmd("2026-02-27")!), 0);
});
test("leave request blocked in probation / over balance / not half-day step", () => {
  const prob = computeLeaveAccrual(hire, parseYmd("2026-03-01")!);
  assert.equal(validateLeaveRequest(prob, 1).ok, false);
  const y1 = computeLeaveAccrual(hire, parseYmd("2026-08-15")!); // 7 months → 8.75 (requestable 8.5)
  assert.equal(y1.requestableDays, 8.5);
  assert.equal(validateLeaveRequest(y1, 8.5).ok, true);
  assert.equal(validateLeaveRequest(y1, 9).ok, false);
  assert.equal(validateLeaveRequest(y1, 1.25).ok, false);
});
test("Old Labor Law (legacy_21): 6 months → 10.5d (6 × 1.75), 12 months → 21d in Year 1", () => {
  const m5 = computeLeaveAccrual(hire, parseYmd("2026-06-15")!, { leaveLawType: "legacy_21" });
  assert.equal(m5.phase, "probation");
  assert.equal(m5.balance, 0);

  const m6 = computeLeaveAccrual(hire, parseYmd("2026-07-15")!, { leaveLawType: "legacy_21" });
  assert.equal(m6.phase, "year1");
  assert.equal(m6.leaveLawType, "legacy_21");
  assert.equal(m6.annualEntitlementDays, 21);
  assert.equal(m6.monthlyRate, 1.75);
  assert.equal(m6.accruedDays, 10.5);
  assert.equal(m6.balance, 10.5);

  const m12 = computeLeaveAccrual(hire, parseYmd("2027-01-15")!, { leaveLawType: "legacy_21" });
  assert.equal(m12.accruedDays, 21);
  assert.equal(m12.balance, 21);
});

console.log("\n[6] Overtime day/night split");
test("17:00 + 3h → 1h day (1.35x) + 2h night (1.70x)", () => {
  const r = splitOvertimePay(at("17:00"), 180, 100);
  assert.equal(r.dayMinutes, 60);
  assert.equal(r.nightMinutes, 120);
  assert.equal(r.dayPay, 135);
  assert.equal(r.nightPay, 340);
  assert.equal(r.total, 475);
});
test("05:00 + 2h → 1h night + 1h day (crosses 06:00)", () => {
  const r = splitOvertimePay(at("05:00"), 120, 100);
  assert.equal(r.nightMinutes, 60);
  assert.equal(r.dayMinutes, 60);
});
test("night allowance added once when any night minutes", () => {
  const cfg = { ...CFG, nightShiftAllowance: 50 };
  assert.equal(splitOvertimePay(at("18:30"), 30, 100, cfg).nightAllowance, 50);
  assert.equal(splitOvertimePay(at("10:00"), 30, 100, cfg).nightAllowance, 0);
});
test("payable = min(approved, actual); unapproved = 0", () => {
  const r = payableOvertimeForDay({
    firstClockIn: at("10:00"), lastClockOut: at("21:00"), workedMinutes: 660,
    approvedMinutes: 60, isOffDay: false, hourlyRate: 100,
  });
  assert.equal(r.actualMinutes, 180);
  assert.equal(r.totalMinutes, 60);
  assert.equal(r.startHm, "18:00");
  const none = payableOvertimeForDay({
    firstClockIn: at("10:00"), lastClockOut: at("21:00"), workedMinutes: 660,
    approvedMinutes: 0, isOffDay: false, hourlyRate: 100,
  });
  assert.equal(none.total, 0);
});
test("off-day: all approved worked minutes count from clock-in", () => {
  const r = payableOvertimeForDay({
    firstClockIn: at("12:00"), lastClockOut: at("16:00"), workedMinutes: 240,
    approvedMinutes: 300, isOffDay: true, hourlyRate: 100,
  });
  assert.equal(r.totalMinutes, 240);
  assert.equal(r.dayMinutes, 240);
});

console.log("\n[7] Reimbursements");
test("outdoor without screenshot / route → errors", () => {
  const f = validateReimbursement({ type: "outdoor", amount: 0 });
  assert.deepEqual(f.map((x) => x.code).sort(), ["missing_amount", "missing_route", "missing_screenshot"]);
});
test("purchase invoice over approval flagged (0% tolerance)", () => {
  const f = validateReimbursement({
    type: "purchase", stage: "review", amount: 500, quoteLink: "https://x", approvedAmount: 500,
    invoiceAmount: 520, attachmentKinds: ["invoice"],
  });
  assert.ok(f.some((x) => x.code === "invoice_over_approval"));
});
test("duplicate image hash blocked", () => {
  const f = validateReimbursement(
    { type: "outdoor", amount: 80, routeFrom: "A", routeTo: "B", attachmentKinds: ["ride_screenshot"], imageHashes: ["abc"] },
    { knownHashes: ["abc"] },
  );
  assert.ok(f.some((x) => x.code === "duplicate_image"));
});

console.log("\n[8] Settings & auditor");
test("policyConfigFromSettings derives 11:00 cutoff from 10:00 + 60", () => {
  const c = policyConfigFromSettings({ shiftStartTime: "10:00", gracePeriodMinutes: 60, secondThresholdMinutes: 120 });
  assert.equal(c.lateCutoffTime, "11:00");
  assert.equal(c.veryLateCutoffTime, "12:00");
});
test("effective date gating", () => {
  assert.equal(isPolicy2026Active({ policy2026Enabled: true, policy2026EffectiveFrom: "2026-06-01" }, "2026-05-31"), false);
  assert.equal(isPolicy2026Active({ policy2026Enabled: true, policy2026EffectiveFrom: "2026-10-21" }, "2026-03-01"), true); // legacy 2026-10-21 normalized to 2026-01-01
  assert.equal(isPolicy2026Active({ policy2026Enabled: false }, "2027-01-01"), false);
});
test("parseAuditLog handles comma, pipe+ot=, and tab formats", () => {
  const rows = parseAuditLog("2026-10-21, 11:35, 18:20\n2026-10-22 | in 10:40 | out 20:30 | ot=90\n2026-10-25\t11:01\t19:00\t60\n# comment\nbad line");
  assert.equal(rows.length, 4);
  assert.deepEqual([rows[0]!.clockIn, rows[0]!.clockOut, rows[0]!.approvedOtMinutes], ["11:35", "18:20", 0]);
  assert.equal(rows[1]!.approvedOtMinutes, 90);
  assert.equal(rows[2]!.approvedOtMinutes, 60);
  assert.ok(rows[3]!.error);
});
test("auditAttendanceLog end-to-end", () => {
  // 2026-10-21 Wed, 22 Thu, 25 Sun, 26 Mon, 27 Tue
  const rows = parseAuditLog(
    [
      "2026-10-21, 11:01, 19:00",        // late 1 → 30 (1/30)
      "2026-10-22, 11:35, 19:00",        // late 35 → 45 (2/75)
      "2026-10-25, 10:00, 18:00, 120",   // on time, ot approved but none worked
      "2026-10-26, 10:30, 18:15",        // early 15 → 30 (3/105)
      "2026-10-27, 11:20, 21:00, 60",    // late 20 → 30 (4/135), ot 60 night
      "2026-10-28, 11:01, 19:00",        // quota exhausted → 0.25 day
    ].join("\n"),
  );
  const rep = auditAttendanceLog(rows, { hourlyRate: 100 });
  assert.equal(rep.totals.permissionsUsed, 4);
  assert.equal(rep.totals.permissionMinutesUsed, 135);
  assert.equal(rep.totals.uncoveredLateDays, 1);
  assert.equal(rep.totals.latePenaltyEgp, 200); // 0.25 × 8h × 100
  assert.equal(rep.totals.otNightMinutes, 60);
  assert.equal(rep.totals.otPay, 170);
  assert.deepEqual(rep.totals.remaining, { count: 0, minutes: 105 });
});

console.log("\n[9] Monthly permission request validation & explicit reasons");
test("validatePermissionRequest: 1 min rounds up to 30 min (First-Minute Rule)", () => {
  const v = validatePermissionRequest(1, { count: 0, minutes: 0 });
  assert.equal(v.ok, true);
  assert.equal(v.chargedMinutes, 30);
  assert.deepEqual(v.allowedDurations, [30, 45, 60, 75, 90, 105, 120]);
});
test("validatePermissionRequest: blocked with count_exhausted when 4 permissions used", () => {
  const v = validatePermissionRequest(30, { count: 4, minutes: 120 });
  assert.equal(v.ok, false);
  assert.equal(v.reasonCode, "count_exhausted");
  assert.match(v.reasonAr, /استهلكت الحد الأقصى الشهري لعدد الأذونات/);
});
test("validatePermissionRequest: blocked with minutes_exhausted when < 30m left", () => {
  const v = validatePermissionRequest(30, { count: 2, minutes: 225 });
  assert.equal(v.ok, false);
  assert.equal(v.reasonCode, "minutes_exhausted");
  assert.match(v.reasonAr, /أقل من الحد الأدنى للإذن الواحد/);
});
test("validatePermissionRequest: blocked with over_single_cap when > 120m requested", () => {
  const v = validatePermissionRequest(150, { count: 0, minutes: 0 });
  assert.equal(v.ok, false);
  assert.equal(v.reasonCode, "over_single_cap");
  assert.match(v.reasonAr, /تتجاوز الحد الأقصى المسموح به للإذن الواحد وهو ساعتان/);
});
test("validatePermissionRequest: blocked with minutes_exhausted when 90m requested but only 60m left", () => {
  const v = validatePermissionRequest(90, { count: 2, minutes: 180 });
  assert.equal(v.ok, false);
  assert.equal(v.reasonCode, "minutes_exhausted");
  assert.deepEqual(v.allowedDurations, [30, 45, 60]);
  assert.match(v.reasonAr!, /المتبقي في رصيد ساعاتك الشهري هو ٦٠ دقيقة فقط/);
});
test("validatePermissionRequest: blocks multiple permissions exceeding 120m in the same day", () => {
  // Already used 90m today -> requesting 45m (90 + 45 = 135 > 120) is blocked; only 30m is allowed
  const vBlocked = validatePermissionRequest(45, { count: 1, minutes: 90 }, undefined, { dailyUsedMinutes: 90 });
  assert.equal(vBlocked.ok, false);
  assert.equal(vBlocked.reasonCode, "over_single_cap");
  assert.deepEqual(vBlocked.allowedDurations, [30]);
  assert.match(vBlocked.reasonAr!, /إجمالي الأذونات في اليوم الواحد لا يجوز أن يتجاوز ساعتين/);

  // Requesting 30m (90 + 30 = 120) is allowed
  const vOk = validatePermissionRequest(30, { count: 1, minutes: 90 }, undefined, { dailyUsedMinutes: 90 });
  assert.equal(vOk.ok, true);
  assert.equal(vOk.remainingDailyMinutes, 30);

  // Already used 120m today -> 0m left today, any additional permission on the same day is blocked
  const vFull = validatePermissionRequest(30, { count: 1, minutes: 120 }, undefined, { dailyUsedMinutes: 120 });
  assert.equal(vFull.ok, false);
  assert.equal(vFull.reasonCode, "over_single_cap");
  assert.deepEqual(vFull.allowedDurations, []);
});
test("validatePermissionRequest: blocks duplicate permission of the same kind on the same day", () => {
  const v = validatePermissionRequest(30, { count: 1, minutes: 30 }, undefined, {
    dailyUsedMinutes: 30,
    sameKindAlreadyBooked: true,
  });
  assert.equal(v.ok, false);
  assert.equal(v.reasonCode, "over_single_cap");
  assert.deepEqual(v.allowedDurations, []);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failed:\n - " + failures.join("\n - "));
  process.exit(1);
}
