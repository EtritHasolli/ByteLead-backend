import {
  BaseScraper,
  type ScraperOptions,
  type ScraperResult,
  type ProgressCallback,
} from "./base.js";

const DEMO_BUSINESSES: Array<{
  niche: string;
  businesses: Array<{
    businessName: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    rating: number;
    reviewCount: number;
  }>;
}> = [
  {
    niche: "Plumbers",
    businesses: [
      { businessName: "Mike's Plumbing Service", phone: "(512) 555-0147", address: "1423 Oak Hill Dr", city: "Austin", state: "TX", rating: 4.2, reviewCount: 38 },
      { businessName: "Quick Fix Plumbing", phone: "(512) 555-0234", address: "892 Cedar Lane", city: "Austin", state: "TX", rating: 4.5, reviewCount: 52 },
      { businessName: "Pro Pipe Solutions", phone: "(512) 555-0345", address: "2156 Maple Ave", city: "Round Rock", state: "TX", rating: 4.0, reviewCount: 28 },
      { businessName: "Express Drain Cleaning", phone: "(512) 555-0456", address: "445 Elm Street", city: "Cedar Park", state: "TX", rating: 4.8, reviewCount: 67 },
      { businessName: "Budget Plumbers LLC", phone: "(512) 555-0567", address: "789 Pine Road", city: "Pflugerville", state: "TX", rating: 3.9, reviewCount: 15 },
      { businessName: "24/7 Emergency Plumbing", phone: "(512) 555-0678", address: "321 Birch Blvd", city: "Austin", state: "TX", rating: 4.3, reviewCount: 89 },
      { businessName: "Family Plumbing Co", phone: "(512) 555-0789", address: "567 Walnut Way", city: "Georgetown", state: "TX", rating: 4.6, reviewCount: 45 },
      { businessName: "Reliable Rooter Service", phone: "(512) 555-0890", address: "234 Ash Circle", city: "Leander", state: "TX", rating: 4.1, reviewCount: 33 },
      { businessName: "Capital City Plumbing", phone: "(512) 555-0901", address: "456 Congress Ave", city: "Austin", state: "TX", rating: 4.4, reviewCount: 76 },
      { businessName: "Hill Country Plumbers", phone: "(512) 555-0912", address: "789 Barton Springs Rd", city: "Austin", state: "TX", rating: 4.7, reviewCount: 92 },
      { businessName: "Lakeway Plumbing Pros", phone: "(512) 555-0923", address: "321 Lake Travis Blvd", city: "Lakeway", state: "TX", rating: 4.5, reviewCount: 61 },
      { businessName: "South Austin Plumbing", phone: "(512) 555-0934", address: "654 S Lamar Blvd", city: "Austin", state: "TX", rating: 4.2, reviewCount: 47 },
      { businessName: "North Austin Drain Service", phone: "(512) 555-0945", address: "987 N Lamar Blvd", city: "Austin", state: "TX", rating: 4.6, reviewCount: 83 },
      { businessName: "Dripping Springs Plumbing", phone: "(512) 555-0956", address: "147 Main St", city: "Dripping Springs", state: "TX", rating: 4.8, reviewCount: 34 },
      { businessName: "Bee Cave Plumbing Co", phone: "(512) 555-0967", address: "258 Bee Cave Pkwy", city: "Bee Cave", state: "TX", rating: 4.3, reviewCount: 29 },
      { businessName: "Manor Plumbing Service", phone: "(512) 555-0978", address: "369 Main St", city: "Manor", state: "TX", rating: 4.1, reviewCount: 22 },
    ],
  },
  {
    niche: "Electricians",
    businesses: [
      { businessName: "Bright Spark Electric", phone: "(305) 555-1234", address: "456 Palm Ave", city: "Miami", state: "FL", rating: 4.4, reviewCount: 56 },
      { businessName: "PowerUp Electrical", phone: "(305) 555-2345", address: "789 Ocean Dr", city: "Miami Beach", state: "FL", rating: 4.7, reviewCount: 78 },
      { businessName: "Safe Wire Solutions", phone: "(305) 555-3456", address: "123 Coral Way", city: "Coral Gables", state: "FL", rating: 4.2, reviewCount: 34 },
      { businessName: "Circuit Masters", phone: "(305) 555-4567", address: "567 Bay Harbor", city: "Hialeah", state: "FL", rating: 4.0, reviewCount: 22 },
      { businessName: "Lightning Fast Electric", phone: "(305) 555-5678", address: "890 Sunset Blvd", city: "Kendall", state: "FL", rating: 4.8, reviewCount: 91 },
    ],
  },
  {
    niche: "Restaurants",
    businesses: [
      { businessName: "Tony's Italian Kitchen", phone: "(718) 555-1111", address: "234 Arthur Ave", city: "Brooklyn", state: "NY", rating: 4.6, reviewCount: 124 },
      { businessName: "Golden Dragon Chinese", phone: "(718) 555-2222", address: "567 Atlantic Ave", city: "Brooklyn", state: "NY", rating: 4.3, reviewCount: 89 },
      { businessName: "Mama Rosa's Pizzeria", phone: "(718) 555-3333", address: "890 Flatbush Ave", city: "Brooklyn", state: "NY", rating: 4.8, reviewCount: 156 },
      { businessName: "El Sabor Latino", phone: "(718) 555-4444", address: "123 Smith Street", city: "Brooklyn", state: "NY", rating: 4.4, reviewCount: 67 },
      { businessName: "Blue Moon Diner", phone: "(718) 555-5555", address: "456 Court Street", city: "Brooklyn", state: "NY", rating: 4.1, reviewCount: 45 },
      { businessName: "Sakura Sushi Bar", phone: "(718) 555-6666", address: "789 Montague St", city: "Brooklyn", state: "NY", rating: 4.5, reviewCount: 98 },
      { businessName: "Brooklyn Bagel House", phone: "(718) 555-7777", address: "321 Bedford Ave", city: "Brooklyn", state: "NY", rating: 4.7, reviewCount: 187 },
      { businessName: "Park Slope Bistro", phone: "(718) 555-8888", address: "654 7th Ave", city: "Brooklyn", state: "NY", rating: 4.2, reviewCount: 73 },
      { businessName: "Williamsburg BBQ Joint", phone: "(718) 555-9999", address: "987 Grand St", city: "Brooklyn", state: "NY", rating: 4.9, reviewCount: 234 },
      { businessName: "DUMBO Thai Kitchen", phone: "(718) 555-0011", address: "147 Front St", city: "Brooklyn", state: "NY", rating: 4.4, reviewCount: 112 },
      { businessName: "Red Hook Lobster Pound", phone: "(718) 555-0022", address: "258 Van Brunt St", city: "Brooklyn", state: "NY", rating: 4.6, reviewCount: 145 },
      { businessName: "Bushwick Taqueria", phone: "(718) 555-0033", address: "369 Knickerbocker Ave", city: "Brooklyn", state: "NY", rating: 4.3, reviewCount: 87 },
      { businessName: "Crown Heights Jerk Chicken", phone: "(718) 555-0044", address: "471 Nostrand Ave", city: "Brooklyn", state: "NY", rating: 4.8, reviewCount: 201 },
      { businessName: "Bay Ridge Steakhouse", phone: "(718) 555-0055", address: "582 86th St", city: "Brooklyn", state: "NY", rating: 4.5, reviewCount: 134 },
      { businessName: "Greenpoint Pierogi House", phone: "(718) 555-0066", address: "693 Manhattan Ave", city: "Brooklyn", state: "NY", rating: 4.7, reviewCount: 98 },
      { businessName: "Coney Island Seafood", phone: "(718) 555-0077", address: "804 Surf Ave", city: "Brooklyn", state: "NY", rating: 4.2, reviewCount: 76 },
    ],
  },
  {
    niche: "Dentists",
    businesses: [
      { businessName: "Smile Bright Dental", phone: "(786) 555-0001", address: "100 Brickell Ave", city: "Miami", state: "FL", rating: 4.9, reviewCount: 145 },
      { businessName: "Family Dental Care", phone: "(786) 555-0002", address: "200 SW 8th St", city: "Miami", state: "FL", rating: 4.6, reviewCount: 87 },
      { businessName: "Gentle Touch Dentistry", phone: "(786) 555-0003", address: "300 NE 2nd Ave", city: "Miami", state: "FL", rating: 4.4, reviewCount: 56 },
      { businessName: "Premier Dental Group", phone: "(786) 555-0004", address: "400 Collins Ave", city: "Miami Beach", state: "FL", rating: 4.7, reviewCount: 112 },
      { businessName: "Coral Gables Family Dentist", phone: "(305) 555-0101", address: "501 Miracle Mile", city: "Coral Gables", state: "FL", rating: 4.5, reviewCount: 78 },
      { businessName: "South Beach Dental Studio", phone: "(305) 555-0102", address: "602 Ocean Dr", city: "Miami Beach", state: "FL", rating: 4.8, reviewCount: 134 },
      { businessName: "Kendall Dental Associates", phone: "(305) 555-0103", address: "703 Dadeland Blvd", city: "Kendall", state: "FL", rating: 4.3, reviewCount: 65 },
      { businessName: "Hialeah Family Dental", phone: "(305) 555-0104", address: "804 Palm Ave", city: "Hialeah", state: "FL", rating: 4.2, reviewCount: 43 },
      { businessName: "Doral Dental Excellence", phone: "(305) 555-0105", address: "905 NW 87th Ave", city: "Doral", state: "FL", rating: 4.6, reviewCount: 98 },
      { businessName: "Little Havana Dentistry", phone: "(305) 555-0106", address: "1006 Calle Ocho", city: "Miami", state: "FL", rating: 4.1, reviewCount: 52 },
      { businessName: "Aventura Dental Clinic", phone: "(305) 555-0107", address: "1107 Biscayne Blvd", city: "Aventura", state: "FL", rating: 4.7, reviewCount: 89 },
      { businessName: "Homestead Family Dental", phone: "(305) 555-0108", address: "1208 S Dixie Hwy", city: "Homestead", state: "FL", rating: 4.4, reviewCount: 67 },
      { businessName: "Key Biscayne Dental Care", phone: "(305) 555-0109", address: "1309 Crandon Blvd", city: "Key Biscayne", state: "FL", rating: 4.9, reviewCount: 156 },
      { businessName: "Palmetto Bay Dentistry", phone: "(305) 555-0110", address: "1410 SW 184th St", city: "Palmetto Bay", state: "FL", rating: 4.5, reviewCount: 71 },
      { businessName: "Pinecrest Dental Studio", phone: "(305) 555-0111", address: "1511 S Dixie Hwy", city: "Pinecrest", state: "FL", rating: 4.8, reviewCount: 123 },
      { businessName: "Sunny Isles Dental", phone: "(305) 555-0112", address: "1612 Collins Ave", city: "Sunny Isles Beach", state: "FL", rating: 4.3, reviewCount: 54 },
    ],
  },
  {
    niche: "Hair Salons",
    businesses: [
      { businessName: "Glamour Cuts", phone: "(303) 555-7001", address: "123 16th St Mall", city: "Denver", state: "CO", rating: 4.5, reviewCount: 78 },
      { businessName: "Style Studio", phone: "(303) 555-7002", address: "456 Colfax Ave", city: "Denver", state: "CO", rating: 4.3, reviewCount: 45 },
      { businessName: "Mane Attraction", phone: "(303) 555-7003", address: "789 Broadway", city: "Denver", state: "CO", rating: 4.7, reviewCount: 92 },
      { businessName: "Shear Perfection", phone: "(303) 555-7004", address: "321 Pearl St", city: "Boulder", state: "CO", rating: 4.8, reviewCount: 134 },
      { businessName: "Classic Barber Shop", phone: "(303) 555-7005", address: "654 Larimer St", city: "Denver", state: "CO", rating: 4.2, reviewCount: 67 },
    ],
  },
  {
    niche: "HVAC",
    businesses: [
      { businessName: "Cool Breeze HVAC", phone: "(312) 555-8001", address: "100 N Michigan Ave", city: "Chicago", state: "IL", rating: 4.4, reviewCount: 89 },
      { businessName: "Comfort Zone Heating", phone: "(312) 555-8002", address: "200 W Madison St", city: "Chicago", state: "IL", rating: 4.6, reviewCount: 67 },
      { businessName: "Arctic Air Systems", phone: "(312) 555-8003", address: "300 S State St", city: "Chicago", state: "IL", rating: 4.2, reviewCount: 45 },
      { businessName: "Reliable Heating & AC", phone: "(312) 555-8004", address: "400 E Ohio St", city: "Chicago", state: "IL", rating: 4.8, reviewCount: 156 },
      { businessName: "Pro Climate Control", phone: "(312) 555-8005", address: "500 N Clark St", city: "Chicago", state: "IL", rating: 4.3, reviewCount: 78 },
    ],
  },
];

