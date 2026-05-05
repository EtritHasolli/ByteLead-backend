import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { getLeadsByUser, getLeadsByJob, deleteLead, deleteLeadsByIds, revealLead, updateLeadTags, bulkRevealLeads, sanitizeLeadsForClient } from "../db/queries.js";

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
    const { leadId, aiData } = req.body;
    if (!leadId) return res.status(400).json({ error: "leadId required" });
    const lead = await revealLead(leadId, aiData);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: "Failed to reveal lead" });
  }
});

leadsRouter.post("/reveal-bulk", requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: "ids array required" });
    const count = await bulkRevealLeads(ids);
    res.json({ revealed: count });
  } catch (err) {
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
