import { NextRequest, NextResponse } from "next/server";
import { sendExpoPushBatch, type ExpoPushInputMessage } from "@/lib/server/pushTransport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as unknown;
    if (!Array.isArray(body) || body.length === 0) {
      return NextResponse.json({ error: "Expected JSON array of push messages" }, { status: 400 });
    }
    if (body.length > 100) {
      return NextResponse.json({ error: "Too many messages (max 100)" }, { status: 400 });
    }

    const result = await sendExpoPushBatch(body as ExpoPushInputMessage[]);
    if (!result.ok && result.sent === 0 && result.tickets.length === 0 && result.invalidTokens.length === 0) {
      return NextResponse.json(
        { error: "Expo push failed", detail: result.errors.join("; "), ...result },
        { status: 502 },
      );
    }

    return NextResponse.json(result);
  } catch (e) {
    console.error("[expo-push]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
