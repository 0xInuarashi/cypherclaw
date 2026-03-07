---
name: clawhub
description: |
  Browse, install, publish, and manage agent skills on the ClawHub registry (clawhub.ai).
  Covers the full v1 REST API: search, list, fetch metadata, download zips, publish,
  soft-delete, star, transfer ownership, and admin/moderation endpoints.
---

# ClawHub API

**Base URL:** `https://clawhub.ai`
**Auth:** `Authorization: Bearer <token>` on all authenticated routes.
All responses are JSON unless stated otherwise. All slugs are lowercase.

## Discovery

Resolve the live registry base URL before making requests (useful for self-hosted instances):

```
GET /.well-known/clawhub.json
GET /.well-known/clawdhub.json   # alias
```

Response: `{ apiBase: string, authBase?: string, minCliVersion?: string }`
If `apiBase` is present, use it as the base URL for all `/api/v1/*` routes.

---

## Rate Limits

All endpoints return rate-limit headers:

| Header | Meaning |
|---|---|
| `x-ratelimit-limit` / `ratelimit-limit` | Max requests in window |
| `x-ratelimit-remaining` / `ratelimit-remaining` | Remaining requests |
| `x-ratelimit-reset` / `ratelimit-reset` | Unix epoch seconds when window resets |
| `retry-after` | Seconds to wait on 429 |

On **429**: wait `retry-after` seconds, then retry.

---

## Skills

### Search

```
GET /api/v1/search?q=<query>&limit=<n>&highlightedOnly=<bool>
```

Vector/embedding search (OpenAI `text-embedding-3-small`). No auth required.

| Param | Type | Notes |
|---|---|---|
| `q` | string | Required. Empty returns `[]`. |
| `limit` | number | Optional. Server-capped. |
| `highlightedOnly` | `true`/`false` | Optional. Filter to curated skills only. |

Response:
```json
{
  "results": [
    { "score": 0.91, "slug": "git", "displayName": "Git", "summary": "...", "version": "1.2.0", "updatedAt": 1710000000000 }
  ]
}
```

---

### List / Explore

```
GET /api/v1/skills?limit=<n>&cursor=<cursor>&sort=<sort>
```

No auth required. Paginated.

| `sort` value | Meaning |
|---|---|
| `updated` (default) | Most recently updated |
| `downloads` | Total downloads |
| `stars` | Stars/highlights |
| `installsCurrent` | Recent installs |
| `installsAllTime` | All-time installs |
| `trending` | Trending (cursor ignored) |

Response:
```json
{
  "items": [
    {
      "slug": "git",
      "displayName": "Git",
      "summary": "...",
      "tags": { "latest": "<versionId>" },
      "stats": {},
      "createdAt": 1700000000000,
      "updatedAt": 1710000000000,
      "latestVersion": { "version": "1.2.0", "createdAt": 1710000000000, "changelog": "...", "license": "MIT-0" },
      "metadata": { "os": ["linux", "darwin"], "systems": ["aarch64-darwin"] }
    }
  ],
  "nextCursor": "<cursor>|null"
}
```

Pass `cursor` from `nextCursor` to page forward.

---

### Get Skill Metadata

```
GET /api/v1/skills/<slug>
```

No auth required.

Response:
```json
{
  "skill": { "slug": "git", "displayName": "Git", "summary": "...", "tags": {}, "stats": {}, "createdAt": 0, "updatedAt": 0 },
  "latestVersion": { "version": "1.2.0", "createdAt": 0, "changelog": "...", "license": "MIT-0" },
  "metadata": { "os": ["linux"], "systems": null },
  "owner": { "handle": "alice", "userId": "<id>", "displayName": "Alice", "image": "<url>" },
  "moderation": { "isSuspicious": false, "isMalwareBlocked": false }
}
```

Status codes: `404` not found, `410` soft-deleted (owner sees helpful message), `423` pending scan, `403` hidden by moderation.

---

### List Versions

```
GET /api/v1/skills/<slug>/versions?limit=<n>&cursor=<cursor>
```

No auth required.

Response:
```json
{
  "items": [
    { "version": "1.2.0", "createdAt": 0, "changelog": "Bug fixes", "changelogSource": "user" }
  ],
  "nextCursor": null
}
```

`changelogSource`: `"user"` | `"auto"` | `null`

---

