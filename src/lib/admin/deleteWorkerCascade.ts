import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Deletes a worker and related documents (matches HTML dashboard behavior).
 */
export async function deleteWorkerCascade(workerId: string): Promise<void> {
  const ops: Promise<unknown>[] = [];

  const ws = await getDocs(query(collection(db, "workSessions"), where("workerId", "==", workerId)));
  ws.forEach((d) => ops.push(deleteDoc(d.ref)));

  const ex = await getDocs(query(collection(db, "exceptionRequests"), where("workerId", "==", workerId)));
  ex.forEach((d) => ops.push(deleteDoc(d.ref)));

  const pen = await getDocs(query(collection(db, "penalties"), where("workerId", "==", workerId)));
  pen.forEach((d) => ops.push(deleteDoc(d.ref)));

  const tEq = await getDocs(query(collection(db, "tasks"), where("assignedTo", "==", workerId)));
  tEq.forEach((d) => ops.push(deleteDoc(d.ref)));

  try {
    const tArr = await getDocs(query(collection(db, "tasks"), where("assignedTo", "array-contains", workerId)));
    tArr.forEach((d) => ops.push(deleteDoc(d.ref)));
  } catch {
    // Missing composite index — skip array-assigned cleanup
  }

  const alertsSnap = await getDocs(collection(db, "alerts"));
  alertsSnap.forEach((d) => {
    const data = d.data();
    // Clean up legacy fallback admin notifications stored in `alerts` for the deleted worker
    if (data.adminNotif === true && data.actorUid === workerId) {
      ops.push(deleteDoc(d.ref));
      return;
    }
    const rec = data.recipients as string[] | undefined;
    if (!rec?.includes(workerId)) return;
    const next = rec.filter((id) => id !== workerId);
    if (next.length === 0) ops.push(deleteDoc(d.ref));
    else ops.push(updateDoc(d.ref, { recipients: next, recipientCount: next.length }));
  });

  // Best-effort cleanup of historical notifications tied to the deleted worker
  try {
    const adminNotifs = await getDocs(
      query(collection(db, "adminNotifications"), where("actorUid", "==", workerId)),
    );
    adminNotifs.forEach((d) => ops.push(deleteDoc(d.ref)));
  } catch {
    // Non-super-admin (e.g. hr_admin) list rule requires role scope; retry scoped to hr_admin
    try {
      const hrAdminNotifs = await getDocs(
        query(
          collection(db, "adminNotifications"),
          where("actorUid", "==", workerId),
          where("targetRoles", "array-contains", "hr_admin"),
        ),
      );
      hrAdminNotifs.forEach((d) => ops.push(deleteDoc(d.ref)));
    } catch {
      // Non-fatal if rule/index unavailable
    }
  }

  try {
    const chatNotifs = await getDocs(
      query(collection(db, "chatNotifications"), where("recipientUid", "==", workerId)),
    );
    chatNotifs.forEach((d) => ops.push(deleteDoc(d.ref)));
  } catch {
    // Non-fatal if rule/index unavailable
  }

  await Promise.all(ops);
  await deleteDoc(doc(db, "workers", workerId));
}
