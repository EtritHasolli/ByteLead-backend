# ByteLead → ByteLead-backend Migration Plan

## Overview

Move all backend logic out of the Next.js frontend into the standalone Express backend. After migration:

- **Frontend** has zero secrets, zero direct DB access, zero Supabase service role usage
- **Frontend** communicates exclusively via HTTP to `http://localhost:4000` (or production backend URL)
- **Backend** owns all auth, database, scraping, AI, credits, and rate limiting
- The only Supabase usage remaining in the frontend is `supabase-browser.ts` (anon key, for realtime subscriptions only)

---

## Current State

| | Frontend (Next.js) | Backend (Express) |
|---|---|---|
| Status | Full app — SSR pages call DB directly | Skeleton — routes, scrapers, DB, auth already ported |
| Problem | 20+ files import `@/lib/auth`, `@/lib/db/*`, `@/lib/supabase` directly from SSR pages and server actions | Missing: analytics, plans, saved searches, Google OAuth, credit deduction on reveal, AI insights |

---

## Phase 1 — Complete the Backend (`ByteLead-backend`)

### 1.1 Add Missing API Endpoints

These routes exist in the frontend but are **not yet in the backend**:

| Endpoint | Method | Purpose | Source to port |
|---|---|---|---|
| `/api/auth/google` | GET | Redirect to Google OAuth consent screen | `app/api/auth/google/route.ts` |
| `/api/auth/google/callback` | GET | OAuth token exchange + user creation/login | `app/api/auth/google/callback/route.ts` |
| `/api/analytics/overview` | GET | leads-by-date, top niches, job counts | `app/(dashboard)/analytics/page.tsx` — uses `getLeadsGroupedByDate`, `getTopNiches` (already in `db/queries.ts`) |
| `/api/plans` | GET | Active plans list for marketing page | `getActivePlans()` / `getAllPlans()` already in `db/queries.ts` |
| `/api/saved` | GET | Scrape job history | `getScrapeJobsByUser()` already in `db/queries.ts` |
| `/api/saved/:id` | DELETE | Delete a scrape job | `deleteScrapeJob()` already in `db/queries.ts` |
| `/api/scrape/:jobId` | GET | Poll job progress | `getScrapeJob()` already in `db/queries.ts` |
| `/api/admin/stats` | GET | Admin dashboard stats | Port `getAdminStats()` from frontend |

Routes already present in the backend and working:

- `POST /api/auth/login` ✅
- `POST /api/auth/signup` ✅
- `POST /api/auth/logout` ✅
- `GET /api/auth/me` ✅
- `POST /api/scrape` ✅
- `POST /api/scrape/interpret` (regex only — needs Groq upgrade, see 1.2)
- `GET /api/leads` ✅
- `POST /api/leads/reveal` (no credit deduction yet — see 1.2)
- `POST /api/leads/reveal-bulk` (no credit deduction yet — see 1.2)
- `POST /api/leads/tags` ✅
- `DELETE /api/leads/:id` ✅
- `POST /api/leads/delete-bulk` ✅
- `GET /api/friends` ✅
- `POST /api/friends/request` ✅
- `POST /api/friends/respond` ✅
- `POST /api/friends/message` ✅
- `GET /api/friends/messages/:friendId` ✅
- `GET /api/friends/notifications` ✅
- `POST /api/friends/notifications/read` ✅
- `POST /api/friends/share` ✅
- `GET /api/profile` ✅
- `PUT /api/profile` ✅
- `POST /api/profile/disclaimer` ✅
- `GET /api/settings/usage` ✅
- `POST /api/settings/change-password` ✅
- `POST /api/settings/notifications` ✅
- `DELETE /api/settings/account` ✅
- `GET /api/admin/users` ✅
- `GET /api/admin/plans` ✅
- `POST /api/admin/users/:id/update` ✅
- `POST /api/ai-chat` ✅

### 1.2 Add Missing Backend Logic

| Missing piece | What to do |
|---|---|
| **Credit deduction on reveal** | Add `decrement_credits` Supabase RPC call in `routes/leads.ts` reveal route; check balance, deduct atomically, return 402 if insufficient |
| **Credit deduction on bulk reveal** | Same as above, deduct `ids.length` credits before processing |
| **AI lead insights** | Port `lib/ai/lead-insights.ts` → `src/lib/ai-insights.ts` — Groq calls for description + pitch, 500-item LRU cache, retry with backoff |
| **Groq interpret endpoint** | Replace the regex-only `/interpret` in `routes/scrape.ts` with the full Groq-powered version from `lib/engine/interpret-query.ts` |
| **Admin role guard** | Add `requireAdmin` Express middleware in `src/lib/auth.ts` — check `role === "admin"` on the DB profile |
| **`isUnlimited` helper** | Port `lib/credits.ts` → `src/lib/credits.ts` for reuse across reveal/scrape routes |

