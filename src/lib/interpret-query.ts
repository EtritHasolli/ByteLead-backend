import { matchRegionKey, REGION_HUBS } from "./region-cities.js";

const GROQ_MODEL = "llama-3.3-70b-versatile";

export interface InterpretedQuery {
  niche: string;
  location?: string;
  locations?: Array<{ city: string; country?: string }>;
  country: string;
  maxPages: number;
  minRating: number;
  limit?: number;
  requireNoWebsite?: boolean;
}

function userRequestedNoWebsiteFilter(raw: string): boolean {
  return /without\s+websites?|no\s+website|missing\s+website|don'?t\s+have\s+(?:a\s+)?website|no\s+web\s+site|without\s+(?:a\s+)?site\b|lacking\s+(?:a\s+)?website/i.test(
    raw.trim()
  );
}

function fallbackParse(raw: string): InterpretedQuery {
  const q = raw.trim();
  const limitMatch = q.match(/^(\d+)\s+/);
  const limit = limitMatch ? Math.min(500, parseInt(limitMatch[1], 10)) : undefined;
  const locMatch = q.match(/\bin\s+(.+?)(?:\s+(?:without|with|who|that)|$)/i);
  const location = locMatch ? locMatch[1].trim() : "";
  return {
    niche: "Local businesses",
    location: location || "New York, NY",
    country: "US",
    maxPages: limit ? Math.min(20, Math.ceil(limit / 10)) : 3,
    minRating: 0,
    requireNoWebsite: userRequestedNoWebsiteFilter(q),
    ...(limit ? { limit } : {}),
  };
}

export async function interpretSearchQuery(raw: string): Promise<InterpretedQuery> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return fallbackParse(raw);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content: `You parse lead-generation search queries into JSON. Return ONLY valid JSON, no explanation.

Given a user query, extract:
- "niche": The specific business type/industry. Examples: "Plumbers", "Restaurants", "Dentists", "Hair Salons", "Tattoo Parlors". If the user writes "plumbers businesses" or "plumber companies", the niche is "Plumbers" - ignore generic words like "businesses"/"companies". ONLY use "Local businesses" if absolutely no specific industry is mentioned.
- "location": The city or area name (e.g. "Paris", "Austin, TX", "Berlin"). Omit if it's a broad region.
- "country": ISO 2-letter country code (e.g. "US", "FR", "DE", "GB", "XK"). Infer from location. Default "US".
- "region": If the user says a broad area like "Europe", "Scandinavia", "USA", "California", "Balkans", "UK", "Germany", "France", "Spain" - return this field with the region name (lowercase). Otherwise omit.
- "limit": Number of results requested. Default: omit (no cap).
- "minRating": Minimum star rating if mentioned. Default: 0.
- "maxPages": Scraping depth 1-20. For small limits (<20) use 3, for medium use 5, for large (>50) use 10.
- "requireNoWebsite": true ONLY if the user explicitly wants businesses without a website (e.g. "without a website", "no website", "don't have a website"). Otherwise false or omit.

Examples:
Query: "20 plumbers businesses in europe without websites"
{"niche":"Plumbers","region":"europe","country":"GB","limit":20,"minRating":0,"maxPages":5,"requireNoWebsite":true}

Query: "restaurants in Paris with rating < 3"
{"niche":"Restaurants","location":"Paris","country":"FR","minRating":0,"maxPages":3,"requireNoWebsite":false}

Query: "50 tattoo parlors near Berlin"
{"niche":"Tattoo Parlors","location":"Berlin","country":"DE","limit":50,"minRating":0,"maxPages":8,"requireNoWebsite":false}

Query: "dentists in Kosovo"
{"niche":"Dentists","location":"Kosovo","country":"XK","minRating":0,"maxPages":3,"requireNoWebsite":false}`,
          },
          { role: "user", content: raw.trim() },
        ],
        temperature: 0,
        max_tokens: 256,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[interpretSearchQuery] Groq API error ${res.status}`);
      return fallbackParse(raw);
    }

    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? "";

    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return fallbackParse(raw);

    const parsed = JSON.parse(match[0]) as Record<string, unknown>;

    const niche = String(parsed.niche || "Local businesses");
    const country = String(parsed.country || "US").toUpperCase();
    const minRating = typeof parsed.minRating === "number" ? parsed.minRating : 0;
    const maxPages = typeof parsed.maxPages === "number" ? Math.min(20, Math.max(1, parsed.maxPages)) : 3;
    const limit = typeof parsed.limit === "number" ? Math.min(500, Math.max(1, parsed.limit)) : undefined;
    const requireNoWebsite =
      (typeof parsed.requireNoWebsite === "boolean" ? parsed.requireNoWebsite : false) ||
      userRequestedNoWebsiteFilter(raw);

    const region = typeof parsed.region === "string" ? parsed.region.toLowerCase() : null;
    if (region) {
      const regionKey = matchRegionKey(region);
      if (regionKey && REGION_HUBS[regionKey]) {
        return {
          niche,
          locations: REGION_HUBS[regionKey],
          country: REGION_HUBS[regionKey][0]?.country ?? country,
          maxPages,
          minRating,
          requireNoWebsite,
          ...(limit ? { limit } : {}),
        };
      }
    }

    const location = String(parsed.location || "");

    if (location) {
      const regionKey = matchRegionKey(location);
      if (regionKey && REGION_HUBS[regionKey]) {
        return {
          niche,
          locations: REGION_HUBS[regionKey],
          country: REGION_HUBS[regionKey][0]?.country ?? country,
          maxPages,
          minRating,
          requireNoWebsite,
          ...(limit ? { limit } : {}),
        };
      }
    }

    return {
      niche,
      location: location || "New York, NY",
      country,
      maxPages,
      minRating,
      requireNoWebsite,
      ...(limit ? { limit } : {}),
    };
  } catch (err) {
    console.warn("[interpretSearchQuery] failed, using fallback:", err);
    return fallbackParse(raw);
  }
}
