import { BaseScraper } from "./base.js";
import { YellowPagesScraper } from "./yellowpages.js";
import { GoogleMapsScraper } from "./googlemaps.js";
import { BingScraper } from "./bing.js";
import { DemoScraper } from "./demo.js";
import { OpenStreetMapScraper } from "./osm.js";

class ScraperRegistry {
  private scrapers = new Map<string, BaseScraper>();

  register(key: string, scraper: BaseScraper): void {
    this.scrapers.set(key, scraper);
  }

  get(key: string): BaseScraper | undefined {
    return this.scrapers.get(key);
  }

  getDemo(): BaseScraper {
    return this.scrapers.get("demo")!;
  }

  getGoogleMaps(): BaseScraper {
    return this.scrapers.get("googlemaps")!;
  }

  getBing(): BaseScraper {
    return this.scrapers.get("bing")!;
  }

  getOSM(): BaseScraper {
    return this.scrapers.get("openstreetmap")!;
  }

  getForCountry(countryCode: string): BaseScraper | undefined {
    const cc = countryCode.toUpperCase() === "GB" ? "UK" : countryCode.toUpperCase();
    const mapping: Record<string, string> = {
      US: "yellowpages",
      UK: "yell",
      DE: "gelbeseiten",
      FR: "pagesjaunes",
    };
    const key = mapping[cc];
    return key ? this.scrapers.get(key) : undefined;
  }

  listAll(): BaseScraper[] {
    return Array.from(this.scrapers.values());
  }
}

const registry = new ScraperRegistry();
registry.register("yellowpages", new YellowPagesScraper());
registry.register("googlemaps", new GoogleMapsScraper());
registry.register("bing", new BingScraper());
registry.register("openstreetmap", new OpenStreetMapScraper());
registry.register("demo", new DemoScraper());

export { registry };
export type { BaseScraper };
