"use client";

import { useCallback, useEffect, useState } from "react";
import { collection, getCountFromServer, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { msToHoursLabel, sumTodayWorkMs } from "@/lib/admin/workTime";

export default function AdminHeaderStats() {
  const [submissionCount, setSubmissionCount] = useState(0);
  const [workers, setWorkers] = useState({ total: 0, pending: 0, online: 0 });
  const [todayWorkLabel, setTodayWorkLabel] = useState("0h");
  const [refreshing, setRefreshing] = useState(false);

  const refreshSubmissionCount = useCallback(async () => {
    try {
      const snap = await getCountFromServer(collection(db, "submissions"));
      setSubmissionCount(snap.data().count);
    } catch (e) {
      console.error("Submission count:", e);
    }
  }, []);

  useEffect(() => {
    void refreshSubmissionCount();
    const id = setInterval(() => void refreshSubmissionCount(), 15000);
    return () => clearInterval(id);
  }, [refreshSubmissionCount]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "workers"), (snap) => {
      let pending = 0;
      let online = 0;
      snap.forEach((d) => {
        const w = d.data();
        if (w.status === "pending") pending += 1;
        if (w.isOnline === true) online += 1;
      });
      setWorkers({ total: snap.size, pending, online });
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    const q = query(collection(db, "workSessions"), where("date", "==", today));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const sessions = snap.docs.map((d) => d.data() as { totalWorkTime?: number; date?: string });
        const ms = sumTodayWorkMs(sessions, today!);
        setTodayWorkLabel(msToHoursLabel(ms));
      },
      () => {
        setTodayWorkLabel("0h");
      },
    );
    return () => unsub();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshSubmissionCount();
    setRefreshing(false);
  };

  const items = [
    { label: "Submissions", value: submissionCount },
    { label: "Workers", value: workers.total },
    { label: "Pending", value: workers.pending },
    { label: "Online", value: workers.online },
    { label: "Today Work", value: todayWorkLabel },
  ];

  return (
    <div className="mb-6 border border-[var(--mft-border)] bg-[var(--mft-surface)] flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between px-4 py-4 md:px-6">
      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-px bg-[var(--mft-border)] sm:grid-cols-5 border border-[var(--mft-border)]">
        {items.map((s) => (
          <div key={s.label} className="bg-[var(--mft-bg)] px-4 py-3 text-center hover:bg-[var(--mft-surface)] transition-colors">
            <div className="text-2xl font-oswald font-bold text-[var(--mft-primary)] tabular-nums">{s.value}</div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 justify-center lg:justify-end">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#00FF66]">
          <span className="h-1.5 w-1.5 bg-[#00FF66] animate-pulse" aria-hidden />
          LIVE
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={refreshing}
          className="brutal-btn px-4 py-2 disabled:opacity-50"
        >
          {refreshing ? "[ SYNCING... ]" : "[ REFRESH ]"}
        </button>
      </div>
    </div>
  );
}
