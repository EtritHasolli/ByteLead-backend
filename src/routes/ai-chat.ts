import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { getProfile } from "../db/queries.js";
import { checkChatLimit } from "../lib/rate-limit.js";

export const aiChatRouter = Router();

/** Override with `GROQ_MODEL` in .env if needed. */
const GROQ_MODEL_PRIMARY =
  (typeof process.env.GROQ_MODEL === "string" && process.env.GROQ_MODEL.trim()) ||
  "llama-3.3-70b-versatile";
/** Used when the primary model errors (capacity, transient 5xx, some 4xx). */
const GROQ_MODEL_FALLBACK = "llama-3.1-8b-instant";

const PLAN_MAX_PAGES: Record<string, number> = { free: 3, pro: 10, agency: 20 };

function buildSystemPrompt(profile: { plan: string; role: string; credits_remaining: number; credits_monthly_limit: number }): string {
  const isAdmin = profile.role === "admin";
  const isUnlimited = isAdmin || profile.plan === "agency";
  const creditsInfo = isUnlimited ? "Unlimited credits" : `${profile.credits_remaining} reveals remaining out of ${profile.credits_monthly_limit}`;
  const maxPages = isAdmin ? 20 : (PLAN_MAX_PAGES[profile.plan] ?? 3);

  return `You are ByteBot, a lead generation AI assistant. User plan: ${profile.plan}${isAdmin ? " (Admin)" : ""}. Credits: ${creditsInfo}. Max pages: ${maxPages}.

You can search for local businesses by calling the search_leads tool. Only call it when the user explicitly names a business type AND a location.

Rules:
- Never invent niches or locations
- Set requireNoWebsite: true only when explicitly asked
- For regions/countries, expand to 3-7 representative cities
- Be concise and helpful`;
}

const TOOLS = [{
  type: "function",
  function: {
    name: "search_leads",
    description: "Search for local businesses",
    parameters: {
      type: "object",
      properties: {
        niche: { type: "string" },
        location: { type: "string" },
        locations: { type: "array", description: "Multi-city fan-out (1–7 entries). Use when the user gives a region/country/continent (e.g. 'Europe', 'Kosovo', 'California'). Pick representative business hubs yourself.", items: { type: "object", properties: { city: { type: "string" }, country: { type: "string" } }, required: ["city"] } },
        country: { type: "string" },
        maxPages: { type: "number" },
        minRating: { type: "number" },
        limit: { type: "number" },
        requireNoWebsite: { type: "boolean" },
      },
      required: ["niche"],
    },
  },
}];

function groqFailureUserMessage(status: number, bodyText: string): string {
  let apiMsg = "";
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string } };
    if (j?.error?.message) apiMsg = j.error.message;
  } catch { /* ignore */ }
  if (status === 401 || /invalid api key|unauthorized/i.test(apiMsg)) {
    return "ByteBot can't reach the AI service — your **GROQ_API_KEY** may be missing or invalid. Check `.env` and restart the server.";
  }
  if (status === 429 || /rate limit/i.test(apiMsg)) {
    return "The AI service is rate-limiting requests. Please wait a few seconds and try again.";
  }
  if (status === 498 || /capacity|flex tier/i.test(apiMsg)) {
    return "The AI service is temporarily at capacity. Please try again in a moment.";
  }
  if (process.env.NODE_ENV === "development" && apiMsg) {
    return `Sorry, the AI request failed (${status}). ${apiMsg}`;
  }
  return "Sorry, I ran into an error. Please try again.";
}

type GroqMessage = { role: string; content: string };

async function groqChatCompletion(apiKey: string, model: string, groqMessages: GroqMessage[]): Promise<Response> {
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: groqMessages, tools: TOOLS, tool_choice: "auto", temperature: 0.6, max_tokens: 2048 }),
    signal: AbortSignal.timeout(60_000),
  });
}

