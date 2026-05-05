interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 60_000);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAt };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

export function checkScrapeLimit(userId: string) {
  return rateLimit(`scrape:${userId}`, 10, 60_000);
}

export function checkRevealLimit(userId: string) {
  return rateLimit(`reveal:${userId}`, 30, 60_000);
}

export function checkChatLimit(userId: string) {
  return rateLimit(`chat:${userId}`, 20, 60_000);
}

export function checkLoginLimit(email: string) {
  return rateLimit(`login:${email.toLowerCase()}`, 5, 60_000);
}
