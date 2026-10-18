# Firestore collections — MFT admin dashboard

Derived from [`legacy/admin-dashboard-firebase.html`](../legacy/admin-dashboard-firebase.html). Used by this Next.js admin app and any worker-facing clients.

## `projects`

| Field | Type | Notes |
|-------|------|--------|
| `name` | string | |
| `clientName` | string | |
| `description` | string | |
| `projectTypes` | string[] | e.g. `social-media`, `web-development`, `media-buying`, `branding`, `seo`, `content-creation` |
| `status` | string | `active`, `on-hold`, `completed` |
| `startDate` | string \| null | ISO date `YYYY-MM-DD` |
| `endDate` | string \| null | |
| `createdAt` | Timestamp | |
| `updatedAt` | Timestamp | optional on update |

Tasks may reference a project via `tasks.projectId`.

## `tasks` (extended)

Existing fields plus:

| Field | Type | Notes |
|-------|------|--------|
| `projectId` | string | optional; links to `projects` |
| `department` | string | used when creating from project flow |
| `assignedTo` | string \| string[] | HTML project flow uses **array**; legacy admin uses string |
| `photo` | string \| null | optional filename |

## `workSessions`

| Field | Type | Notes |
|-------|------|--------|
| `workerId` | string | |
| `workerName` | string | denormalized |
| `workerEmail` | string | |
| `date` | string | `YYYY-MM-DD` |
| `loginTime` | Timestamp | |
| `logoutTime` | Timestamp | optional |
| `startTime` | Timestamp | optional |
| `isActive` | boolean | |
| `createdAt` | Timestamp | |
| `department` | string | |
| `role` | string | |
| `totalWorkTime` | number | milliseconds (HTML sums for “today’s work” hours) |
| `attendanceStatus` | string | e.g. `on-time` |
| `isLate` | boolean | |
| `latePenalty` | number | |

## `exceptionRequests`

| Field | Type | Notes |
|-------|------|--------|
| `workerId` | string | |
| `workerName` | string | |
| `workerEmail` | string | |
| `type` | string | `late`, `absent`, `overtime`, `annual_leave`, `sick_leave`, `emergency_leave`, `advance_request` |
| `lateMinutes` | number | optional (also holds requested **overtime** minutes for `overtime`) |
| `leaveDays` | number | HR-POL-2026 — `annual_leave` length in days (0.5 steps), starting at `exceptionDate` |
| `exceptionDate` | string | `YYYY-MM-DD` |
| `reason` | string | |
| `supportingEvidence` | string | optional |
| `status` | string | `pending`, `approved`, `rejected` |
| `createdAt` | Timestamp | |
| `submittedAt` | Timestamp | |
| `createdBy` | string | |
| `approvedAt`, `rejectedAt` | Timestamp | set by admin |
| `approvedBy`, `rejectedBy` | string | |
| `adminResponse` | string | optional |
| `responseAt`, `responseBy` | Timestamp / string | optional |

## `alerts`

| Field | Type | Notes |
|-------|------|--------|
| `type` | string | attendance, performance, schedule, policy, general, urgent |
| `title` | string | |
| `message` | string | |
| `recipient` | string | `all`, `department`, `individual`, `absent`, `late`, `overtime` |
| `department` | string | optional |
| `workerId` | string | optional (individual) |
| `priority` | string | low, medium, high, urgent |
| `penalty` | string | optional; numeric string e.g. `0.25`, `-0.5` |
| `penaltyReason` | string | optional |
| `recipients` | string[] | worker IDs |
| `sentBy` | string | |
| `sentAt` | Timestamp | |
| `recipientCount` | number | |
| `isRead` | boolean | |
| `createdAt` | Timestamp | |
| `hasPenalty` | boolean | |
| `penaltyApplied` | number | |
| `readBy` | string[] | optional |
| `resent`, `originalAlertId` | optional | for resend flow |

## `penalties`

| Field | Type | Notes |
|-------|------|--------|
| `workerId` | string | |
| `workerName` | string | |
| `workerEmail` | string | |
| `type` | string | `deduction`, `bonus` |
| `amount` | number | day units |
| `reason` | string | |
| `appliedBy` | string | |
| `appliedAt` | Timestamp | |
| `alertId` | string \| null | |
| `date` | string | `YYYY-MM-DD` |
| `category` | string | e.g. `manual` |
| `description` | string | |