### Get Specific Version

```
GET /api/v1/skills/<slug>/versions/<version>
```

No auth required.

Response:
```json
{
  "skill": { "slug": "git", "displayName": "Git" },
  "version": {
    "version": "1.2.0",
    "createdAt": 0,
    "changelog": "...",
    "changelogSource": "user",
    "license": "MIT-0",
    "files": [
      { "path": "SKILL.md", "size": 1234, "sha256": "<hex>", "contentType": "text/markdown" }
    ],
    "security": {
      "status": "clean",
      "hasWarnings": false,
      "checkedAt": 1710000000000,
      "model": "gpt-4o"
    }
  }
}
```

`security.status`: `"clean"` | `"suspicious"` | `"malicious"` | `"pending"` | `"error"`

---

### Get Raw File Content

```
GET /api/v1/skills/<slug>/file?path=<path>&version=<semver>&tag=<tag>
```

No auth required. Returns raw file text. Limit: **200 KB**.

| Param | Notes |
|---|---|
| `path` | e.g. `SKILL.md`, `scripts/run.sh` |
| `version` | Specific semver (optional) |
| `tag` | Tag name e.g. `latest` (optional; version takes precedence) |

Defaults to `latestVersion` if neither `version` nor `tag` is provided.

Status codes: `404` (skill/file not found), `410` (version unavailable), `413` (file > 200KB).

---

### Download Zip

```
GET /api/v1/download?slug=<slug>&version=<semver>&tag=<tag>
```

Returns a binary zip. Auth optional (used for deduplicating download metrics).

| Status | Meaning |
|---|---|
| `200` | `Content-Type: application/zip` |
| `403` | Malware-blocked or hidden |
| `404` | Skill/version not found |
| `410` | Removed by moderation |
| `423` | Pending security scan — retry in a few minutes |

Zip `Content-Disposition`: `attachment; filename="<slug>-<version>.zip"`

---

### Resolve Version by File Hash

```
GET /api/v1/resolve?slug=<slug>&hash=<sha256hex>
```

Match a local skill folder's file fingerprint to a known registry version. No auth required.

`hash` must be a 64-character lowercase hex SHA-256 fingerprint of the skill's text files.

Response:
```json
{ "match": { "version": "1.2.0" }, "latestVersion": { "version": "1.2.0" } }
```

`match` is `null` if no registry version matches the hash.

---

### Publish Skill

```
POST /api/v1/skills
Authorization: Bearer <token>
Content-Type: application/json
```

**Auth required.** `acceptLicenseTerms: true` is mandatory (MIT-0 agreement).

Body:
```json
{
  "slug": "my-skill",
  "displayName": "My Skill",
  "version": "1.0.0",
  "changelog": "Initial release",
  "acceptLicenseTerms": true,
  "tags": ["latest"],
  "forkOf": { "slug": "other-skill", "version": "1.0.0" },
  "files": [
    { "path": "SKILL.md", "size": 512, "storageId": "<id>", "sha256": "<hex>", "contentType": "text/markdown" }
  ]
}
```

Also accepts `multipart/form-data`.

Response: `{ "ok": true, "skillId": "<id>", "versionId": "<id>" }`

---

### Soft-Delete Skill

```
DELETE /api/v1/skills/<slug>
Authorization: Bearer <token>
```

**Auth required** (owner, moderator, or admin). Response: `{ "ok": true }`

---

### Restore Soft-Deleted Skill

```
POST /api/v1/skills/<slug>/undelete
Authorization: Bearer <token>
```

**Auth required** (owner, moderator, or admin). Response: `{ "ok": true }`

---

### Transfer Ownership

```
POST /api/v1/skills/<slug>/transfer
Authorization: Bearer <token>
Content-Type: application/json
```

Body: `{ "toUserHandle": "@alice", "message": "Optional note" }`

Response: `{ "ok": true, "transferId": "<id>", "toUserHandle": "alice", "expiresAt": 1720000000000 }`

**Respond to a transfer:**

```
POST /api/v1/skills/<slug>/transfer/accept
POST /api/v1/skills/<slug>/transfer/reject
POST /api/v1/skills/<slug>/transfer/cancel
```

All require auth. No body needed. Response: `{ "ok": true, "skillSlug": "<slug>" }`

---

## Stars