### 1.3 New Files to Create in Backend

```
src/
├── lib/
│   ├── ai-insights.ts        ← port from ByteLead/lib/ai/lead-insights.ts
│   ├── credits.ts            ← port from ByteLead/lib/credits.ts
│   └── interpret-query.ts    ← port from ByteLead/lib/engine/interpret-query.ts
└── routes/
    ├── analytics.ts          ← new: GET /overview
    ├── plans.ts              ← new: GET /
    ├── saved.ts              ← new: GET /, DELETE /:id
    └── google-auth.ts        ← new: GET /google, GET /google/callback
```

Register all new routers in `src/index.ts`:

```ts
import { analyticsRouter } from "./routes/analytics.js";
import { plansRouter }     from "./routes/plans.js";
import { savedRouter }     from "./routes/saved.js";
import { googleAuthRouter } from "./routes/google-auth.js";

app.use("/api/analytics", analyticsRouter);
app.use("/api/plans",     plansRouter);
app.use("/api/saved",     savedRouter);
app.use("/api/auth",      googleAuthRouter); // adds /api/auth/google + /api/auth/google/callback
```

### 1.4 Backend `.env` Additions

```env
# Already present
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
JWT_SECRET=...
ADMIN_EMAIL=...
FRONTEND_URL=http://localhost:3000
PORT=4000

# Add these
GROQ_API_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback
SCRAPE_DO_TOKEN=...          # optional, for ScrapeDo proxy
BYTELEADS_ENABLE_DEMO=false  # set to true to enable demo scraper
```

### 1.5 Test Backend Independently

Before touching the frontend, verify every endpoint works:

```bash
# Health
curl http://localhost:4000/api/health

# Auth
curl -c cookies.txt -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}'

# Profile
curl -b cookies.txt http://localhost:4000/api/auth/me

# Scrape interpret
curl -b cookies.txt -X POST http://localhost:4000/api/scrape/interpret \
  -H "Content-Type: application/json" \
  -d '{"query":"20 plumbers in Austin without a website"}'

# Plans (no auth)
curl http://localhost:4000/api/plans

# Analytics
curl -b cookies.txt http://localhost:4000/api/analytics/overview
```

---

## Phase 2 — Rewire the Frontend (`ByteLead`)

### 2.1 Set the API Base URL

```env
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SUPABASE_URL=...        # keep — for realtime only
NEXT_PUBLIC_SUPABASE_ANON_KEY=...   # keep — for realtime only
```

All calls via `lib/api-client.ts` already use `NEXT_PUBLIC_API_URL ?? ""` as the base URL prefix — this env var is the only change required for most client-side calls.

### 2.2 Create `lib/server-api.ts`

Used by SSR pages and layouts to call the backend with cookie forwarding:

