import {
  BaseScraper,
  type ScraperOptions,
  type ScraperResult,
  type ProgressCallback,
} from "./base.js";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
];

/**
 * Per-country defaults so Google Maps returns location-appropriate listings.
 * Geolocation is rough city-center; locale drives the UI language.
 */
const COUNTRY_DEFAULTS: Record<
  string,
  { locale: string; lat: number; lng: number }
> = {
  US: { locale: "en-US", lat: 40.7128, lng: -74.006 },
  CA: { locale: "en-CA", lat: 43.6532, lng: -79.3832 },
  UK: { locale: "en-GB", lat: 51.5074, lng: -0.1278 },
  GB: { locale: "en-GB", lat: 51.5074, lng: -0.1278 },
  IE: { locale: "en-IE", lat: 53.3498, lng: -6.2603 },
  DE: { locale: "de-DE", lat: 52.52, lng: 13.405 },
  AT: { locale: "de-AT", lat: 48.2082, lng: 16.3738 },
  CH: { locale: "de-CH", lat: 47.3769, lng: 8.5417 },
  FR: { locale: "fr-FR", lat: 48.8566, lng: 2.3522 },
  BE: { locale: "nl-BE", lat: 50.8503, lng: 4.3517 },
  NL: { locale: "nl-NL", lat: 52.3676, lng: 4.9041 },
  IT: { locale: "it-IT", lat: 41.9028, lng: 12.4964 },
  ES: { locale: "es-ES", lat: 40.4168, lng: -3.7038 },
  PT: { locale: "pt-PT", lat: 38.7223, lng: -9.1393 },
  GR: { locale: "el-GR", lat: 37.9838, lng: 23.7275 },
  PL: { locale: "pl-PL", lat: 52.2297, lng: 21.0122 },
  CZ: { locale: "cs-CZ", lat: 50.0755, lng: 14.4378 },
  HU: { locale: "hu-HU", lat: 47.4979, lng: 19.0402 },
  RO: { locale: "ro-RO", lat: 44.4268, lng: 26.1025 },
  SE: { locale: "sv-SE", lat: 59.3293, lng: 18.0686 },
  NO: { locale: "no-NO", lat: 59.9139, lng: 10.7522 },
  DK: { locale: "da-DK", lat: 55.6761, lng: 12.5683 },
  FI: { locale: "fi-FI", lat: 60.1699, lng: 24.9384 },
  AL: { locale: "sq-AL", lat: 41.3275, lng: 19.8187 },
  XK: { locale: "sq-AL", lat: 42.6629, lng: 21.1655 },
  RS: { locale: "sr-RS", lat: 44.7866, lng: 20.4489 },
  HR: { locale: "hr-HR", lat: 45.815, lng: 15.9819 },
  BA: { locale: "bs-BA", lat: 43.8563, lng: 18.4131 },
  ME: { locale: "sr-ME", lat: 42.4304, lng: 19.2594 },
  MK: { locale: "mk-MK", lat: 41.9981, lng: 21.4254 },
  SI: { locale: "sl-SI", lat: 46.0569, lng: 14.5058 },
  TR: { locale: "tr-TR", lat: 41.0082, lng: 28.9784 },
  RU: { locale: "ru-RU", lat: 55.7558, lng: 37.6173 },
  UA: { locale: "uk-UA", lat: 50.4501, lng: 30.5234 },
  AE: { locale: "ar-AE", lat: 25.2048, lng: 55.2708 },
  SA: { locale: "ar-SA", lat: 24.7136, lng: 46.6753 },
  IL: { locale: "he-IL", lat: 32.0853, lng: 34.7818 },
  IN: { locale: "en-IN", lat: 28.6139, lng: 77.209 },
  JP: { locale: "ja-JP", lat: 35.6762, lng: 139.6503 },
  KR: { locale: "ko-KR", lat: 37.5665, lng: 126.978 },
  CN: { locale: "zh-CN", lat: 39.9042, lng: 116.4074 },
  HK: { locale: "zh-HK", lat: 22.3193, lng: 114.1694 },
  SG: { locale: "en-SG", lat: 1.3521, lng: 103.8198 },
  AU: { locale: "en-AU", lat: -33.8688, lng: 151.2093 },
  NZ: { locale: "en-NZ", lat: -36.8485, lng: 174.7633 },
  MX: { locale: "es-MX", lat: 19.4326, lng: -99.1332 },
  BR: { locale: "pt-BR", lat: -23.5505, lng: -46.6333 },
  AR: { locale: "es-AR", lat: -34.6037, lng: -58.3816 },
  ZA: { locale: "en-ZA", lat: -26.2041, lng: 28.0473 },
};

