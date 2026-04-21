import { Timestamp } from "firebase/firestore";

/** Firestore Timestamp or plain client read shape with `toDate`. */
export type SessionLike = {
  totalWorkTime?: number;
  date?: string;
  loginTime?: Timestamp | null | { toDate: () => Date };
  workerId?: string;
  workerName?: string;
  isActive?: boolean;
};

/** Sum totalWorkTime (ms) for sessions whose `date` is today (YYYY-MM-DD in local TZ). */
export function sumTodayWorkMs(sessions: SessionLike[], todayYmd: string): number {
  let total = 0;
  for (const s of sessions) {
    if (s.date === todayYmd && typeof s.totalWorkTime === "number") {
      total += s.totalWorkTime;
    }
  }
  return total;
}

export function msToHoursLabel(ms: number): string {
  const h = Math.round((ms / (1000 * 60 * 60)) * 10) / 10;
  return `${h}h`;
}

export function sessionHours(session: SessionLike): number {
  return (session.totalWorkTime || 0) / (1000 * 60 * 60);
}
