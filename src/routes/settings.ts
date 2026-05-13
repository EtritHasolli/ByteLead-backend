import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../lib/auth.js";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { getProfile, updateProfile, deleteUser, getUserById, countLeadsByUser, countLeadsThisMonth, countScrapeJobsThisMonth, getCreditsUsedThisMonth } from "../db/queries.js";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const settingsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

settingsRouter.post("/avatar", requireAuth, upload.single("avatar"), async (req, res) => {
  try {
    const userId = (req as any).userId;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file provided" });

    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowed.includes(file.mimetype)) return res.status(400).json({ error: "Invalid image type" });

    const h = file.buffer;
    const isJpeg = h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF;
    const isPng  = h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47;
    const isGif  = h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46;
    const isWebp = h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50;
    if (!isJpeg && !isPng && !isGif && !isWebp) return res.status(400).json({ error: "Invalid image file" });

    const ext = file.originalname.split(".").pop() ?? "jpg";
    const path = `avatars/${userId}.${ext}`;
    const sb = getSupabaseAdmin();
    const { error: uploadErr } = await sb.storage.from("avatars").upload(path, h, { contentType: file.mimetype, upsert: true });
    if (uploadErr) return res.status(500).json({ error: uploadErr.message });

    const { data: urlData } = sb.storage.from("avatars").getPublicUrl(path);
    const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
    await updateProfile(userId, { avatar_url: publicUrl });
    res.json({ url: publicUrl });
  } catch (err) {
    res.status(500).json({ error: "Failed to upload avatar" });
  }
});

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
    const userId = (req as any).userId;
    const { password } = req.body ?? {};
    if (!password) return res.status(400).json({ error: "Password is required" });

    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.password_hash) {
      // Google OAuth user — must type "DELETE" to confirm
      if (password !== "DELETE") return res.status(401).json({ error: 'Type "DELETE" to confirm account deletion' });
    } else {
      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: "Incorrect password" });
    }

    await deleteUser(userId);
    res.clearCookie("byteleads-session", { path: "/" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete account" });
  }
});
