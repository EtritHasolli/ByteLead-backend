import { Router } from "express";
import { hashPassword, verifyPassword, createSessionToken, setSessionCookie, clearSessionCookie } from "../lib/auth.js";
import { checkLoginLimit } from "../lib/rate-limit.js";
import { loginSchema, signupSchema } from "../lib/validators.js";
import { getUserByEmail, createUser, touchUserSeen, updateProfile, getProfile, getUserById } from "../db/queries.js";
import { isAdminEmail } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";
import { sendPasswordResetEmail } from "../lib/mailer.js";
import { createResetToken, consumeResetToken } from "../lib/reset-tokens.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const rl = checkLoginLimit(parsed.data.email);
    if (!rl.allowed) return res.status(429).json({ error: "Too many login attempts. Please wait." });

    const user = await getUserByEmail(parsed.data.email);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    const valid = await verifyPassword(parsed.data.password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });

    if (isAdminEmail(user.email) && (user.role !== "admin" || user.plan !== "agency")) {
      await updateProfile(user.id, { role: "admin", plan: "agency", credits_remaining: 999999, credits_monthly_limit: 999999 }).catch(() => {});
    }

    await touchUserSeen(user.id).catch(() => {});
    const token = await createSessionToken(user.id);
    setSessionCookie(res, token);
    res.json({ success: true });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

authRouter.post("/signup", async (req, res) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const existing = await getUserByEmail(parsed.data.email);
    if (existing) return res.status(409).json({ error: "An account with this email already exists" });

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await createUser(parsed.data.email, passwordHash, parsed.data.fullName);

    const token = await createSessionToken(user.id);
    setSessionCookie(res, token);
    res.json({ success: true });
  } catch (err) {
    console.error("signup error:", err);
    res.status(500).json({ error: "Could not create account" });
  }
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

authRouter.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await getUserByEmail(email);
    // Always return success so we don't leak whether an email exists
    if (!user || !user.password_hash) return res.json({ success: true });

    const token = createResetToken(user.id);
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    await sendPasswordResetEmail(user.email, resetUrl);
    res.json({ success: true });
  } catch (err) {
    console.error("forgot-password error:", err);
    res.status(500).json({ error: "Failed to send reset email" });
  }
});

authRouter.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: "Token and password are required" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

    const userId = consumeResetToken(token);
    if (!userId) return res.status(400).json({ error: "Reset link is invalid or has expired" });

    const hash = await hashPassword(password);
    await updateProfile(userId, { password_hash: hash });
    res.json({ success: true });
  } catch (err) {
    console.error("reset-password error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const [profile, user] = await Promise.all([
      getProfile(userId),
      getUserById(userId),
    ]);
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    touchUserSeen(userId).catch(() => {});
    res.json({ ...profile, has_password: !!user?.password_hash });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});
