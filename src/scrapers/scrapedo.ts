/**
 * Thin wrapper around https://scrape.do
 *
 * scrape.do exposes a single endpoint:
 *   GET https://api.scrape.do/?token=...&url=...&render=true&geoCode=us...
 * It returns the upstream HTML (with proxy + optional JS rendering) directly,
 * so we can use the same cheerio/regex parsers we already have.
 *
 * If `SCRAPE_DO_TOKEN` is not set, `scrapeDoFetch` returns `null` so callers
 * can fall back to a direct fetch / Playwright path.
 */

export interface ScrapeDoOptions {
  /** Render JS via headless browser. Costs more credits — use only if needed. */
  render?: boolean;
  /** Country routing — "us", "gb", "de", "fr". */
  geoCode?: string;
  /** Use premium residential proxies. Costs more credits. */
  premium?: boolean;
  /** Per-request timeout (ms). Default 45s. */
  timeoutMs?: number;
  /** Extra headers to forward to the upstream site. */
  headers?: Record<string, string>;
}

export function isScrapeDoConfigured(): boolean {
  return !!process.env.SCRAPE_DO_TOKEN;
}

export async function scrapeDoFetch(
  url: string,
  opts: ScrapeDoOptions = {}
): Promise<string | null> {
  const token = process.env.SCRAPE_DO_TOKEN;
  if (!token) return null;

  const params = new URLSearchParams({
    token,
    url,
  });
  if (opts.render) params.set("render", "true");
  if (opts.geoCode) params.set("geoCode", opts.geoCode);
  if (opts.premium) params.set("super", "true");

  const apiUrl = `https://api.scrape.do/?${params.toString()}`;

  try {
    const res = await fetch(apiUrl, {
      headers: opts.headers ?? {},
      signal: AbortSignal.timeout(opts.timeoutMs ?? 45000),
    });
    if (!res.ok) {
      console.warn(`scrape.do non-2xx for ${url}: ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`scrape.do fetch failed for ${url}:`, err);
    return null;
  }
}

export interface FetchHtmlOptions extends ScrapeDoOptions {
  /**
   * When true, only use Scrape.do — never hit the target URL directly.
   * Use for sites (e.g. Yellow Pages) where a datacenter IP risks blocks;
   * requires `SCRAPE_DO_TOKEN`.
   */
  scrapeDoOnly?: boolean;
}

/**
 * Convenience: try scrape.do first, fall back to a direct fetch with
 * a desktop User-Agent. Returns `""` (empty string) on total failure.
 *
 * With `scrapeDoOnly: true`, no direct fetch is attempted.
 */
export async function fetchHtml(
  url: string,
  opts: FetchHtmlOptions = {}
): Promise<string> {
  const { scrapeDoOnly, ...scrapeOpts } = opts;
  const viaProxy = await scrapeDoFetch(url, scrapeOpts);
  if (viaProxy && viaProxy.length > 200) return viaProxy;
  if (scrapeDoOnly) return "";

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(opts.headers ?? {}),
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}
