import { NextRequest, NextResponse } from "next/server";

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound?: string;
  priority?: string;
  channelId?: string;
  android?: { channelId?: string };
  data?: Record<string, string>;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as unknown;
    if (!Array.isArray(body) || body.length === 0) {
      return NextResponse.json({ error: "Expected JSON array of push messages" }, { status: 400 });
    }
    if (body.length > 100) {
      return NextResponse.json({ error: "Too many messages (max 100)" }, { status: 400 });
    }

    const upRes = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body as ExpoPushMessage[]),
    });

    const text = await upRes.text();
    if (!upRes.ok) {
      console.error("[expo-push] Expo API error:", upRes.status, text);
      return NextResponse.json({ error: "Expo push failed", detail: text }, { status: 502 });
    }

    try {
      const parsed = JSON.parse(text) as {
        data?: Array<{ status?: string; message?: string; details?: unknown }>;
        errors?: unknown[];
      };
      if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        console.error("[expo-push] Expo errors:", parsed.errors);
      }
      if (Array.isArray(parsed.data)) {
        for (const ticket of parsed.data) {
          if (ticket?.status === "error") {
            console.error("[expo-push] ticket:", ticket.message, ticket.details);
          }
        }
      }
      return NextResponse.json(parsed);
    } catch {
      return NextResponse.json({ ok: true, raw: text });
    }
  } catch (e) {
    console.error("[expo-push]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
