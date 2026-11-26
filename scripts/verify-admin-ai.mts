/**
 * Automated verification for MFT Admin Super AI:
 *  1. Auth & strict role security (401/403, no super_admin fallback for non-admins)
 *  2. Role isolation (ops_admin vs hr_admin vs super_admin context, hrefs, and drafts)
 *  3. Multi-provider free AI gateway fallback chain (custom -> opencode -> groq -> gemini -> openrouter -> local)
 *  4. Context size cap (Groq 8K TPM safety <= 6,500 chars) + bilingual Arabic/English local fallback + HR-POL-2026
 *  5. Action/draft sanitization + rate limiting (429) + GET status endpoint secret-safety
 *
 * Run:  node scripts/verify-admin-ai.mts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(rootDir, "src");

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(srcDir, specifier.slice(2));
      for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
        const candidate = base + ext;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const base = path.resolve(parentDir, specifier);
      for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
        const candidate = base + ext;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const aiGateway = await import("../src/lib/server/aiGateway.ts");
const adminAiAuth = await import("../src/lib/server/adminAiAuth.ts");
const adminAiContext = await import("../src/lib/server/adminAiContext.ts");
const adminAiLocal = await import("../src/lib/server/adminAiLocal.ts");
const adminAiHandler = await import("../src/lib/server/adminAiHandler.ts");
const cairoTime = await import("../src/lib/admin/cairoTime.ts");

let passed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.stack || err.message : String(err)}`);
    console.log(`  ✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createAuthMockFetch(accountsByToken: Record<string, { localId: string; email: string; customAttributes?: string }>) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("identitytoolkit.googleapis.com/v1/accounts:lookup")) {
      const parsed = JSON.parse(String(init?.body || "{}")) as { idToken?: string };
      const acc = parsed.idToken ? accountsByToken[parsed.idToken] : undefined;
      if (!acc) return makeJsonResponse(400, { error: { message: "INVALID_ID_TOKEN" } });
      return makeJsonResponse(200, { users: [acc] });
    }
    return makeJsonResponse(404, { error: "unexpected_url" });
  };
}

function createMockFirestore(docs: Record<string, Record<string, unknown>>) {
  const queriedCollections: string[] = [];
  const queryFilterCounts: Array<{ collection: string; filterCount: number }> = [];
  const fetchedDocs: string[] = [];
  return {
    queriedCollections,
    queryFilterCounts,
    fetchedDocs,
    client: {
      async getDocument(docPath: string) {
        fetchedDocs.push(docPath);
        const data = docs[docPath];
        if (!data) return null;
        const parts = docPath.split("/");
        return { id: parts[parts.length - 1]!, path: docPath, data: structuredClone(data) };
      },
      async queryCollection(
        collectionId: string,
        filters: Array<{ field: string; op: "EQUAL" | "LESS_THAN" | "GREATER_THAN"; value: unknown }>,
      ) {
        queriedCollections.push(collectionId);
        queryFilterCounts.push({ collection: collectionId, filterCount: filters.length });
        const out: Array<{ id: string; path: string; data: Record<string, unknown> }> = [];
        for (const [k, data] of Object.entries(docs)) {
          if (!k.startsWith(`${collectionId}/`)) continue;
          const id = k.slice(collectionId.length + 1);
          if (id.includes("/")) continue;
          let match = true;
          for (const f of filters) {
            if (f.op === "EQUAL" && data[f.field] !== f.value) match = false;
          }
          if (match) out.push({ id, path: k, data: structuredClone(data) });
        }
        return out;
      },
      async patchDocument() {
        return true;
      },
      async createDocument() {
        return "new_doc";
      },
      async createDocumentIfAbsent(_c: string, id: string) {
        return { created: true, id };
      },
    },
  };
}

const TOKEN_SUPER = "tok_super_admin_valid_1234567890";
const TOKEN_OPS = "tok_ops_admin_valid_1234567890";
const TOKEN_HR = "tok_hr_admin_valid_1234567890";
const TOKEN_WORKER = "tok_regular_worker_valid_1234567890";
const TOKEN_BAD = "tok_invalid_token_1234567890";

const ACCOUNTS = {
  [TOKEN_SUPER]: { localId: "uid_super", email: "admin@mft.com" },
  [TOKEN_OPS]: { localId: "uid_ops", email: "mayamahmoud@mft.com" },
  [TOKEN_HR]: { localId: "uid_hr", email: "hr@mft.com" },
  [TOKEN_WORKER]: { localId: "uid_worker", email: "sara.worker@mft.com" },
};

const NOW_MS = cairoTime.cairoWallTimeToDate(2026, 11, 26, 14, 0, 0).getTime();
const T10_MS = cairoTime.cairoWallTimeToDate(2026, 11, 26, 10, 0, 0).getTime();
const T1130_MS = cairoTime.cairoWallTimeToDate(2026, 11, 26, 11, 30, 0).getTime();

const SAMPLE_DOCS: Record<string, Record<string, unknown>> = {
  "workers/w1": {
    firstName: "Ahmed",
    lastName: "Ali",
    department: "development",
    role: "engineer",
    status: "approved",
    hourlyRate: 150,
    expectedSalary: 25000,
  },
  "workers/w2": {
    firstName: "Mona",
    lastName: "Hassan",
    department: "design",
    role: "designer",
    status: "approved",
    hourlyRate: 120,
  },
  "workers/w3": {
    firstName: "New",
    lastName: "Applicant",
    department: "marketing",
    role: "specialist",
    status: "pending",
  },
  "projects/p1": { name: "ARC Launch", clientName: "ARC Motors", status: "active" },
  "tasks/t1": {
    title: "Finalize landing page",
    status: "pending-approval",
    assignedTo: "w1",
    assignedWorkerName: "Ahmed Ali",
    projectName: "ARC Launch",
    dueDate: "2026-11-24",
  },
  "tasks/t2": {
    title: "Social media grid",
    status: "in-progress",
    assignedTo: "w2",
    assignedWorkerName: "Mona Hassan",
    projectName: "ARC Launch",
    dueDate: "2026-11-20",
  },
  "submissions/sub1": { name: "Karim Client", company: "Nile Co", service: "branding", status: "new" },
  "settings/client_portals_v1": {
    portals: [{ brandName: "ARC Motors", feedPosts: [1, 2], dailyStories: [1, 2, 3] }],
  },
  "workSessions/w1_2026-11-26": {
    workerId: "w1",
    workerName: "Ahmed Ali",
    date: "2026-11-26",
    isActive: true,
    startTime: new Date(T10_MS),
    segmentStartAt: new Date(T10_MS),
    presenceStatus: "active",
  },
  "workSessions/w2_2026-11-26": {
    workerId: "w2",
    workerName: "Mona Hassan",
    date: "2026-11-26",
    isActive: true,
    startTime: new Date(T1130_MS),
    segmentStartAt: new Date(T1130_MS),
    presenceStatus: "idle",
  },
  "exceptionRequests/ex1": {
    workerId: "w1",
    workerName: "Ahmed Ali",
    type: "overtime",
    status: "pending",
    exceptionDate: "2026-11-26",
    lateMinutes: 120,
  },
  "reimbursements/rb1": {
    workerId: "w2",
    workerName: "Mona Hassan",
    type: "outdoor",
    stage: "review",
    amount: 240,
  },
  "settings/hr": {
    standardHours: 8,
    shiftStartTime: "10:00",
    lateCutoffTime: "11:00",
    graceMinutes: 60,
    policy2026Enabled: true,
  },
  "activityLog/act1": {
    action: "approved",
    entity: "exception",
    label: "Overtime · Ahmed Ali",
    createdAt: new Date(NOW_MS - 300_000),
  },
};

console.log("\n[1] Auth & strict role security");

await test("401 on missing or invalid Firebase ID token", async () => {
  const mockFetch = createAuthMockFetch(ACCOUNTS);
  const rMissing = await adminAiHandler.handleAdminAiPost(null, { message: "hello" }, { fetchImpl: mockFetch, env: {} });
  assert.equal(rMissing.status, 401);

  const rBad = await adminAiHandler.handleAdminAiPost(
    `Bearer ${TOKEN_BAD}`,
    { message: "hello" },
    { fetchImpl: mockFetch, env: {} },
  );
  assert.equal(rBad.status, 401);
});

await test("403 on valid non-admin worker token (NEVER defaults to super_admin!)", async () => {
  const mockFetch = createAuthMockFetch(ACCOUNTS);
  const rPost = await adminAiHandler.handleAdminAiPost(
    `Bearer ${TOKEN_WORKER}`,
    { message: "Give me studio briefing" },
    { fetchImpl: mockFetch, env: {} },
  );
  assert.equal(rPost.status, 403);

  const rGet = await adminAiHandler.handleAdminAiGet(`Bearer ${TOKEN_WORKER}`, { fetchImpl: mockFetch, env: {} });
  assert.equal(rGet.status, 403);
});

await test("Strict role resolution supports default emails, custom claims, and env allowlists", () => {
  assert.equal(adminAiAuth.resolveStrictAdminRole("admin@mft.com"), "super_admin");
  assert.equal(adminAiAuth.resolveStrictAdminRole("mayamahmoud@mft.com"), "ops_admin");
  assert.equal(adminAiAuth.resolveStrictAdminRole("hr@mft.com"), "hr_admin");
  assert.equal(adminAiAuth.resolveStrictAdminRole("random.worker@mft.com"), null);
  assert.equal(
    adminAiAuth.resolveStrictAdminRole("custom.hr@mft.com", JSON.stringify({ role: "hr_admin" })),
    "hr_admin",
  );
  assert.equal(
    adminAiAuth.resolveStrictAdminRole("extra.ops@mft.com", null, { ADMIN_OPS_EMAILS: "extra.ops@mft.com" }),
    "ops_admin",
  );
});

console.log("\n[2] Role isolation (ops_admin vs hr_admin vs super_admin)");

await test("ops_admin never fetches HR collections, never sees hourlyRate/salary, and strips HR hrefs & drafts", async () => {
  const mockDb = createMockFirestore(SAMPLE_DOCS);
  const ctx = await adminAiContext.loadAdminAiContext({
    role: "ops_admin",
    pathname: "/admin/projects",
    firestore: mockDb.client,
    nowMs: NOW_MS,
  });

  assert.ok(ctx.ops, "ops_admin should receive Ops snapshot");
  assert.equal(ctx.hr, undefined, "ops_admin MUST NOT receive HR snapshot");
  assert.equal(ctx.recentActivity, undefined, "ops_admin MUST NOT receive activityLog");
  assert.equal(mockDb.queriedCollections.includes("workSessions"), false);
  assert.equal(mockDb.queriedCollections.includes("exceptionRequests"), false);
  assert.equal(mockDb.queriedCollections.includes("reimbursements"), false);

  const serialized = adminAiContext.serializeAdminContext(ctx);
  assert.equal(serialized.includes("hourlyRate"), false);
  assert.equal(serialized.includes("25000"), false);

  // Role-boundary denial on HR query
  const localHrAttempt = adminAiLocal.runAdminAiLocal("Who is late today and what is payroll?", ctx);
  assert.match(localHrAttempt.reply, /ops_admin|restricted/i);
  assert.equal(localHrAttempt.draft, null);

  // Action & draft sanitizers block HR paths & HR drafts for ops_admin
  const filteredActions = adminAiLocal.sanitizeAdminAiActions(
    [
      { label: "Projects", href: "/admin/projects" },
      { label: "HR Secret", href: "/admin/hr" },
      { label: "Exceptions", href: "/admin/exceptions?status=pending" },
      { label: "Evil", href: "https://evil.example/phish" },
    ],
    "ops_admin",
  );
  assert.deepEqual(
    filteredActions.map((a) => a.href),
    ["/admin/projects"],
  );
  assert.equal(
    adminAiLocal.sanitizeAdminAiDraft(
      { type: "send_hr_alert", title: "Test", message: "Msg", alertType: "urgent", priority: "high", recipient: "all" },
      "ops_admin",
      ctx,
    ),
    null,
  );
  assert.ok(
    adminAiLocal.sanitizeAdminAiDraft(
      { type: "create_task", title: "Ship hero", description: "Update copy", department: "design", priority: "high" },
      "ops_admin",
      ctx,
    ),
  );
});

await test("hr_admin never fetches Ops/Client Portal collections and strips Ops hrefs & drafts", async () => {
  const mockDb = createMockFirestore(SAMPLE_DOCS);
  const ctx = await adminAiContext.loadAdminAiContext({
    role: "hr_admin",
    pathname: "/admin/hr",
    firestore: mockDb.client,
    nowMs: NOW_MS,
  });

  assert.ok(ctx.hr, "hr_admin should receive HR snapshot");
  assert.equal(ctx.ops, undefined, "hr_admin MUST NOT receive Ops snapshot");
  assert.equal(mockDb.queriedCollections.includes("projects"), false);
  assert.equal(mockDb.queriedCollections.includes("tasks"), false);
  assert.equal(mockDb.queriedCollections.includes("submissions"), false);
  assert.equal(mockDb.fetchedDocs.includes("settings/client_portals_v1"), false);
  assert.equal(ctx.hr!.liveOnlineWorkers.length, 2);
  assert.equal(ctx.hr!.lateTodayWorkers.length, 1);
  assert.equal(ctx.hr!.idleTodayWorkers.length, 1);

  const localOpsAttempt = adminAiLocal.runAdminAiLocal("Summarize new client leads and create task", ctx);
  assert.match(localOpsAttempt.reply, /hr_admin|restricted/i);
  assert.equal(localOpsAttempt.draft, null);

  const filteredActions = adminAiLocal.sanitizeAdminAiActions(
    [
      { label: "HR", href: "/admin/hr" },
      { label: "Work Sessions", href: "/admin/work-sessions?status=idle" },
      { label: "Client Portal", href: "/admin/client-portal" },
      { label: "Tasks", href: "/admin/tasks" },
    ],
    "hr_admin",
  );
  assert.deepEqual(
    filteredActions.map((a) => a.href),
    ["/admin/hr", "/admin/work-sessions?status=idle"],
  );
  assert.equal(
    adminAiLocal.sanitizeAdminAiDraft(
      { type: "create_task", title: "Bad", description: "No", department: "design", priority: "high" },
      "hr_admin",
      ctx,
    ),
    null,
  );
  assert.ok(
    adminAiLocal.sanitizeAdminAiDraft(
      { type: "send_hr_alert", title: "Reminder", message: "Check in", alertType: "shift_reminder", priority: "high", recipient: "all" },
      "hr_admin",
      ctx,
    ),
  );
});

await test("super_admin gets full Ops + HR + recentActivity, single-filter OT query, strict route sanitization, & all 4 draft types", async () => {
  const mockDb = createMockFirestore({
    ...SAMPLE_DOCS,
    "workSessions/w1_2026-11-26": {
      workerId: "w1",
      workerName: "Ahmed Ali",
      date: "2026-11-26",
      isActive: true,
      startTime: new Date(T10_MS),
      segmentStartAt: new Date(T10_MS),
      presenceStatus: "active",
    },
    // Pending 120m OT MUST NOT extend hours; approved 60m OT DOES extend hours
    "exceptionRequests/ex_approved_ot": {
      workerId: "w1",
      workerName: "Ahmed Ali",
      type: "overtime",
      status: "approved",
      exceptionDate: "2026-11-26",
      lateMinutes: 60,
    },
  });
  // Evaluate at 19:00 Cairo (9h after 10:00): approved 60m OT allows 9.0h (not 10h from pending ex1!)
  const t19Ms = cairoTime.cairoWallTimeToDate(2026, 11, 26, 19, 0, 0).getTime();
  const ctx = await adminAiContext.loadAdminAiContext({
    role: "super_admin",
    pathname: "/admin",
    firestore: mockDb.client,
    nowMs: t19Ms,
  });

  assert.ok(ctx.ops);
  assert.ok(ctx.hr);
  assert.equal(ctx.recentActivity?.length, 1);

  // AI-A2: Never issue multi-field composite queries (no Firestore composite index dependency)
  const badComposite = mockDb.queryFilterCounts.filter((q) => q.filterCount > 1);
  assert.deepEqual(badComposite, [], "All Firestore queries in adminAiContext must use <= 1 filter");
  const w1Live = ctx.hr!.liveOnlineWorkers.find((w) => w.name === "Ahmed Ali");
  assert.equal(w1Live?.hours, 9, "Approved 60m OT must extend live hours to 9h while ignoring pending OT");

  // AI-A3: Even super_admin rejects /admin/login, traversal (..), unknown & prefix-spoofed routes
  const superActions = adminAiLocal.sanitizeAdminAiActions(
    [
      { label: "Overview", href: "/admin" },
      { label: "Policy Lab", href: "/admin/hr/policy-lab" },
      { label: "Login", href: "/admin/login" },
      { label: "Traversal", href: "/admin/hr/../login" },
      { label: "Hallucinated", href: "/admin/nonexistent-secret" },
      { label: "Prefix Spoof", href: "/admin/hr-fake" },
    ],
    "super_admin",
  );
  assert.deepEqual(
    superActions.map((a) => a.href),
    ["/admin", "/admin/hr/policy-lab"],
  );

  assert.ok(adminAiLocal.sanitizeAdminAiDraft({ type: "create_task", title: "T", description: "D", department: "design", priority: "low" }, "super_admin", ctx));
  assert.ok(adminAiLocal.sanitizeAdminAiDraft({ type: "send_hr_alert", title: "A", message: "M", alertType: "system_announcement", priority: "high", recipient: "all" }, "super_admin", ctx));
  assert.ok(adminAiLocal.sanitizeAdminAiDraft({ type: "client_reply_draft", subject: "S", body: "Hello", language: "en" }, "super_admin", ctx));
  assert.ok(adminAiLocal.sanitizeAdminAiDraft({ type: "hr_notice_draft", title: "N", body: "Notice", language: "en" }, "super_admin", ctx));
});

console.log("\n[3] Multi-provider free AI gateway fallback chain");

await test("Full fallback chain: custom (503) -> opencode (403) -> groq (429) -> gemini (200)", async () => {
  const calls: string[] = [];
  const mockFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    if (url.startsWith("https://custom.local/v1/chat/completions")) {
      return makeJsonResponse(503, { error: "down" });
    }
    if (url.startsWith("https://opencode.ai/zen/v1/chat/completions")) {
      return makeJsonResponse(403, { error: "FreeTierError" });
    }
    if (url.startsWith("https://api.groq.com/openai/v1/chat/completions")) {
      return makeJsonResponse(429, { error: "rate_limited" });
    }
    if (url.includes("generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent")) {
      const body = JSON.parse(String(init?.body || "{}")) as {
        systemInstruction?: { parts?: Array<{ text?: string }> };
        contents?: Array<{ role?: string }>;
      };
      assert.ok(body.systemInstruction?.parts?.[0]?.text, "Gemini request must include systemInstruction");
      assert.equal(body.contents?.[0]?.role, "user");
      return makeJsonResponse(200, {
        candidates: [{ content: { parts: [{ text: "Studio is healthy.\n```mft-actions\n{\"actions\":[{\"label\":\"HR\",\"href\":\"/admin/hr\"}]}\n```" }] } }],
      });
    }
    return makeJsonResponse(500, { error: "unexpected" });
  };

  const res = await aiGateway.callAiGateway(
    {
      systemPrompt: "You are MFT Super AI.",
      messages: [{ role: "user", content: "Briefing?" }],
    },
    {
      fetchImpl: mockFetch,
      env: {
        AI_BASE_URL: "https://custom.local/v1",
        AI_MODEL: "local-llama",
        OPENCODE_API_KEY: "oc_test",
        GROQ_API_KEY: "gsk_test",
        GEMINI_API_KEY: "AIza_test",
        OPENROUTER_API_KEY: "sk_or_test",
      },
    },
  );

  assert.equal(res.ok, true);
  assert.equal(res.provider, "gemini");
  assert.equal(res.model, "gemini-2.5-flash");
  assert.ok(calls.some((u) => u.includes("custom.local")));
  assert.ok(calls.some((u) => u.includes("opencode.ai/zen")));
  assert.ok(calls.some((u) => u.includes("api.groq.com")));
  assert.equal(calls.some((u) => u.includes("openrouter.ai")), false, "Should stop once Gemini succeeds");

  const extracted = aiGateway.extractMftActionsBlock(res.text);
  assert.equal(extracted.cleanReply, "Studio is healthy.");
  assert.ok(Array.isArray(extracted.parsed?.actions));
});

await test("Gemini auto-detects Vertex AI Express (AQ.) vs AI Studio (AIza...) with x-goog-api-key header & model fallback", async () => {
  const vertexCalls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  const mockVertexFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init?.body || "{}"));
    vertexCalls.push({ url, headers, body });

    // Simulate gemini-2.5-flash 404 -> falls back cleanly to gemini-2.5-flash-lite on Vertex Express
    if (url.includes("/models/gemini-2.5-flash:generateContent")) {
      return makeJsonResponse(404, { error: "not_found" });
    }
    if (url === "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash-lite:generateContent") {
      return makeJsonResponse(200, {
        candidates: [{ content: { parts: [{ text: "Vertex Express response OK" }] } }],
      });
    }
    return makeJsonResponse(500, {});
  };

  const aqKey = "AQ.Ab8RN6MockVertexExpressKey12345";
  const rVertex = await aiGateway.callAiGateway(
    {
      systemPrompt: "Sys",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Briefing" },
      ],
    },
    { fetchImpl: mockVertexFetch, env: { GEMINI_API_KEY: aqKey } },
  );

  assert.equal(rVertex.ok, true);
  assert.equal(rVertex.provider, "gemini");
  assert.equal(rVertex.model, "gemini-2.5-flash-lite");
  assert.equal(rVertex.text, "Vertex Express response OK");
  assert.equal(vertexCalls.length, 2);
  for (const c of vertexCalls) {
    assert.ok(c.url.startsWith("https://aiplatform.googleapis.com/v1/publishers/google/models/"));
    assert.equal(c.url.includes(aqKey), false, "API key MUST NEVER appear in URL");
    assert.equal(c.headers["x-goog-api-key"], aqKey);
    const contents = (c.body as { contents?: Array<{ role?: string }> }).contents ?? [];
    assert.deepEqual(
      contents.map((x) => x.role),
      ["user", "model", "user"],
      "Every contents entry must carry explicit role",
    );
  }

  // Standard AI Studio key (AIza...) routes to generativelanguage.googleapis.com with x-goog-api-key header
  let studioUrl = "";
  let studioHeaderKey = "";
  const aizaKey = "AIzaSyMockStudioKey67890";
  const rStudio = await aiGateway.callAiGateway(
    { systemPrompt: "Sys", messages: [{ role: "user", content: "Hi" }] },
    {
      fetchImpl: async (input, init) => {
        studioUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        studioHeaderKey = ((init?.headers ?? {}) as Record<string, string>)["x-goog-api-key"] ?? "";
        return makeJsonResponse(200, {
          candidates: [{ content: { parts: [{ text: "AI Studio OK" }] } }],
        });
      },
      env: { GEMINI_API_KEY: aizaKey },
    },
  );
  assert.equal(rStudio.ok, true);
  assert.equal(studioUrl, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  assert.equal(studioUrl.includes(aizaKey), false, "API key MUST NEVER appear in URL");
  assert.equal(studioHeaderKey, aizaKey);
});

await test("OpenRouter fallback sends HTTP-Referer + X-Title and handles malformed mft-actions JSON safely", async () => {
  let sawHeaders: Record<string, string> = {};
  const mockFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://openrouter.ai/api/v1/chat/completions")) {
      sawHeaders = (init?.headers ?? {}) as Record<string, string>;
      return makeJsonResponse(200, {
        choices: [{ message: { content: "Hello from OpenRouter.\n```mft-actions\n{not valid json\n```" } }],
      });
    }
    return makeJsonResponse(429, {});
  };

  const res = await aiGateway.callAiGateway(
    { systemPrompt: "sys", messages: [{ role: "user", content: "hi" }] },
    {
      fetchImpl: mockFetch,
      env: { OPENROUTER_API_KEY: "sk-or-test" },
    },
  );

  assert.equal(res.ok, true);
  assert.equal(res.provider, "openrouter");
  assert.equal(res.model, "openrouter/free");
  assert.equal(sawHeaders["X-Title"], "MFT Studio AI");
  assert.ok(sawHeaders["HTTP-Referer"]);

  const extracted = aiGateway.extractMftActionsBlock(res.text);
  assert.equal(extracted.cleanReply, "Hello from OpenRouter.");
  assert.equal(extracted.parsed, null);
});

await test("Zero external keys falls back seamlessly to local mode with setupHint=true", async () => {
  const mockDb = createMockFirestore(SAMPLE_DOCS);
  const mockFetch = createAuthMockFetch(ACCOUNTS);
  const limiter = new adminAiHandler.AdminAiRateLimiter();

  const res = await adminAiHandler.handleAdminAiPost(
    `Bearer ${TOKEN_SUPER}`,
    { message: "ملخص الحضور اليوم ومين متأخر؟", pathname: "/admin/hr" },
    { fetchImpl: mockFetch, firestore: mockDb.client, env: {}, rateLimiter: limiter, nowMs: NOW_MS },
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.mode, "local");
  assert.equal(res.body.provider, "local");
  assert.equal(res.body.setupHint, true);
  assert.match(String(res.body.reply), /Ahmed Ali/);
  assert.match(String(res.body.reply), /Mona Hassan/);
});

console.log("\n[4] Context size cap (Groq 8K TPM safety) & HR-POL-2026 local accuracy");

await test("Huge workspace serializes strictly <= 6,500 chars for Groq 8K TPM safety", async () => {
  const hugeDocs: Record<string, Record<string, unknown>> = {
    "settings/hr": { standardHours: 8, shiftStartTime: "10:00", lateCutoffTime: "11:00", policy2026Enabled: true },
  };
  for (let i = 0; i < 80; i++) {
    hugeDocs[`workers/w${i}`] = {
      firstName: `WorkerNumber${i}WithAVeryLongName`,
      lastName: `FamilyName${i}`,
      department: "development",
      role: "senior_engineer",
      status: "approved",
    };
    hugeDocs[`projects/p${i}`] = {
      name: `Enterprise Studio Project Alpha Beta Gamma ${i}`,
      clientName: `Client Organization Long Name ${i}`,
      status: "active",
    };
    hugeDocs[`tasks/t${i}`] = {
      title: `Deliverable Milestone With Extended Description ${i}`,
      status: i % 2 === 0 ? "pending-approval" : "in-progress",
      assignedWorkerName: `WorkerNumber${i}`,
      projectName: `Enterprise Studio Project ${i}`,
      dueDate: "2026-11-10",
    };
    hugeDocs[`workSessions/w${i}_2026-11-26`] = {
      workerId: `w${i}`,
      workerName: `WorkerNumber${i}`,
      date: "2026-11-26",
      isActive: true,
      startTime: new Date(T1130_MS),
      segmentStartAt: new Date(T1130_MS),
      presenceStatus: "idle",
    };
  }
  const mockDb = createMockFirestore(hugeDocs);
  const ctx = await adminAiContext.loadAdminAiContext({
    role: "super_admin",
    pathname: "/admin",
    firestore: mockDb.client,
    nowMs: NOW_MS,
  });
  const serialized = adminAiContext.serializeAdminContext(ctx, 6_200);
  assert.ok(serialized.length <= 6_500, `Expected <= 6500 chars, got ${serialized.length}`);
});

await test("Local engine answers HR-POL-2026 rules accurately in Arabic & English and builds confirmed drafts", async () => {
  const mockDb = createMockFirestore(SAMPLE_DOCS);
  const ctx = await adminAiContext.loadAdminAiContext({
    role: "super_admin",
    pathname: "/admin/hr",
    firestore: mockDb.client,
    nowMs: NOW_MS,
  });

  const polEn = adminAiLocal.runAdminAiLocal("Explain HR-POL-2026 overtime and 240m permission policy", ctx);
  assert.match(polEn.reply, /1\.35x/);
  assert.match(polEn.reply, /1\.70x/);
  assert.match(polEn.reply, /240/);
  assert.match(polEn.reply, /1 shift clock-in/i);

  const polAr = adminAiLocal.runAdminAiLocal("ما هي قواعد لائحة HR-POL-2026 للأوفرتايم والتأخير؟", ctx);
  assert.match(polAr.reply, /11:01/);
  assert.match(polAr.reply, /240/);
  assert.match(polAr.reply, /موافقة الأدمن/);

  const taskDraft = adminAiLocal.runAdminAiLocal("Create task for design team to update ARC social grid", ctx);
  assert.equal(taskDraft.draft?.type, "create_task");
  assert.equal(taskDraft.draft?.department, "design");

  const alertDraft = adminAiLocal.runAdminAiLocal("Send HR alert reminding everyone about 2h check-in", ctx);
  assert.equal(alertDraft.draft?.type, "send_hr_alert");
});

console.log("\n[5] GET status secret safety & per-UID rate limiting (429)");

await test("GET /api/ai/admin returns provider readiness without leaking any API key values", async () => {
  const mockFetch = createAuthMockFetch(ACCOUNTS);
  const secretKey = "gsk_super_secret_should_never_leak_999";
  const res = await adminAiHandler.handleAdminAiGet(`Bearer ${TOKEN_SUPER}`, {
    fetchImpl: mockFetch,
    env: { GROQ_API_KEY: secretKey },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.activeProvider, "groq");
  assert.equal(res.body.localFallbackReady, true);
  assert.equal(JSON.stringify(res.body).includes(secretKey), false, "API key MUST NEVER appear in status response");
});

await test("Per-UID rate limiter enforces 25 req/min and returns 429 on 26th request", async () => {
  const mockFetch = createAuthMockFetch(ACCOUNTS);
  const mockDb = createMockFirestore(SAMPLE_DOCS);
  const limiter = new adminAiHandler.AdminAiRateLimiter();

  for (let i = 0; i < 25; i++) {
    const r = await adminAiHandler.handleAdminAiPost(
      `Bearer ${TOKEN_HR}`,
      { message: "HR briefing" },
      { fetchImpl: mockFetch, firestore: mockDb.client, env: {}, rateLimiter: limiter, nowMs: NOW_MS + i * 100 },
    );
    assert.equal(r.status, 200, `Request #${i + 1} should succeed`);
  }

  const r26 = await adminAiHandler.handleAdminAiPost(
    `Bearer ${TOKEN_HR}`,
    { message: "HR briefing" },
    { fetchImpl: mockFetch, firestore: mockDb.client, env: {}, rateLimiter: limiter, nowMs: NOW_MS + 3_000 },
  );
  assert.equal(r26.status, 429);
  assert.ok(r26.headers?.["Retry-After"]);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failed:\n - " + failures.join("\n - "));
  process.exit(1);
}
