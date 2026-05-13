const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const BATCH_SIZE = 10;

interface LeadInfo {
  businessName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  rating: number | null;
  reviewCount: number | null;
  niche?: string;
  userProfileContext?: string | null;
}

interface LeadInsights {
  description: string;
  pitch: string;
}

/** Per-process LRU cache — last 500 insight pairs. */
const insightCache = new Map<string, LeadInsights>();
const CACHE_LIMIT = 500;

function cacheKey(lead: LeadInfo): string {
  return `${lead.businessName.toLowerCase().trim()}|${(lead.city || "").toLowerCase().trim()}`;
}

function rememberInsight(lead: LeadInfo, value: LeadInsights): void {
  const key = cacheKey(lead);
  if (insightCache.has(key)) insightCache.delete(key);
  insightCache.set(key, value);
  if (insightCache.size > CACHE_LIMIT) {
    const oldest = insightCache.keys().next().value;
    if (oldest) insightCache.delete(oldest);
  }
}

function stripFences(s: string): string {
  let out = s.trim();
  if (out.startsWith("```")) {
    out = out.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return out;
}

/** Fetch with retry: respects Retry-After on 429, exponential backoff on 5xx. */
async function fetchGroq(body: object, attempt = 0): Promise<Response | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (res.ok) return res;

    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 8000)
        : Math.min(500 * 2 ** attempt, 4000);
      console.warn(`Groq ${res.status}, retrying in ${wait}ms (attempt ${attempt + 1}/3)`);
      await new Promise((r) => setTimeout(r, wait));
      return fetchGroq(body, attempt + 1);
    }

    console.warn("Groq API error:", res.status);
    return null;
  } catch (err) {
    console.warn("Groq fetch threw:", err);
    return null;
  }
}

function generateFallbackInsights(lead: LeadInfo): LeadInsights {
  const name = lead.businessName.toLowerCase();
  let businessType = "local business";
  let service = "services";

  if (name.includes("plumb")) {
    businessType = "plumbing company"; service = "plumbing repairs, installations, and emergency fixes";
  } else if (name.includes("electric")) {
    businessType = "electrical contractor"; service = "electrical wiring, repairs, and installations";
  } else if (name.includes("hvac") || name.includes("heating") || name.includes("cooling") || name.includes("air")) {
    businessType = "HVAC company"; service = "heating, cooling, and ventilation services";
  } else if (name.includes("dental") || name.includes("dentist")) {
    businessType = "dental practice"; service = "dental care including cleanings, fillings, and cosmetic dentistry";
  } else if (name.includes("salon") || name.includes("hair") || name.includes("barber") || name.includes("beauty")) {
    businessType = "hair salon/barbershop"; service = "haircuts, styling, and beauty services";
  } else if (name.includes("restaurant") || name.includes("grill") || name.includes("kitchen") || name.includes("cafe") || name.includes("diner")) {
    businessType = "restaurant"; service = "dining and food services";
  } else if (name.includes("auto") || name.includes("car") || name.includes("mechanic") || name.includes("repair")) {
    businessType = "auto repair shop"; service = "vehicle maintenance and repair services";
  } else if (name.includes("law") || name.includes("attorney") || name.includes("legal")) {
    businessType = "law firm"; service = "legal services and representation";
  } else if (name.includes("roof")) {
    businessType = "roofing company"; service = "roof installation, repair, and maintenance";
  } else if (name.includes("landscap") || name.includes("lawn") || name.includes("garden")) {
    businessType = "landscaping company"; service = "lawn care, landscaping, and outdoor maintenance";
  } else if (name.includes("clean")) {
    businessType = "cleaning service"; service = "residential and commercial cleaning";
  } else if (name.includes("pet") || name.includes("vet") || name.includes("animal")) {
    businessType = "pet services / veterinary"; service = "pet care and veterinary services";
  }

  const description = `${lead.businessName} is a ${businessType} located in ${lead.city}${lead.state ? ", " + lead.state : ""}. They provide ${service} to local customers in the area.`;

  const pitches = [
    `Hi! I noticed ${lead.businessName} doesn't have a website yet. A lot of people in ${lead.city} search online for ${businessType}s — I'd love to help you capture that traffic with a clean, professional site.`,
    `Hey there! I'm reaching out because ${lead.businessName} came up in my research. Most customers Google before they call, and a website could help you stand out from other ${businessType}s in ${lead.city}.`,
    `Hi! I help local ${businessType}s like ${lead.businessName} get found online. With your ${lead.rating ? `${lead.rating}-star rating` : "great reputation"}, a website would really help showcase your work to new customers.`,
  ];

  const pitch = pitches[Math.floor(Math.random() * pitches.length)];
  return { description, pitch };
}

/* ─── Single-lead path ──────────────────────────────────────────────────── */

