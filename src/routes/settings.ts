import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { getProfile, updateProfile, deleteUser, getUserById, countLeadsByUser, countLeadsThisMonth, countScrapeJobsThisMonth } from "../db/queries.js";

export const settingsRouter = Router();

settingsRouter.get("/usage", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const [totalLeads, leadsThisMonth, jobsThisMonth] = await Promise.all([
      countLeadsByUser(userId),
      countLeadsThisMonth(userId),
      countScrapeJobsThisMonth(userId),
    ]);
    res.json({ totalLeads, leadsThisMonth, jobsThisMonth });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch usage" });
  }
});

settingsRouter.post("/change-password", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: "Both passwords required" });
    if (newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

    const user = await getUserById(userId);
    if (!user || !user.password_hash) return res.status(400).json({ error: "Cannot change password" });

    const valid = await verifyPassword(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    const hash = await hashPassword(newPassword);
    await updateProfile(userId, { password_hash: hash });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to change password" });
  }
});

settingsRouter.post("/notifications", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { notif_friend_request, notif_friend_accept, notif_message, notif_lead_share } = req.body;
    const patch: Record<string, unknown> = {};
    if (notif_friend_request !== undefined) patch.notif_friend_request = notif_friend_request;
    if (notif_friend_accept !== undefined) patch.notif_friend_accept = notif_friend_accept;
    if (notif_message !== undefined) patch.notif_message = notif_message;
    if (notif_lead_share !== undefined) patch.notif_lead_share = notif_lead_share;
    await updateProfile(userId, patch);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

settingsRouter.delete("/account", requireAuth, async (req, res) => {
  try {
    await deleteUser((req as any).userId);
    res.clearCookie("byteleads-session", { path: "/" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete account" });
  }
});
