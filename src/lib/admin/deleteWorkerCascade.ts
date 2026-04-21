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
    const rec = data.recipients as string[] | undefined;
    if (!rec?.includes(workerId)) return;
    const next = rec.filter((id) => id !== workerId);
    if (next.length === 0) ops.push(deleteDoc(d.ref));
    else ops.push(updateDoc(d.ref, { recipients: next, recipientCount: next.length }));
  });

  await Promise.all(ops);
  await deleteDoc(doc(db, "workers", workerId));
}
