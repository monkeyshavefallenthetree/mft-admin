# MFT Admin Dashboard (standalone)

Firebase-backed **operations** dashboard for MFT: submissions, workers, tasks, projects, work sessions, HR, exceptions.

- **Not** the marketing CMS — that stays in **`../cms/`** (Strapi).
- **Legacy reference:** HTML prototype lives in `legacy/` (same behavior as documented in `docs/firestore-admin-schema.md`).

## Run locally

```powershell
cd mft-admin-dashboard
npm install
npm run dev
```

- App: **http://localhost:3001** (redirects to `/admin`)
- Login: **http://localhost:3001/admin/login**

Default dev port is **3001** so it can run beside `modern-site` (3000) and Strapi (1337).

## Environment

Copy `.env.example` to `.env.local` if you need to change the Strapi admin link in the sidebar:

`NEXT_PUBLIC_STRAPICMS_ADMIN_URL`

Firebase config is in `src/lib/firebase.ts` (same project as before). Prefer moving secrets to env vars for production.

## Docs

- `docs/firestore-admin-schema.md` — collection field shapes
- `docs/firestore-rules-recommended.rules` — example security rules (deploy in Firebase Console)
