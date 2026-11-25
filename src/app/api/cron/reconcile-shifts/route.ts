import { NextRequest, NextResponse } from "next/server";
import {
  createFirestoreRestClient,
  resolveServerFirestoreBearerToken,
  verifyAdminFirebaseIdToken,
} from "@/lib/server/firestoreRest";
import { reconcileActiveShifts } from "@/lib/server/reconcileShifts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    return token || null;
  }
  return null;
}

async function authorizeRequest(req: NextRequest): Promise<{
  authorized: boolean;
  callerAdminIdToken?: string | null;
  reason?: string;
}> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  const bearer = extractBearerToken(req);
  const headerSecret = (req.headers.get("x-cron-secret") || "").trim();

  // 1. Secret match (Vercel Cron automatically sends `Authorization: Bearer ${CRON_SECRET}`)
  if (cronSecret && (bearer === cronSecret || headerSecret === cronSecret)) {
    return { authorized: true, callerAdminIdToken: null };
  }

  // 2. Authenticated HR / Super Admin Firebase ID token (used by Admin Dashboard live fallback)
  if (bearer && bearer !== cronSecret) {
    const verified = await verifyAdminFirebaseIdToken(bearer);
    if (verified.valid) {
      return { authorized: true, callerAdminIdToken: bearer };
    }
  }

  // 3. Vercel Cron invocation when CRON_SECRET is not configured yet
  if (!cronSecret && req.headers.get("x-vercel-cron") === "1") {
    return { authorized: true, callerAdminIdToken: null };
  }

  // 4. Local development convenience when CRON_SECRET is not set
  if (!cronSecret && process.env.NODE_ENV !== "production") {
    return { authorized: true, callerAdminIdToken: bearer };
  }

  return {
    authorized: false,
    reason: cronSecret
      ? "Unauthorized: provide Authorization: Bearer <CRON_SECRET> or an admin Firebase ID token"
      : "Unauthorized: set CRON_SECRET or pass an admin Firebase ID token",
  };
}

async function handleReconcile(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req);
    if (!authResult.authorized) {
      return NextResponse.json({ ok: false, error: authResult.reason || "Unauthorized" }, { status: 401 });
    }

    const tokenInfo = await resolveServerFirestoreBearerToken(authResult.callerAdminIdToken);
    if (!tokenInfo) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing server Firestore credentials. Configure FIREBASE_SERVICE_ACCOUNT_JSON (or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY, or CRON_ADMIN_EMAIL + CRON_ADMIN_PASSWORD) or call with an admin Firebase ID token.",
        },
        { status: 503 },
      );
    }

    const firestore = createFirestoreRestClient(tokenInfo.token);
    const summary = await reconcileActiveShifts({ firestore });
    return NextResponse.json({ ...summary, authMode: tokenInfo.authMode });
  } catch (err) {
    console.error("[cron/reconcile-shifts] error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Reconciliation failed" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return handleReconcile(req);
}

export async function POST(req: NextRequest) {
  return handleReconcile(req);
}
