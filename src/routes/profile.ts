import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { getProfile, updateProfile } from "../db/queries.js";

export const profileRouter = Router();

profileRouter.get("/", requireAuth, async (req, res) => {
  try {
    const profile = await getProfile((req as any).userId);
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

profileRouter.put("/", requireAuth, async (req, res) => {
  try {
    const { full_name, about_me, avatar_url } = req.body;
    const patch: Record<string, unknown> = {};
    if (full_name !== undefined) patch.full_name = full_name;
    if (about_me !== undefined) patch.about_me = about_me;
    if (avatar_url !== undefined) patch.avatar_url = avatar_url;
    await updateProfile((req as any).userId, patch);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update profile" });
  }
});

profileRouter.post("/disclaimer", requireAuth, async (req, res) => {
  try {
    await updateProfile((req as any).userId, { disclaimer_accepted: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to accept disclaimer" });
  }
});
