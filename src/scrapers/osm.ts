import {
  BaseScraper,
  type ScraperOptions,
  type ScraperResult,
  type ProgressCallback,
} from "./base.js";

/**
 * OpenStreetMap / Overpass scraper.
 *
 * Why: This is the strongest source for "businesses without a website"
 * because OSM has explicit `website` and `phone` tags — we can ask the
 * server for "all <niche> in <city> WITHOUT a website" and it just gives
 * them to us. No HTML parsing, no anti-bot, works in every country.
 *
 * Flow:
 *   1. Geocode the city via Nominatim → (lat, lng) + bounding box.
 *   2. Build an Overpass QL query selecting nodes/ways/relations whose tags
 *      match the niche AND have no website tag AND have a phone.
 *   3. POST to a public Overpass endpoint, normalise results.
 *
 * No API key needed. We rate-limit + set a polite User-Agent as required by
 * the OSM/Nominatim usage policies.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

const USER_AGENT =
  "ByteLead/1.0 (+https://bytelead.app; lead-generation tool - contact: support@bytelead.app)";

// ── Niche → OSM tag selectors ──────────────────────────────────────────────
// Each niche maps to a list of OQL selector fragments. We also do a fuzzy
// fallback name-match if the user types something we don't recognise.
const NICHE_TAGS: Record<string, string[]> = {
  plumber: ['craft=plumber', 'shop=plumbing', 'office=plumber'],
  plumbers: ['craft=plumber', 'shop=plumbing', 'office=plumber'],
  plumbing: ['craft=plumber', 'shop=plumbing'],

  electrician: ['craft=electrician', 'office=electrician'],
  electricians: ['craft=electrician'],

  hvac: ['craft=hvac'],
  heating: ['craft=hvac', 'craft=plumber'],

  roofer: ['craft=roofer'],
  roofers: ['craft=roofer'],
  roofing: ['craft=roofer'],

  painter: ['craft=painter'],
  painters: ['craft=painter'],

  carpenter: ['craft=carpenter'],
  carpenters: ['craft=carpenter'],

  builder: ['craft=builder', 'office=contractor'],
  contractor: ['office=contractor', 'craft=builder'],
  contractors: ['office=contractor', 'craft=builder'],
  construction: ['office=contractor', 'craft=builder'],
  'construction companies': ['office=contractor', 'craft=builder'],
  'construction company': ['office=contractor', 'craft=builder'],

  locksmith: ['shop=locksmith', 'craft=locksmith'],
  locksmiths: ['shop=locksmith', 'craft=locksmith'],

  cleaner: ['shop=cleaning', 'office=cleaning_services'],
  cleaners: ['shop=cleaning', 'office=cleaning_services'],
  cleaning: ['shop=cleaning', 'office=cleaning_services'],

  landscaper: ['craft=gardener', 'shop=garden_centre'],
  landscaping: ['craft=gardener', 'shop=garden_centre'],
  gardener: ['craft=gardener'],

  mechanic: ['shop=car_repair', 'amenity=car_repair'],
  mechanics: ['shop=car_repair'],
  'auto repair': ['shop=car_repair'],
  garage: ['shop=car_repair'],

  // Health
  dentist: ['amenity=dentist', 'healthcare=dentist'],
  dentists: ['amenity=dentist', 'healthcare=dentist'],
  doctor: ['amenity=doctors', 'healthcare=doctor'],
  doctors: ['amenity=doctors', 'healthcare=doctor'],
  vet: ['amenity=veterinary'],
  veterinarian: ['amenity=veterinary'],
  pharmacy: ['amenity=pharmacy'],
  optician: ['shop=optician'],
  chiropractor: ['healthcare=chiropractor'],
  physiotherapist: ['healthcare=physiotherapist'],
  physio: ['healthcare=physiotherapist'],

  // Beauty
  'hair salon': ['shop=hairdresser'],
  'hair salons': ['shop=hairdresser'],
  'hair saloon': ['shop=hairdresser'],
  'hair saloons': ['shop=hairdresser'],
  hairdresser: ['shop=hairdresser'],
  hairdressers: ['shop=hairdresser'],
  barber: ['shop=hairdresser'],
  barbers: ['shop=hairdresser'],
  salon: ['shop=hairdresser', 'shop=beauty'],
  salons: ['shop=hairdresser', 'shop=beauty'],
  'nail salon': ['shop=beauty'],
  'nail salons': ['shop=beauty'],
  beauty: ['shop=beauty'],
  spa: ['leisure=spa', 'amenity=spa'],
  tattoo: ['shop=tattoo'],

  // Food
  restaurant: ['amenity=restaurant'],
  restaurants: ['amenity=restaurant'],
  cafe: ['amenity=cafe'],
  cafes: ['amenity=cafe'],
  coffee: ['amenity=cafe'],
  bakery: ['shop=bakery'],
  bakeries: ['shop=bakery'],
  bar: ['amenity=bar', 'amenity=pub'],
  bars: ['amenity=bar', 'amenity=pub'],
  pub: ['amenity=pub'],
  pubs: ['amenity=pub'],
  pizza: ['cuisine=pizza', 'amenity=fast_food'],
  butcher: ['shop=butcher'],

  // Pro services
  lawyer: ['office=lawyer'],
  lawyers: ['office=lawyer'],
  'law firm': ['office=lawyer'],
  attorney: ['office=lawyer'],
  accountant: ['office=accountant'],
  accountants: ['office=accountant'],
  'real estate': ['office=estate_agent'],
  realtor: ['office=estate_agent'],
  insurance: ['office=insurance'],

  // Retail
  florist: ['shop=florist'],
  florists: ['shop=florist'],
  jeweler: ['shop=jewelry'],
  jewelry: ['shop=jewelry'],
  jewellery: ['shop=jewelry'],
  bookstore: ['shop=books'],
  bookshop: ['shop=books'],
  pet: ['shop=pet'],
  'pet store': ['shop=pet'],
  'pet shop': ['shop=pet'],
  furniture: ['shop=furniture'],
  clothing: ['shop=clothes'],
  clothes: ['shop=clothes'],

  // Fitness
  gym: ['leisure=fitness_centre', 'leisure=sports_centre'],
  gyms: ['leisure=fitness_centre'],
  fitness: ['leisure=fitness_centre'],
  yoga: ['leisure=fitness_centre'],

  // Photography
  photographer: ['craft=photographer'],
  photographers: ['craft=photographer'],
  photography: ['craft=photographer'],

  // Generic (plain-English search "businesses" / "companies" — any verifiable
  // local shop/office/craft/amenity with a phone, no site).
  business: [
    'shop=hairdresser',
    'shop=car_repair',
    'shop=beauty',
    'shop=florist',
    'shop=bakery',
    'shop=butcher',
    'shop=furniture',
    'shop=optician',
    'shop=pet',
    'shop=jewelry',
    'craft=plumber',
    'craft=electrician',
    'craft=painter',
    'craft=carpenter',
    'craft=roofer',
    'office=lawyer',
    'office=accountant',
    'office=insurance',
    'office=estate_agent',
    'amenity=restaurant',
    'amenity=cafe',
    'amenity=dentist',
    'amenity=doctors',
    'amenity=veterinary',
    'amenity=pharmacy',
  ],
  businesses: [
    'shop=hairdresser',
    'shop=car_repair',
    'shop=beauty',
    'shop=florist',
    'shop=bakery',
    'shop=butcher',
    'shop=furniture',
    'shop=optician',
    'shop=pet',
    'shop=jewelry',
    'craft=plumber',
    'craft=electrician',
    'craft=painter',
    'craft=carpenter',
    'craft=roofer',
    'office=lawyer',
    'office=accountant',
    'office=insurance',
    'office=estate_agent',
    'amenity=restaurant',
    'amenity=cafe',
    'amenity=dentist',
    'amenity=doctors',
    'amenity=veterinary',
    'amenity=pharmacy',
  ],
  company: [
    'office=lawyer',
    'office=accountant',
    'office=insurance',
    'office=estate_agent',
    'office=contractor',
    'craft=plumber',
    'craft=electrician',
  ],
  companies: [
    'office=lawyer',
    'office=accountant',
    'office=insurance',
    'office=estate_agent',
    'office=contractor',
    'craft=plumber',
    'craft=electrician',
  ],
  "local business": [
    'shop=hairdresser',
    'shop=car_repair',
    'shop=beauty',
    'shop=bakery',
    'craft=plumber',
    'craft=electrician',
    'office=lawyer',
    'amenity=restaurant',
    'amenity=dentist',
  ],
  "local businesses": [
    'shop=hairdresser',
    'shop=car_repair',
    'shop=beauty',
    'shop=bakery',
    'craft=plumber',
    'craft=electrician',
    'office=lawyer',
    'amenity=restaurant',
    'amenity=dentist',
  ],
};

interface NominatimHit {
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string];
  display_name: string;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

export class OpenStreetMapScraper extends BaseScraper {
  readonly name = "openstreetmap";
  readonly country = "ALL";
  readonly baseUrl = "https://www.openstreetmap.org";

  /** Look up a city → bounding box via Nominatim. */
  private async geocode(
    city: string,
    country: string
  ): Promise<NominatimHit | null> {
    const params = new URLSearchParams({
      q: country ? `${city}, ${country}` : city,
      format: "jsonv2",
      limit: "1",
      addressdetails: "0",
    });

    try {
      const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          "Accept-Language": "en",
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return null;
      const arr = (await res.json()) as NominatimHit[];
      return arr[0] ?? null;
    } catch {
      return null;
    }
  }

  /** Resolve a free-text niche into a list of Overpass tag selectors. */
  private nicheToSelectors(niche: string): string[] {
    const key = niche.trim().toLowerCase();

    // Direct hit.
    if (NICHE_TAGS[key]) return NICHE_TAGS[key];

    // Try each word as a key (e.g. "Local Plumbers" → "plumbers").
    for (const word of key.split(/[\s,]+/)) {
      if (NICHE_TAGS[word]) return NICHE_TAGS[word];
    }

    // Fuzzy: "auto body" includes "auto" → mechanic, etc.
    for (const k of Object.keys(NICHE_TAGS)) {
      if (key.includes(k)) return NICHE_TAGS[k];
    }

    // Fallback: search by name match against common business types.
    // We avoid wildcard `shop~"."` selectors — they match too broadly and
    // cause Overpass timeouts on large cities.
    const safe = niche.replace(/["\\]/g, "");
    return [
      `name~"${safe}",i`,
    ];
  }

  /**
   * Build a single Overpass query that pulls features matching ANY of the
   * niche selectors AND have a phone tag AND have NO website tag.
   *
   * We use a bounding-box search rather than `area:` because not every city
   * has a clean admin polygon in OSM.
   */
  private buildQuery(
    bbox: [string, string, string, string],
    selectors: string[],
    limit: number,
    requireNoWebsite: boolean
  ): string {
    // Nominatim returns bbox as [south, north, west, east] *as strings*.
    const [south, north, west, east] = bbox;
    const bb = `(${south},${west},${north},${east})`;

    const phoneClause = `["phone"]`;
    const noWebClause = `["website"!~".*"]["contact:website"!~".*"]`;
    const webFilter = requireNoWebsite ? noWebClause : "";

    // For the fallback "name~" selector we don't want to require a phone
    // (we'll filter client-side); for everything else we do.
    const lines: string[] = [];
    for (const sel of selectors) {
      // Selectors like `shop=bakery` or `name~"foo",i`.
      const looksLikeNameMatch = sel.startsWith("name~");
      const where = looksLikeNameMatch
        ? `[${sel}]${webFilter}`
        : `[${sel}]${phoneClause}${webFilter}`;
      lines.push(`  nwr${where}${bb};`);
    }

    // Use longer timeout for broad queries (many selectors)
    const timeout = lines.length > 10 ? 45 : 25;
    return `
[out:json][timeout:${timeout}];
(
${lines.join("\n")}
);
out tags center ${Math.max(20, limit)};
`.trim();
  }

  private async runOverpass(query: string): Promise<OverpassElement[]> {
    let lastErr: unknown = null;

    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
            Accept: "application/json",
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(50000),
        });
        if (!res.ok) {
          lastErr = new Error(`overpass ${endpoint} → ${res.status}`);
          continue;
        }
        const data = (await res.json()) as OverpassResponse;
        return data.elements ?? [];
      } catch (err) {
        lastErr = err;
        continue;
      }
    }

    if (lastErr) console.warn("[osm] all overpass endpoints failed:", lastErr);
    return [];
  }

  private elementToResult(
    el: OverpassElement,
    fallbackCity: string,
    _country: string,
    requireNoWebsite: boolean
  ): ScraperResult | null {
    const tags = el.tags ?? {};
    const name = (tags.name || tags["name:en"] || "").trim();
    if (!name || name.length < 2) return null;

    // Phone: try several common tags.
    const rawPhone =
      tags.phone ||
      tags["contact:phone"] ||
      tags["phone:mobile"] ||
      tags["contact:mobile"] ||
      "";
    const phone = this.normalizePhone(rawPhone);
    if (!phone) return null;

    const siteUrl =
      (tags.website || tags["contact:website"] || tags.url || "").trim();
    const hasWebsite = !!siteUrl;
    if (requireNoWebsite && hasWebsite) return null;

    // Address.
    const street = [tags["addr:housenumber"], tags["addr:street"]]
      .filter(Boolean)
      .join(" ");
    const city = (tags["addr:city"] || tags["addr:town"] || fallbackCity || "").trim();
    const state = (tags["addr:state"] || tags["addr:province"] || "").trim();
    const postcode = tags["addr:postcode"] || "";
    const address = [street, [postcode, city].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");

    const sourceUrl = hasWebsite
      ? siteUrl.slice(0, 500)
      : `https://www.openstreetmap.org/${el.type}/${el.id}`;

    return {
      businessName: name.slice(0, 120),
      phone,
      address: address.slice(0, 200),
      city: city.slice(0, 80),
      state: state.slice(0, 40),
      rating: null,
      reviewCount: null,
      hasWebsite,
      isClosed: false,
      sourceUrl,
      source: this.name,
    };
  }

  async scrape(
    options: ScraperOptions,
    onProgress: ProgressCallback
  ): Promise<ScraperResult[]> {
    await onProgress(5, "OSM: geocoding city…", 0);

    // Nominatim enforces max 1 request/second. When multi-city fan-out
    // calls this scraper in a loop, we must wait to avoid 429s.
    await this.sleep(1100, 1500);

    const country = (options.country ?? "").toUpperCase();
    const hit = await this.geocode(options.location, country);
    if (!hit) {
      await onProgress(100, "OSM: city not found", 0);
      return [];
    }

    const selectors = this.nicheToSelectors(options.niche);
    const requireNoWebsite = options.requireNoWebsite === true;
    // Multi-city runs hit Overpass many times — keep each query light.
    const targetCount = options.multiCity
      ? Math.min(80, Math.max(15, options.maxPages * 18))
      : Math.min(300, Math.max(20, options.maxPages * 25));
    const query = this.buildQuery(hit.boundingbox, selectors, targetCount, requireNoWebsite);

    await onProgress(25, "OSM: querying Overpass…", 0);
    const elements = await this.runOverpass(query);

    await onProgress(85, "OSM: normalising…", 0);

    const seen = new Set<string>();
    const out: ScraperResult[] = [];
    for (const el of elements) {
      const r = this.elementToResult(el, options.location, country, requireNoWebsite);
      if (!r) continue;
      const key = `${r.businessName.toLowerCase()}|${r.phone.replace(/\D/g, "")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      if (out.length >= targetCount) break;
    }

    await onProgress(100, `OSM: ${out.length} leads`, out.length);
    return out;
  }
}
