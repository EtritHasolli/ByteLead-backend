import { getSupabaseAdmin, isAdminEmail } from "../lib/supabase.js";
import type { Profile, ScrapeJob, Lead, Plan, UserRole, PlanConfig } from "../types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  avatar_url: string | null;
  about_me: string | null;
  plan: string;
  role: string;
  credits_remaining: number;
  credits_monthly_limit: number;
  credits_reset_at: string;
  disclaimer_accepted: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  last_seen_at: string;
  created_at: string;
  notif_friend_request: boolean;
  notif_friend_accept: boolean;
  notif_message: boolean;
  notif_lead_share: boolean;
}

function rowToProfile(row: UserRow): Profile {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name || null,
    avatar_url: row.avatar_url || null,
    about_me: row.about_me || null,
    plan: row.plan as Plan,
    role: (row.role as UserRole) || "user",
    credits_remaining: row.credits_remaining ?? 0,
    credits_monthly_limit: row.credits_monthly_limit ?? 10,
    share_credits_remaining: (row as any).share_credits_remaining ?? 0,
    share_credits_monthly_limit: (row as any).share_credits_monthly_limit ?? 0,
    credits_reset_at: row.credits_reset_at,
    disclaimer_accepted: !!row.disclaimer_accepted,
    stripe_customer_id: row.stripe_customer_id,
    stripe_subscription_id: row.stripe_subscription_id,
    created_at: row.created_at,
    notif_friend_request: row.notif_friend_request ?? true,
    notif_friend_accept: row.notif_friend_accept ?? true,
    notif_message: row.notif_message ?? true,
    notif_lead_share: row.notif_lead_share ?? true,
  };
}

// ─── Users / Profiles ────────────────────────────────────────────────────────

export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("users").select("*").ilike("email", email).maybeSingle();
  if (error) throw error;
  return (data as UserRow | null) ?? undefined;
}

export async function getUserById(id: string): Promise<UserRow | undefined> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("users").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as UserRow | null) ?? undefined;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const row = await getUserById(userId);
  return row ? rowToProfile(row) : null;
}

export async function createUser(email: string, passwordHash: string, fullName: string): Promise<UserRow> {
  const sb = getSupabaseAdmin();
  const { data: freePlan } = await sb.from("plans").select("monthly_credits").eq("key", "free").maybeSingle();
  const freeCredits = (freePlan?.monthly_credits as number | undefined) ?? 10;
  const isAdmin = isAdminEmail(email);
  const insert = {
    email: email.toLowerCase(),
    password_hash: passwordHash,
    full_name: fullName,
    plan: isAdmin ? "agency" : "free",
    role: isAdmin ? "admin" : "user",
    credits_remaining: isAdmin ? 999999 : freeCredits,
    credits_monthly_limit: isAdmin ? 999999 : freeCredits,
  };
  const { data, error } = await sb.from("users").insert(insert).select("*").single();
  if (error) throw error;
  return data as UserRow;
}

export async function updateProfile(userId: string, data: Record<string, unknown>): Promise<void> {
  const sb = getSupabaseAdmin();
  if (Object.keys(data).length === 0) return;
  const { error } = await sb.from("users").update(data).eq("id", userId);
  if (error) throw error;
}

export async function touchUserSeen(userId: string): Promise<void> {
  const sb = getSupabaseAdmin();
  await sb.from("users").update({ last_seen_at: new Date().toISOString() }).eq("id", userId);
}

export async function deleteUser(userId: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("users").delete().eq("id", userId);
  if (error) throw error;
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────

export async function getUserByGoogleSub(googleSub: string): Promise<UserRow | undefined> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("users").select("*").eq("google_sub", googleSub).maybeSingle();
  if (error) throw error;
  return (data as UserRow | null) ?? undefined;
}