export class GoogleMapsScraper extends BaseScraper {
  readonly name = "googlemaps";
  readonly country = "ALL";
  readonly baseUrl = "https://www.google.com/maps";

  private getRandomUA(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  async scrape(
    options: ScraperOptions,
    onProgress: ProgressCallback
  ): Promise<ScraperResult[]> {
    const results: ScraperResult[] = [];

    await onProgress(5, "Launching browser...", 0);

    const { chromium } = await import("playwright");
    let browser = null;

    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage",
        ],
      });

      const country = (options.country ?? "US").toUpperCase();
      const defaults = COUNTRY_DEFAULTS[country] ?? COUNTRY_DEFAULTS.US;

      const context = await browser.newContext({
        userAgent: this.getRandomUA(),
        viewport: { width: 1920, height: 1080 },
        locale: defaults.locale,
        geolocation: { latitude: defaults.lat, longitude: defaults.lng },
        permissions: ["geolocation"],
      });

      const page = await context.newPage();
      
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });

      const searchQuery = `${options.niche} in ${options.location}`;
      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

      await onProgress(10, "Searching Google Maps...", 0);
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      
      await this.sleep(2000, 3000);

      await onProgress(20, "Loading results...", 0);

      // Scale aggressively with `maxPages` so a Pro/Agency user actually
      // gets dozens of results (was capped at 30 → frequently returned <10
      // after filtering). 10 results per page → up to 200 candidates.
      const maxResults = Math.max(40, options.maxPages * 20);
      let scrollAttempts = 0;
      const maxScrolls = Math.min(options.maxPages * 4, 24);

      while (scrollAttempts < maxScrolls) {
        const currentCount = await page.locator('[data-result-index], .Nv2PK').count();
        
        if (currentCount >= maxResults) break;

        const feed = page.locator('div[role="feed"]').first();
        if (await feed.count() > 0) {
          await feed.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
        }

        await this.sleep(1500, 2500);
        scrollAttempts++;

        const progress = 20 + Math.round((scrollAttempts / maxScrolls) * 40);
        await onProgress(progress, `Scrolling for more results...`, currentCount);
      }

      await onProgress(65, "Extracting business data...", 0);

      const listings = await page.locator('.Nv2PK, [data-result-index]').all();
      const seenNames = new Set<string>();
      const requireNoWebsite = options.requireNoWebsite === true;

      for (let i = 0; i < Math.min(listings.length, maxResults); i++) {
        try {
          const listing = listings[i];
          
          const nameEl = await listing.locator('.qBF1Pd, .fontHeadlineSmall').first();
          const businessName = await nameEl.textContent() || "";
          
          if (!businessName.trim()) continue;
          
          const nameKey = businessName.toLowerCase().trim();
          if (seenNames.has(nameKey)) continue;
          seenNames.add(nameKey);

          const ratingEl = await listing.locator('.MW4etd, .ZkP5Je').first();
          const ratingText = await ratingEl.textContent().catch(() => "");
          const rating = ratingText ? parseFloat(ratingText) : null;

          const reviewEl = await listing.locator('.UY7F9, .e4rVHe').first();
          const reviewText = (await reviewEl.textContent().catch(() => "")) ?? "";
          const reviewMatch = reviewText.match(/\(?([\d,]+)\)?/);
          const reviewCount = reviewMatch ? parseInt(reviewMatch[1].replace(",", ""), 10) : null;

          // Skip ONLY permanently/out-of-business listings.
          // Don't kill leads that are just "Closed · Opens 9 AM Mon".
          const listingText = await listing.textContent().catch(() => "");
          const isClosed =
            /(permanently closed|temporarily closed|out of business|closed permanently)/i.test(
              listingText || ""
            );
          if (isClosed) continue;

          if (options.minRating > 0 && (rating === null || rating < options.minRating)) {
            continue;
          }

          const addressEl = await listing.locator('.W4Efsd:last-child .W4Efsd span:not(.ZkP5Je)').first();
          const addressText = await addressEl.textContent().catch(() => "");
          
          // The only signal we trust on Google Maps is an explicit website
          // button on the card (avoids false positives from text snippets).
          const websiteEl = await listing
            .locator('a[data-value="Website"], a[aria-label*="Website" i]')
            .first();
          const hasWebsite = (await websiteEl.count()) > 0;
          if (requireNoWebsite && hasWebsite) continue;

          let address = "";
          let city = "";
          let state = "";
          
          if (addressText) {
            const parts = addressText.split(",").map((s: string) => s.trim());
            address = parts[0] || "";
            city = parts[1] || "";
            const stateMatch = (parts[2] || "").match(/([A-Z]{2})/);
            state = stateMatch ? stateMatch[1] : "";
          }

          let sourceUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${businessName} ${options.location}`)}`;
          if (hasWebsite) {
            const href = await websiteEl.getAttribute("href").catch(() => null);
            if (href?.startsWith("http")) sourceUrl = href.slice(0, 500);
          }

          results.push({
            businessName: businessName.trim(),
            phone: "",
            address,
            city,
            state,
            rating,
            reviewCount,
            hasWebsite,
            isClosed: false,
            sourceUrl,
            source: "googlemaps",
          });

          const progress = 65 + Math.round((i / Math.min(listings.length, maxResults)) * 30);
          await onProgress(progress, `Processing ${i + 1} of ${Math.min(listings.length, maxResults)}...`, results.length);

        } catch {
          continue;
        }
      }

      // Walk the kept results and pull a phone number from each detail panel.
      // We do this for ALL results, not just the top 5, because leads without
      // a phone aren't actionable and we drop them at the end.
      const phoneFetchLimit = Math.min(results.length, listings.length, maxResults);
      for (let i = 0; i < phoneFetchLimit; i++) {
        try {
          const listing = listings[i];
          await listing.click();
          await this.sleep(1200, 1800);

          // The phone button's data-item-id is the most reliable source.
          const phoneEl = await page.locator('button[data-item-id*="phone"]').first();
          if (await phoneEl.count() > 0) {
            const phoneAttr = await phoneEl.getAttribute("data-item-id");
            if (phoneAttr) {
              const phone = this.normalizePhone(
                phoneAttr.replace(/^phone:tel:/, "")
              );
              if (phone) results[i].phone = phone;
            }
          }

          // Also try to upgrade the address from the detail panel since
          // the side-list address is often truncated.
          const fullAddrEl = await page
            .locator('button[data-item-id="address"] div.fontBodyMedium')
            .first();
          if (await fullAddrEl.count() > 0) {
            const fullAddr = (await fullAddrEl.textContent().catch(() => "")) ?? "";
            if (fullAddr.trim()) {
              results[i].address = fullAddr.trim().slice(0, 200);
            }
          }

          await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
          await this.sleep(400, 800);

          const progress = 70 + Math.round((i / phoneFetchLimit) * 28);
          await onProgress(progress, `Fetching contact ${i + 1}/${phoneFetchLimit}`, results.length);
        } catch {
          continue;
        }
      }

      // Drop any result that still doesn't have a phone — without a phone
      // it isn't a usable lead, and we'd rather return fewer real ones.
      const usable = results.filter((r) => r.phone && r.phone.replace(/\D/g, "").length >= 7);

      await onProgress(100, "Done!", usable.length);
      return usable;

    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
}
