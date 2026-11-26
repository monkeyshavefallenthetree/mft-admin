import crypto from "node:crypto";
import { firebaseConfig } from "@/lib/firebase-config";

const PROJECT_ID = (process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId).trim();
const API_KEY = (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || firebaseConfig.apiKey).trim();
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

export type FirestoreDocRecord = {
  id: string;
  path: string;
  data: Record<string, unknown>;
  updateTime?: string;
};

export interface ServerFirestoreClient {
  getDocument(docPath: string): Promise<FirestoreDocRecord | null>;
  queryCollection(
    collectionId: string,
    filters: Array<{ field: string; op: "EQUAL" | "LESS_THAN" | "GREATER_THAN"; value: unknown }>,
  ): Promise<FirestoreDocRecord[]>;
  patchDocument(
    docPath: string,
    fields: Record<string, unknown>,
    opts?: { updateTime?: string },
  ): Promise<boolean>;
  createDocument(collectionId: string, fields: Record<string, unknown>): Promise<string>;
  createDocumentIfAbsent(
    collectionId: string,
    documentId: string,
    fields: Record<string, unknown>,
  ): Promise<{ created: boolean; id: string }>;
}

/* ────────────────────── Firestore REST Value Codec ────────────────────── */

export function encodeFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return { nullValue: null };
    if (Number.isInteger(val) && Math.abs(val) <= Number.MAX_SAFE_INTEGER) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === "string") return { stringValue: val };
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map((item) => encodeFirestoreValue(item)),
      },
    };
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.toDate === "function") {
      const d = (obj.toDate as () => Date)();
      if (d instanceof Date && !Number.isNaN(d.getTime())) {
        return { timestampValue: d.toISOString() };
      }
    }
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        fields[k] = encodeFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function decodeFirestoreValue(fsVal: Record<string, unknown> | undefined): unknown {
  if (!fsVal || typeof fsVal !== "object") return null;
  if ("nullValue" in fsVal) return null;
  if ("booleanValue" in fsVal) return Boolean(fsVal.booleanValue);
  if ("integerValue" in fsVal) return Number(fsVal.integerValue);
  if ("doubleValue" in fsVal) return Number(fsVal.doubleValue);
  if ("stringValue" in fsVal) return String(fsVal.stringValue);
  if ("timestampValue" in fsVal) return String(fsVal.timestampValue);
  if ("arrayValue" in fsVal) {
    const arr = (fsVal.arrayValue as { values?: Array<Record<string, unknown>> })?.values;
    return Array.isArray(arr) ? arr.map((v) => decodeFirestoreValue(v)) : [];
  }
  if ("mapValue" in fsVal) {
    const fields = (fsVal.mapValue as { fields?: Record<string, Record<string, unknown>> })?.fields || {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return null;
}

export function decodeFirestoreDoc(raw: {
  name?: string;
  fields?: Record<string, Record<string, unknown>>;
  updateTime?: string;
}): FirestoreDocRecord {
  const fullName = raw.name || "";
  const idx = fullName.indexOf("/documents/");
  const relPath = idx >= 0 ? fullName.slice(idx + "/documents/".length) : fullName;
  const segments = relPath.split("/");
  const id = segments[segments.length - 1] || "";
  const data: Record<string, unknown> = {};
  if (raw.fields && typeof raw.fields === "object") {
    for (const [k, v] of Object.entries(raw.fields)) {
      data[k] = decodeFirestoreValue(v);
    }
  }
  return { id, path: relPath, data, ...(raw.updateTime ? { updateTime: raw.updateTime } : {}) };
}

/* ────────────────────── Auth Token Providers ────────────────────── */

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

let cachedServiceToken: CachedToken | null = null;
let cachedPasswordToken: CachedToken | null = null;

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function loadServiceAccount(): { clientEmail: string; privateKey: string } | null {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as { client_email?: string; private_key?: string };
      if (parsed.client_email && parsed.private_key) {
        return {
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key.replace(/\\n/g, "\n"),
        };
      }
    } catch (err) {
      console.error("[firestoreRest] Invalid FIREBASE_SERVICE_ACCOUNT_JSON:", err);
    }
  }
  const email = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const key = process.env.FIREBASE_PRIVATE_KEY?.trim();
  if (email && key) {
    return {
      clientEmail: email,
      privateKey: key.replace(/\\n/g, "\n"),
    };
  }
  return null;
}

