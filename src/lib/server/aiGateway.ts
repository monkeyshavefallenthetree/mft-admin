/**
 * Shared Multi-Provider Free AI Gateway (zero external npm dependencies; native fetch).
 *
 * Supported providers & default fallback chain (overridable via `AI_PROVIDER_ORDER`):
 *   1. custom     — Any OpenAI-compatible server (`AI_BASE_URL` + `AI_MODEL` + optional `AI_API_KEY`)
 *   2. opencode   — OpenCode Zen (`OPENCODE_API_KEY` or `OPENCODE_ALLOW_PUBLIC=1`)
 *   3. groq       — Groq Free Tier (`GROQ_API_KEY`, zero-CC, admin default `openai/gpt-oss-120b`)
 *   4. gemini     — Google Gemini Free Tier (`GEMINI_API_KEY`, zero-CC, native REST)
 *   5. openrouter — OpenRouter Free Tier (`OPENROUTER_API_KEY`, zero-CC, default `openrouter/free`)
 *   6. local      — Caller's deterministic local engine when zero keys or all providers soft-fail
 */

import type { AdminAiProviderInfo } from "@/lib/admin/adminAiTypes";

export type AiProviderId = "custom" | "opencode" | "groq" | "gemini" | "openrouter";

export interface AiGatewayMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiGatewayInput {
  systemPrompt: string;
  messages: AiGatewayMessage[];
  /** Default 1050 for Admin Super AI (keeps Groq 8K TPM safe). */
  maxTokens?: number;
  /** Default 0.3 (Groq recommends avoiding exact 0 on reasoning/OSS models). */
  temperature?: number;
}

export interface AiAttemptLog {
  provider: AiProviderId;
  model: string;
  ok: boolean;
  status?: number;
  reason?: string;
}

export interface AiGatewayResult {
  ok: boolean;
  provider: AiProviderId | "local";
  model: string;
  text: string;
  attempts: AiAttemptLog[];
}

