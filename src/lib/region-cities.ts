export const REGION_HUBS: Record<string, Array<{ city: string; country: string }>> = {
  europe: [
    { city: "London", country: "GB" },
    { city: "Paris", country: "FR" },
    { city: "Berlin", country: "DE" },
    { city: "Madrid", country: "ES" },
    { city: "Amsterdam", country: "NL" },
    { city: "Rome", country: "IT" },
  ],
  eu: [
    { city: "Brussels", country: "BE" },
    { city: "Amsterdam", country: "NL" },
    { city: "Frankfurt", country: "DE" },
    { city: "Dublin", country: "IE" },
  ],
  scandinavia: [
    { city: "Stockholm", country: "SE" },
    { city: "Oslo", country: "NO" },
    { city: "Copenhagen", country: "DK" },
    { city: "Helsinki", country: "FI" },
  ],
  balkans: [
    { city: "Belgrade", country: "RS" },
    { city: "Zagreb", country: "HR" },
    { city: "Sarajevo", country: "BA" },
    { city: "Tirana", country: "AL" },
    { city: "Pristina", country: "XK" },
  ],
  kosovo: [
    { city: "Pristina", country: "XK" },
    { city: "Prizren", country: "XK" },
    { city: "Pejë", country: "XK" },
    { city: "Gjakova", country: "XK" },
    { city: "Ferizaj", country: "XK" },
  ],
  albania: [
    { city: "Tirana", country: "AL" },
    { city: "Durrës", country: "AL" },
    { city: "Vlorë", country: "AL" },
    { city: "Shkodër", country: "AL" },
  ],
  italy: [
    { city: "Rome", country: "IT" },
    { city: "Milan", country: "IT" },
    { city: "Naples", country: "IT" },
    { city: "Turin", country: "IT" },
  ],
  netherlands: [
    { city: "Amsterdam", country: "NL" },
    { city: "Rotterdam", country: "NL" },
    { city: "The Hague", country: "NL" },
  ],
  "united states": [
    { city: "New York, NY", country: "US" },
    { city: "Los Angeles, CA", country: "US" },
    { city: "Chicago, IL", country: "US" },
    { city: "Houston, TX", country: "US" },
    { city: "Phoenix, AZ", country: "US" },
  ],
  usa: [
    { city: "New York, NY", country: "US" },
    { city: "Los Angeles, CA", country: "US" },
    { city: "Chicago, IL", country: "US" },
    { city: "Houston, TX", country: "US" },
    { city: "Phoenix, AZ", country: "US" },
  ],
  america: [
    { city: "New York, NY", country: "US" },
    { city: "Los Angeles, CA", country: "US" },
    { city: "Chicago, IL", country: "US" },
    { city: "Houston, TX", country: "US" },
    { city: "Phoenix, AZ", country: "US" },
  ],
  california: [
    { city: "Los Angeles, CA", country: "US" },
    { city: "San Francisco, CA", country: "US" },
    { city: "San Diego, CA", country: "US" },
  ],
  uk: [
    { city: "London", country: "GB" },
    { city: "Manchester", country: "GB" },
    { city: "Birmingham", country: "GB" },
  ],
  germany: [
    { city: "Berlin", country: "DE" },
    { city: "Munich", country: "DE" },
    { city: "Hamburg", country: "DE" },
  ],
  france: [
    { city: "Paris", country: "FR" },
    { city: "Lyon", country: "FR" },
  ],
  spain: [
    { city: "Madrid", country: "ES" },
    { city: "Barcelona", country: "ES" },
  ],
  canada: [
    { city: "Toronto", country: "CA" },
    { city: "Vancouver", country: "CA" },
    { city: "Montreal", country: "CA" },
    { city: "Calgary", country: "CA" },
  ],
  australia: [
    { city: "Sydney", country: "AU" },
    { city: "Melbourne", country: "AU" },
    { city: "Brisbane", country: "AU" },
    { city: "Perth", country: "AU" },
  ],
};

/** Try to find a key in REGION_HUBS for a free-text place string. */
export function matchRegionKey(place: string): string | null {
  const p = place
    .toLowerCase()
    .replace(/[,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\beuropean union\b/.test(p)) return "europe";
  const keys = Object.keys(REGION_HUBS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(p)) return key;
  }
  return null;
}
