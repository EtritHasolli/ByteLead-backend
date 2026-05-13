import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { getLeadsGroupedByDate, getTopNiches, countLeadsByUser, countLeadsThisMonth, countScrapeJobsThisMonth, countCompletedJobsThisMonth, getTopLocations, getTopTags } from "../db/queries.js";

export const analyticsRouter = Router();

analyticsRouter.get("/overview", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;

    const [totalLeads, monthLeads, monthJobs, completedJobs, topNiches, topLocations, topTags, leadsOverTime] = await Promise.all([
      countLeadsByUser(userId),
      countLeadsThisMonth(userId),
      countScrapeJobsThisMonth(userId),
      countCompletedJobsThisMonth(userId),
      getTopNiches(userId, 5),
      getTopLocations(userId, 5),
      getTopTags(userId, 5),
      getLeadsGroupedByDate(userId, 14),
    ]);

    res.json({ totalLeads, monthLeads, monthJobs, completedJobs, topNiches, topLocations, topTags, leadsOverTime });
  } catch (err) {
    console.error("analytics error:", err);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});
