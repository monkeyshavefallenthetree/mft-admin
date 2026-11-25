import crypto from "node:crypto";
import webpush from "web-push";

export const DEFAULT_VAPID_PUBLIC_KEY =
  "BC4qV_AA_NGWwJUuOf3I5pKrblvWSHOhhSdY-F0ENgdfzZ3tqFEGPG6HcIj0tv-i8yGkeJA5puekWty8rLH5KQM";

export const DEFAULT_VAPID_PRIVATE_KEY =
  "af3SqNjdI2lIBaIVJKL4jzjydfPpHJKT8Q1YkvmWxrk";

export const DEFAULT_VAPID_SUBJECT = "mailto:admin@mft.com";

export function getVapidConfig() {
  return {
    publicKey: (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY).trim(),
    privateKey: (process.env.VAPID_PRIVATE_KEY || DEFAULT_VAPID_PRIVATE_KEY).trim(),
    subject: (process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT).trim(),
  };
}

function base64UrlToBuffer(str: string): Buffer {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

function bufferToBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function validateVapidConfig(cfg = getVapidConfig()): { valid: boolean; reason?: string } {
  if (!cfg.subject.startsWith("mailto:") && !cfg.subject.startsWith("https://")) {
    return { valid: false, reason: `Invalid VAPID_SUBJECT "${cfg.subject}" (must start with mailto: or https://)` };
  }
  try {
    const privBuf = base64UrlToBuffer(cfg.privateKey);
    const pubBuf = base64UrlToBuffer(cfg.publicKey);
    if (privBuf.length !== 32) {
      return { valid: false, reason: `VAPID private key decoded to ${privBuf.length} bytes (expected 32)` };
    }
    if (pubBuf.length !== 65 || pubBuf[0] !== 0x04) {
      return { valid: false, reason: `VAPID public key is not an uncompressed 65-byte P-256 key` };
    }
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.setPrivateKey(privBuf);
    const derived = bufferToBase64Url(ecdh.getPublicKey());
    if (derived !== cfg.publicKey) {
      return { valid: false, reason: "VAPID public/private keypair mismatch" };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: `VAPID validation error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

let vapidConfiguredKey = "";
export function ensureVapidConfigured(): { valid: boolean; reason?: string } {
  const cfg = getVapidConfig();
  const sig = `${cfg.subject}|${cfg.publicKey}|${cfg.privateKey}`;
  const check = validateVapidConfig(cfg);
  if (!check.valid) return check;
  if (vapidConfiguredKey !== sig) {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    vapidConfiguredKey = sig;
  }
  return { valid: true };
}

export interface StoredPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
  platform?: string;
  createdAt?: string;
}

export interface WebPushPayload {
  title: string;
  body: string;
  url?: string;
  tab?: string;
  taskId?: string;
  tag?: string;
  dedupe?: boolean;
  urgent?: boolean;
  requireInteraction?: boolean;
  badgeCount?: number;
  topic?: string;
  data?: Record<string, string>;
}

export interface WebPushBatchResult {
  sent: number;
  failed: number;
  goneEndpoints: string[];
  errors: Array<{ endpoint: string; statusCode: number; message: string }>;
}

const APNS_SAFE_MAX_BYTES = 3500;

function trimChars(s: string, maxChars: number): string {
  const chars = Array.from(String(s || ""));
  if (chars.length <= maxChars) return chars.join("");
  return chars.slice(0, Math.max(0, maxChars - 1)).join("") + "…";
}

export function sanitizeTopic(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = String(raw).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Serializes a Web Push notification payload safely under Apple APNs' 4KB encrypted limit
 * (accounting for multi-byte UTF-8 Arabic characters and AES128GCM overhead).
 */
export function buildWebPushSerializedPayload(payload: WebPushPayload, nowMs = Date.now()): string {
  const baseTag = payload.tag || payload.taskId || "mft-admin";
  const dedupe = Boolean(payload.dedupe && payload.tag);
  const tag = dedupe ? baseTag : `${baseTag}-${nowMs}`;
  const requireInteraction = payload.requireInteraction !== false;
  const urgent = Boolean(payload.urgent);

  const obj: Record<string, unknown> = {
    title: trimChars(payload.title || "MFT Admin", 120),
    body: trimChars(payload.body || "", 400),
    url: payload.url || "/admin",
    tab: payload.tab,
    taskId: payload.taskId,
    tag,
    dedupe,
    urgent,
    requireInteraction,
    badgeCount: typeof payload.badgeCount === "number" ? payload.badgeCount : 1,
    timestamp: nowMs,
    data: payload.data || {},
  };

  let serialized = JSON.stringify(obj);
  if (Buffer.byteLength(serialized, "utf8") > APNS_SAFE_MAX_BYTES) {
    // Progressively shrink body while staying valid UTF-8
    let bodyChars = Array.from(String(obj.body || ""));
    while (bodyChars.length > 40 && Buffer.byteLength(serialized, "utf8") > APNS_SAFE_MAX_BYTES) {
      bodyChars = bodyChars.slice(0, Math.floor(bodyChars.length * 0.7));
      obj.body = bodyChars.join("") + "…";
      serialized = JSON.stringify(obj);
    }
  }
  if (Buffer.byteLength(serialized, "utf8") > APNS_SAFE_MAX_BYTES) {
    obj.data = {};
    serialized = JSON.stringify(obj);
  }
  return serialized;
}

export type WebPushSenderFn = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { TTL: number; urgency: "very-low" | "low" | "normal" | "high"; topic?: string },
) => Promise<unknown>;

export async function sendWebPushBatch(
  subs: StoredPushSubscription[],
  payload: WebPushPayload,
  opts?: {
    sender?: WebPushSenderFn;
    nowMs?: number;
  },
): Promise<WebPushBatchResult> {
  const validSubs = subs.filter(
    (s) => s && typeof s.endpoint === "string" && s.endpoint.startsWith("http") && s.keys?.p256dh && s.keys?.auth,
  );
  if (validSubs.length === 0) {
    return { sent: 0, failed: 0, goneEndpoints: [], errors: [] };
  }

  if (!opts?.sender) {
    const check = ensureVapidConfigured();
    if (!check.valid) {
      return {
        sent: 0,
        failed: validSubs.length,
        goneEndpoints: [],
        errors: validSubs.map((s) => ({
          endpoint: s.endpoint,
          statusCode: 500,
          message: check.reason || "Invalid VAPID configuration",
        })),
      };
    }
  }

  const serialized = buildWebPushSerializedPayload(payload, opts?.nowMs);
  const topic = sanitizeTopic(payload.topic || (payload.dedupe ? payload.tag : undefined));
  const pushOpts: { TTL: number; urgency: "high"; topic?: string } = {
    TTL: 86400,
    urgency: "high",
    ...(topic ? { topic } : {}),
  };

  const sender: WebPushSenderFn =
    opts?.sender ||
    ((subscription, body, options) => webpush.sendNotification(subscription, body, options));

  let sent = 0;
  let failed = 0;
  const goneEndpoints: string[] = [];
  const errors: Array<{ endpoint: string; statusCode: number; message: string }> = [];

  await Promise.all(
    validSubs.map(async (sub) => {
      try {
        await sender(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.keys.p256dh,
              auth: sub.keys.auth,
            },
          },
          serialized,
          pushOpts,
        );
        sent += 1;
      } catch (err: unknown) {
        failed += 1;
        const statusCode =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode?: number }).statusCode) || 0
            : 0;
        const rawMsg = err instanceof Error ? err.message : String(err);
        if (statusCode === 404 || statusCode === 410) {
          goneEndpoints.push(sub.endpoint);
        } else if (statusCode === 401 || statusCode === 403) {
          console.error("[web-push] VAPID key mismatch / unauthorized:", statusCode, rawMsg);
        } else {
          console.warn("[web-push] send error:", statusCode, rawMsg);
        }
        errors.push({
          endpoint: sub.endpoint,
          statusCode,
          message: statusCode === 401 || statusCode === 403 ? `VAPID mismatch (${statusCode}): ${rawMsg}` : rawMsg,
        });
      }
    }),
  );

  return { sent, failed, goneEndpoints, errors };
}

/* ────────────────────────────── Expo Push (Android + iOS Native) ────────────────────────────── */

export const EXPO_PUSH_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

export function isValidExpoPushToken(token: unknown): token is string {
  return typeof token === "string" && EXPO_PUSH_TOKEN_RE.test(token.trim());
}

export interface ExpoPushInputMessage {
  to: string;
  title: string;
  body: string;
  sound?: string;
  priority?: "default" | "normal" | "high" | string;
  ttl?: number;
  badge?: number;
  channelId?: string;
  android?: { channelId?: string };
  mutableContent?: boolean;
  _displayInForeground?: boolean;
  interruptionLevel?: "active" | "critical" | "passive" | "time-sensitive" | string;
  urgent?: boolean;
  data?: Record<string, string>;
}

export interface NormalizedExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: string;
  priority: "high";
  ttl: number;
  badge: number;
  channelId: string;
  mutableContent: boolean;
  _displayInForeground: boolean;
  interruptionLevel: "time-sensitive" | "active";
  data: Record<string, string>;
}

export function normalizeExpoPushMessage(msg: ExpoPushInputMessage): NormalizedExpoPushMessage {
  const urgent = Boolean(msg.urgent || msg.interruptionLevel === "time-sensitive");
  const channelId = msg.channelId || msg.android?.channelId || (urgent ? "alerts" : "default");
  return {
    to: String(msg.to || "").trim(),
    title: trimChars(msg.title || "MFT", 120),
    body: trimChars(msg.body || "", 400),
    sound: msg.sound || "default",
    priority: "high",
    ttl: typeof msg.ttl === "number" && Number.isFinite(msg.ttl) ? Math.max(60, Math.round(msg.ttl)) : 86400,
    badge: typeof msg.badge === "number" && Number.isFinite(msg.badge) ? Math.max(0, Math.round(msg.badge)) : 1,
    channelId,
    mutableContent: msg.mutableContent !== false,
    _displayInForeground: msg._displayInForeground !== false,
    interruptionLevel: urgent ? "time-sensitive" : "active",
    data: msg.data && typeof msg.data === "object" ? msg.data : {},
  };
}

export interface ExpoPushTicket {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string; [k: string]: unknown };
}

export interface ExpoPushBatchResult {
  ok: boolean;
  sent: number;
  failed: number;
  invalidTokens: string[];
  tickets: ExpoPushTicket[];
  data: ExpoPushTicket[];
  errors: string[];
}

export async function sendExpoPushBatch(
  rawMessages: ExpoPushInputMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<ExpoPushBatchResult> {
  const normalized: NormalizedExpoPushMessage[] = [];
  const invalidTokens: string[] = [];
  const errors: string[] = [];

  for (const m of rawMessages) {
    if (!m || !isValidExpoPushToken(m.to)) {
      // Do NOT add malformed/legacy non-Expo strings (e.g. `webp:[...]`) into invalidTokens,
      // which is strictly for Expo-formatted tokens reported as DeviceNotRegistered by Expo.
      errors.push(`Invalid Expo push token format: ${String(m?.to || "").slice(0, 40)}`);
      continue;
    }
    normalized.push(normalizeExpoPushMessage(m));
  }

  if (normalized.length === 0) {
    return {
      ok: errors.length === 0,
      sent: 0,
      failed: errors.length,
      invalidTokens,
      tickets: [],
      data: [],
      errors,
    };
  }

  let sent = 0;
  let failed = errors.length;
  const tickets: ExpoPushTicket[] = [];

  // Expo Push API accepts up to 100 messages per request
  for (let i = 0; i < normalized.length; i += 100) {
    const chunk = normalized.slice(i, i + 100);
    try {
      const upRes = await fetchImpl("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });

      const text = await upRes.text();
      if (!upRes.ok) {
        failed += chunk.length;
        errors.push(`Expo HTTP ${upRes.status}: ${text.slice(0, 200)}`);
        continue;
      }

      const parsed = JSON.parse(text) as {
        data?: ExpoPushTicket[];
        errors?: Array<{ message?: string }>;
      };

      if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        for (const e of parsed.errors) {
          errors.push(e?.message || JSON.stringify(e));
        }
      }

      if (Array.isArray(parsed.data)) {
        parsed.data.forEach((ticket, idx) => {
          tickets.push(ticket);
          if (ticket?.status === "ok") {
            sent += 1;
          } else {
            failed += 1;
            const errCode = ticket?.details?.error;
            if (errCode === "DeviceNotRegistered" && chunk[idx]?.to) {
              invalidTokens.push(chunk[idx].to);
            }
            if (ticket?.message) {
              errors.push(`${errCode || "ExpoError"}: ${ticket.message}`);
            }
          }
        });
      } else {
        sent += chunk.length;
      }
    } catch (err) {
      failed += chunk.length;
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    ok: sent > 0 || failed === 0,
    sent,
    failed,
    invalidTokens: Array.from(new Set(invalidTokens)),
    tickets,
    data: tickets,
    errors,
  };
}