```
POST   /api/v1/stars/<slug>    — star (highlight) a skill
DELETE /api/v1/stars/<slug>    — unstar a skill
```

Both require auth.

Star response: `{ "ok": true, "starred": true, "alreadyStarred": false }`
Unstar response: `{ "ok": true, "unstarred": true, "alreadyUnstarred": false }`

---

## Transfers (Inbox)

```
GET /api/v1/transfers/incoming
GET /api/v1/transfers/outgoing
```

Both require auth.

Response:
```json
{
  "transfers": [
    {
      "_id": "<id>",
      "skill": { "_id": "<id>", "slug": "git", "displayName": "Git" },
      "fromUser": { "_id": "<id>", "handle": "alice", "displayName": "Alice" },
      "toUser": { "_id": "<id>", "handle": "bob", "displayName": "Bob" },
      "message": "Optional note",
      "requestedAt": 0,
      "expiresAt": 0
    }
  ]
}
```

---

## Whoami

```
GET /api/v1/whoami
Authorization: Bearer <token>
```

Response: `{ "user": { "handle": "alice", "displayName": "Alice", "image": "<url>" } }`

Status `401` if token is invalid or missing.

---

## Users (Admin / Moderator)

All user management endpoints require auth.

### Search Users

```
GET /api/v1/users?q=<query>&limit=<n>
Authorization: Bearer <token>
```

Moderator/admin only. `limit` clamped 1–200 (default 20).

Response: `{ "items": [{ "userId": "<id>", "handle": "alice", "displayName": "Alice", "name": "Alice Smith", "role": "user" }], "total": 42 }`

### Ban User

```
POST /api/v1/users/ban
Authorization: Bearer <token>
```

Moderator/admin. Body: `{ "handle": "alice" }` or `{ "userId": "<id>" }`, optional `"reason"` (max 500 chars).

### Set Role

```
POST /api/v1/users/role
Authorization: Bearer <token>
```

Admin only. Body: `{ "handle": "alice", "role": "user"|"moderator"|"admin" }`

Response: `{ "ok": true, "role": "moderator" }`

### Restore Skills from GitHub Backup (Admin)

```
POST /api/v1/users/restore
Authorization: Bearer <token>
```

Body: `{ "handle": "alice", "slugs": ["git", "docker"], "forceOverwriteSquatter": false }` — max 100 slugs.

### Reclaim Slugs for Rightful Owner (Admin)

```
POST /api/v1/users/reclaim
Authorization: Bearer <token>
```

Non-destructive ownership transfer. Body: `{ "handle": "alice", "slugs": ["git"], "reason": "optional" }` — max 200 slugs.

Response: `{ "ok": true, "results": [{ "slug": "git", "ok": true, "action": "transferred" }], "succeeded": 1, "failed": 0 }`

---

## Legacy Routes (Deprecated)

Still served — prefer v1:

| Legacy | v1 Equivalent |
|---|---|
| `GET /api/download` | `GET /api/v1/download` |
| `GET /api/search` | `GET /api/v1/search` |
| `GET /api/skill` | `GET /api/v1/skills/<slug>` |
| `GET /api/skill/resolve` | `GET /api/v1/resolve` |
| `GET /api/cli/whoami` | `GET /api/v1/whoami` |
| `POST /api/cli/publish` | `POST /api/v1/skills` |
| `POST /api/cli/skill/delete` | `DELETE /api/v1/skills/<slug>` |
| `POST /api/cli/skill/undelete` | `POST /api/v1/skills/<slug>/undelete` |
| `POST /api/cli/telemetry/sync` | *(no v1 equivalent)* |

---

## Common Patterns

**Browse and install a skill:**
1. `GET /api/v1/search?q=<query>` — pick a slug from results
2. `GET /api/v1/skills/<slug>` — check `moderation`, get `latestVersion.version`
3. `GET /api/v1/download?slug=<slug>&version=<version>` — download and extract zip

**Inspect without downloading:**
1. `GET /api/v1/skills/<slug>/versions` — list versions
2. `GET /api/v1/skills/<slug>/versions/<version>` — get file manifest
3. `GET /api/v1/skills/<slug>/file?path=SKILL.md` — read individual files (max 200 KB each)

**Publish a skill:**
1. `GET /api/v1/whoami` — verify auth
2. `POST /api/v1/skills` with `acceptLicenseTerms: true` and `files` array
