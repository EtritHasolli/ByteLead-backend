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

// ─── Scrape Jobs ─────────────────────────────────────────────────────────────

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

export async function getAllPlans(): Promise<PlanConfig[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("plans").select("*").order("sort_order");
  if (error) throw error;
  return (data ?? []) as unknown as PlanConfig[];
}
