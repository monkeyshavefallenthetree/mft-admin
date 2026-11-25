import { NextRequest, NextResponse } from "next/server";
import {
  ensureVapidConfigured,
  getVapidConfig,
  sendWebPushBatch,
  type StoredPushSubscription,
  type WebPushPayload,
} from "@/lib/server/pushTransport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = getVapidConfig();
  const check = ensureVapidConfigured();
  return NextResponse.json({
    publicKey: cfg.publicKey,
    configured: check.valid,
    ...(check.valid ? {} : { warning: check.reason }),
  });
}

export async function POST(req: NextRequest) {
  try {
    const check = ensureVapidConfigured();
    if (!check.valid) {
      console.error("[web-push] Invalid VAPID config:", check.reason);
      return NextResponse.json(
        { error: check.reason || "Invalid VAPID configuration", sent: 0, failed: 0, goneEndpoints: [], errors: [] },
        { status: 500 },
      );
    }

    const body = (await req.json()) as {
      subscriptions?: StoredPushSubscription[];
      payload?: WebPushPayload;
      delayMs?: number;
    };

    const subs = Array.isArray(body.subscriptions) ? body.subscriptions : [];
    const payload = body.payload;

    if (!payload || !payload.title) {
      return NextResponse.json({ error: "Missing notification payload.title" }, { status: 400 });
    }
    if (subs.length === 0) {
      return NextResponse.json({ sent: 0, failed: 0, goneEndpoints: [], errors: [] });
    }

    const delayMs = typeof body.delayMs === "number" ? Math.min(Math.max(0, body.delayMs), 8000) : 0;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const result = await sendWebPushBatch(subs, payload);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[web-push] route error:", e);
    return NextResponse.json(
      { error: "Web push server error", sent: 0, failed: 0, goneEndpoints: [], errors: [] },
      { status: 500 },
    );
  }
}