export async function generateLeadInsights(lead: LeadInfo, forceRegenerate = false): Promise<LeadInsights> {
  if (!forceRegenerate) {
    const cached = insightCache.get(cacheKey(lead));
    if (cached) return cached;
  }

  const userContextStr = lead.userProfileContext ? `\nAbout the sender: ${lead.userProfileContext}` : "";

  const prompt = `You are a sales assistant helping web designers reach out to local businesses that need a website.

Business:
- Name: ${lead.businessName}
- Location: ${lead.city}, ${lead.state}
- Address: ${lead.address}
- Phone: ${lead.phone}
${lead.rating ? `- Rating: ${lead.rating}/5 stars` : ""}
${lead.reviewCount ? `- Reviews: ${lead.reviewCount}` : ""}
${lead.niche ? `- Industry: ${lead.niche}` : ""}${userContextStr}

Return a single JSON object: {"description": "...", "pitch": "..."}
- description: 1-2 sentences describing what this business likely does and who their customers are.
- pitch: A natural, friendly cold-outreach opener (max 2 sentences) that mentions how a website would help THIS business specifically. Not salesy.`;

  const res = await fetchGroq({
    model: GROQ_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 300,
    response_format: { type: "json_object" },
  });

  if (!res) {
    const fb = generateFallbackInsights(lead);
    rememberInsight(lead, fb);
    return fb;
  }

  try {
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(stripFences(content));
    const fb = generateFallbackInsights(lead);
    const value: LeadInsights = {
      description: parsed.description || fb.description,
      pitch: parsed.pitch || fb.pitch,
    };
    rememberInsight(lead, value);
    return value;
  } catch (err) {
    console.warn("Groq parse failed:", err);
    const fb = generateFallbackInsights(lead);
    rememberInsight(lead, fb);
    return fb;
  }
}

/* ─── Batched bulk path ─────────────────────────────────────────────────── */

export async function generateBulkInsights(leads: LeadInfo[]): Promise<Map<string, LeadInsights>> {
  const results = new Map<string, LeadInsights>();
  const todo: LeadInfo[] = [];

  for (const lead of leads) {
    const cached = insightCache.get(cacheKey(lead));
    if (cached) {
      results.set(lead.businessName, cached);
    } else {
      todo.push(lead);
    }
  }

  if (todo.length === 0) return results;

  const batches: LeadInfo[][] = [];
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    batches.push(todo.slice(i, i + BATCH_SIZE));
  }

  const settled = await Promise.all(batches.map((b) => runBatch(b)));

  for (const map of settled) {
    for (const [name, insight] of map.entries()) {
      results.set(name, insight);
    }
  }

  return results;
}

async function runBatch(batch: LeadInfo[]): Promise<Map<string, LeadInsights>> {
  const out = new Map<string, LeadInsights>();

  const numbered = batch.map((lead, i) => {
    const ratingLine = lead.rating ? ` rating ${lead.rating}/5` : "";
    const reviewLine = lead.reviewCount ? ` (${lead.reviewCount} reviews)` : "";
    const nicheLine = lead.niche ? ` industry: ${lead.niche};` : "";
    return `${i + 1}. ${lead.businessName} — ${lead.city}, ${lead.state};${nicheLine}${ratingLine}${reviewLine}`;
  }).join("\n");

  const userContextStr = batch[0]?.userProfileContext
    ? `\nAbout the sender: ${batch[0].userProfileContext}`
    : "";

  const prompt = `You are a sales assistant helping web designers reach out to local businesses that don't have websites.

Below are ${batch.length} businesses. For EACH one, write:
  - description: 1-2 sentences about what they likely do and their customers.
  - pitch: a natural, friendly cold-outreach opener (max 2 sentences) mentioning how a website would help THAT specific business. Not salesy.${userContextStr}

Respond with a SINGLE JSON object of this exact shape (no extra prose, no markdown):
{
  "items": [
    { "index": 1, "description": "...", "pitch": "..." },
    { "index": 2, "description": "...", "pitch": "..." }
  ]
}

Businesses:
${numbered}`;

  const res = await fetchGroq({
    model: GROQ_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 220 * batch.length + 200,
    response_format: { type: "json_object" },
  });

  if (!res) {
    for (const lead of batch) {
      const fb = generateFallbackInsights(lead);
      rememberInsight(lead, fb);
      out.set(lead.businessName, fb);
    }
    return out;
  }

  try {
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(stripFences(content));
    const items = Array.isArray(parsed?.items) ? parsed.items : [];

    for (const lead of batch) {
      const fb = generateFallbackInsights(lead);
      const idx = batch.indexOf(lead) + 1;
      const found = items.find(
        (it: { index?: number; description?: string; pitch?: string }) =>
          Number(it.index) === idx
      );
      const value: LeadInsights = {
        description: found?.description?.trim() || fb.description,
        pitch: found?.pitch?.trim() || fb.pitch,
      };
      rememberInsight(lead, value);
      out.set(lead.businessName, value);
    }
    return out;
  } catch (err) {
    console.warn("Groq bulk parse failed, falling back:", err);
    for (const lead of batch) {
      const fb = generateFallbackInsights(lead);
      rememberInsight(lead, fb);
      out.set(lead.businessName, fb);
    }
    return out;
  }
}
