import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { checkScrapeLimit } from "../lib/rate-limit.js";
import { scrapeFormSchema } from "../lib/validators.js";
import { getProfile, createScrapeJob, updateScrapeJob, insertLeads, getScrapeJobsByUser } from "../db/queries.js";
import { getSupabaseAdmin } from "../lib/supabase.js";
import type { ScraperResult, ScraperOptions } from "../scrapers/base.js";
import { registry } from "../scrapers/registry.js";
import { interpretSearchQuery } from "../lib/interpret-query.js";

export const scrapeRouter = Router();

const FICTITIOUS_PHONE_RX = /\b555[-\s]?01\d\d\b/;

function dedupeResults(results: ScraperResult[], requireNoWebsite: boolean): ScraperResult[] {
  const seen = new Set<string>();
  const out: ScraperResult[] = [];
  for (const r of results) {
    if (r.isClosed) continue;
    if (requireNoWebsite && r.hasWebsite) continue;
    const name = r.businessName.toLowerCase().trim();
    if (!name) continue;
    const digits = (r.phone || "").replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) continue;
    if (FICTITIOUS_PHONE_RX.test(r.phone || "")) continue;
    const key = `${name}|p:${digits}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function cleanupStaleJobs(userId: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await sb.from("scrape_jobs")
    .update({ status: "failed", error_message: "Timed out" })
    .eq("user_id", userId).eq("status", "running").lt("created_at", fiveMinAgo);
}

scrapeRouter.post("/", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;

    const rl = checkScrapeLimit(userId);
    if (!rl.allowed) return res.status(429).json({ error: "Too many searches. Please wait." });

    const parsed = scrapeFormSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const { niche, location, country, maxPages, minRating, limit, locations, requireNoWebsite } = parsed.data;
    const isMulti = !!(locations && locations.length > 1);
    const perCityMaxPages = isMulti ? Math.min(3, maxPages) : maxPages;

    const profile = await getProfile(userId);
    if (!profile) return res.status(403).json({ error: "Profile not found" });

    await cleanupStaleJobs(userId).catch(() => {});

    const targets: Array<{ city: string; country: string }> =
      locations && locations.length > 0
        ? locations.map((l) => ({ city: l.city, country: (l.country ?? country).toUpperCase() }))
        : [{ city: location!, country: country.toUpperCase() }];

    const jobLocation = targets.length === 1 ? targets[0].city : `${targets.length} cities`;
    const jobCountry = targets[0].country;
    const directory = registry.getForCountry(jobCountry);
    const sourceName = targets.length > 1 ? "multi-city" : (directory?.name ?? "multi");

    const job = await createScrapeJob({
      user_id: userId, niche, location: jobLocation, country: jobCountry,
      source: sourceName, max_pages: maxPages, min_rating: minRating,
    });

    try {
      const merged: ScraperResult[] = [];
      const perTargetSpan = Math.floor(95 / targets.length);
      const perCityTarget = limit ? Math.ceil(limit / targets.length) + 5 : maxPages * 12;

      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const opts: ScraperOptions = {
          niche, location: target.city, maxPages: perCityMaxPages,
          minRating, country: target.country, multiCity: isMulti, requireNoWebsite,
        };

        const totalLeads = () => dedupeResults(merged, requireNoWebsite).length;
        const needMore = () => limit ? totalLeads() < limit : totalLeads() < perCityTarget;
        const runSlowScrapers = () => {
          if (isMulti) return false;
          const n = totalLeads();
          if (limit) return n < limit;
          return n < Math.min(100, Math.max(24, perCityMaxPages * 5));
        };

        // 1. OSM
        try {
          const r = await registry.getOSM().scrape(opts, async (p) => {
            await updateScrapeJob(job.id, { progress: Math.min(99, Math.round(i * perTargetSpan + (p / 100) * perTargetSpan * 0.25)) });
          });
          merged.push(...r);
        } catch (e) { console.warn("OSM failed:", e); }

        if (limit && totalLeads() >= limit) break;

        // 2. Country directory
        const cityDir = registry.getForCountry(target.country);
        if (cityDir && needMore()) {
          try { merged.push(...await cityDir.scrape(opts, async () => {})); } catch (e) { console.warn("Dir failed:", e); }
        }

        // 3. Bing
        if (runSlowScrapers()) {
          try { merged.push(...await registry.getBing().scrape(opts, async () => {})); } catch (e) { console.warn("Bing failed:", e); }
        }

        // 4. Google Maps
        if (runSlowScrapers()) {
          try { merged.push(...await registry.getGoogleMaps().scrape(opts, async () => {})); } catch (e) { console.warn("GMaps failed:", e); }
        }

        if (limit && dedupeResults(merged, requireNoWebsite).length >= limit) break;
      }

      let filtered = dedupeResults(merged, requireNoWebsite);
      if (limit && filtered.length > limit) filtered = filtered.slice(0, limit);

      if (filtered.length === 0) {
        await updateScrapeJob(job.id, { status: "completed", leads_found: 0, progress: 100 });
        return res.json({ jobId: job.id, leadsFound: 0, scrapedCount: 0, newCount: 0, duplicateCount: 0 });
      }

      const inserted = await insertLeads(filtered.map((r) => ({
        user_id: userId, scrape_job_id: job.id, business_name: r.businessName,
        phone: r.phone, address: r.address, city: r.city, state: r.state,
        rating: r.rating, review_count: r.reviewCount, source: r.source,
        source_url: r.sourceUrl, has_website: r.hasWebsite, is_closed: false,
      })));

      const newCount = inserted.length;
      const duplicateCount = Math.max(0, filtered.length - newCount);
      await updateScrapeJob(job.id, { status: "completed", leads_found: newCount, credits_used: 0, progress: 100 });

      return res.json({ jobId: job.id, leadsFound: newCount, scrapedCount: filtered.length, newCount, duplicateCount });
    } catch (error) {
      console.error("Scrape error:", error);
      await updateScrapeJob(job.id, { status: "failed", error_message: error instanceof Error ? error.message : "Scrape failed" });
      return res.status(500).json({ error: "Search failed. Please try again." });
    }
  } catch (error) {
    console.error("Request error:", error);
    return res.status(500).json({ error: "An unexpected error occurred." });
  }
});

// Interpret endpoint — Groq AI parses natural language queries into structured params
scrapeRouter.post("/interpret", requireAuth, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== "string") return res.status(400).json({ error: "query required" });
    const interpreted = await interpretSearchQuery(query.trim());
    res.json(interpreted);
  } catch (err) {
    console.error("interpret error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Interpretation failed" });
  }
});

// Poll job status
scrapeRouter.get("/:jobId", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const jobs = await getScrapeJobsByUser(userId);
    const job = jobs.find((j) => j.id === req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch job" });
  }
});

