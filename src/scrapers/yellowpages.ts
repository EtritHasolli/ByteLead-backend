import * as cheerio from "cheerio";
import {
  BaseScraper,
  type ScraperOptions,
  type ScraperResult,
  type ProgressCallback,
} from "./base.js";
import { fetchHtml, isScrapeDoConfigured } from "./scrapedo.js";

const DOMAIN_RX =
  /\b[a-z0-9][-a-z0-9]*\.(com|net|org|io|co|us|biz|info|me|dental|health|care|clinic|law|legal|plumbing|hvac|repair|services|pro|solutions|group|site|online|shop|store)\b/i;

const CLOSED_RX =
  /(permanently closed|temporarily closed|out of business|this business has closed|closed permanently)/i;

export class YellowPagesScraper extends BaseScraper {
  readonly name = "yellowpages";
  readonly country = "US";
  readonly baseUrl = "https://www.yellowpages.com";

  private buildSearchUrl(niche: string, location: string, page: number): string {
    const params = new URLSearchParams({
      search_terms: niche,
      geo_location_terms: location,
    });
    let url = `${this.baseUrl}/search?${params.toString()}`;
    if (page > 1) url += `&page=${page}`;
    return url;
  }

  private parseListings(
    html: string,
    minRating: number,
    requireNoWebsite: boolean
  ): ScraperResult[] {
    if (!html) return [];
    const $ = cheerio.load(html);
    const results: ScraperResult[] = [];
    const seenPhones = new Set<string>();

    $(".search-results .result, .srp-listing, .v-card").each((_, el) => {
      try {
        const $el = $(el);
        if ($el.parents(".search-results .result, .srp-listing").length > 0) return;
        if ($el.hasClass("ad") || $el.find(".ad-label").length > 0) return;

        const listingText = $el.text().toLowerCase();
        if (CLOSED_RX.test(listingText)) return;

        const nameEl = $el.find(".business-name a, .n a, h2 a").first();
        const businessName = nameEl.text().trim();
        if (!businessName) return;

        const phone = this.normalizePhone(
          $el.find(".phones.phone.primary, .phone, .phones").first().text()
        );
        if (!phone || phone.length < 7) return;

        const phoneKey = phone.replace(/\D/g, "");
        if (seenPhones.has(phoneKey)) return;
        seenPhones.add(phoneKey);

        const hasWebsiteLink =
          $el.find(".track-visit-website, a.website, .links a[href*='http']").length > 0;
        const hasWebsiteText = DOMAIN_RX.test(listingText);
        const hasWebsite = hasWebsiteLink || hasWebsiteText;
        if (requireNoWebsite && hasWebsite) return;

        const streetAddress = $el
          .find(".street-address, .adr .street-address")
          .first()
          .text()
          .trim();
        const locality = $el
          .find(".locality, .adr .locality")
          .first()
          .text()
          .trim();

        let city = "";
        let state = "";
        if (locality) {
          const parts = locality.split(",").map((s: string) => s.trim());
          city = parts[0] || "";
          state = parts[1]?.split(/\s+/)[0] || "";
        }
        const address = [streetAddress, locality].filter(Boolean).join(", ");

        let rating: number | null = null;
        const ratingEl = $el.find(".ratings .result-rating, .rating-stars");
        if (ratingEl.length > 0) {
          const ratingClass = ratingEl.attr("class") || "";
          const m = ratingClass.match(/(\d)/);
          if (m) rating = parseInt(m[1], 10);
        }

        let reviewCount: number | null = null;
        const reviewText = $el.find(".ratings .count, .review-count").first().text();
        const m = reviewText.match(/(\d+)/);
        if (m) reviewCount = parseInt(m[1], 10);

        if (minRating > 0 && (rating === null || rating < minRating)) return;

        const href = nameEl.attr("href") || "";
        const sourceUrl = href.startsWith("http") ? href : `${this.baseUrl}${href}`;

        results.push({
          businessName,
          phone,
          address,
          city,
          state,
          rating,
          reviewCount,
          hasWebsite,
          isClosed: false,
          sourceUrl,
          source: this.name,
        });
      } catch {
        /* skip malformed listing */
      }
    });

    return results;
  }

  async scrape(
    options: ScraperOptions,
    onProgress: ProgressCallback
  ): Promise<ScraperResult[]> {
    const all: ScraperResult[] = [];
    const useScrapeDo = isScrapeDoConfigured();
    const requireNoWebsite = options.requireNoWebsite === true;

    for (let page = 1; page <= options.maxPages; page++) {
      const url = this.buildSearchUrl(options.niche, options.location, page);
      const progress = Math.min(95, Math.round((page / options.maxPages) * 90));
      await onProgress(progress, `YellowPages page ${page}/${options.maxPages}`, all.length);

      // Route all YP traffic through Scrape.do when configured (US geo + proxy),
      // and never fall back to a direct datacenter fetch — that often 403s.
      const html = await fetchHtml(url, {
        geoCode: useScrapeDo ? "us" : undefined,
        render: false,
        scrapeDoOnly: useScrapeDo,
      });
      if (!html) break;

      const results = this.parseListings(html, options.minRating, requireNoWebsite);
      all.push(...results);

      // Stop early if a page returns nothing — we've exhausted results.
      if (results.length === 0 && page > 1) break;
      if (page < options.maxPages) await this.sleep(800, 1500);
    }

    await onProgress(100, "YellowPages complete", all.length);
    return all;
  }
}
