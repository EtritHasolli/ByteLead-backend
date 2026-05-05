import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { getProfile } from "../db/queries.js";
import { checkChatLimit } from "../lib/rate-limit.js";

export const aiChatRouter = Router();

const GROQ_MODEL = "llama-3.3-70b-versatile";
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
        locations: { type: "array", items: { type: "object", properties: { city: { type: "string" }, country: { type: "string" } }, required: ["city"] }, maxItems: 7 },
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

aiChatRouter.post("/", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const rl = checkChatLimit(userId);
    if (!rl.allowed) return res.json({ content: "You're sending messages too quickly. Please wait.", action: null });

    const profile = await getProfile(userId);
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.json({ content: "ByteBot is not configured. Add GROQ_API_KEY to .env.", action: null });

    const { messages: rawMessages } = req.body;
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) return res.status(400).json({ content: "No messages provided.", action: null });

    const incomingMessages = rawMessages.filter((m: any) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
    const maxPages = profile.role === "admin" ? 20 : (PLAN_MAX_PAGES[profile.plan] ?? 3);

    const groqMessages = [
      { role: "system", content: buildSystemPrompt(profile) },
      ...incomingMessages.map((m: any) => ({ role: m.role, content: m.content })),
    ];

    const res1 = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: GROQ_MODEL, messages: groqMessages, tools: TOOLS, tool_choice: "auto", temperature: 0.6, max_tokens: 1024 }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res1.ok) {
      console.error("Groq error:", await res1.text().catch(() => ""));
      return res.json({ content: "Sorry, I ran into an error. Please try again." });
    }

    const data1 = await res1.json();
    const assistantMsg = data1.choices?.[0]?.message;

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

        return res.json({
          content: `I'll search for **${niche}** in ${targetLabel}. Press **Start Search** below to run it.`,
          action: { type: "search", ...searchParams },
        });
      }
    }

    return res.json({ content: assistantMsg?.content ?? "Sorry, no response.", action: null });
  } catch (err) {
    console.error("ai-chat error:", err);
    return res.json({ content: "Something went wrong. Please try again." });
  }
});