export async function createGoogleUser(opts: {
  email: string;
  fullName: string;
  googleSub: string;
  avatarUrl?: string;
}): Promise<UserRow> {
  const sb = getSupabaseAdmin();
  const { data: freePlan } = await sb.from("plans").select("monthly_credits").eq("key", "free").maybeSingle();
  const freeCredits = (freePlan?.monthly_credits as number | undefined) ?? 10;
  const isAdmin = isAdminEmail(opts.email);
  const insert = {
    email: opts.email.toLowerCase(),
    full_name: opts.fullName,
    google_sub: opts.googleSub,
    avatar_url: opts.avatarUrl || null,
    auth_provider: "google",
    plan: isAdmin ? "agency" : "free",
    role: isAdmin ? "admin" : "user",
    credits_remaining: isAdmin ? 999999 : freeCredits,
    credits_monthly_limit: isAdmin ? 999999 : freeCredits,
  };
  const { data, error } = await sb.from("users").insert(insert).select("*").single();
  if (error) throw error;
  return data as UserRow;
}

export async function linkGoogleSub(userId: string, googleSub: string, avatarUrl?: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const patch: Record<string, unknown> = { google_sub: googleSub, auth_provider: "google" };
  if (avatarUrl) patch.avatar_url = avatarUrl;
  await sb.from("users").update(patch).eq("id", userId);
}



interface JobRow {
  id: string; user_id: string; niche: string; location: string; country: string;
  source: string; status: string; max_pages: number; min_rating: number;
  leads_found: number; credits_used: number; error_message: string | null;
  progress: number; created_at: string;
}

function rowToJob(row: JobRow): ScrapeJob {
  return {
    id: row.id, user_id: row.user_id, niche: row.niche, location: row.location,
    country: row.country, source: row.source, status: row.status as ScrapeJob["status"],
    max_pages: row.max_pages, min_rating: Number(row.min_rating), leads_found: row.leads_found,
    credits_used: row.credits_used, error_message: row.error_message,
    progress: row.progress, created_at: row.created_at,
  };
}

export async function createScrapeJob(data: {
  user_id: string; niche: string; location: string; country: string;
  source: string; max_pages: number; min_rating: number;
}): Promise<ScrapeJob> {
  const sb = getSupabaseAdmin();
  const { data: row, error } = await sb.from("scrape_jobs").insert({ ...data, status: "running" }).select("*").single();
  if (error) throw error;
  return rowToJob(row as JobRow);
}

export async function updateScrapeJob(id: string, data: Record<string, unknown>): Promise<void> {
  if (Object.keys(data).length === 0) return;
  const sb = getSupabaseAdmin();
  await sb.from("scrape_jobs").update(data).eq("id", id);
}

export async function getScrapeJobsByUser(userId: string): Promise<ScrapeJob[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("scrape_jobs").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data as JobRow[]).map(rowToJob);
}

export async function deleteScrapeJob(id: string): Promise<void> {
  const sb = getSupabaseAdmin();
  await sb.from("scrape_jobs").delete().eq("id", id);
}

export async function getScrapeJob(id: string): Promise<ScrapeJob | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("scrape_jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToJob(data as JobRow) : null;
}

export async function getRecentScrapeJobs(userId: string, limit: number): Promise<ScrapeJob[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("scrape_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as JobRow[]).map(rowToJob);
}

// ─── Leads ───────────────────────────────────────────────────────────────────

interface LeadRow {
  id: string; user_id: string; scrape_job_id: string; business_name: string;
  phone: string; address: string; city: string; state: string; rating: number | null;
  review_count: number | null; source: string; source_url: string; has_website: boolean;
  is_closed: boolean; revealed: boolean; tags: string[] | null; description: string | null;
  pitch: string | null; created_at: string;
}

function rowToLead(row: LeadRow): Lead {
  return {
    id: row.id, user_id: row.user_id, scrape_job_id: row.scrape_job_id,
    share_package_id: (row as any).share_package_id ?? null,
    business_name: row.business_name, phone: row.phone, address: row.address,
    city: row.city, state: row.state, rating: row.rating !== null ? Number(row.rating) : null,
    review_count: row.review_count, source: row.source, source_url: row.source_url,
    has_website: !!row.has_website, is_closed: !!row.is_closed, revealed: !!row.revealed,
    tags: Array.isArray(row.tags) ? row.tags : [], description: row.description ?? "",
    pitch: row.pitch ?? "", created_at: row.created_at,
  };
}

export function dedupeKeyFor(name: string, phone: string, city: string): string {
  const n = name.toLowerCase().replace(/\s+/g, " ").trim();
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length >= 7) return `${n}|p:${digits}`;
  return `${n}|c:${(city || "").toLowerCase().trim()}`;
}