aiChatRouter.post("/", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const rl = checkChatLimit(userId);
    if (!rl.allowed) return res.json({ content: "You're sending messages too quickly. Please wait.", action: null });

    const profile = await getProfile(userId);
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) return res.json({ content: "ByteBot is not configured. Add GROQ_API_KEY to .env.", action: null });

    const { messages: rawMessages } = req.body;
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) return res.status(400).json({ content: "No messages provided.", action: null });

    const incomingMessages = rawMessages.filter((m: unknown): m is GroqMessage => {
      if (typeof m !== "object" || m === null) return false;
      const rec = m as Record<string, unknown>;
      return (rec.role === "user" || rec.role === "assistant") && typeof rec.content === "string" && (rec.content as string).length > 0;
    });
    if (incomingMessages.length === 0) return res.status(400).json({ content: "No valid messages to process. Please send your message again.", action: null });
    const maxPages = profile.role === "admin" ? 20 : (PLAN_MAX_PAGES[profile.plan] ?? 3);

    const groqMessages = [
      { role: "system", content: buildSystemPrompt(profile) },
      ...incomingMessages.map((m: any) => ({ role: m.role, content: m.content })),
    ];

    // First call — may return a tool call (primary model, then fallback on transient errors).
    let res1 = await groqChatCompletion(apiKey, GROQ_MODEL_PRIMARY, groqMessages);
    let errBody = "";

    if (!res1.ok) {
      errBody = await res1.text().catch(() => "");
      console.error("[ai-chat] Groq primary error", GROQ_MODEL_PRIMARY, res1.status, errBody);

      const retryable =
        GROQ_MODEL_FALLBACK !== GROQ_MODEL_PRIMARY &&
        res1.status !== 401 &&
        [400, 422, 429, 498, 500, 502, 503].includes(res1.status);

      if (retryable) {
        res1 = await groqChatCompletion(apiKey, GROQ_MODEL_FALLBACK, groqMessages);
        if (!res1.ok) {
          const err2 = await res1.text().catch(() => "");
          console.error("[ai-chat] Groq fallback error", GROQ_MODEL_FALLBACK, res1.status, err2);
          return res.json({ content: groqFailureUserMessage(res1.status, err2 || errBody) });
        }
      } else {
        return res.json({ content: groqFailureUserMessage(res1.status, errBody) });
      }
    }

    let data1: unknown;
    try {
      data1 = await res1.json();
    } catch {
      console.error("[ai-chat] Groq response was not valid JSON");
      return res.json({ content: "Sorry, the AI service returned an unexpected response. Please try again." });
    }

    if (data1 && typeof data1 === "object" && "error" in data1 && (data1 as any).error) {
      console.error("[ai-chat] Groq response body error", (data1 as any).error);
      return res.json({ content: groqFailureUserMessage(422, JSON.stringify((data1 as any).error)) });
    }

    const assistantMsg = (data1 as any)?.choices?.[0]?.message;

    if (assistantMsg?.tool_calls?.length > 0) {
      const toolCall = assistantMsg.tool_calls[0];
      if (toolCall.function.name === "search_leads") {
        let params: any;
        try { params = JSON.parse(toolCall.function.arguments); } catch { return res.json({ content: "I couldn't parse those search parameters." }); }

        const niche = (params.niche ?? "").trim();
        if (!niche || /^(businesses?|leads?|companies|shops?)$/i.test(niche)) {
          return res.json({ content: "What kind of business should I look for?", action: null });
        }

        const cleanedLocations = (params.locations ?? []).filter((l: any) => l?.city?.trim().length >= 2).map((l: any) => ({ city: l.city.trim(), country: l.country?.toUpperCase().slice(0, 2) })).slice(0, 7);
        const singleLocation = (params.location ?? "").trim();

        if (cleanedLocations.length === 0 && !singleLocation) {
          return res.json({ content: "Where should I search? Tell me a city, region, or country.", action: null });
        }

        const searchParams = {
          niche,
          country: params.country?.toUpperCase().slice(0, 2) || "US",
          maxPages: Math.min(Math.max(1, params.maxPages ?? 3), maxPages),
          minRating: Math.min(Math.max(0, params.minRating ?? 0), 5),
          requireNoWebsite: params.requireNoWebsite === true,
          ...(cleanedLocations.length > 0 ? { locations: cleanedLocations } : { location: singleLocation }),
          ...(params.limit ? { limit: Math.min(500, Math.max(1, Math.round(params.limit))) } : {}),
        };

        const targetLabel = cleanedLocations.length > 0
          ? `${cleanedLocations.length} cities`
          : singleLocation;

        const lastUserMsg = [...incomingMessages].reverse().find((m: any) => m.role === "user")?.content ?? "";

        return res.json({
          content: `I'll search for **${niche}** in ${targetLabel}. Press **Start Search** below to run it.`,
          action: { type: "search", ...searchParams, triggerQuery: lastUserMsg },
        });
      }
    }

    return res.json({ content: assistantMsg?.content ?? "Sorry, no response.", action: null });
  } catch (err) {
    console.error("ai-chat error:", err);
    return res.json({ content: "Something went wrong. Please try again." });
  }
});
