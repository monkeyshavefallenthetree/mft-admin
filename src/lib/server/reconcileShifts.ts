import { cairoYmd, formatCairoTime } from "@/lib/admin/cairoTime";
import {
  DEFAULT_AUTO_CLOCK_OUT_GRACE_MS,
  evaluateShiftLifecycle,
  toMillisSafe,
  type ShiftSessionInput,
} from "@/lib/admin/shiftLifecycle";
import type { Policy2026SettingsFields } from "@/lib/admin/hrPolicy2026";
import type { FirestoreDocRecord, ServerFirestoreClient } from "@/lib/server/firestoreRest";
import {
  isValidExpoPushToken,
  sendExpoPushBatch,
  sendWebPushBatch,
  type ExpoPushBatchResult,
  type ExpoPushInputMessage,
  type StoredPushSubscription,
  type WebPushBatchResult,
  type WebPushPayload,
} from "@/lib/server/pushTransport";

export interface ReconcileActionDetail {
  sessionId: string;
  workerId: string;
  workerName: string;
  action: string;
  reason?: string | null;
  notified: boolean;
  cappedHours?: number;
}

export interface ReconcileShiftsSummary {
  ok: boolean;
  nowMs: number;
  todayCairoYmd: string;
  scanned: number;
  autoClockedOut: number;
  shiftCompleteNotified: number;
  shiftWarningNotified: number;
  checkInNotified: number;
  markedIdle: number;
  pushSent: number;
  pushFailed: number;
  cleanedEndpoints: number;
  cleanedTokens: number;
  details: ReconcileActionDetail[];
  errors: string[];
}

export interface ReconcileDeps {
  firestore: ServerFirestoreClient;
  nowMs?: number;
  sendWebPush?: (subs: StoredPushSubscription[], payload: WebPushPayload) => Promise<WebPushBatchResult>;
  sendExpoPush?: (messages: ExpoPushInputMessage[]) => Promise<ExpoPushBatchResult>;
}

function extractWorkerChannels(workerData: Record<string, unknown> | undefined): {
  webSubs: StoredPushSubscription[];
  expoToken: string | null;
} {
  const webMap = new Map<string, StoredPushSubscription>();
  let expoToken: string | null = null;
  if (!workerData) return { webSubs: [], expoToken: null };

  const rawExpo = workerData.expoPushToken;
  if (typeof rawExpo === "string" && rawExpo.startsWith("webp:")) {
    try {
      const parsed = JSON.parse(rawExpo.slice(5));
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const s of arr) {
        if (s && typeof s.endpoint === "string" && s.keys?.p256dh && s.keys?.auth) {
          webMap.set(s.endpoint, s as StoredPushSubscription);
        }
      }
    } catch {
      /* ignore malformed legacy JSON */
    }
  } else if (isValidExpoPushToken(rawExpo)) {
    expoToken = rawExpo.trim();
  }

  if (Array.isArray(workerData.webPushSubscriptions)) {
    for (const s of workerData.webPushSubscriptions) {
      if (s && typeof s.endpoint === "string" && s.keys?.p256dh && s.keys?.auth) {
        webMap.set(s.endpoint, s as StoredPushSubscription);
      }
    }
  }

  return { webSubs: Array.from(webMap.values()), expoToken };
}

function collectAdminSubscriptions(
  docs: FirestoreDocRecord[],
  targetRoles: string[],
): {
  subs: StoredPushSubscription[];
  docsByEndpoint: Map<string, FirestoreDocRecord[]>;
} {
  const subMap = new Map<string, StoredPushSubscription>();
  const docsByEndpoint = new Map<string, FirestoreDocRecord[]>();

  for (const d of docs) {
    const role = typeof d.data.role === "string" ? d.data.role : undefined;
    if (role && !targetRoles.includes(role)) continue;

    const addSub = (s: StoredPushSubscription) => {
      subMap.set(s.endpoint, s);
      const list = docsByEndpoint.get(s.endpoint) ?? [];
      list.push(d);
      docsByEndpoint.set(s.endpoint, list);
    };

    if (Array.isArray(d.data.subscriptions)) {
      for (const s of d.data.subscriptions) {
        if (s && typeof s.endpoint === "string" && s.keys?.p256dh && s.keys?.auth) {
          addSub(s as StoredPushSubscription);
        }
      }
    } else if (
      d.data.subscription &&
      typeof (d.data.subscription as StoredPushSubscription).endpoint === "string" &&
      (d.data.subscription as StoredPushSubscription).keys?.p256dh &&
      (d.data.subscription as StoredPushSubscription).keys?.auth
    ) {
      addSub(d.data.subscription as StoredPushSubscription);
    }
  }

  return { subs: Array.from(subMap.values()), docsByEndpoint };
}