```ts
// lib/server-api.ts
// Runs only on the Next.js server during SSR.
// Forwards the user's session cookie to the Express backend so auth works.
import { cookies } from "next/headers";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function serverFetch<T>(path: string): Promise<T | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const res = await fetch(`${API}${path}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });

  if (!res.ok) return null;
  return res.json() as Promise<T>;
}
```

### 2.3 Rewrite SSR Pages and Layouts (13 files)

Every page/layout that currently imports from `@/lib/auth`, `@/lib/db/*`, `@/lib/supabase`, or `@/lib/credits` must switch to `serverFetch()`:

| File | Remove imports | Replace with |
|---|---|---|
| `app/(dashboard)/layout.tsx` | `getSession`, `getProfile`, `touchUserSeen`, `getNotifications` | `serverFetch("/api/auth/me")`, `serverFetch("/api/friends/notifications")` |
| `app/(dashboard)/leads/page.tsx` | `getSession`, `getScrapeJobsByUser`, `getLeadsByUser`, `sanitizeLeadsForClient`, `getFriends`, `getSupabaseAdmin` | `serverFetch("/api/leads")`, `serverFetch("/api/saved")`, `serverFetch("/api/friends")` |
| `app/(dashboard)/generator/page.tsx` | `getSession`, `getProfile`, `isUnlimited` | `serverFetch("/api/auth/me")` — profile includes plan/role, derive `isUnlimited` locally |
| `app/(dashboard)/analytics/page.tsx` | `getSession`, `getLeadsGroupedByDate`, `getTopNiches`, DB imports | `serverFetch("/api/analytics/overview")` |
| `app/(dashboard)/saved/page.tsx` | `getSession`, `getScrapeJobsByUser` | `serverFetch("/api/saved")` |
| `app/(dashboard)/friends/page.tsx` | `getSession`, `getFriends` | `serverFetch("/api/friends")` |
| `app/(dashboard)/profile/page.tsx` | `getSession`, `getProfile` | `serverFetch("/api/profile")` |
| `app/(dashboard)/settings/page.tsx` | `getSession`, `getProfile` | `serverFetch("/api/profile")`, `serverFetch("/api/settings/usage")` |
| `app/(dashboard)/admin/layout.tsx` | `getSession`, `getProfile` | `serverFetch("/api/auth/me")` + role check |
| `app/(dashboard)/admin/page.tsx` | `getAdminStats` | `serverFetch("/api/admin/stats")` |
| `app/(dashboard)/dashboard/page.tsx` | any direct DB calls | `serverFetch("/api/auth/me")` |
| `app/(marketing)/layout.tsx` | `getSession`, `getProfile` | `serverFetch("/api/auth/me")` |
| `app/(marketing)/page.tsx` | `getActivePlans` | `serverFetch("/api/plans")` |

### 2.4 Rewrite Server Actions (2 files)

**`app/(auth)/actions.ts`** — currently calls `getUserByEmail`, `createUser`, `hashPassword`, `createSession` directly.

Replace with:

```ts
"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function login(formData: FormData) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: formData.get("email"),
      password: formData.get("password"),
    }),
  });

  if (!res.ok) {
    const { error } = await res.json();
    return { error };
  }

  // Forward the Set-Cookie from Express to the browser
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const cookieStore = await cookies();
    // Parse and set each cookie segment
    cookieStore.set("byteleads-session", extractSessionValue(setCookie), {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  redirect("/dashboard");
}

export async function signup(formData: FormData) { /* same pattern */ }
export async function logout() { /* DELETE cookie + redirect /login */ }
```

**`app/(dashboard)/leads/actions.ts`** — currently calls `getSession`, `revealLead`, `updateLeadTags`, etc.

Replace all DB calls with API calls using `serverFetch()` or direct `fetch` with cookie forwarding.

### 2.5 Expand `lib/api-client.ts`

Add all missing client-side API functions:

```ts
// Profile
export function fetchProfile()            { return request<Profile>("/api/profile"); }
export function updateProfile(data: any)  { return request("/api/profile", { method: "PUT", body: JSON.stringify(data) }); }
export function acceptDisclaimer()        { return request("/api/profile/disclaimer", { method: "POST" }); }

// Auth
export function logout()                  { return request("/api/auth/logout", { method: "POST" }); }

// Leads
export function revealLead(leadId: string, aiData?: any) {
  return request("/api/leads/reveal", { method: "POST", body: JSON.stringify({ leadId, aiData }) });
}
export function bulkRevealLeads(ids: string[]) {
  return request("/api/leads/reveal-bulk", { method: "POST", body: JSON.stringify({ ids }) });
}
export function deleteLeads(ids: string[]) {
  return request("/api/leads/delete-bulk", { method: "POST", body: JSON.stringify({ ids }) });
}
export function deleteLead(id: string) {
  return request(`/api/leads/${id}`, { method: "DELETE" });
}
export function updateLeadTags(leadId: string, tags: string[]) {
  return request("/api/leads/tags", { method: "POST", body: JSON.stringify({ leadId, tags }) });
}
export function shareLeads(receiverId: string, leadIds: string[], message?: string) {
  return request("/api/friends/share", { method: "POST", body: JSON.stringify({ receiverId, leadIds, message }) });
}

// Friends / Social
export function fetchFriends()                              { return request("/api/friends"); }
export function sendFriendRequest(email: string)            { return request("/api/friends/request", { method: "POST", body: JSON.stringify({ email }) }); }
export function respondToFriendRequest(id: string, accept: boolean) {
  return request("/api/friends/respond", { method: "POST", body: JSON.stringify({ friendshipId: id, accept }) });
}
export function sendMessage(receiverId: string, content: string) {
  return request("/api/friends/message", { method: "POST", body: JSON.stringify({ receiverId, content }) });
}
export function fetchMessages(friendId: string)             { return request(`/api/friends/messages/${friendId}`); }
export function fetchNotifications()                        { return request("/api/friends/notifications"); }
export function markNotificationsRead()                     { return request("/api/friends/notifications/read", { method: "POST" }); }

