/**
 * Strict server-side Firebase ID Token + Admin Role verification for `/api/ai/admin`.
 *
 * SECURITY INVARIANT:
 * - Never defaults unknown Firebase accounts (such as approved workers) to `super_admin`!
 * - Resolves role strictly from Firebase custom claims or explicit server allowlists.
 * - Missing/invalid token -> 401; valid non-admin Firebase account -> 403.
 * - Does NOT alter `verifyAdminFirebaseIdToken` in `firestoreRest.ts` (used by cron).
 */

import { firebaseConfig } from "@/lib/firebase-config";
import type { AdminRole } from "@/lib/admin/nav";

export type AdminAiAuthResult =
  | { ok: true; uid: string; email: string; role: AdminRole; idToken: string }
  | { ok: false; status: 401 | 403; error: string };

export interface AdminAiAuthDeps {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}

function parseEmailSet(raw: string | undefined, defaults: string[]): Set<string> {
  const set = new Set<string>(defaults.map((e) => e.trim().toLowerCase()));
  for (const part of (raw ?? "").split(",")) {
    const clean = part.trim().toLowerCase();
    if (clean) set.add(clean);
  }
  return set;
}

export function resolveStrictAdminRole(
  email: string,
  customAttributesRaw?: string | null,
  env: Record<string, string | undefined> = process.env,
): AdminRole | null {
  const cleanEmail = (email || "").trim().toLowerCase();
  const superEmails = parseEmailSet(env.ADMIN_SUPER_EMAILS, ["admin@mft.com"]);
  const opsEmails = parseEmailSet(env.ADMIN_OPS_EMAILS, ["mayamahmoud@mft.com"]);
  const hrEmails = parseEmailSet(env.ADMIN_HR_EMAILS, ["hr@mft.com"]);

  let claims: { admin?: boolean; role?: string } | null = null;
  if (customAttributesRaw) {
    try {
      const parsed = JSON.parse(customAttributesRaw) as unknown;
      if (parsed && typeof parsed === "object") {
        claims = parsed as { admin?: boolean; role?: string };
      }
    } catch {
      claims = null;
    }
  }

  if (claims?.admin === true || claims?.role === "super_admin" || superEmails.has(cleanEmail)) {
    return "super_admin";
  }
  if (claims?.role === "ops_admin" || opsEmails.has(cleanEmail)) {
    return "ops_admin";
  }
  if (claims?.role === "hr_admin" || hrEmails.has(cleanEmail)) {
    return "hr_admin";
  }
  return null;
}

export function extractBearerToken(authHeader: string | null | undefined): string {
  if (!authHeader) return "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

/**
 * Verifies the caller's Firebase ID token against Firebase Identity Toolkit
 * (`accounts:lookup`) and resolves their strict Admin role.
 */
export async function verifyAdminAiRequest(
  authHeader: string | null | undefined,
  deps: AdminAiAuthDeps = {},
): Promise<AdminAiAuthResult> {
  const idToken = extractBearerToken(authHeader);
  if (!idToken || idToken.length < 20) {
    return { ok: false, status: 401, error: "Missing or invalid authorization token." };
  }

  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const apiKey = (env.NEXT_PUBLIC_FIREBASE_API_KEY || firebaseConfig.apiKey).trim();

  try {
    const res = await fetchImpl(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!res.ok) {
      return { ok: false, status: 401, error: "Invalid or expired Firebase ID token." };
    }
    const json = (await res.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        customAttributes?: string;
        disabled?: boolean;
      }>;
    };
    const user = json.users?.[0];
    if (!user || !user.localId || user.disabled) {
      return { ok: false, status: 401, error: "Authenticated account not found or disabled." };
    }

    const email = (user.email || "").trim().toLowerCase();
    const role = resolveStrictAdminRole(email, user.customAttributes, env);
    if (!role) {
      return {
        ok: false,
        status: 403,
        error: "Forbidden: Admin privileges required for MFT Super AI.",
      };
    }

    return {
      ok: true,
      uid: user.localId,
      email,
      role,
      idToken,
    };
  } catch {
    return { ok: false, status: 401, error: "Unable to verify Firebase ID token." };
  }
}
