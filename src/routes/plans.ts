import { Router } from "express";
import { getAllPlans } from "../db/queries.js";

export const plansRouter = Router();

// Public endpoint — no auth required for the marketing page pricing display
plansRouter.get("/", async (_req, res) => {
  try {
    const plans = await getAllPlans();
    // Only return active plans to the public
    res.json(plans.filter((p: any) => p.is_active));
  } catch (err) {
    console.error("plans error:", err);
    res.status(500).json({ error: "Failed to fetch plans" });
  }
});