async function getServiceAccountAccessToken(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const sa = loadServiceAccount();
  if (!sa) return null;

  const nowMs = Date.now();
  if (cachedServiceToken && cachedServiceToken.expiresAtMs - 60_000 > nowMs) {
    return cachedServiceToken.token;
  }

  const iat = Math.floor(nowMs / 1000);
  const exp = iat + 3600;
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: sa.clientEmail,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat,
      exp,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = base64UrlEncode(signer.sign(sa.privateKey));
  const assertion = `${signingInput}.${signature}`;

  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Service account OAuth failed (${res.status}): ${txt.slice(0, 200)}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Missing access_token in Google OAuth response");

  cachedServiceToken = {
    token: json.access_token,
    expiresAtMs: nowMs + (Number(json.expires_in) || 3600) * 1000,
  };
  return cachedServiceToken.token;
}

async function getCronAdminIdToken(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const email = process.env.CRON_ADMIN_EMAIL?.trim();
  const password = process.env.CRON_ADMIN_PASSWORD?.trim();
  if (!email || !password) return null;

  const nowMs = Date.now();
  if (cachedPasswordToken && cachedPasswordToken.expiresAtMs - 60_000 > nowMs) {
    return cachedPasswordToken.token;
  }

  const res = await fetchImpl(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Cron admin sign-in failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { idToken?: string; expiresIn?: string };
  if (!json.idToken) throw new Error("Missing idToken from Firebase Identity Toolkit");

  cachedPasswordToken = {
    token: json.idToken,
    expiresAtMs: nowMs + (Number(json.expiresIn) || 3600) * 1000,
  };
  return cachedPasswordToken.token;
}

const DEFAULT_ADMIN_EMAILS = new Set(["admin@mft.com", "hr@mft.com"]);

function allowedAdminEmails(): Set<string> {
  const set = new Set(DEFAULT_ADMIN_EMAILS);
  const envRaw = process.env.ADMIN_PUSH_EMAILS || "";
  for (const part of envRaw.split(",")) {
    const e = part.trim().toLowerCase();
    if (e) set.add(e);
  }
  return set;
}

/** Verifies a Firebase Auth ID token belongs to an authorized HR or Super Admin. */
export async function verifyAdminFirebaseIdToken(
  idToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ valid: boolean; email?: string; uid?: string }> {
  if (!idToken || idToken.length < 20) return { valid: false };
  try {
    const res = await fetchImpl(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!res.ok) return { valid: false };
    const json = (await res.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        customAttributes?: string;
      }>;
    };
    const user = json.users?.[0];
    if (!user) return { valid: false };
    const email = (user.email || "").trim().toLowerCase();
    if (allowedAdminEmails().has(email)) {
      return { valid: true, email, uid: user.localId };
    }
    if (user.customAttributes) {
      try {
        const claims = JSON.parse(user.customAttributes) as { admin?: boolean; role?: string };
        if (
          claims.admin === true ||
          claims.role === "super_admin" ||
          claims.role === "hr_admin"
        ) {
          return { valid: true, email, uid: user.localId };
        }
      } catch {
        /* ignore malformed customAttributes */
      }
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}

export async function resolveServerFirestoreBearerToken(
  callerAdminIdToken?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ token: string; authMode: "service_account" | "cron_admin_password" | "caller_admin_token" } | null> {
  const saToken = await getServiceAccountAccessToken(fetchImpl);
  if (saToken) return { token: saToken, authMode: "service_account" };

  const pwToken = await getCronAdminIdToken(fetchImpl);
  if (pwToken) return { token: pwToken, authMode: "cron_admin_password" };

  if (callerAdminIdToken) {
    return { token: callerAdminIdToken, authMode: "caller_admin_token" };
  }
  return null;
}

export function createFirestoreRestClient(
  bearerToken: string,
  fetchImpl: typeof fetch = fetch,
): ServerFirestoreClient {
  const headers = {
    Authorization: `Bearer ${bearerToken}`,
    "Content-Type": "application/json",
  };

  return {
    async getDocument(docPath: string): Promise<FirestoreDocRecord | null> {
      const clean = docPath.replace(/^\/+/, "");
      const res = await fetchImpl(`${FIRESTORE_BASE}/${clean}`, {
        method: "GET",
        headers,
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Firestore GET ${clean} failed (${res.status}): ${txt.slice(0, 200)}`);
      }
      const raw = (await res.json()) as {
        name?: string;
        fields?: Record<string, Record<string, unknown>>;
        updateTime?: string;
      };
      return decodeFirestoreDoc(raw);
    },

    async queryCollection(
      collectionId: string,
      filters: Array<{ field: string; op: "EQUAL" | "LESS_THAN" | "GREATER_THAN"; value: unknown }>,
    ): Promise<FirestoreDocRecord[]> {
      const fieldFilters = filters.map((f) => ({
        fieldFilter: {
          field: { fieldPath: f.field },
          op: f.op,
          value: encodeFirestoreValue(f.value),
        },
      }));

      const structuredQuery: Record<string, unknown> = {
        from: [{ collectionId }],
      };
      if (fieldFilters.length === 1) {
        structuredQuery.where = fieldFilters[0];
      } else if (fieldFilters.length > 1) {
        structuredQuery.where = {
          compositeFilter: {
            op: "AND",
            filters: fieldFilters,
          },
        };
      }

      const res = await fetchImpl(`${FIRESTORE_BASE}:runQuery`, {
        method: "POST",
        headers,
        body: JSON.stringify({ structuredQuery }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Firestore runQuery ${collectionId} failed (${res.status}): ${txt.slice(0, 200)}`);
      }

      const rows = (await res.json()) as Array<{
        document?: { name?: string; fields?: Record<string, Record<string, unknown>>; updateTime?: string };
      }>;
      const out: FirestoreDocRecord[] = [];
      for (const row of rows) {
        if (row.document) out.push(decodeFirestoreDoc(row.document));
      }
      return out;
    },

    async patchDocument(
      docPath: string,
      fields: Record<string, unknown>,
      opts?: { updateTime?: string },
    ): Promise<boolean> {
      const clean = docPath.replace(/^\/+/, "");
      const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
      if (keys.length === 0) return true;

      const params = keys.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`);
      if (opts?.updateTime) {
        params.push(`currentDocument.updateTime=${encodeURIComponent(opts.updateTime)}`);
      }
      const encodedFields: Record<string, unknown> = {};
      for (const k of keys) {
        encodedFields[k] = encodeFirestoreValue(fields[k]);
      }

      const res = await fetchImpl(`${FIRESTORE_BASE}/${clean}?${params.join("&")}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ fields: encodedFields }),
      });
      if (res.status === 409 || res.status === 412 || res.status === 400) {
        // Optimistic concurrency precondition mismatch (another cron or client already updated/closed doc)
        if (opts?.updateTime && (res.status === 409 || res.status === 412)) {
          return false;
        }
        const txt = await res.text();
        if (opts?.updateTime && txt.includes("FAILED_PRECONDITION")) {
          return false;
        }
        throw new Error(`Firestore PATCH ${clean} failed (${res.status}): ${txt.slice(0, 200)}`);
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Firestore PATCH ${clean} failed (${res.status}): ${txt.slice(0, 200)}`);
      }
      return true;
    },

    async createDocument(collectionId: string, fields: Record<string, unknown>): Promise<string> {
      const encodedFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) encodedFields[k] = encodeFirestoreValue(v);
      }
      const res = await fetchImpl(`${FIRESTORE_BASE}/${collectionId}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ fields: encodedFields }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Firestore CREATE ${collectionId} failed (${res.status}): ${txt.slice(0, 200)}`);
      }
      const raw = (await res.json()) as { name?: string };
      const parts = (raw.name || "").split("/");
      return parts[parts.length - 1] || "";
    },

    async createDocumentIfAbsent(
      collectionId: string,
      documentId: string,
      fields: Record<string, unknown>,
    ): Promise<{ created: boolean; id: string }> {
      const encodedFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) encodedFields[k] = encodeFirestoreValue(v);
      }
      const res = await fetchImpl(
        `${FIRESTORE_BASE}/${collectionId}?documentId=${encodeURIComponent(documentId)}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ fields: encodedFields }),
        },
      );
      if (res.status === 409) {
        return { created: false, id: documentId };
      }
      if (!res.ok) {
        const txt = await res.text();
        if (txt.includes("ALREADY_EXISTS")) {
          return { created: false, id: documentId };
        }
        throw new Error(`Firestore CREATE ${collectionId}/${documentId} failed (${res.status}): ${txt.slice(0, 200)}`);
      }
      return { created: true, id: documentId };
    },
  };
}
