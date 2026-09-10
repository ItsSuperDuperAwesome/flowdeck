"use server";

import { dashboardWidgetRegistry, defaultDashboardWidgets, defaultPipelineStatuses, defaultServiceTypes } from "@/lib/job-tracker/config";
import type { DashboardWidgetKey, IntakeFieldType, JobFileCategory, JobSource, JobStatus, QuoteStatus } from "@/lib/job-tracker/types";
import { createClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const validStatuses: JobStatus[] = ["lead", "contacted", "quoted", "scheduled", "in_progress", "completed", "lost"];
const validQuoteStatuses: QuoteStatus[] = ["draft", "sent", "accepted", "declined"];
const validIntakeFieldTypes: IntakeFieldType[] = ["short_text", "long_text", "number", "select", "checkbox", "date"];
const validSources: JobSource[] = ["website_form", "google", "facebook", "instagram", "referral", "repeat_customer", "phone", "walk_in", "manual", "other"];
const validDashboardWidgets = Object.keys(dashboardWidgetRegistry) as DashboardWidgetKey[];
const validLostReasons = ["price", "no_response", "competitor", "timing", "canceled_project", "not_qualified", "other"];
const confirmedStatuses: JobStatus[] = ["scheduled", "in_progress", "completed"];
const maxPhotoCount = 5;
const maxPhotoSize = 10 * 1024 * 1024;
const validPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const validPhotoCategories: JobFileCategory[] = ["before", "damage", "prep", "progress", "completed", "other"];

type ParsedIntakeField =
  | { error: string }
  | {
      field: {
        enabled: boolean;
        field_key: string;
        field_type: IntakeFieldType;
        label: string;
        options: string[];
        required: boolean;
      };
    };

function message(value: string) {
  return encodeURIComponent(value);
}

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function optional(value: FormDataEntryValue | null) {
  const cleaned = clean(value);
  return cleaned || null;
}

function internalRedirectTarget(value: FormDataEntryValue | null, fallback: string) {
  const target = clean(value);

  if (target.startsWith("/") && !target.startsWith("//") && !target.includes("://")) {
    return target;
  }

  return fallback;
}

function moneyToCents(value: FormDataEntryValue | null) {
  const amount = Number(String(value ?? "0").replace(/[$,]/g, ""));
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

function publicQuoteToken() {
  return randomBytes(32).toString("hex");
}

function extensionForMime(type: string) {
  return {
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  }[type] ?? "img";
}

function displayFileName(name: string) {
  return name
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Job photo";
}

function validatePhotoFiles(files: File[]) {
  if (!files.length) {
    return "Choose at least one photo.";
  }

  if (files.length > maxPhotoCount) {
    return `Upload ${maxPhotoCount} photos or fewer at a time.`;
  }

  for (const file of files) {
    if (!validPhotoTypes.has(file.type)) {
      return "Photos must be JPG, PNG, WebP, or GIF images.";
    }

    if (file.size <= 0 || file.size > maxPhotoSize) {
      return "Each photo must be 10 MB or smaller.";
    }
  }

  return null;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatActivityDateTime(value: string) {
  const date = new Date(value);
  const dateText = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(date);
  const timeText = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  return `${dateText} at ${timeText}`;
}

function formatStatus(status: JobStatus) {
  return {
    lead: "Lead",
    contacted: "Contacted",
    quoted: "Quoted",
    scheduled: "Scheduled",
    in_progress: "In Progress",
    completed: "Completed",
    lost: "Lost",
  }[status];
}

function scheduleValue(date: FormDataEntryValue | null, time: FormDataEntryValue | null) {
  const day = clean(date);
  const clock = clean(time) || "09:00";

  if (!day) {
    return null;
  }

  return `${day}T${clock}:00`;
}

function dateTimeLocalValue(value: FormDataEntryValue | null) {
  const cleaned = clean(value);
  return cleaned ? `${cleaned}:00` : null;
}

function normalizeScheduledEnd(start: string | null, end: string | null) {
  if (!start || !end) {
    return end;
  }

  return new Date(end).getTime() >= new Date(start).getTime() ? end : null;
}

function needsConfirmedSchedule(status: JobStatus) {
  return confirmedStatuses.includes(status);
}

function isClosedStatus(status: JobStatus) {
  return status === "completed" || status === "lost";
}

function statusTransitionUpdate(input: {
  currentCompletedAt?: string | null;
  currentFirstContactAt?: string | null;
  currentQuoteSentAt?: string | null;
  currentWonAt?: string | null;
  nextStatus: JobStatus;
  priceCents?: number;
}) {
  const now = new Date().toISOString();
  const update: Record<string, string | number | null> = {
    status: input.nextStatus,
  };

  if (input.nextStatus === "contacted" && !input.currentFirstContactAt) {
    update.first_contact_at = now;
  }

  if (input.nextStatus === "quoted") {
    if (!input.currentFirstContactAt) {
      update.first_contact_at = now;
    }

    if (!input.currentQuoteSentAt) {
      update.quote_sent_at = now;
    }
  }

  if (input.nextStatus === "scheduled" || input.nextStatus === "in_progress" || input.nextStatus === "completed" || input.nextStatus === "lost") {
    update.next_follow_up_at = null;
  }

  if ((input.nextStatus === "scheduled" || input.nextStatus === "in_progress" || input.nextStatus === "completed") && !input.currentWonAt) {
    update.won_at = now;
  }

  if (input.nextStatus === "completed") {
    if (!input.currentCompletedAt) {
      update.completed_at = now;
    }

    update.revenue_cents = Math.max(0, input.priceCents ?? 0);
  }

  if (input.nextStatus === "lost") {
    update.lost_at = now;
    update.revenue_cents = 0;
  }

  if (input.nextStatus !== "lost") {
    update.lost_at = null;
    update.lost_reason = null;
  }

  return update;
}

function revenueForJob(status: JobStatus, priceCents: number, wonAt?: string | null) {
  return status === "completed" || Boolean(wonAt) ? Math.max(0, priceCents) : 0;
}

function statusActivityMessage(from: JobStatus, to: JobStatus) {
  if (to === "contacted") {
    return "Customer contacted.";
  }

  if (to === "quoted") {
    return "Job moved to quoted.";
  }

  if (to === "scheduled") {
    return "Job scheduled.";
  }

  if (to === "in_progress") {
    return "Job started.";
  }

  if (to === "completed") {
    return "Job completed.";
  }

  if (to === "lost") {
    return "Job marked lost.";
  }

  return `Status changed from ${formatStatus(from)} to ${formatStatus(to)}.`;
}

async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    redirect("/");
  }

  return {
    supabase,
    userId: data.claims.sub,
  };
}

async function logActivity(input: {
  businessId: string;
  eventType: string;
  jobId: string;
  message: string;
  metadata?: Record<string, unknown>;
  userId: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("job_activity").insert({
    business_id: input.businessId,
    event_type: input.eventType,
    job_id: input.jobId,
    message: input.message,
    metadata: input.metadata ?? {},
    user_id: input.userId,
  });

  if (error) {
    throw new Error(`Could not log job activity: ${error.message}`);
  }
}

async function requireBusinessId() {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("business_members").select("business_id").limit(1).single();

  if (!data?.business_id) {
    redirect("/dashboard");
  }

  return data.business_id as string;
}

async function requireBusinessAccess(businessId: string) {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("business_id", businessId)
    .limit(1)
    .single();

  if (error || !data?.business_id) {
    redirect(`/dashboard?view=Settings&message=${message("Could not access that workspace.")}`);
  }

  return { businessId: data.business_id as string, supabase, userId };
}

function fieldKeyFromLabel(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function configKeyFromLabel(label: string) {
  return fieldKeyFromLabel(label) || "service";
}

async function seedWorkspaceConfig(supabase: Awaited<ReturnType<typeof createClient>>, businessId: string) {
  await supabase.from("business_service_types").insert(
    defaultServiceTypes.map((service, index) => ({
      business_id: businessId,
      key: service.key,
      label: service.label,
      sort_order: (index + 1) * 10,
    })),
  );

  await supabase.from("business_pipeline_statuses").insert(
    defaultPipelineStatuses.map((status, index) => ({
      business_id: businessId,
      key: status.key,
      label: status.label,
      semantic_type: status.semantic_type,
      sort_order: (index + 1) * 10,
    })),
  );

  await supabase.from("business_dashboard_widgets").insert(
    defaultDashboardWidgets.map((widgetKey, index) => ({
      business_id: businessId,
      sort_order: (index + 1) * 10,
      widget_key: widgetKey,
    })),
  );
}

function parseIntakeOptions(value: FormDataEntryValue | null) {
  return clean(value)
    .split(/\r?\n|,/)
    .map((option) => option.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function parseIntakeField(formData: FormData): ParsedIntakeField {
  const label = clean(formData.get("label")).slice(0, 80);
  const fieldType = clean(formData.get("fieldType")) as IntakeFieldType;
  const fieldKey = (clean(formData.get("fieldKey")) || fieldKeyFromLabel(label)).toLowerCase();
  const options = parseIntakeOptions(formData.get("options"));

  if (!label) {
    return { error: "Field label is required." };
  }

  if (!/^[a-z][a-z0-9_]{1,40}$/.test(fieldKey)) {
    return { error: "Use a stable key like project_goal or garage_size." };
  }

  if (!validIntakeFieldTypes.includes(fieldType)) {
    return { error: "Choose a supported field type." };
  }

  if (fieldType === "select" && options.length === 0) {
    return { error: "Select fields need at least one option." };
  }

  return {
    field: {
      enabled: formData.get("enabled") === "on",
      field_key: fieldKey,
      field_type: fieldType,
      label,
      options,
      required: formData.get("required") === "on",
    },
  };
}

async function requireJobForQuote(jobId: string) {
  const { supabase, userId } = await requireUser();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, business_id, status, price_cents, revenue_cents, first_contact_at, quote_sent_at, won_at, completed_at")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    redirect(`/dashboard?message=${message(error?.message ?? "Could not load that job.")}`);
  }

  return { job, supabase, userId };
}

async function requireQuoteForJob(quoteId: string, jobId: string) {
  const { supabase, userId } = await requireUser();
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, business_id, job_id, amount_cents, status, public_token, public_token_created_at, public_access_revoked_at, sent_at, accepted_at, declined_at")
    .eq("id", quoteId)
    .eq("job_id", jobId)
    .single();

  if (quoteError || !quote) {
    redirect(`/jobs/${jobId}?message=${message(quoteError?.message ?? "Could not load that quote.")}`);
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, business_id, status, price_cents, revenue_cents, first_contact_at, quote_sent_at, won_at, completed_at")
    .eq("id", jobId)
    .eq("business_id", quote.business_id)
    .single();

  if (jobError || !job) {
    redirect(`/jobs/${jobId}?message=${message(jobError?.message ?? "Could not load that job.")}`);
  }

  return { job, quote, supabase, userId };
}

export async function createBusiness(formData: FormData) {
  const name = clean(formData.get("name"));

  if (!name) {
    redirect(`/dashboard?message=${message("Business name is required.")}`);
  }

  const { supabase, userId } = await requireUser();

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .insert({
      name,
      created_by: userId,
    })
    .select("id")
    .single();

  if (businessError || !business) {
    redirect(
      `/dashboard?message=${message(
        businessError?.message ?? "Could not create the business.",
      )}`,
    );
  }

  const { error: memberError } = await supabase.from("business_members").insert({
    business_id: business.id,
    user_id: userId,
    role: "owner",
  });

  if (memberError) {
    redirect(`/dashboard?message=${message(memberError.message)}`);
  }

  await seedWorkspaceConfig(supabase, business.id);

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function createCustomer(formData: FormData) {
  const businessId = clean(formData.get("businessId")) || (await requireBusinessId());
  const name = clean(formData.get("name"));

  if (!name) {
    redirect(`/dashboard?message=${message("Customer name is required.")}`);
  }

  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      address_line1: optional(formData.get("addressLine1")),
      address_line2: optional(formData.get("addressLine2")),
      business_id: businessId,
      city: optional(formData.get("city")),
      email: optional(formData.get("email")),
      name,
      notes: optional(formData.get("notes")),
      phone: optional(formData.get("phone")),
      postal_code: optional(formData.get("postalCode")),
      state: optional(formData.get("state")),
    })
    .select("id")
    .single();

  if (error || !data) {
    redirect(`/dashboard?message=${message(error?.message ?? "Could not create customer.")}`);
  }

  revalidatePath("/dashboard");
  redirect(`/customers/${data.id}?message=${message("Customer created.")}`);
}

export async function updateCustomer(formData: FormData) {
  const customerId = clean(formData.get("customerId"));

  if (!customerId) {
    redirect(`/dashboard?message=${message("Could not find that customer.")}`);
  }

  await updateCustomerRecord(customerId, formData);
}

export async function updateCustomerById(customerId: string, formData: FormData) {
  await updateCustomerRecord(customerId, formData);
}

export async function updateCustomerByIdWithContactFallback(customerId: string, currentPhone: string, currentEmail: string, formData: FormData) {
  await updateCustomerRecord(customerId, formData, { currentEmail, currentPhone });
}

async function updateCustomerRecord(
  customerId: string,
  formData: FormData,
  fallback: { currentEmail: string; currentPhone: string } | null = null,
) {
  const name = clean(formData.get("name"));

  if (!name) {
    redirect(`/customers/${customerId}?message=${message("Customer name is required.")}`);
  }

  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("customers")
    .update({
      address_line1: optional(formData.get("addressLine1")),
      address_line2: optional(formData.get("addressLine2")),
      city: optional(formData.get("city")),
      email: optional(formData.get("customerEmail") ?? formData.get("email")) ?? fallback?.currentEmail ?? null,
      name,
      notes: optional(formData.get("notes")),
      phone: optional(formData.get("customerPhone") ?? formData.get("phone")) ?? fallback?.currentPhone ?? null,
      postal_code: optional(formData.get("postalCode")),
      state: optional(formData.get("state")),
    })
    .eq("id", customerId);

  if (error) {
    redirect(`/customers/${customerId}?message=${message(error.message)}`);
  }

  revalidatePath("/dashboard");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?message=${message("Customer updated.")}`);
}

export async function createJob(formData: FormData) {
  const businessId = clean(formData.get("businessId")) || (await requireBusinessId());
  const customerId = clean(formData.get("customerId"));
  const title = clean(formData.get("title"));
  const status = clean(formData.get("status")) as JobStatus;
  const scheduledStart = scheduleValue(formData.get("scheduledDate"), formData.get("scheduledTime"));
  const submittedEnd = scheduleValue(formData.get("scheduledEndDate"), formData.get("scheduledEndTime"));
  const scheduledEnd = normalizeScheduledEnd(scheduledStart, submittedEnd);
  const source = (clean(formData.get("source")) || "manual") as JobSource;
  const projectType = optional(formData.get("projectType"));

  if (!businessId || !customerId || !title) {
    redirect(`/dashboard?message=${message("Customer and job title are required.")}`);
  }

  if (!validSources.includes(source)) {
    redirect(`/dashboard?message=${message("Choose a supported lead source.")}`);
  }

  if (!validStatuses.includes(status)) {
    redirect(`/dashboard?message=${message("That status is not supported.")}`);
  }

  if (needsConfirmedSchedule(status) && !scheduledStart) {
    redirect(`/dashboard?message=${message("Scheduled, active, and completed jobs need a confirmed start date.")}`);
  }

  if (submittedEnd && !scheduledEnd) {
    redirect(`/dashboard?message=${message("End time cannot be earlier than the start time.")}`);
  }

  const { supabase, userId } = await requireUser();
  const { data: customer } = await supabase
    .from("customers")
    .select("name, address_line1, address_line2, city, state, postal_code")
    .eq("id", customerId)
    .eq("business_id", businessId)
    .single();

  const customerAddress = [
    customer?.address_line1,
    customer?.address_line2,
    customer?.city,
    customer?.state,
    customer?.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
  const address = optional(formData.get("jobAddress")) ?? (customerAddress || null);
  const priceCents = moneyToCents(formData.get("price"));
  const transitionUpdate = statusTransitionUpdate({
    currentCompletedAt: null,
    currentFirstContactAt: null,
    currentQuoteSentAt: null,
    currentWonAt: null,
    nextStatus: status,
    priceCents,
  });

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      business_id: businessId,
      customer_id: customerId,
      customer_name: customer?.name ?? "Customer",
      description: optional(formData.get("description")),
      internal_notes: optional(formData.get("internalNotes")),
      job_address: address,
      job_title: title,
      price_cents: priceCents,
      project_type: projectType,
      revenue_cents: revenueForJob(status, priceCents, transitionUpdate.won_at as string | null | undefined),
      scheduled_date: scheduledStart ? scheduledStart.slice(0, 10) : null,
      scheduled_end: scheduledEnd,
      scheduled_start: scheduledStart,
      source,
      title,
      ...transitionUpdate,
    })
    .select("id")
    .single();

  if (error || !job) {
    redirect(`/dashboard?message=${message(error?.message ?? "Could not create job.")}`);
  }

  await logActivity({
    businessId,
    eventType: "job_created",
    jobId: job.id,
    message: "Job created.",
    userId,
  });

  if (scheduledStart) {
    await logActivity({
      businessId,
      eventType: "scheduled",
      jobId: job.id,
      message: `Scheduled for ${formatActivityDateTime(scheduledStart)}.`,
      metadata: { scheduled_start: scheduledStart },
      userId,
    });
  }

  revalidatePath("/dashboard");
  redirect(`/jobs/${job.id}?message=${message("Job created.")}`);
}

export async function updateJob(formData: FormData) {
  const jobId = clean(formData.get("jobId"));

  if (!jobId) {
    redirect(`/dashboard?message=${message("Could not find that job.")}`);
  }

  const customerId = clean(formData.get("customerId"));
  const title = clean(formData.get("title"));
  const status = clean(formData.get("status")) as JobStatus;
  const scheduledStart = scheduleValue(formData.get("scheduledDate"), formData.get("scheduledTime"));
  const submittedEnd = scheduleValue(formData.get("scheduledEndDate"), formData.get("scheduledEndTime"));
  const scheduledEnd = normalizeScheduledEnd(scheduledStart, submittedEnd);
  const priceCents = moneyToCents(formData.get("price"));
  const source = (clean(formData.get("source")) || "manual") as JobSource;
  const projectType = optional(formData.get("projectType"));

  if (!customerId || !title) {
    redirect(`/jobs/${jobId}?message=${message("Customer and job title are required.")}`);
  }

  if (!validStatuses.includes(status)) {
    redirect(`/jobs/${jobId}?message=${message("That status is not supported.")}`);
  }

  if (!validSources.includes(source)) {
    redirect(`/jobs/${jobId}?message=${message("Choose a supported lead source.")}`);
  }

  if (needsConfirmedSchedule(status) && !scheduledStart) {
    redirect(`/jobs/${jobId}?message=${message("Scheduled, active, and completed jobs need a confirmed start date.")}`);
  }

  if (submittedEnd && !scheduledEnd) {
    redirect(`/jobs/${jobId}?message=${message("End time cannot be earlier than the start time.")}`);
  }

  const { supabase, userId } = await requireUser();
  const { data: current, error: currentError } = await supabase
    .from("jobs")
    .select("business_id, customer_id, title, status, price_cents, revenue_cents, source, scheduled_start, first_contact_at, quote_sent_at, won_at, completed_at, lost_reason")
    .eq("id", jobId)
    .single();

  if (currentError || !current) {
    redirect(`/dashboard?message=${message(currentError?.message ?? "Could not load that job.")}`);
  }

  if (status === "lost" && !current.lost_reason) {
    redirect(`/jobs/${jobId}?message=${message("Use Mark Lost so a lost reason is recorded.")}`);
  }

  const { data: customer } = await supabase
    .from("customers")
    .select("name")
    .eq("id", customerId)
    .eq("business_id", current.business_id)
    .single();

  const transitionUpdate = current.status !== status
    ? statusTransitionUpdate({
        currentFirstContactAt: current.first_contact_at,
        currentQuoteSentAt: current.quote_sent_at,
        currentWonAt: current.won_at,
        currentCompletedAt: current.completed_at,
        nextStatus: status,
        priceCents,
      })
    : {};
  const revenueCents = transitionUpdate.revenue_cents ?? revenueForJob(status, priceCents, (transitionUpdate.won_at as string | null | undefined) ?? current.won_at);

  const { error } = await supabase
    .from("jobs")
    .update({
      customer_id: customerId,
      customer_name: customer?.name ?? "Customer",
      description: optional(formData.get("description")),
      internal_notes: optional(formData.get("internalNotes")),
      job_address: optional(formData.get("jobAddress")),
      job_title: title,
      price_cents: priceCents,
      project_type: projectType,
      revenue_cents: revenueCents,
      scheduled_date: scheduledStart ? scheduledStart.slice(0, 10) : null,
      scheduled_end: scheduledEnd,
      scheduled_start: scheduledStart,
      source,
      status,
      title,
      ...transitionUpdate,
    })
    .eq("id", jobId);

  if (error) {
    redirect(`/jobs/${jobId}?message=${message(error.message)}`);
  }

  const activity = [];

  if (current.status !== status) {
    activity.push({
      eventType: "status_changed",
      message: statusActivityMessage(current.status as JobStatus, status),
      metadata: { from: current.status, to: status },
    });
  }

  if (current.scheduled_start !== scheduledStart) {
    activity.push({
      eventType: "schedule_changed",
      message: scheduledStart ? `Scheduled for ${formatActivityDateTime(scheduledStart)}.` : "Schedule cleared.",
      metadata: { from: current.scheduled_start, to: scheduledStart },
    });
  }

  if (current.price_cents !== priceCents) {
    activity.push({
      eventType: "value_changed",
      message: `Job value changed from ${formatMoney(current.price_cents)} to ${formatMoney(priceCents)}.`,
      metadata: { from: current.price_cents, to: priceCents },
    });
  }

  if (current.source !== source) {
    activity.push({
      eventType: "source_changed",
      message: "Lead source updated.",
      metadata: { from: current.source, to: source },
    });
  }

  if (current.customer_id !== customerId) {
    activity.push({
      eventType: "customer_changed",
      message: `Customer changed to ${customer?.name ?? "selected customer"}.`,
      metadata: { from: current.customer_id, to: customerId },
    });
  }

  await Promise.all(
    activity.map((entry) =>
      logActivity({
        businessId: current.business_id,
        eventType: entry.eventType,
        jobId,
        message: entry.message,
        metadata: entry.metadata,
        userId,
      }),
    ),
  );

  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}?message=${message("Job updated.")}`);
}

export async function updateJobStatus(formData: FormData) {
  const jobId = clean(formData.get("jobId"));
  const status = clean(formData.get("status")) as JobStatus;

  if (!jobId) {
    redirect(`/dashboard?message=${message("Could not find that job.")}`);
  }

  if (!validStatuses.includes(status)) {
    redirect(`/dashboard?message=${message("That status is not supported.")}`);
  }

  const { supabase, userId } = await requireUser();
  const { data: current, error: currentError } = await supabase
    .from("jobs")
    .select("business_id, status, price_cents, scheduled_start, first_contact_at, quote_sent_at, won_at, completed_at")
    .eq("id", jobId)
    .single();

  if (currentError || !current) {
    redirect(`/dashboard?message=${message(currentError?.message ?? "Could not load that job.")}`);
  }

  if (status === "lost" && current.status !== "lost") {
    redirect(`/jobs/${jobId}?message=${message("Use Mark Lost so a lost reason is recorded.")}`);
  }

  if (needsConfirmedSchedule(status) && !current.scheduled_start) {
    redirect(`/jobs/${jobId}?message=${message("Set a confirmed schedule before moving this job into scheduled work.")}`);
  }

  const update = statusTransitionUpdate({
    currentCompletedAt: current.completed_at,
    currentFirstContactAt: current.first_contact_at,
    currentQuoteSentAt: current.quote_sent_at,
    currentWonAt: current.won_at,
    nextStatus: status,
    priceCents: current.price_cents,
  });

  const { error } = await supabase.from("jobs").update(update).eq("id", jobId);

  if (error) {
    redirect(`/dashboard?message=${message(error.message)}`);
  }

  if (current.status !== status) {
    await logActivity({
      businessId: current.business_id,
      eventType: "status_changed",
      jobId,
      message: statusActivityMessage(current.status as JobStatus, status),
      metadata: { from: current.status, to: status },
      userId,
    });
  }

  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${jobId}`);
  redirect(clean(formData.get("returnTo")) || "/dashboard");
}

export async function markJobContacted(formData: FormData) {
  const jobId = clean(formData.get("jobId"));

  if (!jobId) {
    redirect(`/dashboard?message=${message("Could not find that job.")}`);
  }

  const returnTo = internalRedirectTarget(formData.get("returnTo"), `/jobs/${jobId}?message=${message("Contact recorded.")}`);

  const { supabase, userId } = await requireUser();
  const { data: current, error: currentError } = await supabase
    .from("jobs")
    .select("business_id, status, first_contact_at, quote_sent_at, scheduled_start, won_at, completed_at")
    .eq("id", jobId)
    .single();

  if (currentError || !current) {
    redirect(`/dashboard?message=${message(currentError?.message ?? "Could not load that job.")}`);
  }

  const nextStatus = current.status === "lead" ? "contacted" : current.status;
  const update = statusTransitionUpdate({
    currentCompletedAt: current.completed_at,
    currentFirstContactAt: current.first_contact_at,
    currentQuoteSentAt: current.quote_sent_at,
    currentWonAt: current.won_at,
    nextStatus,
  });
  const shouldRecordContact = !current.first_contact_at || current.status === "lead";

  if (shouldRecordContact) {
    const { error } = await supabase
      .from("jobs")
      .update(update)
      .eq("id", jobId);

    if (error) {
      redirect(`/jobs/${jobId}?message=${message(error.message)}`);
    }

    await logActivity({
      businessId: current.business_id,
      eventType: "contacted",
      jobId,
      message: current.first_contact_at ? "Customer contact confirmed." : "First contact recorded.",
      metadata: { first_contact_at: update.first_contact_at ?? current.first_contact_at, from: current.status, to: nextStatus },
      userId,
    });
  }

  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${jobId}`);
  redirect(returnTo);
}

export async function markJobQuoted(formData: FormData) {
  const jobId = clean(formData.get("jobId"));

  if (!jobId) {
    redirect(`/dashboard?message=${message("Could not find that job.")}`);
  }

  const { supabase, userId } = await requireUser();
  const { data: current, error: currentError } = await supabase
    .from("jobs")
    .select("business_id, status, first_contact_at, quote_sent_at, scheduled_start, won_at, completed_at")
    .eq("id", jobId)
    .single();

  if (currentError || !current) {
    redirect(`/dashboard?message=${message(currentError?.message ?? "Could not load that job.")}`);
  }

  if (current.status !== "lead" && current.status !== "contacted" && current.status !== "quoted") {
    redirect(`/jobs/${jobId}?message=${message("Only active sales jobs can be moved to quoted.")}`);
  }

  const update = statusTransitionUpdate({
    currentCompletedAt: current.completed_at,
    currentFirstContactAt: current.first_contact_at,
    currentQuoteSentAt: current.quote_sent_at,
    currentWonAt: current.won_at,
    nextStatus: "quoted",
  });
  const { error } = await supabase
    .from("jobs")
    .update(update)
    .eq("id", jobId);

  if (error) {
    redirect(`/jobs/${jobId}?message=${message(error.message)}`);
  }

  await logActivity({
    businessId: current.business_id,
    eventType: "quoted",
    jobId,
    message: current.quote_sent_at ? "Quote status confirmed." : "Job moved to quoted.",
    metadata: { quote_sent_at: update.quote_sent_at ?? current.quote_sent_at, from: current.status, to: "quoted" },
    userId,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}?message=${message("Quote recorded.")}`);
}

export async function setJobFollowUp(formData: FormData) {
  const jobId = clean(formData.get("jobId"));
  const nextFollowUpAt = dateTimeLocalValue(formData.get("nextFollowUpAt"));

  if (!jobId || !nextFollowUpAt) {
    redirect(`/jobs/${jobId || ""}?message=${message("Choose a follow-up date and time.")}`);
  }

  if (new Date(nextFollowUpAt).getTime() <= Date.now()) {
    redirect(`/jobs/${jobId}?message=${message("Choose a future follow-up time.")}`);
  }

  const { supabase, userId } = await requireUser();
  const { data: current, error: currentError } = await supabase
    .from("jobs")
    .select("business_id, next_follow_up_at")
    .eq("id", jobId)
    .single();

  if (currentError || !current) {
    redirect(`/dashboard?message=${message(currentError?.message ?? "Could not load that job.")}`);
  }

  const { error } = await supabase
    .from("jobs")
    .update({ next_follow_up_at: nextFollowUpAt })
    .eq("id", jobId);

  if (error) {
    redirect(`/jobs/${jobId}?message=${message(error.message)}`);
  }

  await logActivity({
    businessId: current.business_id,
    eventType: "follow_up_set",
    jobId,
    message: `Follow-up set for ${formatActivityDateTime(nextFollowUpAt)}.`,
    metadata: { from: current.next_follow_up_at, to: nextFollowUpAt },
    userId,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}?message=${message("Follow-up saved.")}`);
}

export async function markJobLost(formData: FormData) {
  const jobId = clean(formData.get("jobId"));
  const lostReason = clean(formData.get("lostReason"));

  if (!jobId) {
    redirect(`/dashboard?message=${message("Could not find that job.")}`);
  }

  if (!validLostReasons.includes(lostReason)) {
    redirect(`/jobs/${jobId}?message=${message("Choose a lost reason.")}`);
  }

  const { supabase, userId } = await requireUser();
  const { data: current, error: currentError } = await supabase
    .from("jobs")
    .select("business_id, status, lost_at")
    .eq("id", jobId)
    .single();

  if (currentError || !current) {
    redirect(`/dashboard?message=${message(currentError?.message ?? "Could not load that job.")}`);
  }

  const lostAt = new Date().toISOString();
  const { error } = await supabase
    .from("jobs")
    .update({
      lost_at: current.lost_at ?? lostAt,
      lost_reason: lostReason,
      revenue_cents: 0,
      status: "lost",
    })
    .eq("id", jobId);

  if (error) {
    redirect(`/jobs/${jobId}?message=${message(error.message)}`);
  }

  await logActivity({
    businessId: current.business_id,
    eventType: "lost",
    jobId,
    message: `Marked lost: ${lostReason.replace(/_/g, " ")}.`,
    metadata: { from: current.status, lost_at: current.lost_at ?? lostAt, lost_reason: lostReason, to: "lost" },
    userId,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}?message=${message("Job marked lost.")}`);
}

export async function saveQuote(formData: FormData) {
  const jobId = clean(formData.get("jobId"));
  const quoteId = clean(formData.get("quoteId"));
  const amountCents = moneyToCents(formData.get("amount"));
  const validUntil = optional(formData.get("validUntil"));

  if (!jobId) {
    redirect(`/dashboard?message=${message("Could not find that job.")}`);
  }

  if (amountCents <= 0) {
    redirect(`/jobs/${jobId}?message=${message("Enter a quote amount greater than $0.")}`);
  }

  const { job, supabase, userId } = await requireJobForQuote(jobId);

  if (isClosedStatus(job.status as JobStatus)) {
    redirect(`/jobs/${jobId}?message=${message("Closed jobs cannot be quoted.")}`);
  }

  const quotePayload = {
    amount_cents: amountCents,
    notes: optional(formData.get("quoteNotes")),
    valid_until: validUntil,
  };

  const query = quoteId
    ? supabase
        .from("quotes")
        .update(quotePayload)
        .eq("id", quoteId)
        .eq("job_id", jobId)
        .eq("business_id", job.business_id)
        .select("id, status")
        .single()
    : supabase
        .from("quotes")
        .insert({
          ...quotePayload,
          business_id: job.business_id,
          job_id: jobId,
          public_token: publicQuoteToken(),
          status: "draft",
        })
        .select("id, status")
        .single();

  const { data: quote, error } = await query;

  if (error || !quote) {
    redirect(`/jobs/${jobId}?message=${message(error?.message ?? "Could not save quote.")}`);
  }

  if ((quote.status as QuoteStatus) === "accepted") {
    const { error: jobError } = await supabase
      .from("jobs")
      .update({ price_cents: amountCents, revenue_cents: amountCents })
      .eq("id", jobId)
      .eq("business_id", job.business_id);

    if (jobError) {
      redirect(`/jobs/${jobId}?message=${message(jobError.message)}`);
    }
  }

  await logActivity({
    businessId: job.business_id,
    eventType: quoteId ? "quote_updated" : "quote_created",
    jobId,
    message: quoteId ? `Quote updated to ${formatMoney(amountCents)}.` : `Quote draft created for ${formatMoney(amountCents)}.`,
    metadata: { amount_cents: amountCents, quote_id: quote.id, status: quote.status, valid_until: validUntil },
    userId,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}?message=${message("Quote saved.")}`);
}

export async function markQuoteSent(formData: FormData) {
  const jobId = clean(formData.get("jobId"));
  const quoteId = clean(formData.get("quoteId"));

  if (!jobId || !quoteId) {
    redirect(`/jobs/${jobId || ""}?message=${message("Could not find that quote.")}`);
  }

  const { job, quote, supabase, userId } = await requireQuoteForJob(quoteId, jobId);
  const currentQuoteStatus = quote.status as QuoteStatus;

  if (isClosedStatus(job.status as JobStatus)) {
    redirect(`/jobs/${jobId}?message=${message("Closed jobs cannot be quoted.")}`);
  }

  if (!validQuoteStatuses.includes(currentQuoteStatus) || currentQuoteStatus === "accepted" || currentQuoteStatus === "declined") {
    redirect(`/jobs/${jobId}?message=${message("Only draft quotes can be marked sent.")}`);
  }

  const sentAt = quote.sent_at ?? new Date().toISOString();
  const { error: quoteError } = await supabase
    .from("quotes")
    .update({
      accepted_at: null,
      declined_at: null,
      public_token: quote.public_token ?? publicQuoteToken(),
      public_access_revoked_at: null,
      sent_at: sentAt,
      status: "sent",
    })
    .eq("id", quoteId)
    .eq("job_id", jobId);

  if (quoteError) {
    redirect(`/jobs/${jobId}?message=${message(quoteError.message)}`);
  }

  if (["lead", "contacted", "quoted"].includes(job.status as JobStatus)) {
    const jobUpdate = statusTransitionUpdate({
      currentCompletedAt: job.completed_at,
      currentFirstContactAt: job.first_contact_at,
      currentQuoteSentAt: job.quote_sent_at,
      currentWonAt: job.won_at,
      nextStatus: "quoted",
    });
    const { error: jobError } = await supabase.from("jobs").update(jobUpdate).eq("id", jobId);

    if (jobError) {
      redirect(`/jobs/${jobId}?message=${message(jobError.message)}`);
    }
  }

  await logActivity({
    businessId: quote.business_id,
    eventType: "quote_sent",
    jobId,
    message: `Quote sent for ${formatMoney(quote.amount_cents)}.`,
    metadata: { amount_cents: quote.amount_cents, quote_id: quote.id, sent_at: sentAt, status: "sent" },
    userId,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}?message=${message("Quote marked sent.")}`);
}

export async function markQuoteAccepted(formData: FormData) {
  const jobId = clean(formData.get("jobId"));
  const quoteId = clean(formData.get("quoteId"));

  if (!jobId || !quoteId) {
    redirect(`/jobs/${jobId || ""}?message=${message("Could not find that quote.")}`);
  }

  const { job, quote, supabase, userId } = await requireQuoteForJob(quoteId, jobId);
  const currentQuoteStatus = quote.status as QuoteStatus;

  if (isClosedStatus(job.status as JobStatus)) {
    redirect(`/jobs/${jobId}?message=${message("Closed jobs cannot be quoted.")}`);
  }

  if (!validQuoteStatuses.includes(currentQuoteStatus) || currentQuoteStatus === "declined") {
    redirect(`/jobs/${jobId}?message=${message("Declined quotes cannot be accepted. Save a new quote first.")}`);
  }

  const acceptedAt = quote.accepted_at ?? new Date().toISOString();
  const sentAt = quote.sent_at ?? acceptedAt;
  const { error: quoteError } = await supabase
    .from("quotes")
    .update({
      accepted_at: acceptedAt,
      declined_at: null,
      sent_at: sentAt,
      status: "accepted",
    })
    .eq("id", quoteId)
    .eq("job_id", jobId);

  if (quoteError) {
    redirect(`/jobs/${jobId}?message=${message(quoteError.message)}`);
  }

  const statusUpdate = ["lead", "contacted", "quoted"].includes(job.status as JobStatus)
    ? statusTransitionUpdate({
        currentCompletedAt: job.completed_at,
        currentFirstContactAt: job.first_contact_at,
        currentQuoteSentAt: job.quote_sent_at,
        currentWonAt: job.won_at,
        nextStatus: "quoted",
      })
    : {};
  const wonAt = job.won_at ?? new Date().toISOString();
  const { error: jobError } = await supabase
    .from("jobs")
    .update({
      ...statusUpdate,
      next_follow_up_at: null,
      price_cents: quote.amount_cents,
      revenue_cents: quote.amount_cents,
      won_at: wonAt,
    })
    .eq("id", jobId);

  if (jobError) {
    redirect(`/jobs/${jobId}?message=${message(jobError.message)}`);
  }

  await logActivity({
    businessId: quote.business_id,
    eventType: "quote_accepted",
    jobId,
    message: `Quote accepted for ${formatMoney(quote.amount_cents)}.`,
    metadata: { accepted_at: acceptedAt, amount_cents: quote.amount_cents, quote_id: quote.id, sent_at: sentAt, status: "accepted", won_at: wonAt },
    userId,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}?message=${message("Quote accepted.")}`);
}

export async function markQuoteDeclined(formData: FormData) {
  const jobId = clean(formData.get("jobId"));
  const quoteId = clean(formData.get("quoteId"));

  if (!jobId || !quoteId) {
    redirect(`/jobs/${jobId || ""}?message=${message("Could not find that quote.")}`);
  }

  const { job, quote, supabase, userId } = await requireQuoteForJob(quoteId, jobId);
  const currentQuoteStatus = quote.status as QuoteStatus;

  if (isClosedStatus(job.status as JobStatus)) {
    redirect(`/jobs/${jobId}?message=${message("Closed jobs cannot be quoted.")}`);
  }

  if (!validQuoteStatuses.includes(currentQuoteStatus) || currentQuoteStatus === "accepted") {
    redirect(`/jobs/${jobId}?message=${message("Accepted quotes cannot be declined.")}`);
  }

  const declinedAt = quote.declined_at ?? new Date().toISOString();
  const nextStatus = "declined" satisfies QuoteStatus;

  if (!validQuoteStatuses.includes(nextStatus)) {
    redirect(`/jobs/${jobId}?message=${message("That quote status is not supported.")}`);
  }

  const { error } = await supabase
    .from("quotes")
    .update({
      accepted_at: null,
      declined_at: declinedAt,
      status: nextStatus,
    })
    .eq("id", quoteId)
    .eq("job_id", jobId);

  if (error) {
    redirect(`/jobs/${jobId}?message=${message(error.message)}`);
  }

  await logActivity({
    businessId: quote.business_id,
    eventType: "quote_declined",
    jobId,
    message: `Quote declined for ${formatMoney(quote.amount_cents)}.`,
    metadata: { amount_cents: quote.amount_cents, declined_at: declinedAt, quote_id: quote.id, status: nextStatus },
    userId,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}?message=${message("Quote declined.")}`);
}

export async function resolveQuoteMessage(formData: FormData) {
  const messageId = clean(formData.get("messageId"));

  if (!messageId) {
    redirect(`/dashboard?message=${message("Could not find that quote message.")}`);
  }

  const { supabase, userId } = await requireUser();
  const { data: quoteMessage, error: messageError } = await supabase
    .from("quote_messages")
    .select("id, business_id, quote_id, job_id, resolved_at")
    .eq("id", messageId)
    .single();

  if (messageError || !quoteMessage) {
    redirect(`/dashboard?message=${message(messageError?.message ?? "Could not load that quote message.")}`);
  }

  if (!quoteMessage.resolved_at) {
    const resolvedAt = new Date().toISOString();
    const { error } = await supabase
      .from("quote_messages")
      .update({ resolved_at: resolvedAt })
      .eq("id", messageId)
      .is("resolved_at", null);

    if (error) {
      redirect(`/jobs/${quoteMessage.job_id}?message=${message(error.message)}`);
    }

    await logActivity({
      businessId: quoteMessage.business_id,
      eventType: "quote_message_resolved",
      jobId: quoteMessage.job_id,
      message: "Quote question resolved.",
      metadata: { quote_id: quoteMessage.quote_id, quote_message_id: quoteMessage.id, resolved_at: resolvedAt },
      userId,
    });
  }

  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${quoteMessage.job_id}`);
  redirect(`/jobs/${quoteMessage.job_id}?message=${message("Quote question resolved.")}#quote`);
}

export async function sendQuoteReply(formData: FormData) {
  const quoteId = clean(formData.get("quoteId"));
  const reply = clean(formData.get("reply")).slice(0, 1000);

  if (!quoteId) {
    redirect(`/dashboard?message=${message("Could not find that quote.")}`);
  }

  if (!reply) {
    redirect(`/dashboard?message=${message("Write a reply before sending.")}`);
  }

  const { supabase, userId } = await requireUser();
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, business_id, job_id, public_token")
    .eq("id", quoteId)
    .single();

  if (quoteError || !quote) {
    redirect(`/dashboard?message=${message(quoteError?.message ?? "Could not load that quote.")}`);
  }

  const { data: existingReply } = await supabase
    .from("quote_messages")
    .select("id")
    .eq("quote_id", quote.id)
    .eq("source", "business")
    .eq("message", reply)
    .gte("created_at", new Date(Date.now() - 2 * 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existingReply) {
    const { data: inserted, error: insertError } = await supabase
      .from("quote_messages")
      .insert({
        business_id: quote.business_id,
        job_id: quote.job_id,
        message: reply,
        quote_id: quote.id,
        source: "business",
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      redirect(`/jobs/${quote.job_id}?message=${message(insertError?.message ?? "Could not send that reply.")}#quote`);
    }

    await logActivity({
      businessId: quote.business_id,
      eventType: "quote_message_replied",
      jobId: quote.job_id,
      message: "Business replied to customer.",
      metadata: { quote_id: quote.id, quote_message_id: inserted.id, source: "business", message: reply },
      userId,
    });
  }

  const { error: resolveError } = await supabase
    .from("quote_messages")
    .update({ resolved_at: new Date().toISOString() })
    .eq("quote_id", quote.id)
    .eq("source", "customer")
    .is("resolved_at", null);

  if (resolveError) {
    redirect(`/jobs/${quote.job_id}?message=${message(resolveError.message)}#quote`);
  }

  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${quote.job_id}`);
  revalidatePath(`/quote/${quote.public_token}`);
  redirect(`/jobs/${quote.job_id}?message=${message(existingReply ? "Reply already sent." : "Reply sent.")}#quote`);
}

export async function uploadJobPhotos(formData: FormData) {
  const jobId = clean(formData.get("jobId"));
  const category = clean(formData.get("category")) as JobFileCategory;
  const files = formData.getAll("photos").filter((value): value is File => value instanceof File && value.size > 0);

  if (!jobId) {
    redirect(`/dashboard?message=${message("Could not find that job.")}`);
  }

  if (!validPhotoCategories.includes(category)) {
    redirect(`/jobs/${jobId}?message=${message("Choose a valid photo category.")}`);
  }

  const validationError = validatePhotoFiles(files);

  if (validationError) {
    redirect(`/jobs/${jobId}?message=${message(validationError)}`);
  }

  const { supabase, userId } = await requireUser();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, business_id")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    redirect(`/dashboard?message=${message(jobError?.message ?? "Could not load that job.")}`);
  }

  let uploadedCount = 0;

  for (const file of files) {
    const storagePath = `${job.business_id}/${job.id}/${category}/${crypto.randomUUID()}.${extensionForMime(file.type)}`;
    const upload = await supabase.storage.from("job-files").upload(storagePath, await file.arrayBuffer(), {
      contentType: file.type,
      metadata: {
        mimetype: file.type,
        size: String(file.size),
      },
      upsert: false,
    });

    if (upload.error) {
      redirect(`/jobs/${jobId}?message=${message("That photo could not be uploaded. Please try again.")}`);
    }

    const { error: metadataError } = await supabase.from("job_files").insert({
      business_id: job.business_id,
      category,
      file_name: displayFileName(file.name),
      job_id: job.id,
      mime_type: file.type.toLowerCase(),
      size_bytes: file.size,
      source_context: "job_detail",
      storage_bucket: "job-files",
      storage_path: storagePath,
    });

    if (metadataError) {
      await supabase.storage.from("job-files").remove([storagePath]);
      redirect(`/jobs/${jobId}?message=${message("That photo could not be saved. Please try again.")}`);
    }

    uploadedCount += 1;
  }

  await logActivity({
    businessId: job.business_id,
    eventType: "photos_uploaded",
    jobId,
    message: uploadedCount === 1 ? "1 job photo uploaded." : `${uploadedCount} job photos uploaded.`,
    metadata: { category, count: uploadedCount },
    userId,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}?message=${message(uploadedCount === 1 ? "Photo uploaded." : "Photos uploaded.")}`);
}

export async function updateBusiness(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const name = clean(formData.get("name"));

  if (!businessId || !name) {
    redirect(`/dashboard?message=${message("Business name is required.")}`);
  }

  const { supabase } = await requireUser();
  const { error } = await supabase.from("businesses").update({ name }).eq("id", businessId);

  if (error) {
    redirect(`/dashboard?message=${message(error.message)}`);
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard?message=${message("Workspace updated.")}`);
}

export async function updateIntakeSettings(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const title = clean(formData.get("intakeTitle"));
  const description = clean(formData.get("intakeDescription"));

  if (!businessId) {
    redirect(`/dashboard?message=${message("Could not find that workspace.")}`);
  }

  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("businesses")
    .update({
      intake_form_description: description || "Share a few details and we will follow up with next steps.",
      intake_form_enabled: formData.get("intakeEnabled") === "on",
      intake_form_title: title || "Tell us about your project",
    })
    .eq("id", businessId);

  if (error) {
    redirect(`/dashboard?message=${message(error.message)}`);
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard?message=${message("Intake form settings saved.")}`);
}

export async function createIntakeField(formData: FormData) {
  const businessId = clean(formData.get("businessId"));

  if (!businessId) {
    redirect(`/dashboard?view=Settings&message=${message("Could not find that workspace.")}`);
  }

  const parsed = parseIntakeField(formData);

  if ("error" in parsed) {
    redirect(`/dashboard?view=Settings&message=${message(parsed.error)}`);
  }

  const { supabase } = await requireBusinessAccess(businessId);
  const { data: lastField } = await supabase
    .from("intake_fields")
    .select("sort_order")
    .eq("business_id", businessId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("intake_fields").insert({
    ...parsed.field,
    business_id: businessId,
    sort_order: Number(lastField?.sort_order ?? 0) + 10,
  });

  if (error) {
    redirect(`/dashboard?view=Settings&message=${message(error.message)}`);
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard?view=Settings&message=${message("Intake field added.")}`);
}

export async function updateIntakeField(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const fieldId = clean(formData.get("fieldId"));

  if (!businessId || !fieldId) {
    redirect(`/dashboard?view=Settings&message=${message("Could not find that intake field.")}`);
  }

  const parsed = parseIntakeField(formData);

  if ("error" in parsed) {
    redirect(`/dashboard?view=Settings&message=${message(parsed.error)}`);
  }

  const { supabase } = await requireBusinessAccess(businessId);
  const { error } = await supabase
    .from("intake_fields")
    .update(parsed.field)
    .eq("business_id", businessId)
    .eq("id", fieldId);

  if (error) {
    redirect(`/dashboard?view=Settings&message=${message(error.message)}`);
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard?view=Settings&message=${message("Intake field saved.")}`);
}

export async function archiveIntakeField(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const fieldId = clean(formData.get("fieldId"));

  if (!businessId || !fieldId) {
    redirect(`/dashboard?view=Settings&message=${message("Could not find that intake field.")}`);
  }

  const { supabase } = await requireBusinessAccess(businessId);
  const { error } = await supabase
    .from("intake_fields")
    .update({ enabled: false })
    .eq("business_id", businessId)
    .eq("id", fieldId);

  if (error) {
    redirect(`/dashboard?view=Settings&message=${message(error.message)}`);
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard?view=Settings&message=${message("Intake field disabled.")}`);
}

export async function moveIntakeField(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const fieldId = clean(formData.get("fieldId"));
  const direction = clean(formData.get("direction"));

  if (!businessId || !fieldId || (direction !== "up" && direction !== "down")) {
    redirect(`/dashboard?view=Settings&message=${message("Could not reorder that intake field.")}`);
  }

  const { supabase } = await requireBusinessAccess(businessId);
  const { data: fields, error: fieldsError } = await supabase
    .from("intake_fields")
    .select("id, sort_order")
    .eq("business_id", businessId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (fieldsError || !fields?.length) {
    redirect(`/dashboard?view=Settings&message=${message(fieldsError?.message ?? "Could not load intake fields.")}`);
  }

  const currentIndex = fields.findIndex((field) => field.id === fieldId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= fields.length) {
    redirect(`/dashboard?view=Settings`);
  }

  const current = fields[currentIndex];
  const target = fields[targetIndex];
  const { error: firstError } = await supabase
    .from("intake_fields")
    .update({ sort_order: target.sort_order })
    .eq("business_id", businessId)
    .eq("id", current.id);

  if (firstError) {
    redirect(`/dashboard?view=Settings&message=${message(firstError.message)}`);
  }

  const { error: secondError } = await supabase
    .from("intake_fields")
    .update({ sort_order: current.sort_order })
    .eq("business_id", businessId)
    .eq("id", target.id);

  if (secondError) {
    redirect(`/dashboard?view=Settings&message=${message(secondError.message)}`);
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard?view=Settings`);
}

export async function createServiceType(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const label = clean(formData.get("label")).slice(0, 80);
  const key = (clean(formData.get("key")) || configKeyFromLabel(label)).toLowerCase();

  if (!businessId || !label) {
    redirect(`/dashboard?view=Settings&message=${message("Service label is required.")}`);
  }

  if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) {
    redirect(`/dashboard?view=Settings&message=${message("Use a stable key like window_cleaning.")}`);
  }

  const { supabase } = await requireBusinessAccess(businessId);
  const { data: lastService } = await supabase
    .from("business_service_types")
    .select("sort_order")
    .eq("business_id", businessId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("business_service_types").insert({
    business_id: businessId,
    enabled: true,
    key,
    label,
    sort_order: Number(lastService?.sort_order ?? 0) + 10,
  });

  if (error) {
    redirect(`/dashboard?view=Settings&message=${message(error.message)}`);
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard?view=Settings&message=${message("Service type added.")}`);
}

export async function updateServiceType(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const serviceId = clean(formData.get("serviceId"));
  const label = clean(formData.get("label")).slice(0, 80);

  if (!businessId || !serviceId || !label) {
    redirect(`/dashboard?view=Settings&message=${message("Service label is required.")}`);
  }

  const { supabase } = await requireBusinessAccess(businessId);
  const { error } = await supabase
    .from("business_service_types")
    .update({ enabled: formData.get("enabled") === "on", label })
    .eq("business_id", businessId)
    .eq("id", serviceId);

  if (error) {
    redirect(`/dashboard?view=Settings&message=${message(error.message)}`);
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard?view=Settings&message=${message("Service type saved.")}`);
}

export async function archiveServiceType(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const serviceId = clean(formData.get("serviceId"));

  if (!businessId || !serviceId) {
    redirect(`/dashboard?view=Settings&message=${message("Could not find that service type.")}`);
  }

  const { supabase } = await requireBusinessAccess(businessId);
  const { error } = await supabase
    .from("business_service_types")
    .update({ enabled: false })
    .eq("business_id", businessId)
    .eq("id", serviceId);

  if (error) {
    redirect(`/dashboard?view=Settings&message=${message(error.message)}`);
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard?view=Settings&message=${message("Service type disabled.")}`);
}

export async function updatePipelineStatusConfig(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const statusId = clean(formData.get("statusId"));
  const label = clean(formData.get("label")).slice(0, 80);
  const semanticType = clean(formData.get("semanticType")) as JobStatus;

  if (!businessId || !statusId || !label || !validStatuses.includes(semanticType)) {
    redirect(`/dashboard?view=Settings&message=${message("Could not update that pipeline status.")}`);
  }

  const cannotDisable = semanticType === "lead" || semanticType === "completed" || semanticType === "lost";
  const { supabase } = await requireBusinessAccess(businessId);
  const { error } = await supabase
    .from("business_pipeline_statuses")
    .update({ enabled: cannotDisable ? true : formData.get("enabled") === "on", label })
    .eq("business_id", businessId)
    .eq("id", statusId)
    .eq("semantic_type", semanticType);

  if (error) {
    redirect(`/dashboard?view=Settings&message=${message(error.message)}`);
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard?view=Settings&message=${message("Pipeline status saved.")}`);
}

export async function updateDashboardWidgetConfig(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const widgetId = clean(formData.get("widgetId"));
  const widgetKey = clean(formData.get("widgetKey")) as DashboardWidgetKey;
  const label = optional(formData.get("labelOverride"));

  if (!businessId || !widgetId || !validDashboardWidgets.includes(widgetKey)) {
    redirect(`/dashboard?view=Settings&message=${message("Could not update that dashboard item.")}`);
  }

  const { supabase } = await requireBusinessAccess(businessId);
  const { error } = await supabase
    .from("business_dashboard_widgets")
    .update({
      enabled: formData.get("enabled") === "on",
      label_override: label ? label.slice(0, 80) : null,
    })
    .eq("business_id", businessId)
    .eq("id", widgetId)
    .eq("widget_key", widgetKey);

  if (error) {
    redirect(`/dashboard?view=Settings&message=${message(error.message)}`);
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard?view=Settings&message=${message("Dashboard item saved.")}`);
}

export async function moveConfigItem(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const itemId = clean(formData.get("itemId"));
  const direction = clean(formData.get("direction"));
  const configType = clean(formData.get("configType"));

  const table =
    configType === "services"
      ? "business_service_types"
      : configType === "pipeline"
        ? "business_pipeline_statuses"
        : configType === "dashboard"
          ? "business_dashboard_widgets"
          : null;

  if (!businessId || !itemId || !table || (direction !== "up" && direction !== "down")) {
    redirect(`/dashboard?view=Settings&message=${message("Could not reorder that item.")}`);
  }

  const { supabase } = await requireBusinessAccess(businessId);
  const { data: items, error: itemsError } = await supabase
    .from(table)
    .select("id, sort_order")
    .eq("business_id", businessId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (itemsError || !items?.length) {
    redirect(`/dashboard?view=Settings&message=${message(itemsError?.message ?? "Could not load those settings.")}`);
  }

  const currentIndex = items.findIndex((item) => item.id === itemId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length) {
    redirect(`/dashboard?view=Settings`);
  }

  const current = items[currentIndex];
  const target = items[targetIndex];
  const { error: firstError } = await supabase
    .from(table)
    .update({ sort_order: target.sort_order })
    .eq("business_id", businessId)
    .eq("id", current.id);

  if (firstError) {
    redirect(`/dashboard?view=Settings&message=${message(firstError.message)}`);
  }

  const { error: secondError } = await supabase
    .from(table)
    .update({ sort_order: current.sort_order })
    .eq("business_id", businessId)
    .eq("id", target.id);

  if (secondError) {
    redirect(`/dashboard?view=Settings&message=${message(secondError.message)}`);
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard?view=Settings`);
}
