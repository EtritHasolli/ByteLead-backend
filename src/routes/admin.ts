import { Router } from "express";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { listAllUsers, listRecentJobs, getAllPlans, updateProfile, deleteUser, getAdminStats, createPlan, updatePlan, deletePlan } from "../db/queries.js";

export const adminRouter = Router();

adminRouter.get("/stats", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const stats = await getAdminStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch admin stats" });
  }
});

adminRouter.get("/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await listAllUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

adminRouter.get("/jobs", requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const jobs = await listRecentJobs(limit);
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

adminRouter.post("/users/:id/update", requireAuth, requireAdmin, async (req, res) => {
  try {
    const patch: Record<string, unknown> = {};
    const allowed = ["full_name", "plan", "role", "credits_remaining", "credits_monthly_limit"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    await updateProfile(req.params.id, patch);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update user" });
  }
});

adminRouter.delete("/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const adminId = (req as any).userId;
    if (req.params.id === adminId) return res.status(400).json({ error: "Cannot delete your own account" });
    await deleteUser(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete user" });
  }
});

adminRouter.get("/plans", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const plans = await getAllPlans();
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch plans" });
  }
});

adminRouter.post("/plans", requireAuth, requireAdmin, async (req, res) => {
  try {
    await createPlan(req.body);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Failed to create plan" });
  }
});

adminRouter.put("/plans/:key", requireAuth, requireAdmin, async (req, res) => {
  try {
    await updatePlan(req.params.key, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update plan" });
  }
});

adminRouter.delete("/plans/:key", requireAuth, requireAdmin, async (req, res) => {
  try {
    const core = ["free", "pro", "agency"];
    if (core.includes(req.params.key)) return res.status(400).json({ error: "Cannot delete core plans" });
    await deletePlan(req.params.key);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete plan" });
  }
});