export async function insertLeads(leads: Array<{
  user_id: string; scrape_job_id: string; business_name: string; phone: string;
  address: string; city: string; state: string; rating: number | null;
  review_count: number | null; source: string; source_url: string;
  has_website: boolean; is_closed: boolean;
}>): Promise<Lead[]> {
  if (leads.length === 0) return [];
  const sb = getSupabaseAdmin();
  const seen = new Set<string>();
  const rows = leads.map((l) => ({ ...l, dedupe_key: dedupeKeyFor(l.business_name, l.phone, l.city) }))
    .filter((l) => { if (seen.has(l.dedupe_key)) return false; seen.add(l.dedupe_key); return true; });
  if (rows.length === 0) return [];
  const { data, error } = await sb.from("leads").upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }).select("*");
  if (error) { console.error("insertLeads upsert failed:", error); return []; }
  return ((data as LeadRow[] | null) ?? []).map(rowToLead);
}

export async function getLeadsByUser(userId: string): Promise<Lead[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("leads").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data as LeadRow[]).map(rowToLead);
}

export async function getLeadsByJob(jobId: string): Promise<Lead[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("leads").select("*").eq("scrape_job_id", jobId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data as LeadRow[]).map(rowToLead);
}

export async function getLeadById(id: string): Promise<Lead | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("leads").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToLead(data as LeadRow) : null;
}

export async function deleteLead(id: string): Promise<void> {
  const sb = getSupabaseAdmin();
  await sb.from("leads").delete().eq("id", id);
}

export async function deleteLeadsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const sb = getSupabaseAdmin();
  await sb.from("leads").delete().in("id", ids);
}

export async function revealLead(id: string, aiData?: { description: string; pitch: string }): Promise<Lead | null> {
  const sb = getSupabaseAdmin();
  const patch: Record<string, unknown> = { revealed: true };
  if (aiData) { patch.description = aiData.description; patch.pitch = aiData.pitch; }
  const { data, error } = await sb.from("leads").update(patch).eq("id", id).select("*").single();
  if (error) { console.error("revealLead failed:", error); return null; }
  return rowToLead(data as LeadRow);
}

export async function updateLeadTags(leadId: string, tags: string[]): Promise<Lead | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("leads").update({ tags }).eq("id", leadId).select("*").single();
  if (error) { console.error("updateLeadTags failed:", error); return null; }
  return rowToLead(data as LeadRow);
}

export async function bulkRevealLeads(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("leads").update({ revealed: true }).in("id", ids).eq("revealed", false).select("id");
  if (error) { console.error("bulkRevealLeads failed:", error); return 0; }
  return data?.length ?? 0;
}

export function sanitizeLeadsForClient(leads: Lead[]): Lead[] {
  return leads.map((lead) => {
    if (lead.revealed) return lead;
    return { ...lead, business_name: "", phone: "", address: "", source_url: "", description: "", pitch: "" };
  });
}

// ─── Analytics ───────────────────────────────────────────────────────────────

function monthStartIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export async function countLeadsByUser(userId: string): Promise<number> {
  const sb = getSupabaseAdmin();
  const { count } = await sb.from("leads").select("id", { count: "exact", head: true }).eq("user_id", userId);
  return count ?? 0;
}

export async function countLeadsThisMonth(userId: string): Promise<number> {
  const sb = getSupabaseAdmin();
  const { count } = await sb.from("leads").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", monthStartIso());
  return count ?? 0;
}

