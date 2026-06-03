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
  close_date: string | null;
  notes: string | null;
  created_at: string;
};

export type ThoughtLink = {
  thought_id: string;
  content_preview: string;
  linked_at: string;
};

export type Thought = {
  id: string;
  content: string;
  original_content: string;
  created_at: string;
  status: string;
  retrieval_count: number;
  source_id: string | null;
  metadata: {
    type?: string;
    domain?: string;
    horizon?: string;
    signal_type?: string;
    confidence?: string;
    topics?: string[];
    people?: string[];
    action_items?: string[];
    needs_split?: boolean;
    metadata_fallback?: boolean;
    taste_preference_id?: string;
  };
};

// --- Artifact v2 (patch-based, block-addressable) ---
// jsonb columns (metadata, ops) are intentionally loosely typed; read with guards.
export type Artifact = {
  id: string;
  key: string;
  title: string;
  kind: string;
  status: string;
  current_version: number;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type ArtifactBlock = {
  id: string;
  artifact_id: string;
  path: string;
  title: string | null;
  content: string;
  content_hash: string | null;
  version: number;
  sort_order: number;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type ArtifactRevision = {
  id: string;
  artifact_id: string;
  version: number;
  base_version: number | null;
  ops?: unknown;
  summary: string | null;
  actor: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type ServiceLog = {
  id: string;
  contact_id: string;
  service_date: string;
  service_type: "onsite" | "remote" | "phone" | "email" | "project" | "maintenance";
  description: string;
  resolution?: string;
  time_spent_minutes?: number;
  billable: boolean;
  billed: boolean;
  follow_up_needed: boolean;
  follow_up_notes?: string;
  created_at: string;
};

export type BillingEntry = {
  id: string;
  contact_id: string;
  service_log_ids: string[];
  description?: string;
  amount?: number;
  status: "draft" | "sent" | "paid";
  invoice_date?: string;
  paid_date?: string;
  notes?: string;
  created_at: string;
};

export type Briefing = {
  id: string;
  briefing_type: "morning" | "pre_meeting" | "checkin" | "evening" | "habit_reminder" | "weekly_review" | "custom";
  content: string;
  delivered_via: string;
  user_responded: boolean;
  created_at: string;
};

export type TastePreference = {
  id: string;
  user_id: string;
  preference_name: string | null;
  domain: string | null;
  reject: string | null;
  want: string | null;
  type_label: string | null;
  constraint_type: string | null;
  constraint_text: string;
  source: string | null;
  contact_id: string | null;
  status: "active" | "archived" | "superseded";
  invocation_count: number | null;
  last_invoked_at: string | null;
  user_responded: boolean | null;
  thought_id: string | null;
  created_at: string;
  updated_at: string | null;
};

export type TasteEvolution = {
  id: string;
  taste_id: string;
  change_type: "upgraded" | "downgraded" | "refined" | "archived";
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  approved: boolean;
  applied_at: string | null;
  created_at: string;
};

export type PersonObservation = {
  id: string;
  contact_id: string;
  observation_type: "fact" | "observation" | "interpretation" | "hypothesis" | "strategy";
  content: string;
  confidence: number;
  domain_context: string | null;
  observed_at: string;
  source: string;
  linked_thought_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PersonSnapshot = {
  id: string;
  contact_id: string;
  snapshot_content: string;
  domains_covered: string[];
  source_observation_ids: string[];
  source_thought_ids: string[];
  compiled_by: string;
  version: number;
  is_current: boolean;
  created_at: string;
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

export const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-gray-100 text-gray-700",
  qualified: "bg-blue-100 text-blue-800",
  proposal: "bg-purple-100 text-purple-800",
  closed_won: "bg-green-100 text-green-800",
  closed_lost: "bg-red-100 text-red-800",
};

export const BRAIN_DOMAIN_COLORS: Record<string, string> = {
  "ecos-architecture": "bg-violet-100 text-violet-800",
  "tango-pedagogy": "bg-rose-100 text-rose-800",
  "ttc-board": "bg-orange-100 text-orange-800",
  "neil-outreach": "bg-amber-100 text-amber-800",
  "it-consulting": "bg-blue-100 text-blue-800",
  "music-production": "bg-purple-100 text-purple-800",
  "brain-protocol": "bg-teal-100 text-teal-800",
  personal: "bg-green-100 text-green-800",
};

export const BRAIN_DOMAIN_LABELS: Record<string, string> = {
  "ecos-architecture": "ECOS Arch",
  "tango-pedagogy": "Tango",
  "ttc-board": "TTC",
  "neil-outreach": "Neil",
  "it-consulting": "IT",
  "music-production": "Music",
  "brain-protocol": "BRAIN",
  personal: "Personal",
};
