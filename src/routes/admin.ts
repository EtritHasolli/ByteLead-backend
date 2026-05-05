import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { listAllUsers, getAllPlans, updateProfile } from "../db/queries.js";

export const adminRouter = Router();

adminRouter.get("/users", requireAuth, async (req, res) => {
  try {
    // TODO: verify admin role
    const users = await listAllUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

adminRouter.get("/plans", requireAuth, async (req, res) => {
  try {
    const plans = await getAllPlans();
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch plans" });
  }
});

adminRouter.post("/users/:id/update", requireAuth, async (req, res) => {
  try {
    await updateProfile(req.params.id, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update user" });
  }
});