export interface AiGatewayDeps {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

const DEFAULT_PROVIDER_ORDER: AiProviderId[] = [
  "custom",
  "opencode",
  "groq",
  "gemini",
  "openrouter",
];

const VALID_PROVIDERS = new Set<AiProviderId>(DEFAULT_PROVIDER_ORDER);

function cleanEnv(env: Record<string, string | undefined>, key: string): string {
  return (env[key] ?? "").trim();
}

function dedupeModels(models: Array<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of models) {
    const clean = (m ?? "").trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

export function resolveProviderOrder(
  env: Record<string, string | undefined> = process.env,
): AiProviderId[] {
  const raw = cleanEnv(env, "AI_PROVIDER_ORDER");
  if (!raw) return [...DEFAULT_PROVIDER_ORDER];
  const parsed: AiProviderId[] = [];
  const seen = new Set<AiProviderId>();
  for (const token of raw.split(",")) {
    const id = token.trim().toLowerCase() as AiProviderId;
    if (VALID_PROVIDERS.has(id) && !seen.has(id)) {
      seen.add(id);
      parsed.push(id);
    }
  }
  return parsed.length > 0 ? parsed : [...DEFAULT_PROVIDER_ORDER];
}

export function getConfiguredAiProviders(
  env: Record<string, string | undefined> = process.env,
): AdminAiProviderInfo[] {
  const customConfigured = Boolean(cleanEnv(env, "AI_BASE_URL") && cleanEnv(env, "AI_MODEL"));
  const opencodeConfigured = Boolean(
    cleanEnv(env, "OPENCODE_API_KEY") || cleanEnv(env, "OPENCODE_ALLOW_PUBLIC") === "1",
  );
  const groqConfigured = Boolean(cleanEnv(env, "GROQ_API_KEY"));
  const geminiConfigured = Boolean(cleanEnv(env, "GEMINI_API_KEY"));
  const openrouterConfigured = Boolean(cleanEnv(env, "OPENROUTER_API_KEY"));

  const catalog: Record<AiProviderId, AdminAiProviderInfo> = {
    custom: {
      id: "custom",
      label: "Custom OpenAI-Compatible",
      configured: customConfigured,
      defaultModel: cleanEnv(env, "AI_MODEL") || "custom-model",
    },
    opencode: {
      id: "opencode",
      label: "OpenCode Zen",
      configured: opencodeConfigured,
      defaultModel: cleanEnv(env, "OPENCODE_MODEL") || "big-pickle",
      freeSignupUrl: "https://opencode.ai/auth",
    },
    groq: {
      id: "groq",
      label: "Groq Free Tier",
      configured: groqConfigured,
      defaultModel: cleanEnv(env, "GROQ_MODEL") || "openai/gpt-oss-120b",
      freeSignupUrl: "https://console.groq.com/keys",
    },
    gemini: {
      id: "gemini",
      label: "Google Gemini Free",
      configured: geminiConfigured,
      defaultModel: cleanEnv(env, "GEMINI_MODEL") || "gemini-2.5-flash",
      freeSignupUrl: "https://aistudio.google.com/apikey",
    },
    openrouter: {
      id: "openrouter",
      label: "OpenRouter Free",
      configured: openrouterConfigured,
      defaultModel: cleanEnv(env, "OPENROUTER_MODEL") || "openrouter/free",
      freeSignupUrl: "https://openrouter.ai/keys",
    },
  };

  return resolveProviderOrder(env).map((id) => catalog[id]);
}

export function getActiveProviderHint(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = getConfiguredAiProviders(env).find((p) => p.configured);
  return configured ? configured.id : "local";
}

function buildTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function extractOpenAiContent(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0] as { message?: { content?: unknown }; text?: unknown };
  const content = first?.message?.content ?? first?.text;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function extractGeminiContent(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const candidates = (json as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
    .join("")
    .trim();
}

async function callOpenAiCompatible(params: {
  provider: AiProviderId;
  url: string;
  model: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  systemPrompt: string;
  messages: AiGatewayMessage[];
  maxTokens: number;
  temperature: number;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<{ ok: boolean; text: string; status?: number; reason?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(params.extraHeaders ?? {}),
  };
  if (params.apiKey) {
    headers.Authorization = `Bearer ${params.apiKey}`;
  }

  const body = {
    model: params.model,
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    messages: [
      { role: "system", content: params.systemPrompt },
      ...params.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };

  try {
    const res = await params.fetchImpl(params.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: buildTimeoutSignal(params.timeoutMs),
    });

    if (!res.ok) {
      return { ok: false, text: "", status: res.status, reason: `http_${res.status}` };
    }

    const json = (await res.json()) as unknown;
    const text = extractOpenAiContent(json);
    if (!text) {
      return { ok: false, text: "", status: res.status, reason: "empty_response" };
    }
    return { ok: true, text, status: res.status };
  } catch (err) {
    const isAbort = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      text: "",
      reason: isAbort ? "timeout" : "network_error",
    };
  }
}

async function callGeminiNative(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: AiGatewayMessage[];
  maxTokens: number;
  temperature: number;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<{ ok: boolean; text: string; status?: number; reason?: string }> {
  const isVertexExpress = params.apiKey.startsWith("AQ.");
  const url = isVertexExpress
    ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(
        params.model,
      )}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        params.model,
      )}:generateContent`;

  const contents = params.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body = {
    systemInstruction: { parts: [{ text: params.systemPrompt }] },
    contents,
    generationConfig: {
      temperature: params.temperature,
      maxOutputTokens: params.maxTokens,
    },
  };

  try {
    const res = await params.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": params.apiKey,
      },
      body: JSON.stringify(body),
      signal: buildTimeoutSignal(params.timeoutMs),
    });

    if (!res.ok) {
      return { ok: false, text: "", status: res.status, reason: `http_${res.status}` };
    }

    const json = (await res.json()) as unknown;
    const text = extractGeminiContent(json);
    if (!text) {
      return { ok: false, text: "", status: res.status, reason: "empty_response" };
    }
    return { ok: true, text, status: res.status };
  } catch (err) {
    const isAbort = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      text: "",
      reason: isAbort ? "timeout" : "network_error",
    };
  }
}

function normalizeCustomUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

/**
 * Calls configured free AI providers in priority order, automatically falling through
 * on 401/403/404/413/429/5xx, timeout, network error, or empty text.
 * Returns `{ ok: false, provider: "local", ... }` when zero external keys are configured
 * or all configured providers fail.
 */
export async function callAiGateway(
  input: AiGatewayInput,
  deps: AiGatewayDeps = {},
): Promise<AiGatewayResult> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 14_000;
  const maxTokens = Math.min(1_100, Math.max(128, input.maxTokens ?? 1_050));
  const temperature =
    typeof input.temperature === "number" && input.temperature > 0 && input.temperature <= 1.2
      ? input.temperature
      : 0.3;

  const order = resolveProviderOrder(env);
  const attempts: AiAttemptLog[] = [];

  for (const provider of order) {
    if (provider === "custom") {
      const baseUrl = cleanEnv(env, "AI_BASE_URL");
      const model = cleanEnv(env, "AI_MODEL");
      if (!baseUrl || !model) continue;
      const apiKey = cleanEnv(env, "AI_API_KEY") || undefined;
      const r = await callOpenAiCompatible({
        provider,
        url: normalizeCustomUrl(baseUrl),
        model,
        apiKey,
        systemPrompt: input.systemPrompt,
        messages: input.messages,
        maxTokens,
        temperature,
        fetchImpl,
        timeoutMs,
      });
      attempts.push({ provider, model, ok: r.ok, status: r.status, reason: r.reason });
      if (r.ok) return { ok: true, provider, model, text: r.text, attempts };
      continue;
    }

    if (provider === "opencode") {
      const key = cleanEnv(env, "OPENCODE_API_KEY");
      const allowPublic = cleanEnv(env, "OPENCODE_ALLOW_PUBLIC") === "1";
      if (!key && !allowPublic) continue;
      const models = dedupeModels([
        cleanEnv(env, "OPENCODE_MODEL"),
        "big-pickle",
        "deepseek-v4.1-flash-free",
      ]);
      for (const model of models) {
        const r = await callOpenAiCompatible({
          provider,
          url: "https://opencode.ai/zen/v1/chat/completions",
          model,
          apiKey: key || "public",
          systemPrompt: input.systemPrompt,
          messages: input.messages,
          maxTokens,
          temperature,
          fetchImpl,
          timeoutMs,
        });
        attempts.push({ provider, model, ok: r.ok, status: r.status, reason: r.reason });
        if (r.ok) return { ok: true, provider, model, text: r.text, attempts };
        // Auth/workspace 401/403 applies to the whole provider; move to next provider immediately.
        if (r.status === 401 || r.status === 403) break;
      }
      continue;
    }

    if (provider === "groq") {
      const key = cleanEnv(env, "GROQ_API_KEY");
      if (!key) continue;
      const models = dedupeModels([
        cleanEnv(env, "GROQ_MODEL"),
        "openai/gpt-oss-120b",
        "qwen/qwen3.8-27b",
        "openai/gpt-oss-20b",
      ]);
      for (const model of models) {
        const r = await callOpenAiCompatible({
          provider,
          url: "https://api.groq.com/openai/v1/chat/completions",
          model,
          apiKey: key,
          systemPrompt: input.systemPrompt,
          messages: input.messages,
          maxTokens,
          temperature,
          fetchImpl,
          timeoutMs,
        });
        attempts.push({ provider, model, ok: r.ok, status: r.status, reason: r.reason });
        if (r.ok) return { ok: true, provider, model, text: r.text, attempts };
        if (r.status === 401 || r.status === 403) break;
      }
      continue;
    }

    if (provider === "gemini") {
      const key = cleanEnv(env, "GEMINI_API_KEY");
      if (!key) continue;
      const isVertexExpress = key.startsWith("AQ.");
      const models = isVertexExpress
        ? dedupeModels([
            cleanEnv(env, "GEMINI_MODEL"),
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash",
          ])
        : dedupeModels([
            cleanEnv(env, "GEMINI_MODEL"),
            "gemini-2.5-flash",
            "gemini-3-flash-preview",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash",
          ]);
      for (const model of models) {
        const r = await callGeminiNative({
          apiKey: key,
          model,
          systemPrompt: input.systemPrompt,
          messages: input.messages,
          maxTokens,
          temperature,
          fetchImpl,
          timeoutMs,
        });
        attempts.push({ provider, model, ok: r.ok, status: r.status, reason: r.reason });
        if (r.ok) return { ok: true, provider, model, text: r.text, attempts };
        if (r.status === 401 || r.status === 403) break;
      }
      continue;
    }

    if (provider === "openrouter") {
      const key = cleanEnv(env, "OPENROUTER_API_KEY");
      if (!key) continue;
      const referer = cleanEnv(env, "NEXT_PUBLIC_SITE_URL") || "https://mft-admin.vercel.app";
      const models = dedupeModels([cleanEnv(env, "OPENROUTER_MODEL"), "openrouter/free"]);
      for (const model of models) {
        const r = await callOpenAiCompatible({
          provider,
          url: "https://openrouter.ai/api/v1/chat/completions",
          model,
          apiKey: key,
          extraHeaders: {
            "HTTP-Referer": referer,
            "X-Title": "MFT Studio AI",
          },
          systemPrompt: input.systemPrompt,
          messages: input.messages,
          maxTokens,
          temperature,
          fetchImpl,
          timeoutMs,
        });
        attempts.push({ provider, model, ok: r.ok, status: r.status, reason: r.reason });
        if (r.ok) return { ok: true, provider, model, text: r.text, attempts };
        if (r.status === 401 || r.status === 403) break;
      }
    }
  }

  return {
    ok: false,
    provider: "local",
    model: "mft-local-studio",
    text: "",
    attempts,
  };
}

/**
 * Extracts and strips an optional fenced ```` ```mft-actions ... ``` ```` JSON block
 * from an LLM response. Never throws on malformed JSON.
 */
export function extractMftActionsBlock(rawText: string): {
  cleanReply: string;
  parsed: { actions?: unknown; draft?: unknown } | null;
} {
  if (!rawText) return { cleanReply: "", parsed: null };
  const regex = /```mft-actions\s*([\s\S]*?)```/i;
  const match = rawText.match(regex);
  if (!match) {
    return { cleanReply: rawText.trim(), parsed: null };
  }
  const cleanReply = rawText.replace(regex, "").trim();
  const jsonCandidate = (match[1] ?? "").trim();
  if (!jsonCandidate) {
    return { cleanReply, parsed: null };
  }
  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        cleanReply,
        parsed: parsed as { actions?: unknown; draft?: unknown },
      };
    }
  } catch {
    // Ignore malformed LLM JSON cleanly
  }
  return { cleanReply, parsed: null };
}
