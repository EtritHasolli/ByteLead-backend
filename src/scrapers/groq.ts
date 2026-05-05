import {
  BaseScraper,
  type ScraperOptions,
  type ScraperResult,
  type ProgressCallback,
} from "./base";

const GROQ_MODEL = "llama-3.3-70b-versatile";

interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GroqChoice {
  message: { content: string };
}

interface GroqResponse {
  choices: GroqChoice[];
}

/**
 * AI-powered lead finder using Groq LLM.
 *
 * Strategy: Ask the model to generate realistic local businesses for the
 * given niche + location that are likely to NOT have a website. The model
 * draws on its training data of real US/UK/EU business directories.
 *
 * This is NOT a scraper in the traditional sense — it uses AI knowledge
 * to produce plausible leads. When you later add ScrapingBee or a real
 * proxy the YellowPages scraper will kick in automatically.
 */
export class GroqLeadFinder extends BaseScraper {
  readonly name = "groq-ai";
  readonly country = "ALL";
  readonly baseUrl = "https://api.groq.com";

  async scrape(
    options: ScraperOptions,
    onProgress: ProgressCallback
  ): Promise<ScraperResult[]> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GROQ_API_KEY is not set. Add it to .env — get one free at https://console.groq.com"
      );
    }

    // 15-50 leads per scrape so users always get a healthy batch even when
    // the live directory scrapers are blocked or thin.
    const batchSize = Math.min(Math.max(options.maxPages * 10, 15), 50);

    await onProgress(10, "Connecting to Groq AI...", 0);

    const systemPrompt = `You are a business directory data assistant. You return ONLY valid JSON arrays.
Your job: generate realistic local businesses for a given niche and location that are very likely to NOT have a website.
Focus on small, independent, owner-operated businesses — NOT chains or franchises.
Each business must have a plausible US-formatted phone number, street address, city, and state.
Use realistic-sounding business names that fit the niche and locale.
Rating should be between 1.0 and 5.0 (one decimal). Review count between 1 and 200.
Return ONLY a JSON array, no markdown fences, no explanation.`;

    const userPrompt = `Generate ${batchSize} ${options.niche} businesses in or near "${options.location}" that likely do NOT have a website.
${options.minRating > 0 ? `Minimum rating: ${options.minRating} stars.` : ""}

Return a JSON array of objects with these exact keys:
businessName, phone, address, city, state, rating, reviewCount

Example format:
[{"businessName":"Joe's Plumbing","phone":"(512) 555-0147","address":"1423 Oak Hill Dr","city":"Austin","state":"TX","rating":4.2,"reviewCount":38}]`;

    const messages: GroqMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    await onProgress(30, "AI is generating leads...", 0);

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: 0.9,
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Groq API error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = (await res.json()) as GroqResponse;
    const raw = data.choices?.[0]?.message?.content ?? "";

    await onProgress(70, "Parsing AI results...", 0);

    const results = this.parseResponse(raw, options.minRating);

    await onProgress(100, "Done!", results.length);
    return results;
  }

  private parseResponse(raw: string, minRating: number): ScraperResult[] {
    // Strip markdown code fences if the model wraps them
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Try to extract JSON array from the response
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          console.error("Groq response could not be parsed:", cleaned.slice(0, 500));
          return [];
        }
      } else {
        console.error("Groq response contained no JSON array:", cleaned.slice(0, 500));
        return [];
      }
    }

    if (!Array.isArray(parsed)) return [];

    const results: ScraperResult[] = [];

    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;

      const businessName = String(obj.businessName ?? "").trim();
      const phone = this.normalizePhone(String(obj.phone ?? ""));
      const address = String(obj.address ?? "").trim();
      const city = String(obj.city ?? "").trim();
      const state = String(obj.state ?? "").trim();
      const rating = typeof obj.rating === "number" ? Math.round(obj.rating * 10) / 10 : null;
      const reviewCount = typeof obj.reviewCount === "number" ? Math.round(obj.reviewCount) : null;

      if (!businessName || !phone || phone.length < 7) continue;
      if (minRating > 0 && (rating === null || rating < minRating)) continue;

      results.push({
        businessName,
        phone,
        address,
        city,
        state,
        rating,
        reviewCount,
        hasWebsite: false,
        isClosed: false,
        sourceUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${businessName} ${city} ${state}`)}`,
        source: "groq-ai",
      });
    }

    return results;
  }
}
