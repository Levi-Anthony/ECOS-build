import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Contact = {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  notes: string | null;
  follow_up_date: string | null;
  last_contacted: string | null;
  relationship_domain: string;
  administrative_status: string;
  thought_links: ThoughtLink[] | null;
  community_role: string | null;
  music_role: string | null;
  created_at: string;
  updated_at: string;
};

export type Interaction = {
  id: string;
  contact_id: string;
  interaction_type: string;
  summary: string;
  follow_up_notes: string | null;
  follow_up_needed: boolean;
  occurred_at: string;
  created_at: string;
};

export type Opportunity = {
  id: string;
  contact_id: string;
  title: string;
  stage: string;
  value: number | null;
  expected_close_date: string | null;
  notes: string | null;
  created_at: string;
};

export type ThoughtLink = {
  thought_id: string;
  content_preview: string;
  linked_at: string;
};

export const DOMAIN_LABELS: Record<string, string> = {
  tango: "Tango",
  ttc: "TTC",
  outreach: "Outreach",
  it: "IT",
  music: "Music",
  personal: "Personal",
  general: "General",
};

export const DOMAIN_COLORS: Record<string, string> = {
  tango: "bg-rose-100 text-rose-800",
  ttc: "bg-orange-100 text-orange-800",
  outreach: "bg-amber-100 text-amber-800",
  it: "bg-blue-100 text-blue-800",
  music: "bg-purple-100 text-purple-800",
  personal: "bg-green-100 text-green-800",
  general: "bg-gray-100 text-gray-700",
};

export const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  passive: "bg-yellow-100 text-yellow-800",
  administrative_closed: "bg-red-100 text-red-800",
  community: "bg-sky-100 text-sky-800",
};

export const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  passive: "Passive",
  administrative_closed: "Closed",
  community: "Community",
};
