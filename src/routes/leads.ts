import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { checkRevealLimit } from "../lib/rate-limit.js";
import { isUnlimited } from "../lib/credits.js";
import { generateLeadInsights, generateBulkInsights } from "../lib/ai-insights.js";
import {
  getLeadsByUser,
  getLeadsByJob,
  deleteLead,
  deleteLeadsByIds,
  revealLead,
  updateLeadTags,
  sanitizeLeadsForClient,
  getLeadById,
  getProfile,
} from "../db/queries.js";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const leadsRouter = Router();

leadsRouter.get("/", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const jobId = req.query.jobId as string | undefined;

    let leads;
    if (jobId) {
      leads = await getLeadsByJob(jobId);
    } else {
      leads = await getLeadsByUser(userId);
    }
    res.json(sanitizeLeadsForClient(leads));
  } catch (err) {
    console.error("leads GET error:", err);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

leadsRouter.post("/reveal", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;

    const rl = checkRevealLimit(userId);
    if (!rl.allowed) return res.status(429).json({ error: "Too many reveal requests. Please wait." });

    const { leadId } = req.body;
    if (!leadId) return res.status(400).json({ error: "leadId required" });

    const existing = await getLeadById(leadId);
    if (!existing) return res.status(404).json({ error: "Lead not found" });
    if (existing.user_id !== userId) return res.status(403).json({ error: "Forbidden" });
    if (existing.revealed) return res.json(existing);

    const profile = await getProfile(userId);
    if (!profile) return res.status(403).json({ error: "Profile not found" });

    if (!isUnlimited(profile)) {
      if (profile.credits_remaining <= 0) {
        return res.status(402).json({ error: "No credits remaining. Please upgrade your plan." });
      }
      const sb = getSupabaseAdmin();
      const { error: rpcErr } = await sb.rpc("decrement_credits", { uid: userId, amount: 1 });
      if (rpcErr) {
        const { data: fresh } = await sb.from("users").select("credits_remaining").eq("id", userId).single();
        if (!fresh || (fresh.credits_remaining as number) <= 0) {
          return res.status(402).json({ error: "No credits remaining." });
        }
        await sb.from("users").update({ credits_remaining: (fresh.credits_remaining as number) - 1 }).eq("id", userId);
      }
    }

    const aiData = await generateLeadInsights({
      businessName: existing.business_name,
      phone: existing.phone,
      address: existing.address,
      city: existing.city,
      state: existing.state,
      rating: existing.rating,
      reviewCount: existing.review_count,
    });

    const lead = await revealLead(leadId, aiData);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json(lead);
  } catch (err) {
    console.error("reveal error:", err);
    res.status(500).json({ error: "Failed to reveal lead" });
  }
});

leadsRouter.post("/reveal-bulk", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });

    const profile = await getProfile(userId);
    if (!profile) return res.status(403).json({ error: "Profile not found" });

    const sb = getSupabaseAdmin();
    const { data: leads } = await sb.from("leads")
      .select("*").in("id", ids).eq("user_id", userId).eq("revealed", false);

    const toReveal = leads ?? [];
    if (toReveal.length === 0) return res.json({ revealed: 0, creditsUsed: 0 });

    if (!isUnlimited(profile)) {
      if (profile.credits_remaining < toReveal.length) {
        return res.status(402).json({
          error: `Not enough credits. You have ${profile.credits_remaining} but need ${toReveal.length}.`,
        });
      }
      const { error: rpcErr } = await sb.rpc("decrement_credits", { uid: userId, amount: toReveal.length });
      if (rpcErr) {
        const { data: fresh } = await sb.from("users").select("credits_remaining").eq("id", userId).single();
        const current = (fresh?.credits_remaining as number) ?? 0;
        if (current < toReveal.length) return res.status(402).json({ error: "Not enough credits." });
        await sb.from("users").update({ credits_remaining: current - toReveal.length }).eq("id", userId);
      }
    }

    const insightsMap = await generateBulkInsights(
      toReveal.map((l: any) => ({
        businessName: l.business_name,
        phone: l.phone,
        address: l.address,
        city: l.city,
        state: l.state,
        rating: l.rating,
        reviewCount: l.review_count,
      }))
    );

    let revealed = 0;
    for (const lead of toReveal) {
      const aiData = insightsMap.get(lead.business_name) || { description: "", pitch: "" };
      const result = await revealLead(lead.id, aiData);
      if (result) revealed++;
    }

    res.json({ revealed, creditsUsed: isUnlimited(profile) ? 0 : toReveal.length });
  } catch (err) {
    console.error("bulk reveal error:", err);
    res.status(500).json({ error: "Failed to bulk reveal" });
  }
});

leadsRouter.post("/tags", requireAuth, async (req, res) => {
  try {
    const { leadId, tags } = req.body;
    if (!leadId || !Array.isArray(tags)) return res.status(400).json({ error: "leadId and tags required" });
    const lead = await updateLeadTags(leadId, tags);
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: "Failed to update tags" });
  }
});

leadsRouter.delete("/:id", requireAuth, async (req, res) => {
  try {
    await deleteLead(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete lead" });
  }
});

leadsRouter.post("/delete-bulk", requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: "ids array required" });
    await deleteLeadsByIds(ids);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete leads" });
  }
});
