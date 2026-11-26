/**
 * Core HTTP handler logic for `GET /api/ai/admin` and `POST /api/ai/admin`.
 * Extracted from `route.ts` so Next.js route exports remain strict while unit tests
 * can exercise the full request lifecycle (auth, rate limit, role isolation, fallback, sanitization).
 */

import type {
  AdminAiChatResponse,
  AdminAiHistoryTurn,
  AdminAiStatusResponse,
} from "@/lib/admin/adminAiTypes";
import {
  callAiGateway,
  extractMftActionsBlock,
  getActiveProviderHint,
  getConfiguredAiProviders,
} from "@/lib/server/aiGateway";
import { verifyAdminAiRequest } from "@/lib/server/adminAiAuth";
import {
  loadAdminAiContext,
  serializeAdminContext,
  type AdminAiWorkspaceContext,
} from "@/lib/server/adminAiContext";
import {
  buildAdminSystemPrompt,
  runAdminAiLocal,
  sanitizeAdminAiActions,
  sanitizeAdminAiDraft,
} from "@/lib/server/adminAiLocal";
import type { ServerFirestoreClient } from "@/lib/server/firestoreRest";

const MAX_MESSAGE_CHARS = 2_000;
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_TURN_CHARS = 1_200;
const RATE_LIMIT_PER_MIN = 25;
const RATE_LIMIT_PER_DAY = 250;

export interface RateLimitBucket {
  minuteStartMs: number;
  minuteCount: number;
  dayKey: string;
  dayCount: number;
}

export class AdminAiRateLimiter {
  private buckets = new Map<string, RateLimitBucket>();

  check(uid: string, nowMs = Date.now()): { allowed: boolean; retryAfterSec?: number } {
    const dayKey = new Date(nowMs).toISOString().slice(0, 10);
    const cur = this.buckets.get(uid);
    if (!cur) {
      this.buckets.set(uid, {
        minuteStartMs: nowMs,
        minuteCount: 1,
        dayKey,
        dayCount: 1,
      });
      return { allowed: true };
    }

    if (cur.dayKey !== dayKey) {
      cur.dayKey = dayKey;
      cur.dayCount = 0;
    }
    if (nowMs - cur.minuteStartMs >= 60_000) {
      cur.minuteStartMs = nowMs;
      cur.minuteCount = 0;
    }

    if (cur.minuteCount >= RATE_LIMIT_PER_MIN) {
      const retryAfterSec = Math.max(1, Math.ceil((cur.minuteStartMs + 60_000 - nowMs) / 1000));
      return { allowed: false, retryAfterSec };
    }
    if (cur.dayCount >= RATE_LIMIT_PER_DAY) {
      return { allowed: false, retryAfterSec: 3600 };
    }

    cur.minuteCount += 1;
    cur.dayCount += 1;
    return { allowed: true };
  }

  reset(): void {
    this.buckets.clear();
  }
}

export const defaultAdminAiRateLimiter = new AdminAiRateLimiter();

export interface AdminAiHandlerDeps {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  firestore?: ServerFirestoreClient;
  rateLimiter?: AdminAiRateLimiter;
  nowMs?: number;
}

export interface HandlerHttpResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

function sanitizeHistory(raw: unknown): AdminAiHistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: AdminAiHistoryTurn[] = [];
  for (const item of raw.slice(-MAX_HISTORY_TURNS)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const role = rec.role === "assistant" ? "assistant" : rec.role === "user" ? "user" : null;
    const content = typeof rec.content === "string" ? rec.content.trim().slice(0, MAX_HISTORY_TURN_CHARS) : "";
    if (role && content) {
      out.push({ role, content });
    }
  }
  return out;
}

export async function handleAdminAiGet(
  authHeader: string | null | undefined,
  deps: AdminAiHandlerDeps = {},
): Promise<HandlerHttpResult> {
  const authRes = await verifyAdminAiRequest(authHeader, {
    fetchImpl: deps.fetchImpl,
    env: deps.env,
  });
  if (!authRes.ok) {
    return { status: authRes.status, body: { ok: false, error: authRes.error } };
  }

  const providers = getConfiguredAiProviders(deps.env);
  const activeProvider = getActiveProviderHint(deps.env);
  const res: AdminAiStatusResponse = {
    ok: true,
    role: authRes.role,
    providers,
    activeProvider,
    localFallbackReady: true,
  };
  return { status: 200, body: res as unknown as Record<string, unknown> };
}

