import { NextRequest, NextResponse } from "next/server";

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i]!;
    const next = csvText[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field.trim());
        field = "";
      } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        if (ch === "\r") i++;
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = "";
      } else if (ch !== "\r") {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { sheetUrl?: string };
    const rawUrl = (body.sheetUrl || "").trim();
    const idMatch = rawUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch?.[1]) {
      return NextResponse.json({ error: "Invalid Google Sheets URL" }, { status: 400 });
    }
    const sheetId = idMatch[1];

    const htmlRes = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`, {
      cache: "no-store",
    });
    if (!htmlRes.ok) {
      return NextResponse.json(
        { error: "Could not access Google Sheet. Make sure link sharing is enabled." },
        { status: 400 },
      );
    }
    const html = await htmlRes.text();
    const tabMatches = [...html.matchAll(/name:\s*"([^"]+)"[\s\S]{0,200}?gid:\s*"(\d+)"/g)];
    const tabs =
      tabMatches.length > 0
        ? tabMatches.map((m) => ({ name: m[1]!, gid: m[2]! }))
        : [{ name: "Overview", gid: "0" }];

    const tabData: Record<string, string[][]> = {};
    await Promise.all(
      tabs.map(async (t) => {
        const csvRes = await fetch(
          `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${t.gid}`,
          { cache: "no-store" },
        );
        if (csvRes.ok) {
          const txt = await csvRes.text();
          tabData[t.name] = parseCsvRows(txt);
        }
      }),
    );

    return NextResponse.json({ sheetId, tabs, tabData });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to import Google Sheet" },
      { status: 500 },
    );
  }
}
