import { z } from "zod";

const countryCodeSchema = z.string().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase());

export const scrapeFormSchema = z.object({
  niche: z.string().min(1),
  location: z.string().min(2).optional(),
  country: countryCodeSchema.default("US"),
  maxPages: z.number().min(1).max(20),
  minRating: z.number().min(0).max(5),
  limit: z.number().int().min(1).max(500).optional(),
  locations: z.array(z.object({ city: z.string().min(2), country: countryCodeSchema.optional() })).min(1).max(10).optional(),
  requireNoWebsite: z.boolean().optional().default(false),
}).refine((data) => data.location || (data.locations && data.locations.length > 0), {
  message: "Provide either `location` or a non-empty `locations` array",
  path: ["location"],
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const signupSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
});