// Settings
export function fetchUsage()                                { return request("/api/settings/usage"); }
export function changePassword(currentPassword: string, newPassword: string) {
  return request("/api/settings/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
}
export function updateNotificationPrefs(prefs: any)         { return request("/api/settings/notifications", { method: "POST", body: JSON.stringify(prefs) }); }
export function deleteAccount()                             { return request("/api/settings/account", { method: "DELETE" }); }

// Saved searches
export function fetchSavedSearches()                        { return request("/api/saved"); }
export function deleteSavedSearch(id: string)               { return request(`/api/saved/${id}`, { method: "DELETE" }); }

// Analytics
export function fetchAnalytics()                            { return request("/api/analytics/overview"); }

// Admin
export function fetchAdminUsers()                           { return request("/api/admin/users"); }
export function fetchAdminPlans()                           { return request("/api/admin/plans"); }
export function updateAdminUser(id: string, data: any)      { return request(`/api/admin/users/${id}/update`, { method: "POST", body: JSON.stringify(data) }); }

// Plans (public)
export function fetchPlans()                                { return request("/api/plans"); }

// Scrape job status
export function fetchScrapeJob(jobId: string)               { return request(`/api/scrape/${jobId}`); }
```

### 2.6 Fix the one component import

`components/dashboard/ai-chat-bubble.tsx` imports a type from the engine:

```ts
// Remove this:
import type { InterpretedQuery } from "@/lib/engine/interpret-query";

// Replace with an inline type or move the type to types/index.ts:
export interface InterpretedQuery {
  niche: string;
  location?: string;
  locations?: { city: string; country?: string }[];
  country: string;
  maxPages: number;
  minRating: number;
  limit?: number;
  requireNoWebsite: boolean;
}
```

Or simply move `InterpretedQuery` into `types/index.ts` and import from there in both places.

### 2.7 Simplify `middleware.ts`

Replace the current JWT-verifying middleware with a lightweight cookie-existence check. Auth verification is the backend's job.

```ts
// middleware.ts
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/generator", "/leads", "/settings", "/saved", "/analytics", "/admin", "/profile", "/friends"];
const AUTH_PAGES = ["/login", "/signup"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("byteleads-session");

  if (!hasSession && PROTECTED.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (hasSession && AUTH_PAGES.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
```

> **Note:** The backend still verifies the JWT on every protected API call. The middleware here only handles page-level redirects to avoid a round-trip to the backend for every navigation.

### 2.8 Delete Backend-Only Files from Frontend

Once all pages/actions are rewritten and tests pass, delete these from `ByteLead/`:

```
lib/auth.ts
lib/supabase.ts              ← service role client (secrets)
lib/db/
lib/engine/
lib/scrapers/
lib/ai/
lib/credits.ts
lib/rate-limit.ts
lib/search/
app/api/                     ← all Next.js API routes
app/(auth)/actions.ts        ← replaced by direct backend calls
app/(dashboard)/leads/actions.ts  ← replaced by api-client.ts calls
```

Keep:

```
lib/supabase-browser.ts      ← anon key, realtime only
lib/api-client.ts            ← expanded with all endpoints
lib/server-api.ts            ← new: SSR cookie-forwarding helper
lib/utils.ts
lib/validators.ts
lib/brand.ts
lib/crop-image.ts
lib/region-cities.ts
hooks/use-realtime.ts        ← anon key, realtime subscriptions
hooks/use-credits.tsx        ← UI state only, no DB access
types/index.ts               ← shared types (add InterpretedQuery here)
```

### 2.9 Clean `package.json` in Frontend

Remove packages that are no longer needed in the frontend:

```json
// Remove from dependencies:
"@supabase/ssr": "...",        // no longer doing server-side Supabase
"bcryptjs": "...",
"jose": "...",
"playwright": "...",
"cheerio": "...",
"server-only": "...",
"groq-sdk": "..."              // if present
```

Keep `@supabase/supabase-js` for the browser realtime client.

### 2.10 Final Frontend `.env.local`

**Before** (10+ variables, secrets exposed to build):

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...      ← secret
JWT_SECRET=...                     ← secret
GROQ_API_KEY=...                   ← secret
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...           ← secret
SCRAPE_DO_TOKEN=...                ← secret
ADMIN_EMAIL=...
NEXT_PUBLIC_APP_URL=...
```

**After** (3 variables, zero secrets):

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SUPABASE_URL=...       ← public, for realtime
NEXT_PUBLIC_SUPABASE_ANON_KEY=...  ← public anon key, for realtime
```

---

## Phase 3 — Execution Order

| Step | Project | Task | Key files |
|---|---|---|---|
| 1 | Backend | Add `src/lib/credits.ts` (port from frontend) | 1 file |
| 2 | Backend | Add `src/lib/ai-insights.ts` (port from frontend) | 1 file |
| 3 | Backend | Add `src/lib/interpret-query.ts` (Groq-powered version) | 1 file |
| 4 | Backend | Add credit deduction to reveal + bulk-reveal routes | `routes/leads.ts` |
| 5 | Backend | Replace regex-only `/interpret` with Groq version | `routes/scrape.ts` |
| 6 | Backend | Add `requireAdmin` middleware | `lib/auth.ts` |
| 7 | Backend | Create `routes/analytics.ts` | 1 file |
| 8 | Backend | Create `routes/plans.ts` | 1 file |
| 9 | Backend | Create `routes/saved.ts` | 1 file |
| 10 | Backend | Create `routes/google-auth.ts` | 1 file |
| 11 | Backend | Register all new routes in `index.ts` | `index.ts` |
| 12 | Backend | Add all missing env vars to `.env` | `.env` |
| 13 | Backend | Test all endpoints with curl/Postman | — |
| 14 | Frontend | Create `lib/server-api.ts` | 1 file |
| 15 | Frontend | Expand `lib/api-client.ts` with all missing functions | 1 file |
| 16 | Frontend | Rewrite all 13 SSR pages/layouts | 13 files |
| 17 | Frontend | Rewrite `app/(auth)/actions.ts` | 1 file |
| 18 | Frontend | Rewrite `app/(dashboard)/leads/actions.ts` | 1 file |
| 19 | Frontend | Simplify `middleware.ts` | 1 file |
| 20 | Frontend | Move `InterpretedQuery` type to `types/index.ts` | 2 files |
| 21 | Frontend | Update `NEXT_PUBLIC_API_URL` in `.env.local` | `.env.local` |
| 22 | Frontend | Test full flow: signup → login → scrape → reveal | — |
| 23 | Frontend | Delete all backend-only files | ~30 files |
| 24 | Frontend | Remove backend-only packages from `package.json` | `package.json` |
| 25 | Both | End-to-end test all features | — |

---

## Architecture After Migration

```
┌─────────────────────────────────────────────────┐
│                FRONTEND (Next.js)               │
│                  localhost:3000                 │
│                                                 │
│  Pages (SSR) ──► serverFetch() ──► cookie fwd  │
│  Components ──► api-client.ts ──► fetch()       │
│  Realtime ────► supabase-browser (anon key)     │
│                                                 │
│  ENV: NEXT_PUBLIC_API_URL                       │
│       NEXT_PUBLIC_SUPABASE_URL                  │
│       NEXT_PUBLIC_SUPABASE_ANON_KEY             │
└────────────────────┬────────────────────────────┘
                     │ HTTP + cookies
                     ▼
┌─────────────────────────────────────────────────┐
│               BACKEND (Express)                 │
│                  localhost:4000                 │
│                                                 │
│  Auth      ── JWT sessions, bcrypt passwords    │
│  Database  ── Supabase service role client      │
│  Scraping  ── OSM, GMaps, Bing, YellowPages     │
│  AI        ── Groq (insights + interpret)       │
│  Credits   ── Atomic deduction via RPC          │
│  Rate limit── Per-user sliding window           │
│                                                 │
│  ENV: SUPABASE_SERVICE_ROLE_KEY (secret)        │
│       JWT_SECRET (secret)                       │
│       GROQ_API_KEY (secret)                     │
│       GOOGLE_CLIENT_SECRET (secret)             │
│       SCRAPE_DO_TOKEN (secret)                  │
└────────────────────┬────────────────────────────┘
                     │ service role
                     ▼
┌─────────────────────────────────────────────────┐
│                  Supabase                       │
│         (Postgres + Realtime server)            │
└─────────────────────────────────────────────────┘
```
