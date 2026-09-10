export type JobStatus = "lead" | "contacted" | "quoted" | "scheduled" | "in_progress" | "completed" | "lost";
export type DashboardWidgetKey =
  | "new_leads"
  | "quoted"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "open_pipeline"
  | "avg_job"
  | "needs_attention"
  | "active_job_board"
  | "upcoming";

export type JobSource =
  | "manual"
  | "website_form"
  | "phone"
  | "referral"
  | "google"
  | "facebook"
  | "instagram"
  | "repeat_customer"
  | "walk_in"
  | "other";

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined";

export type IntakeFieldType = "short_text" | "long_text" | "number" | "select" | "checkbox" | "date";
export type JobFileCategory = "intake" | "before" | "damage" | "prep" | "progress" | "completed" | "other";

export type Business = {
  id: string;
  name: string;
  slug: string | null;
  intake_form_enabled: boolean;
  intake_form_title: string;
  intake_form_description: string;
};

export type Customer = {
  id: string;
  business_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Job = {
  id: string;
  business_id: string;
  customer_id: string | null;
  title: string;
  description: string | null;
  status: JobStatus;
  price_cents: number;
  scheduled_start: string | null;
  scheduled_end: string | null;
  job_address: string | null;
  internal_notes: string | null;
  source: JobSource;
  project_type: string | null;
  preferred_date: string | null;
  square_feet: number | null;
  budget_range: string | null;
  first_contact_at: string | null;
  quote_sent_at: string | null;
  won_at: string | null;
  next_follow_up_at: string | null;
  lost_at: string | null;
  completed_at: string | null;
  lost_reason: string | null;
  revenue_cents: number;
  intake_data: Record<string, IntakeResponse> | null;
  created_at: string;
  updated_at: string;
  customer: Customer | null;
};

export type IntakeField = {
  id: string;
  business_id: string;
  field_key: string;
  label: string;
  field_type: IntakeFieldType;
  required: boolean;
  enabled: boolean;
  options: string[];
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type BusinessServiceType = {
  id: string;
  business_id: string;
  key: string;
  label: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type BusinessPipelineStatus = {
  id: string;
  business_id: string;
  key: JobStatus;
  label: string;
  semantic_type: JobStatus;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type BusinessDashboardWidget = {
  id: string;
  business_id: string;
  widget_key: DashboardWidgetKey;
  label_override: string | null;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type IntakeResponse = {
  label: string;
  type: IntakeFieldType;
  value: string | number | boolean | null;
};

export type JobFile = {
  id: string;
  business_id: string;
  job_id: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  category: JobFileCategory;
  source_context: "intake" | "job_detail" | "manual";
  created_at: string;
  signed_url?: string;
};

export type JobActivity = {
  id: string;
  business_id: string;
  job_id: string;
  user_id: string | null;
  event_type: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
  job?: Pick<Job, "id" | "title" | "status"> | null;
};

export type Quote = {
  id: string;
  business_id: string;
  job_id: string;
  amount_cents: number;
  notes: string | null;
  status: QuoteStatus;
  public_token: string;
  public_token_created_at: string | null;
  public_access_revoked_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
};

export type QuoteMessage = {
  id: string;
  business_id: string;
  quote_id: string;
  job_id: string;
  message: string;
  source: "customer" | "business";
  resolved_at: string | null;
  created_at: string;
};

export type CustomerSummary = Customer & {
  job_count: number;
  lifetime_value_cents: number;
  completed_jobs: number;
  active_jobs: number;
  last_job_date: string | null;
};
