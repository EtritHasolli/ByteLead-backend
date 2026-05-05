import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env."
    );
  }

  _admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });

  return _admin;
}

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "etrithasolli5@gmail.com";

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email || !ADMIN_EMAIL) return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
}