/**
 * Scans all active `workSessions` (`isActive == true`), enforces auto clock-out at
 * exact capped shift end, dispatches persistent Android/iOS Web Push & Expo Push
 * notifications (strictly respecting Firestore deduplication fields), cleans up
 * expired 404/410 endpoints & DeviceNotRegistered tokens, and logs HR admin alerts.
 */
export async function reconcileActiveShifts(deps: ReconcileDeps): Promise<ReconcileShiftsSummary> {
  const nowMs = deps.nowMs ?? Date.now();
  const todayCairoYmd = cairoYmd(nowMs);
  const sendWeb = deps.sendWebPush ?? ((subs, payload) => sendWebPushBatch(subs, payload, { nowMs }));
  const sendExpo = deps.sendExpoPush ?? ((msgs) => sendExpoPushBatch(msgs));

  const summary: ReconcileShiftsSummary = {
    ok: true,
    nowMs,
    todayCairoYmd,
    scanned: 0,
    autoClockedOut: 0,
    shiftCompleteNotified: 0,
    shiftWarningNotified: 0,
    checkInNotified: 0,
    markedIdle: 0,
    pushSent: 0,
    pushFailed: 0,
    cleanedEndpoints: 0,
    cleanedTokens: 0,
    details: [],
    errors: [],
  };

  // 1. Read HR settings
  let hrSettingsData: Record<string, unknown> = {};
  try {
    const settingsDoc = await deps.firestore.getDocument("settings/hr");
    if (settingsDoc?.data) hrSettingsData = settingsDoc.data;
  } catch (err) {
    summary.errors.push(`settings/hr read warning: ${err instanceof Error ? err.message : String(err)}`);
  }

  const standardHours =
    typeof hrSettingsData.standardHours === "number" && hrSettingsData.standardHours > 0
      ? hrSettingsData.standardHours
      : 8;
  const graceMinutes =
    typeof hrSettingsData.autoClockOutGraceMinutes === "number" && hrSettingsData.autoClockOutGraceMinutes >= 0
      ? hrSettingsData.autoClockOutGraceMinutes
      : DEFAULT_AUTO_CLOCK_OUT_GRACE_MS / 60_000;
  const autoClockOutGraceMs = Math.round(graceMinutes * 60_000);
  const policySettings = hrSettingsData as Policy2026SettingsFields;

  // 2. Query all active workSessions
  const activeSessions = await deps.firestore.queryCollection("workSessions", [
    { field: "isActive", op: "EQUAL", value: true },
  ]);
  summary.scanned = activeSessions.length;
  if (activeSessions.length === 0) return summary;

  // 3. Query overtime exceptionRequests to compute authoritative OT minutes per (workerId, date)
  const otMinutesByKey = new Map<string, number>();
  const hasOtRequestByKey = new Set<string>();
  try {
    const otDocs = await deps.firestore.queryCollection("exceptionRequests", [
      { field: "type", op: "EQUAL", value: "overtime" },
    ]);
    for (const req of otDocs) {
      const workerId = typeof req.data.workerId === "string" ? req.data.workerId : "";
      const dateStr =
        typeof req.data.exceptionDate === "string"
          ? req.data.exceptionDate.slice(0, 10)
          : typeof req.data.date === "string"
            ? req.data.date.slice(0, 10)
            : "";
      if (!workerId || !dateStr) continue;
      const key = `${workerId}|${dateStr}`;
      hasOtRequestByKey.add(key);
      const status = typeof req.data.status === "string" ? req.data.status : "";
      if (status === "approved" || status === "pending") {
        const mins = Number(req.data.lateMinutes ?? req.data.overtimeMinutes ?? 0) || 0;
        if (mins > 0) {
          otMinutesByKey.set(key, (otMinutesByKey.get(key) ?? 0) + mins);
        }
      }
    }
  } catch (err) {
    summary.errors.push(`exceptionRequests query warning: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Lazy caches for worker docs and admin push docs
  const workerCache = new Map<string, FirestoreDocRecord | null>();
  const getWorker = async (workerId: string): Promise<FirestoreDocRecord | null> => {
    if (workerCache.has(workerId)) return workerCache.get(workerId) ?? null;
    const rec = await deps.firestore.getDocument(`workers/${workerId}`).catch(() => null);
    workerCache.set(workerId, rec);
    return rec;
  };

  let adminPushDocsPromise: Promise<FirestoreDocRecord[]> | null = null;
  const getAdminPushDocs = (): Promise<FirestoreDocRecord[]> => {
    if (!adminPushDocsPromise) {
      adminPushDocsPromise = (async () => {
        const [primary, fallback] = await Promise.all([
          deps.firestore.queryCollection("adminPushSubscriptions", []).catch(() => []),
          deps.firestore
            .queryCollection("alerts", [{ field: "type", op: "EQUAL", value: "admin_push_sub" }])
            .catch(() => []),
        ]);
        return [...primary, ...fallback];
      })();
    }
    return adminPushDocsPromise;
  };

  const pushToWorkerAndCleanup = async (
    workerId: string,
    payload: WebPushPayload,
    channelId: string,
  ): Promise<boolean> => {
    const workerDoc = await getWorker(workerId);
    if (!workerDoc) return false;
    const { webSubs, expoToken } = extractWorkerChannels(workerDoc.data);
    let anyDelivered = false;

    if (webSubs.length > 0) {
      const wpRes = await sendWeb(webSubs, {
        ...payload,
        requireInteraction: true,
        dedupe: true,
      });
      summary.pushSent += wpRes.sent;
      summary.pushFailed += wpRes.failed;
      if (wpRes.sent > 0) anyDelivered = true;

      if (wpRes.goneEndpoints.length > 0) {
        const goneSet = new Set(wpRes.goneEndpoints);
        const patch: Record<string, unknown> = {};
        if (Array.isArray(workerDoc.data.webPushSubscriptions)) {
          const cleaned = workerDoc.data.webPushSubscriptions.filter(
            (s: unknown) =>
              s &&
              typeof (s as StoredPushSubscription).endpoint === "string" &&
              !goneSet.has((s as StoredPushSubscription).endpoint),
          );
          patch.webPushSubscriptions = cleaned;
          workerDoc.data.webPushSubscriptions = cleaned;
        }
        if (typeof workerDoc.data.expoPushToken === "string" && workerDoc.data.expoPushToken.startsWith("webp:")) {
          try {
            const parsed = JSON.parse(workerDoc.data.expoPushToken.slice(5));
            const arr = (Array.isArray(parsed) ? parsed : [parsed]).filter(
              (s: unknown) =>
                s &&
                typeof (s as StoredPushSubscription).endpoint === "string" &&
                !goneSet.has((s as StoredPushSubscription).endpoint),
            );
            const nextVal = arr.length > 0 ? `webp:${JSON.stringify(arr)}` : null;
            patch.expoPushToken = nextVal;
            workerDoc.data.expoPushToken = nextVal;
          } catch {
            /* ignore */
          }
        }
        if (Object.keys(patch).length > 0) {
          patch.webPushUpdatedAt = new Date(nowMs);
          await deps.firestore.patchDocument(`workers/${workerId}`, patch).catch(() => {});
          summary.cleanedEndpoints += wpRes.goneEndpoints.length;
        }
      }
    }

    if (expoToken) {
      const expoRes = await sendExpo([
        {
          to: expoToken,
          title: payload.title,
          body: payload.body,
          sound: "default",
          priority: "high",
          ttl: 86400,
          badge: 1,
          channelId,
          mutableContent: true,
          _displayInForeground: true,
          interruptionLevel: payload.urgent ? "time-sensitive" : "active",
          urgent: Boolean(payload.urgent),
          data: {
            url: payload.url || "/dashboard?tab=time",
            tab: payload.tab || "time",
            tag: payload.tag || "",
          },
        },
      ]);
      summary.pushSent += expoRes.sent;
      summary.pushFailed += expoRes.failed;
      if (expoRes.sent > 0) anyDelivered = true;

      if (expoRes.invalidTokens.includes(expoToken)) {
        await deps.firestore.patchDocument(`workers/${workerId}`, { expoPushToken: null }).catch(() => {});
        workerDoc.data.expoPushToken = null;
        summary.cleanedTokens += 1;
      }
    }

    return anyDelivered;
  };

  const notifyHrAdmins = async (input: {
    eventType: string;
    title: string;
    body: string;
    href: string;
    entityId: string;
    urgent?: boolean;
  }): Promise<void> => {
    const targetRoles = ["super_admin", "hr_admin"];
    let createdId = "";
    try {
      createdId = await deps.firestore.createDocument("adminNotifications", {
        targetRoles,
        category: "hr",
        eventType: input.eventType,
        title: input.title,
        body: input.body,
        href: input.href,
        actorUid: null,
        actorName: "Shift Watchdog",
        entityId: input.entityId,
        projectId: null,
        taskId: null,
        readBy: [],
        createdAt: new Date(nowMs),
      });
    } catch {
      /* ignore */
    }

    try {
      const adminDocs = await getAdminPushDocs();
      const { subs, docsByEndpoint } = collectAdminSubscriptions(adminDocs, targetRoles);
      if (subs.length === 0) return;

      const wpRes = await sendWeb(subs, {
        title: input.title,
        body: input.body,
        url: input.href,
        tag: createdId ? `mft-ev-${createdId}` : `${input.eventType}-${input.entityId}`,
        dedupe: true,
        urgent: Boolean(input.urgent),
        requireInteraction: true,
      });
      summary.pushSent += wpRes.sent;
      summary.pushFailed += wpRes.failed;

      if (wpRes.goneEndpoints.length > 0) {
        const goneSet = new Set(wpRes.goneEndpoints);
        const touched = new Map<string, FirestoreDocRecord>();
        for (const ep of wpRes.goneEndpoints) {
          for (const d of docsByEndpoint.get(ep) ?? []) {
            touched.set(d.path, d);
          }
        }
        for (const d of touched.values()) {
          const existing: StoredPushSubscription[] = Array.isArray(d.data.subscriptions)
            ? (d.data.subscriptions as StoredPushSubscription[])
            : d.data.subscription
              ? [d.data.subscription as StoredPushSubscription]
              : [];
          const cleaned = existing.filter((s) => s && typeof s.endpoint === "string" && !goneSet.has(s.endpoint));
          d.data.subscriptions = cleaned;
          d.data.subscription = cleaned[0] ?? null;
          await deps.firestore
            .patchDocument(d.path, {
              subscriptions: cleaned,
              subscription: cleaned[0] ?? null,
              updatedAt: new Date(nowMs),
            })
            .catch(() => {});
        }
        summary.cleanedEndpoints += wpRes.goneEndpoints.length;
      }
    } catch {
      /* ignore */
    }
  };

  // 4. Evaluate each active session
  for (const docRec of activeSessions) {
    const session = { id: docRec.id, ...(docRec.data as ShiftSessionInput) };
    const workerId = String(session.workerId || "");
    const workerName = String(session.workerName || "Worker");
    if (!workerId) continue;

    const fallbackStartMs = toMillisSafe(session.startTime) ?? toMillisSafe(session.loginTime);
    const dateKey =
      typeof session.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(session.date)
        ? session.date.slice(0, 10)
        : fallbackStartMs != null
          ? cairoYmd(fallbackStartMs)
          : todayCairoYmd;
    const otLookupKey = `${workerId}|${dateKey}`;
    const authoritativeOt = hasOtRequestByKey.has(otLookupKey)
      ? otMinutesByKey.get(otLookupKey) ?? 0
      : undefined;

    const lifecycle = evaluateShiftLifecycle(session, {
      nowMs,
      todayCairoYmd,
      standardHours,
      overtimeMinutes: authoritativeOt,
      autoClockOutGraceMs,
      policySettings,
    });

    try {
      if (lifecycle.action === "auto_clock_out") {
        const cappedLogoutMs = lifecycle.cappedLogoutMs ?? lifecycle.shiftLimitAtMs;
        const cappedTotalWorkTimeMs = lifecycle.cappedTotalWorkTimeMs ?? lifecycle.allowedMs;
        const cappedHours = Math.round((cappedTotalWorkTimeMs / 3_600_000) * 100) / 100;
        const cappedOutLabel = formatCairoTime(cappedLogoutMs);

        await deps.firestore.patchDocument(`workSessions/${docRec.id}`, {
          isActive: false,
          logoutTime: new Date(cappedLogoutMs),
          endTime: new Date(cappedLogoutMs),
          segmentStartAt: null,
          bankedWorkTime: cappedTotalWorkTimeMs,
          totalWorkTime: cappedTotalWorkTimeMs,
          presenceStatus: "offline",
          standardHours: lifecycle.standardHours,
          overtimeMinutes: lifecycle.overtimeMinutes,
          allowedShiftMs: lifecycle.allowedMs,
          autoClockedOut: true,
          autoClockOutReason: lifecycle.autoClockOutReason,
          autoClockedOutAt: new Date(nowMs),
          autoClockOutNotifiedAt: new Date(nowMs),
          lastUpdated: new Date(nowMs),
        });

        await deps.firestore
          .patchDocument(`workers/${workerId}`, {
            isOnline: false,
            presenceStatus: "offline",
            lastLogout: new Date(cappedLogoutMs),
          })
          .catch(() => {});

        let notified = false;
        if (lifecycle.shouldSendAutoClockOutPush) {
          const isPastDay = lifecycle.autoClockOutReason === "past_day_unclosed";
          notified = await pushToWorkerAndCleanup(
            workerId,
            {
              title: "Auto Clocked Out ✅",
              body: isPastDay
                ? `Your unclosed shift (${dateKey}) was automatically closed at ${cappedOutLabel} Cairo (${cappedHours}h logged).`
                : `Your ${cappedHours}h shift reached its limit and was automatically clocked out at ${cappedOutLabel} Cairo.`,
              url: "/dashboard?tab=time",
              tab: "time",
              tag: `mft-auto-clockout-${docRec.id}`,
              topic: `autoout-${docRec.id.slice(-20)}`,
              dedupe: true,
              urgent: true,
              requireInteraction: true,
            },
            "alerts",
          );
        }

        await notifyHrAdmins({
          eventType: "worker_auto_clock_out",
          title: `⏱️ Auto Clock-Out: ${workerName}`,
          body: `${workerName} was auto-clocked-out (${lifecycle.autoClockOutReason === "past_day_unclosed" ? "unclosed past-day shift" : "shift limit reached"}) at ${cappedOutLabel} Cairo · ${cappedHours}h.`,
          href: `/admin/work-sessions?worker=${encodeURIComponent(workerId)}`,
          entityId: docRec.id,
          urgent: false,
        });

        summary.autoClockedOut += 1;
        summary.details.push({
          sessionId: docRec.id,
          workerId,
          workerName,
          action: "auto_clock_out",
          reason: lifecycle.autoClockOutReason,
          notified,
          cappedHours,
        });
      } else if (lifecycle.action === "shift_complete" && lifecycle.shouldSendShiftCompletePush) {
        await deps.firestore.patchDocument(`workSessions/${docRec.id}`, {
          shiftCompleteNotifiedForMs: lifecycle.allowedMs,
          shiftCompleteNotifiedAt: new Date(nowMs),
          standardHours: lifecycle.standardHours,
          overtimeMinutes: lifecycle.overtimeMinutes,
          allowedShiftMs: lifecycle.allowedMs,
          lastUpdated: new Date(nowMs),
        });

        const allowedHours = Math.round((lifecycle.allowedMs / 3_600_000) * 10) / 10;
        const notified = await pushToWorkerAndCleanup(
          workerId,
          {
            title: "Shift Complete — Clock Out Required 🏁",
            body: `You completed your ${allowedHours}h shift. Clock out now or request overtime — auto clock-out runs shortly.`,
            url: "/dashboard?tab=time",
            tab: "time",
            tag: `mft-shift-complete-${docRec.id}-${lifecycle.allowedMs}`,
            topic: `scomp-${docRec.id.slice(-20)}`,
            dedupe: true,
            urgent: true,
            requireInteraction: true,
          },
          "alerts",
        );

        summary.shiftCompleteNotified += 1;
        summary.details.push({
          sessionId: docRec.id,
          workerId,
          workerName,
          action: "shift_complete",
          notified,
        });
      } else if (lifecycle.action === "shift_warning_15m" && lifecycle.shouldSendWarningPush) {
        await deps.firestore.patchDocument(`workSessions/${docRec.id}`, {
          shiftWarningNotifiedForMs: lifecycle.allowedMs,
          shiftWarningNotifiedAt: new Date(nowMs),
          standardHours: lifecycle.standardHours,
          overtimeMinutes: lifecycle.overtimeMinutes,
          allowedShiftMs: lifecycle.allowedMs,
          lastUpdated: new Date(nowMs),
        });

        const endLabel = formatCairoTime(lifecycle.shiftLimitAtMs);
        const notified = await pushToWorkerAndCleanup(
          workerId,
          {
            title: "15 Minutes Left in Your Shift ⏰",
            body: `Your shift ends at ${endLabel} Cairo. Please wrap up and clock out on time.`,
            url: "/dashboard?tab=time",
            tab: "time",
            tag: `mft-shift-15m-${docRec.id}-${lifecycle.allowedMs}`,
            topic: `swarn-${docRec.id.slice(-20)}`,
            dedupe: true,
            urgent: true,
            requireInteraction: true,
          },
          "alerts",
        );

        summary.shiftWarningNotified += 1;
        summary.details.push({
          sessionId: docRec.id,
          workerId,
          workerName,
          action: "shift_warning_15m",
          notified,
        });
      } else if (lifecycle.action === "checkin_due") {
        let notified = false;
        if (lifecycle.shouldSendCheckInPush) {
          await deps.firestore.patchDocument(`workSessions/${docRec.id}`, {
            checkInNotifiedForAtMs: lifecycle.lastCheckInMs,
            checkInNotifiedAt: new Date(nowMs),
            lastUpdated: new Date(nowMs),
          });

          notified = await pushToWorkerAndCleanup(
            workerId,
            {
              title: "🔔 موعد تأكيد الحضور الدوري — نهاية الساعتين",
              body: "أكمل تأكيد الحضور الآن خلال 10 دقائق للحفاظ على حالتك نشط (Active) في الوردية.",
              url: "/dashboard?tab=time",
              tab: "time",
              tag: `mft-checkin-${docRec.id}-${lifecycle.lastCheckInMs}`,
              topic: `chkin-${docRec.id.slice(-20)}`,
              dedupe: true,
              urgent: true,
              requireInteraction: true,
            },
            "alerts",
          );
          summary.checkInNotified += 1;
        }

        if (lifecycle.shouldMarkIdle) {
          await deps.firestore.patchDocument(`workSessions/${docRec.id}`, {
            presenceStatus: "idle",
            missedCheckInAt: new Date(nowMs),
            idleNotifiedForAtMs: lifecycle.lastCheckInMs,
            lastUpdated: new Date(nowMs),
          });
          await deps.firestore
            .patchDocument(`workers/${workerId}`, {
              presenceStatus: "idle",
              missedCheckInAt: new Date(nowMs),
            })
            .catch(() => {});

          await notifyHrAdmins({
            eventType: "missed_checkin",
            title: `⚠️ Missed 2h Check-In: ${workerName}`,
            body: `${workerName} did not confirm the 2-hour presence check-in within the 10-minute window and is now marked Idle.`,
            href: `/admin/work-sessions?status=idle`,
            entityId: docRec.id,
            urgent: true,
          });
          summary.markedIdle += 1;
        }

        if (lifecycle.shouldSendCheckInPush || lifecycle.shouldMarkIdle) {
          summary.details.push({
            sessionId: docRec.id,
            workerId,
            workerName,
            action: lifecycle.shouldMarkIdle ? "checkin_idle" : "checkin_due",
            notified,
          });
        }
      }
    } catch (err) {
      summary.errors.push(`session ${docRec.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return summary;
}
