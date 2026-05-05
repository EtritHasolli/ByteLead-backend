import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import {
  BaseScraper,
  type ScraperOptions,
  type ScraperResult,
  type ProgressCallback,
} from "./base.js";
import { fetchHtml } from "./scrapedo.js";

/**
 * Bing local-business scraper.
 *
 * Strategy: only mine Bing's "local pack" / entity panels (`b_localPoi`,
 * `b_entityTP`, `lc_content`). Plain organic results (`li.b_algo`) are
 * unreliable — phone numbers there often belong to a different company than
 * the heading, which leads to bogus leads. We'd rather return *fewer real*
 * leads than *more fake ones*.
 */
const DOMAIN_RX =
  /\b[a-z0-9][-a-z0-9]*\.(com|net|org|io|co|us|biz|info|me|dental|health|care|clinic|law|legal|plumbing|hvac|repair|services|pro|solutions|group|site|online|shop|store)\b/i;

const CLOSED_RX =
  /(permanently closed|temporarily closed|out of business|closed permanently)/i;

/** Reserved/fictional phone prefixes — instant reject. */
const FICTITIOUS_PHONE_RX = /\b555[-\s]?01\d\d\b/;

/** Known Bing market codes. For anything else we fall back to en-US which
 *  Bing accepts globally; results are still local because the query itself
 *  contains the city name. */
const COUNTRY_TO_MKT: Record<string, string> = {
  US: "en-US", UK: "en-GB", GB: "en-GB",
  DE: "de-DE", FR: "fr-FR", IT: "it-IT", ES: "es-ES", NL: "nl-NL",
  PL: "pl-PL", PT: "pt-PT", SE: "sv-SE", NO: "no-NO", DK: "da-DK",
  FI: "fi-FI", CH: "de-CH", AT: "de-AT", BE: "nl-BE", IE: "en-IE",
  GR: "el-GR", CZ: "cs-CZ", HU: "hu-HU", RO: "ro-RO", RU: "ru-RU",
  TR: "tr-TR", UA: "uk-UA", CA: "en-CA", AU: "en-AU", NZ: "en-NZ",
  IN: "en-IN", JP: "ja-JP", KR: "ko-KR", MX: "es-MX", BR: "pt-BR",
  AR: "es-AR", AE: "ar-AE", SA: "ar-SA", IL: "he-IL", ZA: "en-ZA",
};

/** Country dialling codes — used to prepend "+CC " when scrapers return a
 *  bare local-format phone number. Comprehensive enough for the regions our
 *  AI is likely to hand us. Unknown countries → no prefix added. */
const COUNTRY_DEFAULT_DIAL: Record<string, string> = {
  US: "+1", CA: "+1",
  UK: "+44", GB: "+44", IE: "+353",
  DE: "+49", AT: "+43", CH: "+41", LI: "+423", LU: "+352",
  FR: "+33", BE: "+32", NL: "+31",
  IT: "+39", ES: "+34", PT: "+351", GR: "+30",
  PL: "+48", CZ: "+420", SK: "+421", HU: "+36", RO: "+40", BG: "+359",
  SE: "+46", NO: "+47", DK: "+45", FI: "+358", IS: "+354",
  AL: "+355", XK: "+383", RS: "+381", HR: "+385", BA: "+387", ME: "+382",
  MK: "+389", SI: "+386",
  RU: "+7", UA: "+380", BY: "+375", LT: "+370", LV: "+371", EE: "+372",
  TR: "+90", IL: "+972", AE: "+971", SA: "+966", QA: "+974", KW: "+965",
  EG: "+20", ZA: "+27", NG: "+234", KE: "+254", MA: "+212",
  AU: "+61", NZ: "+64",
  IN: "+91", PK: "+92", BD: "+880", LK: "+94",
  JP: "+81", KR: "+82", CN: "+86", HK: "+852", TW: "+886", SG: "+65",
  TH: "+66", VN: "+84", ID: "+62", PH: "+63", MY: "+60",
  MX: "+52", BR: "+55", AR: "+54", CL: "+56", CO: "+57", PE: "+51",
};

