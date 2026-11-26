import { NextResponse } from "next/server";
import { handleAdminAiGet, handleAdminAiPost } from "@/lib/server/adminAiHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const result = await handleAdminAiGet(req.headers.get("authorization"));
  return NextResponse.json(result.body, {
    status: result.status,
    headers: result.headers,
  });
}

export async function POST(req: Request) {
  let rawBody: unknown = null;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON request body." }, { status: 400 });
  }

  const result = await handleAdminAiPost(req.headers.get("authorization"), rawBody);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: result.headers,
  });
}
