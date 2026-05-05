export type Plan = "free" | "pro" | "agency";
export type UserRole = "user" | "admin";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  about_me: string | null;
  plan: Plan;
  role: UserRole;
  credits_remaining: number;
  credits_monthly_limit: number;
  share_credits_remaining: number;
  share_credits_monthly_limit: number;
  credits_reset_at: string;
  disclaimer_accepted: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  notif_friend_request: boolean;
  notif_friend_accept: boolean;
  notif_message: boolean;
  notif_lead_share: boolean;
}

export interface ScrapeJob {
  id: string;
  user_id: string;
  niche: string;
  location: string;
  country: string;
  source: string;
  status: "pending" | "running" | "completed" | "failed";
  max_pages: number;
  min_rating: number;
  leads_found: number;
  credits_used: number;
  error_message: string | null;
  progress: number;
  created_at: string;
}

export interface Lead {
  id: string;
  user_id: string;
  scrape_job_id: string | null;
  share_package_id: string | null;
  business_name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  rating: number | null;
  review_count: number | null;
  source: string;
  source_url: string;
  has_website: boolean;
  is_closed: boolean;
  revealed: boolean;
  tags: string[];
  description: string;
  pitch: string;
  created_at: string;
}

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export interface PlanConfig {
  key: Plan;
  label: string;
  price_cents: number;
  monthly_credits: number;
  monthly_shares: number;
  max_pages: number;
  features: string[];
  is_active: boolean;
  sort_order: number;
}

export const PLAN_LIMITS: Record<Plan, { credits: number; label: string; price: number }> = {
  free:   { credits: 10,     label: "Free",   price: 0 },
  pro:    { credits: 1000,   label: "Pro",    price: 19 },
  agency: { credits: 999999, label: "Agency", price: 49 },
};
