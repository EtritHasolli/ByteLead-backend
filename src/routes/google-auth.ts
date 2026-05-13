import { Router } from "express";
import { randomBytes } from "crypto";
import {
  getUserByEmail,
  getUserByGoogleSub,
  createGoogleUser,
  linkGoogleSub,
  touchUserSeen,
  updateProfile,
} from "../db/queries.js";
import { isAdminEmail } from "../lib/supabase.js";
import { createSessionToken, setSessionCookie } from "../lib/auth.js";

export const googleAuthRouter = Router();

const FRONTEND_URL = () => process.env.FRONTEND_URL || "http://localhost:3000";

function loginRedirect(errorMsg: string) {
  const url = new URL(`${FRONTEND_URL()}/login`);
  url.searchParams.set("error", errorMsg);
  return url.toString();
}

// Step 1: Redirect to Google consent screen
googleAuthRouter.get("/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({
      error: "Google sign-in is not configured. Add GOOGLE_CLIENT_ID to .env.",
    });
  }

  const redirectUri = process.env.GOOGLE_REDIRECT_URI ||
    `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    include_granted_scopes: "true",
    prompt: "select_account",
    state,
  });

  // Store state in httpOnly cookie (10-min lifetime)
  res.cookie("byteleads-oauth-state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10 * 1000,
    path: "/",
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// Step 2: Google bounces back with ?code=...&state=...
googleAuthRouter.get("/google/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const googleErr = req.query.error as string | undefined;

  if (googleErr) return res.redirect(loginRedirect("Google sign-in was cancelled"));
  if (!code || !state) return res.redirect(loginRedirect("Missing OAuth code"));

  const cookieState = req.cookies?.["byteleads-oauth-state"];
  if (!cookieState || cookieState !== state) {
    return res.redirect(loginRedirect("OAuth state mismatch — please try again"));
  }

  res.clearCookie("byteleads-oauth-state", { path: "/" });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.redirect(loginRedirect("Google sign-in is not configured"));
  }

  const redirectUri = process.env.GOOGLE_REDIRECT_URI ||
    `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

  // 1. Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);

  if (!tokenRes || !tokenRes.ok) {
    console.error("[google] token exchange failed");
    return res.redirect(loginRedirect("Google sign-in failed (token exchange)"));
  }

  const tokens = await tokenRes.json();
  if (!tokens.access_token) {
    return res.redirect(loginRedirect("Google did not return an access token"));
  }

  // 2. Fetch Google profile
  const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);

  if (!userRes || !userRes.ok) {
    return res.redirect(loginRedirect("Failed to fetch Google profile"));
  }

  const googleProfile = await userRes.json();

  if (!googleProfile.email) return res.redirect(loginRedirect("Google account has no email"));
  if (googleProfile.email_verified === false) {
    return res.redirect(loginRedirect("Your Google email is not verified"));
  }

  // 3. Find / create / link the user row
  let userRow = await getUserByGoogleSub(googleProfile.sub).catch(() => undefined);

  if (!userRow) {
    const byEmail = await getUserByEmail(googleProfile.email).catch(() => undefined);
    if (byEmail) {
      await linkGoogleSub(byEmail.id, googleProfile.sub, googleProfile.picture).catch(() => {});
      userRow = byEmail;
    } else {
      try {
        userRow = await createGoogleUser({
          email: googleProfile.email,
          fullName: googleProfile.name || googleProfile.given_name || googleProfile.email.split("@")[0],
          googleSub: googleProfile.sub,
          avatarUrl: googleProfile.picture,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error("[google] createGoogleUser failed:", detail);
        return res.redirect(loginRedirect(`Could not create your account: ${detail}`));
      }
    }
  }

  if (!userRow) return res.redirect(loginRedirect("Account creation failed"));

  // 4. Self-heal admin role
  if (isAdminEmail(userRow.email) && ((userRow as any).role !== "admin" || (userRow as any).plan !== "agency")) {
    await updateProfile(userRow.id, {
      role: "admin",
      plan: "agency",
      credits_remaining: 999999,
      credits_monthly_limit: 999999,
    }).catch(() => {});
  }

  await touchUserSeen(userRow.id).catch(() => {});

  // 5. Issue session cookie + redirect to dashboard
  const token = await createSessionToken(userRow.id);
  setSessionCookie(res, token);
  res.redirect(`${FRONTEND_URL()}/dashboard`);
});