export async function handleAdminAiPost(
  authHeader: string | null | undefined,
  rawBody: unknown,
  deps: AdminAiHandlerDeps = {},
): Promise<HandlerHttpResult> {
  const authRes = await verifyAdminAiRequest(authHeader, {
    fetchImpl: deps.fetchImpl,
    env: deps.env,
  });
  if (!authRes.ok) {
    return { status: authRes.status, body: { ok: false, error: authRes.error } };
  }

  const nowMs = deps.nowMs ?? Date.now();
  const limiter = deps.rateLimiter ?? defaultAdminAiRateLimiter;
  const limitCheck = limiter.check(authRes.uid, nowMs);
  if (!limitCheck.allowed) {
    return {
      status: 429,
      headers: limitCheck.retryAfterSec ? { "Retry-After": String(limitCheck.retryAfterSec) } : undefined,
      body: {
        ok: false,
        error: "Rate limit exceeded. Please wait a moment before sending another AI request.",
      },
    };
  }

  const bodyObj = (rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
    ? rawBody
    : {}) as Record<string, unknown>;
  const message = typeof bodyObj.message === "string" ? bodyObj.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    return {
      status: 400,
      body: {
        ok: false,
        error: `Message must be between 1 and ${MAX_MESSAGE_CHARS} characters.`,
      },
    };
  }

  const history = sanitizeHistory(bodyObj.history);
  const pathname = typeof bodyObj.pathname === "string" ? bodyObj.pathname.trim().slice(0, 120) : "/admin";

  const ctx: AdminAiWorkspaceContext = await loadAdminAiContext({
    role: authRes.role,
    pathname,
    idToken: authRes.idToken,
    firestore: deps.firestore,
    nowMs,
    fetchImpl: deps.fetchImpl,
  });

  const serializedContext = serializeAdminContext(ctx, 6_200);
  const systemPrompt = buildAdminSystemPrompt(authRes.role, serializedContext);

  const providers = getConfiguredAiProviders(deps.env);
  const anyExternalConfigured = providers.some((p) => p.configured);

  const gatewayRes = await callAiGateway(
    {
      systemPrompt,
      messages: [...history, { role: "user", content: message }],
      maxTokens: 1_050,
      temperature: 0.3,
    },
    {
      fetchImpl: deps.fetchImpl,
      env: deps.env,
    },
  );

  if (gatewayRes.ok && gatewayRes.text) {
    const { cleanReply, parsed } = extractMftActionsBlock(gatewayRes.text);
    const sanitizedActions = sanitizeAdminAiActions(parsed?.actions, authRes.role);
    const sanitizedDraft = sanitizeAdminAiDraft(parsed?.draft, authRes.role, ctx);

    const payload: AdminAiChatResponse = {
      ok: true,
      reply: cleanReply || gatewayRes.text,
      provider: gatewayRes.provider,
      model: gatewayRes.model,
      mode: "llm",
      role: authRes.role,
      actions: sanitizedActions,
      draft: sanitizedDraft,
      setupHint: false,
    };
    return { status: 200, body: payload as unknown as Record<string, unknown> };
  }

  // Seamless deterministic local fallback (works with 0 keys or when all external providers soft-fail)
  if (gatewayRes.attempts.length > 0) {
    console.warn(
      "[AdminAI] External providers fell back to local:",
      JSON.stringify(gatewayRes.attempts),
    );
  }

  const localRes = runAdminAiLocal(message, ctx);
  const payload: AdminAiChatResponse = {
    ok: true,
    reply: localRes.reply,
    provider: "local",
    model: "mft-local-studio",
    mode: "local",
    role: authRes.role,
    actions: sanitizeAdminAiActions(localRes.actions, authRes.role),
    draft: sanitizeAdminAiDraft(localRes.draft, authRes.role, ctx),
    setupHint: !anyExternalConfigured,
  };
  return { status: 200, body: payload as unknown as Record<string, unknown> };
}