## `workers` (optional fields used by HR)

| Field | Type | Notes |
|-------|------|--------|
| `department` | string | e.g. `development`, `design`, `general` |
| `employmentType` | string | optional |
| `skills` | string[] | optional |
| `hireDate` | string | HR-POL-2026 — `YYYY-MM-DD`; drives probation / leave accrual (falls back to `createdAt`) |
| `carriedOverLeaveDays` | number | management-approved carry-over beyond the 7-day cap |
| `carryOverApprovedBy` | string | approver of the extra carry-over |

## `settings/hr` — HR-POL-2026 fields

`policy2026Enabled` (bool, default false), `policy2026EffectiveFrom` (`2026-10-21`), `permissionMaxCount` (4), `permissionMaxMinutes` (240), `permissionMinMinutes` (30), `permissionMaxSingleMinutes` (120), `permissionRoundingBlock` (15), `dayOtMultiplier` (1.35), `nightOtMultiplier` (1.7), `dayWindowStart` (`06:00`), `nightWindowStart` (`18:00`), `nightShiftAllowance` (0), `probationMonths` (6), `leaveRateYear1` (1.25), `leaveRateYear2` (1.75), `maxCarryOverDays` (7), `invoiceTolerancePct` (0). Engine: `src/lib/admin/hrPolicy2026.ts` (identical copy in the worker app).

## `permissionLedger` (HR-POL-2026)

Doc id: `{workerId}_{YYYY-MM-DD}_{late|early}` (deterministic → never double-charged).

| Field | Type | Notes |
|-------|------|--------|
| `workerId`, `workerName`, `workerEmail` | string | |
| `cycleId` | string | payroll cycle start `YYYY-MM-DD` |
| `date` | string | `YYYY-MM-DD` |
| `kind` | string | `late`, `early_leave`, `manual` |
| `actualMinutes` | number | real lateness / minutes before required shift end |
| `chargedMinutes` | number | quota minutes (≥30, rounded up to 15); 0 when uncovered |
| `covered` | boolean | false → quota could not cover it → payroll deduction applies |
| `fallbackPenaltyDays` | number | 0.25 / 0.5 legacy penalty for uncovered lateness |
| `uncoveredReason` | string \| null | `over_single_cap`, `count_exhausted`, `minutes_exhausted`, `declined` |
| `clockInHm` / `requiredEndHm` | string | context |
| `status` | string | `applied`, `reversed` |
| `source` | string | `auto`, `worker`, `admin` |
| `reversedReason`, `reversedBy`, `reversedAt` | optional | |

## `reimbursements` (HR-POL-2026 clause 5)

| Field | Type | Notes |
|-------|------|--------|
| `workerId`, `workerName`, `workerEmail` | string | |
| `type` | string | `outdoor`, `purchase` |
| `stage` | string | `pre_approval` → `pending_invoice` → `review` → `approved` / `rejected` (outdoor starts at `review`) |
| `purpose`, `date` | string | |
| `routeFrom`, `routeTo` | string | outdoor |
| `amount` | number | outdoor ride price / purchase estimate |
| `quoteLink` | string \| null | purchase |
| `approvedAmount` | number \| null | locked at pre-approval |
| `invoiceAmount` | number \| null | stage 2 |
| `paidAmount` | number | final amount posted to payroll |
| `attachmentIds`, `attachmentKinds`, `imageHashes` | string[] | pointers to `reimbursementAttachments` + SHA-256 for duplicate detection |
| `checklist` | map | admin verification checklist |
| `adminNote`, `overrideReason` | string | |
| `payrollAdjustmentId` | string | the `payrollAdjustments` allowance (`source: "reimbursement"`) |

## `reimbursementAttachments`

`{ reimbursementId, workerId, kind: ride_screenshot|quote|proforma|invoice, dataUrl (JPEG ≤ ~300 KB), sha256, width, height, bytes, fileName, createdAt }` — images are compressed client-side and stored in Firestore (no Firebase Storage).
