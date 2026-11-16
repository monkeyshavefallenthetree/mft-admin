import { initializeApp, getApps } from "firebase/app";
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getFirestore,
  initializeFirestore,
  onSnapshot,
  setDoc,
  serverTimestamp,
  query,
  orderBy,
  type Firestore,
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { auth, db, firebaseConfig } from "@/lib/firebase";
import { notifyAdmins } from "@/lib/adminNotifications";
import {
  ARC_DEFAULT_PORTAL,
  type ClientPortalInteraction,
  type ClientRolloutPortal,
  type DailyStoryItem,
  type FeedPostItem,
  type MilestoneItem,
  type MilestoneStatus,
  type PublishStatus,
  type RolloutCycleItem,
} from "./clientPortalTypes";

const PORTAL_SETTINGS_DOC_ID = "client_portals_v1";
const CLIENT_BRIDGE_APP_NAME = "mft-client-portal-bridge";
const CLIENT_BRIDGE_EMAIL = "client.portal.bridge@mft-agency.local";
const CLIENT_BRIDGE_PASS = "MftClientPortalBridge#2026!";

let authBridgePromise: Promise<Firestore> | null = null;

function getBridgeFirebase(): { bridgeAuth: ReturnType<typeof getAuth>; bridgeDb: Firestore } {
  const existing = getApps().find((a) => a.name === CLIENT_BRIDGE_APP_NAME);
  const bridgeApp = existing ?? initializeApp(firebaseConfig, CLIENT_BRIDGE_APP_NAME);
  const bridgeAuth = getAuth(bridgeApp);
  let bridgeDb: Firestore;
  try {
    bridgeDb = initializeFirestore(bridgeApp, {
      ignoreUndefinedProperties: true,
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    bridgeDb = getFirestore(bridgeApp);
  }
  return { bridgeAuth, bridgeDb };
}

/**
 * Returns an authenticated Firestore instance for the Client Portal.
 * If an Admin/Worker is already signed in on the primary app, uses primary `db`.
 * Otherwise authenticates an isolated secondary Firebase app instance so `/admin` auth is never affected.
 */
export async function getAuthenticatedPortalDb(): Promise<Firestore> {
  if (auth.currentUser) return db;
  const { bridgeAuth, bridgeDb } = getBridgeFirebase();
  if (bridgeAuth.currentUser) return bridgeDb;
  if (authBridgePromise) return authBridgePromise;

  authBridgePromise = (async () => {
    try {
      await signInWithEmailAndPassword(bridgeAuth, CLIENT_BRIDGE_EMAIL, CLIENT_BRIDGE_PASS);
      return bridgeDb;
    } catch {
      try {
        await createUserWithEmailAndPassword(bridgeAuth, CLIENT_BRIDGE_EMAIL, CLIENT_BRIDGE_PASS);
        return bridgeDb;
      } catch (err) {
        console.warn("Client auth bridge warning:", err);
        return auth.currentUser ? db : bridgeDb;
      }
    } finally {
      authBridgePromise = null;
    }
  })();

  return authBridgePromise;
}

export function getDefaultPortalsMap(): Record<string, ClientRolloutPortal> {
  return {
    [ARC_DEFAULT_PORTAL.id]: ARC_DEFAULT_PORTAL,
  };
}

/**
 * Subscribes in real time to all configured Client Rollout Portals in `settings/client_portals_v1`.
 * Always includes `ARC_DEFAULT_PORTAL` as fallback so ARC works immediately out of the box.
 */
export function subscribeClientPortals(
  onData: (portals: Record<string, ClientRolloutPortal>) => void,
): () => void {
  let unsub: (() => void) | null = null;
  let cancelled = false;

  void getAuthenticatedPortalDb().then((activeDb) => {
    if (cancelled) return;
    const ref = doc(activeDb, "settings", PORTAL_SETTINGS_DOC_ID);
    unsub = onSnapshot(
      ref,
      (snap) => {
        const defaults = getDefaultPortalsMap();
        if (!snap.exists()) {
          onData(defaults);
          return;
        }
        const raw = snap.data() as { portals?: Record<string, ClientRolloutPortal> };
        const merged: Record<string, ClientRolloutPortal> = {
          ...defaults,
          ...(raw?.portals ?? {}),
        };
        onData(merged);
      },
      () => {
        onData(getDefaultPortalsMap());
      },
    );
  });

  return () => {
    cancelled = true;
    if (unsub) unsub();
  };
}

/**
 * Saves the full map of Client Portals (or updates a single portal) to `settings/client_portals_v1`.
 * Called by Admins in `/admin/client-portal`.
 */
export async function saveClientPortalToFirestore(
  portal: ClientRolloutPortal,
  adminEmail = "admin",
): Promise<void> {
  const ref = doc(db, "settings", PORTAL_SETTINGS_DOC_ID);
  const snap = await getDoc(ref).catch(() => null);
  const existing =
    snap && snap.exists()
      ? ((snap.data() as { portals?: Record<string, ClientRolloutPortal> }).portals ?? {})
      : getDefaultPortalsMap();

  const updatedPortal: ClientRolloutPortal = {
    ...portal,
    updatedAtIso: new Date().toISOString(),
    updatedBy: adminEmail,
  };

  await setDoc(
    ref,
    {
      portals: {
        ...existing,
        [portal.id]: updatedPortal,
      },
      updatedAt: serverTimestamp(),
      updatedBy: adminEmail,
    },
    { merge: true },
  );
}

/**
 * Deletes a custom client portal (cannot delete the primary `arc` portal; resets it instead).
 */
export async function deleteClientPortalFromFirestore(
  portalId: string,
  adminEmail = "admin",
): Promise<void> {
  const ref = doc(db, "settings", PORTAL_SETTINGS_DOC_ID);
  const snap = await getDoc(ref).catch(() => null);
  const existing =
    snap && snap.exists()
      ? { ...((snap.data() as { portals?: Record<string, ClientRolloutPortal> }).portals ?? {}) }
      : getDefaultPortalsMap();

  delete existing[portalId];
  await setDoc(
    ref,
    {
      portals: existing,
      updatedAt: serverTimestamp(),
      updatedBy: adminEmail,
    },
    { merge: false },
  );
}

/**
 * Subscribes in real time to Client-submitted approvals, asset links, revision notes,
 * and contract sign-offs stored in `projects/client_portal_{portalId}/messages`.
 */
export function subscribePortalInteractions(
  portalId: string,
  onData: (items: ClientPortalInteraction[]) => void,
): () => void {
  if (!portalId) return () => {};
  let unsub: (() => void) | null = null;
  let cancelled = false;

  void getAuthenticatedPortalDb().then((activeDb) => {
    if (cancelled) return;
    const colRef = collection(activeDb, "projects", `client_portal_${portalId}`, "messages");
    const q = query(colRef, orderBy("createdAtIso", "asc"));
    unsub = onSnapshot(
      q,
      (snap) => {
        const list: ClientPortalInteraction[] = [];
        snap.forEach((d) => {
          const data = d.data() as Omit<ClientPortalInteraction, "id">;
          if (data && data.actionType) {
            list.push({ id: d.id, ...data });
          }
        });
        onData(list);
      },
      () => {
        onData([]);
      },
    );
  });

  return () => {
    cancelled = true;
    if (unsub) unsub();
  };
}

/**
 * Records a Client or Agency interaction (approval, asset handover link, revision request,
 * or contract sign-off) and notifies MFT Admins & Account Managers in real time.
 */
export async function recordClientPortalInteraction(
  event: Omit<ClientPortalInteraction, "id" | "createdAtIso">,
): Promise<void> {
  const activeDb = await getAuthenticatedPortalDb();
  const createdAtIso = new Date().toISOString();
  const colRef = collection(activeDb, "projects", `client_portal_${event.portalId}`, "messages");

  await addDoc(colRef, {
    ...event,
    createdAtIso,
    createdAt: serverTimestamp(),
  });

  // Notify Super Admin & Account Manager immediately when the Client takes an action
  if (event.actorRole === "client") {
    const actionLabels: Record<ClientPortalInteraction["actionType"], string> = {
      approve_milestone: `✅ اعتمد المرحلة: ${event.targetLabel || ""}`,
      submit_assets: `📁 أرفق خامات المشروع: ${event.targetLabel || ""}`,
      approve_post: `✅ اعتمد البوست: ${event.targetLabel || ""}`,
      revision_post: `✏️ طلب تعديل على البوست: ${event.targetLabel || ""}`,
      approve_cycle_feed: `🎉 اعتمد كالندر الدورة بالكامل: ${event.targetLabel || ""}`,
      approve_story: `✅ اعتمد الاستوري: ${event.targetLabel || ""}`,
      revision_story: `✏️ ملاحظة على الاستوري: ${event.targetLabel || ""}`,
      approve_ad_campaign: `🚀 اعتمد الحملة الإعلانية: ${event.targetLabel || ""}`,
      sign_contract: `✍️ وقّع واعتمد خطة العمل والشروط (${event.actorName})`,
      comment: `💬 أضاف ملاحظة جديدة: ${event.targetLabel || ""}`,
    };

    void notifyAdmins(activeDb, {
      targetRoles: ["super_admin", "ops_admin"],
      category: "project",
      eventType: `client_portal_${event.actionType}`,
      title: `🏢 بوابة العميل (${event.portalId.toUpperCase()}): ${actionLabels[event.actionType]}`,
      body: `${event.actorName}: ${event.comment || event.linkUrl || actionLabels[event.actionType]}`,
      href: "/admin/client-portal",
      actorName: event.actorName,
      urgent: true,
    }).catch(() => {});
  }
}

/**
 * Deterministically overlays real-time Client interactions onto a `ClientRolloutPortal`
 * so approvals, asset links, revision notes, and digital sign-offs reflect immediately
 * for both the Client and the Admin.
 */
export function applyClientInteractionsToPortal(
  base: ClientRolloutPortal,
  interactions: ClientPortalInteraction[],
): ClientRolloutPortal {
  if (!interactions.length) return base;

  const milestones = base.milestones.map((m) => ({ ...m }));
  const feedCalendar = base.feedCalendar.map((f) => ({ ...f }));
  const dailyStories = base.dailyStories.map((s) => ({ ...s }));
  const paidCampaigns = base.paidCampaigns.map((p) => ({ ...p }));
  const signOffChecklist = base.signOffChecklist.map((c) => ({ ...c }));

  let contractSigned = base.contractSigned;
  let contractSignedAt = base.contractSignedAt;
  let contractSignedBy = base.contractSignedBy;
  let clientAssetContactName = base.clientAssetContactName;
  let clientAssetContactPhone = base.clientAssetContactPhone;
  let clientApproverName = base.clientApproverName;
  let clientApproverTitle = base.clientApproverTitle;

  const baseUpdatedMs = base.updatedAtIso ? new Date(base.updatedAtIso).getTime() : 0;

  for (const ev of interactions) {
    const evMs = ev.createdAtIso ? new Date(ev.createdAtIso).getTime() : 0;
    const isNewerThanAdminSave = base.updatedBy === "system_seed" || evMs >= baseUpdatedMs;
    const shortDate = new Date(ev.createdAtIso || Date.now()).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    if (ev.actionType === "approve_milestone" && ev.targetId) {
      const m = milestones.find((x) => x.id === ev.targetId);
      if (m) {
        m.clientApproved = true;
        m.clientApprovedAt = ev.createdAtIso;
        if (isNewerThanAdminSave || m.status !== "Done") {
          m.status = "Done";
          if (!m.actualDate) m.actualDate = shortDate;
        }
        if (ev.linkUrl) m.linkEvidence = ev.linkUrl;
        if (ev.comment) m.clientComment = ev.comment;
      }
    } else if (ev.actionType === "submit_assets" && ev.targetId) {
      const m = milestones.find((x) => x.id === ev.targetId);
      if (m) {
        if (ev.linkUrl) m.linkEvidence = ev.linkUrl;
        if (ev.comment) m.clientComment = ev.comment;
        m.clientApproved = true;
        m.clientApprovedAt = ev.createdAtIso;
        if (isNewerThanAdminSave) {
          m.status = "Done";
          if (!m.actualDate) m.actualDate = shortDate;
        }
      }
    } else if (ev.actionType === "approve_post" && ev.targetId) {
      const p = feedCalendar.find((x) => x.id === ev.targetId);
      if (p) {
        p.clientApprovedAt = ev.createdAtIso;
        if (ev.comment) p.clientComment = ev.comment;
        if (isNewerThanAdminSave && p.publishStatus !== "Published" && p.publishStatus !== "Scheduled") {
          p.publishStatus = "Approved";
        }
      }
    } else if (ev.actionType === "revision_post" && ev.targetId) {
      const p = feedCalendar.find((x) => x.id === ev.targetId);
      if (p) {
        if (ev.comment) p.clientComment = ev.comment;
        if (isNewerThanAdminSave) {
          p.publishStatus = "Revision Requested";
        }
      }
    } else if (ev.actionType === "approve_cycle_feed" && ev.targetId) {
      for (const p of feedCalendar) {
        if (p.cycle === ev.targetId && p.publishStatus !== "Published" && p.publishStatus !== "Scheduled") {
          p.publishStatus = "Approved";
          p.clientApprovedAt = ev.createdAtIso;
        }
      }
    } else if (ev.actionType === "approve_story" && ev.targetId) {
      const s = dailyStories.find((x) => x.id === ev.targetId);
      if (s) {
        s.clientApprovedAt = ev.createdAtIso;
        if (ev.comment) s.clientComment = ev.comment;
        if (isNewerThanAdminSave && s.publishStatus !== "Published" && s.publishStatus !== "Scheduled") {
          s.publishStatus = "Approved";
        }
      }
    } else if (ev.actionType === "revision_story" && ev.targetId) {
      const s = dailyStories.find((x) => x.id === ev.targetId);
      if (s) {
        if (ev.comment) s.clientComment = ev.comment;
        if (isNewerThanAdminSave) {
          s.publishStatus = "Revision Requested";
        }
      }
    } else if (ev.actionType === "approve_ad_campaign" && ev.targetId) {
      const c = paidCampaigns.find((x) => x.id === ev.targetId);
      if (c) {
        c.clientApprovedAt = ev.createdAtIso;
        if (ev.comment) c.notes = ev.comment;
        if (isNewerThanAdminSave && c.status !== "Active" && c.status !== "Completed") {
          c.status = "Approved";
        }
      }
    } else if (ev.actionType === "sign_contract") {
      contractSigned = true;
      contractSignedAt = ev.createdAtIso;
      contractSignedBy = ev.actorName;
      for (const item of signOffChecklist) {
        item.confirmed = true;
        item.confirmedAt = ev.createdAtIso;
        item.confirmedBy = ev.actorName;
      }
      if (ev.extraData) {
        if (typeof ev.extraData.assetContactName === "string" && ev.extraData.assetContactName) {
          clientAssetContactName = ev.extraData.assetContactName;
        }
        if (typeof ev.extraData.assetContactPhone === "string" && ev.extraData.assetContactPhone) {
          clientAssetContactPhone = ev.extraData.assetContactPhone;
        }
        if (typeof ev.extraData.approverName === "string" && ev.extraData.approverName) {
          clientApproverName = ev.extraData.approverName;
        }
        if (typeof ev.extraData.approverTitle === "string" && ev.extraData.approverTitle) {
          clientApproverTitle = ev.extraData.approverTitle;
        }
      }
    }
  }

  return {
    ...base,
    contractSigned,
    contractSignedAt,
    contractSignedBy,
    clientAssetContactName,
    clientAssetContactPhone,
    clientApproverName,
    clientApproverTitle,
    milestones,
    feedCalendar,
    dailyStories,
    paidCampaigns,
    signOffChecklist,
  };
}

/**
 * Parses imported Google Sheet tabs (`Overview`, `Master Timeline`, `Feed Calendar`, `Daily Stories`)
 * and merges them into a `ClientRolloutPortal`.
 */
export async function importPortalFromGoogleSheetUrl(
  sheetUrl: string,
  existingPortal: ClientRolloutPortal,
): Promise<ClientRolloutPortal> {
  const res = await fetch("/api/client-portal/import-sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheetUrl }),
  });
  const data = (await res.json()) as {
    error?: string;
    tabData?: Record<string, string[][]>;
  };
  if (!res.ok || !data.tabData) {
    throw new Error(data.error || "Failed to import Google Sheet");
  }

  const next: ClientRolloutPortal = {
    ...existingPortal,
    googleSheetUrl: sheetUrl,
  };

  // 1. Parse Overview Cycles if present
  const overviewRows = data.tabData["Overview"];
  if (overviewRows && overviewRows.length > 0) {
    const titleRow = overviewRows.find((r) => r[0] && r[0].includes("/"));
    if (titleRow?.[0]) next.projectTitle = titleRow[0];
    const subRow = overviewRows.find((r) => r[0] && r[0].toLowerCase().includes("plan"));
    if (subRow?.[0]) next.subtitle = subRow[0];

    const parsedCycles: RolloutCycleItem[] = [];
    for (const r of overviewRows) {
      if (r[0] && /^Cycle\s*\d+/i.test(r[0]) && r[1] && r[2]) {
        parsedCycles.push({
          id: r[0].toLowerCase().replace(/\s+/g, "_"),
          name: r[0],
          startDate: r[1],
          endDate: r[2],
          feedPostsTarget: parseInt(r[3] || "12", 10) || 12,
          storiesTarget: parseInt(r[4] || "30", 10) || 30,
        });
      }
    }
    if (parsedCycles.length > 0) next.cycles = parsedCycles;
  }

  // 2. Parse Master Timeline if present
  const timelineRows = data.tabData["Master Timeline"];
  if (timelineRows && timelineRows.length > 0) {
    const parsedMs: MilestoneItem[] = [];
    let pendingMonthHeader: string | undefined;
    let idx = 1;
    for (const r of timelineRows) {
      const c0 = (r[0] || "").trim();
      if (!c0 || c0 === "Master Timeline" || c0 === "Cycle") continue;
      if (!/^Cycle\s*\d+/i.test(c0)) {
        if (/\d{4}/.test(c0)) pendingMonthHeader = c0;
        continue;
      }
      const rawStatus = (r[6] || "").trim();
      const status: MilestoneStatus =
        rawStatus.toLowerCase() === "done"
          ? "Done"
          : rawStatus.toLowerCase().includes("progress")
            ? "In progress"
            : rawStatus.toLowerCase().includes("wait")
              ? "Waiting Client"
              : rawStatus.toLowerCase().includes("delay")
                ? "Delayed"
                : "Pending";
      parsedMs.push({
        id: `ms_imp_${idx++}`,
        cycle: c0,
        monthHeader: pendingMonthHeader,
        milestone: (r[1] || "").trim(),
        owner: (r[2] || "Agency").trim(),
        startDate: (r[3] || "").trim(),
        endDate: (r[4] || "").trim(),
        actualDate: (r[5] || "").trim(),
        status,
        linkEvidence: (r[7] || "").trim(),
        notes: (r[8] || "").replace(/[\u200E\u200F]/g, "").trim(),
        clientApproved: status === "Done",
      });
      pendingMonthHeader = undefined;
    }
    if (parsedMs.length > 0) next.milestones = parsedMs;
  }

  // 3. Parse Feed Calendar if present
  const feedRows = data.tabData["Feed Calendar"];
  if (feedRows && feedRows.length > 0) {
    const parsedFeed: FeedPostItem[] = [];
    let idx = 1;
    for (const r of feedRows) {
      const c0 = (r[0] || "").trim();
      if (!/^Cycle\s*\d+/i.test(c0)) continue;
      const fmtRaw = (r[5] || "Post").trim();
      const format: FeedPostItem["format"] =
        fmtRaw.toLowerCase() === "reel"
          ? "Reel"
          : fmtRaw.toLowerCase() === "carousel"
            ? "Carousel"
            : fmtRaw.toLowerCase() === "video"
              ? "Video"
              : "Post";
      const stRaw = (r[9] || "").trim().toLowerCase();
      const publishStatus: PublishStatus =
        stRaw === "published"
          ? "Published"
          : stRaw === "scheduled"
            ? "Scheduled"
            : stRaw === "approved"
              ? "Approved"
              : stRaw.includes("review")
                ? "Ready for Review"
                : "Draft";
      parsedFeed.push({
        id: `fp_imp_${idx++}`,
        cycle: c0,
        contentName: (r[1] || `Post ${idx}`).trim(),
        publishDate: (r[2] || "").trim(),
        day: (r[3] || "").trim(),
        cairoTime: (r[4] || "7:00 PM").trim(),
        format,
        platforms: (r[6] || "FB + IG").trim(),
        actualPublish: (r[7] || "").trim(),
        postType: (r[8] || "Organic").trim() as FeedPostItem["postType"],
        publishStatus,
      });
    }
    if (parsedFeed.length > 0) next.feedCalendar = parsedFeed;
  }

  // 4. Parse Daily Stories if present
  const storyRows = data.tabData["Daily Stories"];
  if (storyRows && storyRows.length > 0) {
    const parsedStories: DailyStoryItem[] = [];
    let idx = 1;
    for (const r of storyRows) {
      const c0 = (r[0] || "").trim();
      if (!/^Cycle\s*\d+/i.test(c0)) continue;
      const stRaw = (r[8] || "").trim().toLowerCase();
      const publishStatus: PublishStatus =
        stRaw === "published"
          ? "Published"
          : stRaw === "scheduled"
            ? "Scheduled"
            : stRaw === "approved"
              ? "Approved"
              : "Draft";
      parsedStories.push({
        id: `st_imp_${idx++}`,
        cycle: c0,
        storyId: (r[1] || `Story ${idx}`).trim(),
        publishDate: (r[2] || "").trim(),
        day: (r[3] || "").trim(),
        cairoTime: (r[4] || "6:00 PM").trim(),
        platforms: (r[5] || "FB + IG").trim(),
        topicAssetLink: (r[6] || "").trim(),
        actualPublish: (r[7] || "").trim(),
        publishStatus,
      });
    }
    if (parsedStories.length > 0) next.dailyStories = parsedStories;
  }

  return next;
}