export async function countScrapeJobsThisMonth(userId: string): Promise<number> {
  const sb = getSupabaseAdmin();
  const { count } = await sb.from("scrape_jobs").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", monthStartIso());
  return count ?? 0;
}

export async function countCompletedJobsThisMonth(userId: string): Promise<number> {
  const sb = getSupabaseAdmin();
  const { count } = await sb.from("scrape_jobs").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "completed").gte("created_at", monthStartIso());
  return count ?? 0;
}

export async function getTopLocations(userId: string, limit: number): Promise<Array<{ location: string; count: number }>> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("scrape_jobs").select("location, leads_found").eq("user_id", userId).eq("status", "completed");
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of (data as Array<{ location: string; leads_found: number }>) ?? []) {
    counts.set(r.location, (counts.get(r.location) ?? 0) + (r.leads_found || 0));
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([location, count]) => ({ location, count }));
}

export async function getTopTags(userId: string, limit: number): Promise<Array<{ tag: string; count: number }>> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("leads").select("tags").eq("user_id", userId).not("tags", "is", null);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of (data as Array<{ tags: string[] }>) ?? []) {
    if (Array.isArray(r.tags)) for (const tag of r.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag, count]) => ({ tag, count }));
}

export async function getLeadsGroupedByDate(userId: string, days = 30) {
  const sb = getSupabaseAdmin();
  const start = new Date(); start.setDate(start.getDate() - days);
  const { data, error } = await sb.from("leads").select("created_at").eq("user_id", userId).gte("created_at", start.toISOString());
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of (data as Array<{ created_at: string }>) ?? []) {
    const day = row.created_at.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([date, count]) => ({ date, count }));
}

export async function getTopNiches(userId: string, limit: number) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("scrape_jobs").select("niche, leads_found").eq("user_id", userId).eq("status", "completed");
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of (data as Array<{ niche: string; leads_found: number }>) ?? []) {
    counts.set(r.niche, (counts.get(r.niche) ?? 0) + (r.leads_found || 0));
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([niche, count]) => ({ niche, count }));
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export async function listAllUsers() {
  const sb = getSupabaseAdmin();
  const { data: users, error } = await sb.from("users").select("id,email,full_name,plan,role,credits_remaining,credits_monthly_limit,created_at,last_seen_at").order("created_at", { ascending: false });
  if (error) throw error;
  return users ?? [];
}

export async function listRecentJobs(limit = 100) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("scrape_jobs")
    .select("id,user_id,niche,location,status,leads_found,source,created_at,users(email)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    user_email: row.users?.email ?? null,
    users: undefined,
  }));
}

export async function getAllPlans(): Promise<PlanConfig[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("plans").select("*").order("sort_order");
  if (error) throw error;
  return (data ?? []) as unknown as PlanConfig[];
}

export async function createPlan(data: {
  key: string; label: string; price_cents: number; monthly_credits: number;
  monthly_shares: number; max_pages: number; features: string[]; is_active: boolean; sort_order: number;
}): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("plans").insert(data);
  if (error) throw error;
}

export async function deletePlan(key: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("plans").delete().eq("key", key);
  if (error) throw error;
}

export async function updatePlan(key: string, patch: {
  label?: string; price_cents?: number; monthly_credits?: number;
  monthly_shares?: number; max_pages?: number; features?: string[]; is_active?: boolean;
}): Promise<void> {
  const sb = getSupabaseAdmin();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) update[k] = v;
  }
  const { error } = await sb.from("plans").update(update).eq("key", key);
  if (error) throw error;
}

export async function getCreditsUsedThisMonth(userId: string): Promise<number> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("scrape_jobs").select("credits_used").eq("user_id", userId).gte("created_at", monthStartIso());
  if (error) throw error;
  return ((data as Array<{ credits_used: number }>) ?? []).reduce((acc, r) => acc + (r.credits_used || 0), 0);
}

interface PlanBuckets { free: number; pro: number; agency: number; }