export class BingScraper extends BaseScraper {
  readonly name = "bing";
  readonly country = "ALL";
  readonly baseUrl = "https://www.bing.com";

  private buildUrl(niche: string, location: string, country: string, page: number): string {
    const q = encodeURIComponent(`${niche} in ${location}`);
    const mkt = COUNTRY_TO_MKT[country] ?? "en-US";
    const first = (page - 1) * 10 + 1;
    return `${this.baseUrl}/search?q=${q}&mkt=${mkt}&first=${first}`;
  }

  /** Bing Maps "see all" page — pure local-business listings. */
  private buildMapsUrl(niche: string, location: string, country: string): string {
    const q = encodeURIComponent(`${niche} ${location}`);
    const mkt = COUNTRY_TO_MKT[country] ?? "en-US";
    return `https://www.bing.com/maps?q=${q}&mkt=${mkt}`;
  }

  private locationParts(location: string): { city: string; state: string } {
    const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
    return {
      city: parts[0] ?? "",
      state: parts[1] ?? "",
    };
  }

  /** Find the first phone number that is reasonably formatted *and* not in a
   *  fictional 555 range. Returns "" if no good candidate found. */
  private extractPhone(text: string): string {
    // Match phone-shaped substrings; prefer ones with explicit country codes.
    const candidates =
      text.match(/(?:\+\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]?){2,4}\d{2,4}/g) ?? [];

