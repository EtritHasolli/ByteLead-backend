export interface ScraperResult {
  businessName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  rating: number | null;
  reviewCount: number | null;
  hasWebsite: boolean;
  isClosed: boolean;
  sourceUrl: string;
  source: string;
}

export interface ScraperOptions {
  niche: string;
  location: string;
  maxPages: number;
  minRating: number;
  country?: string;
  /** Region fan-out (e.g. “Europe” → many cities) — keep each city fast. */
  multiCity?: boolean;
  /**
   * When true, drop or exclude listings that appear to have a website.
   * When false, include all listings and set `hasWebsite` from source signals.
   */
  requireNoWebsite?: boolean;
}

export interface ProgressCallback {
  (progress: number, message: string, leadsFound: number): Promise<void>;
}

export abstract class BaseScraper {
  abstract readonly name: string;
  abstract readonly country: string;
  abstract readonly baseUrl: string;

  abstract scrape(
    options: ScraperOptions,
    onProgress: ProgressCallback
  ): Promise<ScraperResult[]>;

  /**
   * Cleans + formats a phone number, preserving international country codes.
   *
   * - Keeps a leading "+" if present (or already starts with country code).
   * - Strips letters, currency, dates, etc.
   * - Collapses internal whitespace and ".", "-", "/", parentheses to single spaces.
   * - Re-formats common digit groupings for readability.
   *
   * Examples:
   *   "Call: +355 69 800 2228 today!"  -> "+355 69 800 2228"
   *   "Tel. +44 20 7946 0958"          -> "+44 20 7946 0958"
   *   "(305) 555-0102"                 -> "(305) 555-0102"
   *   "0211/12345678"                  -> "0211 1234 5678"
   */
  protected normalizePhone(phone: string): string {
    if (!phone) return "";

    // Pull out the contiguous phone-like substring (digits + separators).
    const match = phone.match(/(\(?\+?\d[\d\s().\-\/]{6,}\d)/);
    if (!match) return "";

    let raw = match[1];

    // Standardise separators -> single space, collapse whitespace.
    raw = raw
      .replace(/[.\-\/]/g, " ")
      .replace(/\(\s*/g, "(")
      .replace(/\s*\)/g, ") ")
      .replace(/\s+/g, " ")
      .trim();

    // If the digits-only version is plausibly a phone (7-15 digits) we keep it.
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return "";

    return raw;
  }

  protected sleep(min: number, max: number): Promise<void> {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
