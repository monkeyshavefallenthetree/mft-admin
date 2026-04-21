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
| `type` | string | `late`, `absent` |
| `lateMinutes` | number | optional |
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