export async function getAdminStats() {
  const sb = getSupabaseAdmin();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400_000).toISOString();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const [
    { count: totalUsers }, { count: newUsers7d }, { count: newUsers14d }, { count: activeUsersToday },
    { count: totalJobs }, { count: jobsThisMonth }, { count: totalLeads },
    { count: leadsRevealedThisMonth }, { count: revealedAllTime },
    { data: planRows }, { data: paidUsers }, { data: signups14d }, { data: signupsAllTime }, { data: livePlans },
  ] = await Promise.all([
    sb.from("users").select("id", { count: "exact", head: true }),
    sb.from("users").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    sb.from("users").select("id", { count: "exact", head: true }).gte("created_at", fourteenDaysAgo),
    sb.from("users").select("id", { count: "exact", head: true }).gte("last_seen_at", todayStart),
    sb.from("scrape_jobs").select("id", { count: "exact", head: true }),
    sb.from("scrape_jobs").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
    sb.from("leads").select("id", { count: "exact", head: true }),
    sb.from("leads").select("id", { count: "exact", head: true }).eq("revealed", true).gte("created_at", monthStart),
    sb.from("leads").select("id", { count: "exact", head: true }).eq("revealed", true),
    sb.from("users").select("plan"),
    sb.from("users").select("plan").in("plan", ["pro", "agency"]).neq("role", "admin"),
    sb.from("users").select("created_at,plan").gte("created_at", fourteenDaysAgo),
    sb.from("users").select("created_at,plan"),
    sb.from("plans").select("key,price_cents"),
  ]);

  const planMap = new Map<string, number>([["free", 0], ["pro", 0], ["agency", 0]]);
  for (const r of (planRows as Array<{ plan: string }>) ?? []) planMap.set(r.plan, (planMap.get(r.plan) ?? 0) + 1);

  const planPrice = new Map<string, number>();
  for (const p of (livePlans as Array<{ key: string; price_cents: number }>) ?? []) planPrice.set(p.key, p.price_cents);
  let mrr = 0;
  for (const r of (paidUsers as Array<{ plan: string }>) ?? []) mrr += planPrice.get(r.plan) ?? 0;

  const day14Map = new Map<string, PlanBuckets>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400_000);
    day14Map.set(d.toISOString().slice(0, 10), { free: 0, pro: 0, agency: 0 });
  }
  for (const r of (signups14d as Array<{ created_at: string; plan: string }>) ?? []) {
    const k = r.created_at.slice(0, 10);
    const b = day14Map.get(k);
    if (b) (b as any)[r.plan] = ((b as any)[r.plan] ?? 0) + 1;
  }
  const signupsByDay14d = [...day14Map.entries()].map(([date, b]) => ({ date, ...b }));

  const monthMap = new Map<string, PlanBuckets>();
  for (const r of (signupsAllTime as Array<{ created_at: string; plan: string }>) ?? []) {
    const k = r.created_at.slice(0, 7);
    const b = monthMap.get(k) ?? { free: 0, pro: 0, agency: 0 };
    (b as any)[r.plan] = ((b as any)[r.plan] ?? 0) + 1;
    monthMap.set(k, b);
  }
  const signupsByMonthAllTime = [...monthMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([month, b]) => ({ month, ...b }));

  const totalLeadsNum = totalLeads ?? 0;
  const revealedAll = revealedAllTime ?? 0;

  return {
    totalUsers: totalUsers ?? 0, newUsers7d: newUsers7d ?? 0, newUsers14d: newUsers14d ?? 0,
    paidUsers: (paidUsers ?? []).length, mrrCents: mrr, totalJobs: totalJobs ?? 0,
    jobsThisMonth: jobsThisMonth ?? 0, totalLeads: totalLeadsNum,
    leadsRevealedThisMonth: leadsRevealedThisMonth ?? 0, activeUsersToday: activeUsersToday ?? 0,
    signupsByDay14d, signupsByMonthAllTime,
    planDistribution: [...planMap.entries()].map(([plan, count]) => ({ plan, count })),
    revealStats: { revealed: revealedAll, unrevealed: Math.max(0, totalLeadsNum - revealedAll) },
  };
}