export class DemoScraper extends BaseScraper {
  readonly name = "demo";
  readonly country = "ALL";
  readonly baseUrl = "";

  async scrape(
    options: ScraperOptions,
    onProgress: ProgressCallback
  ): Promise<ScraperResult[]> {
    await onProgress(10, "Searching demo database...", 0);
    
    await this.sleep(500, 1000);
    
    const nicheKey = options.niche.toLowerCase();
    let matchedBusinesses: typeof DEMO_BUSINESSES[0]["businesses"] = [];
    
    for (const category of DEMO_BUSINESSES) {
      if (category.niche.toLowerCase().includes(nicheKey) || 
          nicheKey.includes(category.niche.toLowerCase().slice(0, -1))) {
        matchedBusinesses = [...category.businesses];
        break;
      }
    }
    
    if (matchedBusinesses.length === 0) {
      matchedBusinesses = DEMO_BUSINESSES[0].businesses;
    }
    
    await onProgress(50, "Processing results...", 0);
    await this.sleep(300, 600);
    
    const locationLower = options.location.toLowerCase();
    const results: ScraperResult[] = matchedBusinesses
      .filter(b => options.minRating === 0 || b.rating >= options.minRating)
      .slice(0, Math.min(options.maxPages * 10, matchedBusinesses.length))
      .map((b) => ({
        businessName: b.businessName,
        phone: b.phone,
        address: b.address,
        city: locationLower.includes(b.city.toLowerCase()) ? b.city : this.extractCity(options.location) || b.city,
        state: b.state,
        rating: b.rating,
        reviewCount: b.reviewCount,
        hasWebsite: false,
        isClosed: false,
        sourceUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.businessName} ${options.location}`)}`,
        source: "demo",
      }));
    
    await onProgress(100, "Demo data loaded!", results.length);
    return results;
  }
  
  private extractCity(location: string): string {
    const parts = location.split(",").map(p => p.trim());
    return parts[0] || "";
  }
}