    for (const c of candidates) {
      if (FICTITIOUS_PHONE_RX.test(c)) continue;
      const cleaned = this.normalizePhone(c);
      if (cleaned) return cleaned;
    }
    return "";
  }

  /** Extract a likely business heading from a single block. */
  private extractBusinessName($el: cheerio.Cheerio<AnyNode>): string {
    // Local-pack POI titles and entity panel titles use these classes.
    const candidates = [
      ".b_lcptopdt h2 a",
      ".b_lcrhsdt h2 a",
      ".b_localTitle a",
      ".b_localPoi .b_title",
      ".b_entityTP .b_title",
      ".b_entityTitle",
      ".b_focusTextLarge",
      ".lc_content h2 a",
      // Bing Maps
      ".listings-item .title",
      ".taskItemEntity .title",
      ".b_factrow .b_title",
      "h2 a",
      "h3 a",
    ];
    for (const sel of candidates) {
      const txt = $el.find(sel).first().text().trim();
      if (txt && txt.length > 1) return txt.replace(/\s+/g, " ").slice(0, 120);
    }
    return "";
  }

  private parse(
    html: string,
    fallbackLocation: string,
    country: string,
    minRating: number,
    requireNoWebsite: boolean
  ): ScraperResult[] {
    if (!html) return [];
    const $ = cheerio.load(html);
    const results: ScraperResult[] = [];
    const seenPhones = new Set<string>();
    const seenNames = new Set<string>();
    const { city, state } = this.locationParts(fallbackLocation);
    const dial = COUNTRY_DEFAULT_DIAL[country] ?? "";

    // ONLY trust local-pack, entity-panel, and Bing Maps listing containers.
    // We deliberately skip generic `li.b_algo` because phone-name pairing is
    // unreliable there.
    const blocks = $(
      [
        // Classic Bing local pack
        "div.b_localPoi",
        "div.b_localPoi_singlePoi",
        "div.b_entityTP",
        "div.lc_content",
        ".b_lcptopdt",
        // Bing Maps "venue" cards (rendered into the SSR'd HTML)
        ".listings-item",
        ".taskItemEntity",
        "[data-entity*='LocalBusiness']",
        ".b_vList li.b_ans",
      ].join(", ")
    ).toArray();

    for (const el of blocks) {
      try {
        const $el = $(el);
        const text = $el.text();
        if (CLOSED_RX.test(text.toLowerCase())) continue;

        const hasWebsiteLink = $el
          .find("a[data-h*='website' i], a[href][aria-label*='website' i], a:contains('Website')")
          .length > 0;
        const hasWebsiteText = DOMAIN_RX.test(text);
        const hasWebsite = hasWebsiteLink || hasWebsiteText;
        if (requireNoWebsite && hasWebsite) continue;

        // Heading + phone MUST come from this same block.
        const businessName = this.extractBusinessName($el);
        if (!businessName) continue;

        // Skip generic, non-business titles.
        if (/^(map|directions|hours|see results|reviews|website)$/i.test(businessName)) continue;

        const nameKey = businessName.toLowerCase();
        if (seenNames.has(nameKey)) continue;

        const phone = this.extractPhone(text);
        if (!phone) continue;

        const phoneKey = phone.replace(/\D/g, "");
        if (seenPhones.has(phoneKey)) continue;

        // For non-US locales, force a leading + or country code on bare phones.
        let displayPhone = phone;
        if (!displayPhone.startsWith("+") && country !== "US" && dial) {
          // Local format like "041 555 0754" — prepend country code.
          const stripped = displayPhone.replace(/^0+/, "").trim();
          displayPhone = `${dial} ${stripped}`;
        }

        // Address — must look like a real street address adjacent to the heading.
        let address = "";
        const addrEl = $el
          .find(".b_address, .b_localPoi_address, [data-cid*='address' i]")
          .first()
          .text()
          .trim();
        if (addrEl) {
          address = addrEl.replace(/\s+/g, " ").slice(0, 200);
        }

        // Rating "4.5 (123)" if Bing exposes one.
        let rating: number | null = null;
        let reviewCount: number | null = null;
        const ratingMatch = text.match(/([0-5](?:\.\d)?)\s*(?:stars?|out of 5|\(\s*(\d+)\s*\))/i);
        if (ratingMatch) {
          rating = parseFloat(ratingMatch[1]);
          if (ratingMatch[2]) reviewCount = parseInt(ratingMatch[2], 10);
        }
        if (minRating > 0 && (rating === null || rating < minRating)) continue;

        seenPhones.add(phoneKey);
        seenNames.add(nameKey);

        results.push({
          businessName,
          phone: displayPhone,
          address,
          city,
          state,
          rating,
          reviewCount,
          hasWebsite,
          isClosed: false,
          sourceUrl: `https://www.bing.com/search?q=${encodeURIComponent(`${businessName} ${fallbackLocation}`)}`,
          source: this.name,
        });
      } catch {
        /* skip malformed block */
      }
    }

    return results;
  }

  async scrape(
    options: ScraperOptions,
    onProgress: ProgressCallback
  ): Promise<ScraperResult[]> {
    const all: ScraperResult[] = [];
    const country = options.country ?? "US";
    const requireNoWebsite = options.requireNoWebsite === true;

    // ── Pass 1: Bing Maps (rich, local-business focused) ──────────────────
    {
      await onProgress(5, "Bing Maps…", all.length);
      const mapsUrl = this.buildMapsUrl(options.niche, options.location, country);
      const html = await fetchHtml(mapsUrl, {
        geoCode: country.toLowerCase(),
        render: true, // Bing Maps SSR is sparse without JS render.
      });
      const mapsResults = this.parse(
        html,
        options.location,
        country,
        options.minRating,
        requireNoWebsite
      );
      all.push(...mapsResults);
    }

    // ── Pass 2: standard Bing search pages ────────────────────────────────
    for (let page = 1; page <= options.maxPages; page++) {
      const url = this.buildUrl(options.niche, options.location, country, page);
      const pct = Math.min(95, 15 + Math.round((page / options.maxPages) * 80));
      await onProgress(pct, `Bing page ${page}/${options.maxPages}`, all.length);

      const html = await fetchHtml(url, { geoCode: country.toLowerCase() });
      const pageResults = this.parse(
        html,
        options.location,
        country,
        options.minRating,
        requireNoWebsite
      );
      all.push(...pageResults);

      if (pageResults.length === 0 && page > 1) break;
      if (page < options.maxPages) await this.sleep(700, 1400);
    }

    // De-dup by phone in case Maps + Search returned the same listing.
    const seenPhones = new Set<string>();
    const deduped = all.filter((r) => {
      const key = r.phone.replace(/\D/g, "");
      if (!key || seenPhones.has(key)) return false;
      seenPhones.add(key);
      return true;
    });

    await onProgress(100, "Bing complete", deduped.length);
    return deduped;
  }
}
