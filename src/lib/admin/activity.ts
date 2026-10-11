"use client";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export type ActivityEntity =
  | "project"
  | "task"
  | "worker"
  | "exception"
  | "submission"
  | "hr"
  | "session"
  | "auth";

export type ActivityAction =
  | "created"
  | "updated"
  | "deleted"
  | "approved"
  | "rejected"
  | "assigned"
  | "status"
  | "sent"
  | "exported"
  | "signed-in"
  | "signed-out";

export interface ActivityInput {
  action: ActivityAction;
  entity: ActivityEntity;
  /** Human readable label, e.g. the task title or worker name. */
  label: string;
  entityId?: string;
  /** Optional extra detail line (e.g. "status → done"). */
  detail?: string;
}

export const ACTIVITY_COLLECTION = "activityLog";

/**
 * Record an admin action in the audit log. Never throws – logging must not
 * break the actual operation.
 */
export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    const u = auth.currentUser;
    await addDoc(collection(db, ACTIVITY_COLLECTION), {
      ...input,
      entityId: input.entityId ?? null,
      detail: input.detail ?? null,
      actorEmail: u?.email ?? "unknown",
      actorUid: u?.uid ?? null,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[activity] failed to log", err);
  }
}
