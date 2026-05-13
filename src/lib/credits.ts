import type { Profile, Plan } from "../types.js";

export const PLAN_LIMITS: Record<Plan, { credits: number; label: string; price: number }> = {
  free:   { credits: 10,     label: "Free",   price: 0 },
  pro:    { credits: 1000,   label: "Pro",    price: 19 },
  agency: { credits: 999999, label: "Agency", price: 49 },
};

export function isUnlimited(profile: Profile): boolean {
  return profile.role === "admin" || profile.plan === "agency";
}

export function canScrape(profile: Profile): { allowed: boolean; message: string } {
  if (isUnlimited(profile)) return { allowed: true, message: "" };

  if (profile.credits_remaining <= 0) {
    return {
      allowed: false,
      message: "No credits remaining. Please upgrade your plan or wait for the monthly reset.",
    };
  }

  if (profile.credits_remaining < 5) {
    return {
      allowed: true,
      message: `Only ${profile.credits_remaining} credits remaining.`,
    };
  }

  return { allowed: true, message: "" };
}

export function getCreditsAfterReveal(profile: Profile, count: number): number {
  if (isUnlimited(profile)) return profile.credits_remaining;
  return Math.max(0, profile.credits_remaining - count);
}

export function getPlanLimit(plan: Plan): number {
  return PLAN_LIMITS[plan].credits;
}

export function shouldResetCredits(profile: Profile): boolean {
  return new Date() >= new Date(profile.credits_reset_at);
}
