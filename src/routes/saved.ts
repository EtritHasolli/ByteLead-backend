import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { getScrapeJobsByUser, deleteScrapeJob } from "../db/queries.js";

export const savedRouter = Router();

savedRouter.get("/", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const jobs = await getScrapeJobsByUser(userId);
    res.json(jobs);
  } catch (err) {
    console.error("saved GET error:", err);
    res.status(500).json({ error: "Failed to fetch saved searches" });
  }
});

savedRouter.delete("/:id", requireAuth, async (req, res) => {
  try {
    await deleteScrapeJob(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete saved search" });
  }
});
