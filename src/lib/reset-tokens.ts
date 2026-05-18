import { randomBytes } from "crypto";

interface TokenEntry {
  userId: string;
  expires: number;
}

const store = new Map<string, TokenEntry>();

export function createResetToken(userId: string): string {
  const token = randomBytes(32).toString("hex");
  store.set(token, { userId, expires: Date.now() + 60 * 60 * 1000 }); // 1 hour
  return token;
}

export function consumeResetToken(token: string): string | null {
  const entry = store.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expires) { store.delete(token); return null; }
  store.delete(token);
  return entry.userId;
}
