"use server";

import { defaultFollowupSettings, defaultTerminology } from "@/lib/job-tracker/config";
import type { DashboardWidgetKey, JobStatus } from "@/lib/job-tracker/types";
import { createClient } from "@/lib/supabase/server";
import { createHash, randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const validStatuses: JobStatus[] = ["lead", "contacted", "quoted", "scheduled", "in_progress", "completed", "lost"];
const validDashboardWidgets: DashboardWidgetKey[] = ["new_leads", "quoted", "scheduled", "in_progress", "completed", "open_pipeline", "avg_job", "needs_attention", "active_job_board", "upcoming"];
const validWorkspaceStatuses = ["active", "trial", "paused"];

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function optional(value: FormDataEntryValue | null) {
  const cleaned = clean(value);
  return cleaned || null;
}

function message(value: string) {
  return encodeURIComponent(value);
}

function term(formData: FormData, key: string, fallback: string) {
  return (clean(formData.get(key)) || fallback).slice(0, 40);
}

function boundedInteger(value: FormDataEntryValue | null, fallback: number, min: number, max: number) {
  const number = Number(clean(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function configKeyFromLabel(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "service";
}

async function requirePlatformAdmin() {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();

  if (authError || !auth?.claims?.sub) {
    redirect("/");
  }

  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error || data !== true) {
    redirect("/");
  }

  return { supabase, userId: auth.claims.sub as string };
}

async function audit(supabase: Awaited<ReturnType<typeof createClient>>, businessId: string, action: string, entityType: string, metadata: Record<string, unknown>) {
  await supabase.rpc("platform_admin_log", {
    action,
    entity_type: entityType,
    metadata,
    target_business_id: businessId,
  });
}

function detailPath(businessId: string, text: string) {
  return `/admin/workspaces/${businessId}?message=${message(text)}`;
}

const adminSaveErrorMessage = "We couldn't save those changes. Please try again.";

function logAdminWriteError(context: string, error: unknown) {
  console.error(`[FlowDeck admin write] ${context}`, error);
}

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function appOrigin() {
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host");
  const protocol = headersList.get("x-forwarded-proto") ?? "http";
  return host ? `${protocol}://${host}` : "http://localhost:3000";
}

export async function createAdminWorkspace(formData: FormData) {
  const name = clean(formData.get("name"));
  const slug = clean(formData.get("slug"));
  const ownerEmail = optional(formData.get("ownerEmail"));
  const workspaceStatus = clean(formData.get("workspaceStatus")) || "trial";

  if (!name || !slug || !validWorkspaceStatuses.includes(workspaceStatus)) {
    redirect(`/admin/workspaces?message=${message("Workspace name, slug, and status are required.")}#new-workspace`);
  }

  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) {
    redirect(`/admin/workspaces?message=${message("Use a slug like north-texas-roofing.")}#new-workspace`);
  }

  if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    redirect(`/admin/workspaces?message=${message("Enter a valid owner email or leave it blank.")}#new-workspace`);
  }

  const { supabase } = await requirePlatformAdmin();
  const { data, error } = await supabase.rpc("platform_admin_create_workspace", {
    primary_owner_email: ownerEmail,
    workspace_name: name,
    workspace_slug: slug,
    workspace_status: workspaceStatus,
  });
  const result = data as { ok?: boolean; business_id?: string; message?: string } | null;

  if (error || !result?.ok || !result.business_id) {
    redirect(`/admin/workspaces?message=${message(error?.message ?? result?.message ?? "Could not create workspace.")}#new-workspace`);
  }

  revalidatePath("/admin");
  revalidatePath("/admin/workspaces");
  redirect(detailPath(result.business_id, "Workspace created with default configuration."));
}

export async function updateAdminBusiness(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const name = clean(formData.get("name"));
  const slug = clean(formData.get("slug"));
  const ownerEmail = optional(formData.get("ownerEmail"));
  const workspaceStatus = clean(formData.get("workspaceStatus"));

  if (!businessId || !name || !slug || !validWorkspaceStatuses.includes(workspaceStatus)) {
    redirect("/admin/workspaces");
  }

  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) {
    redirect(detailPath(businessId, "Use a slug like north-texas-roofing."));
  }

  const { supabase } = await requirePlatformAdmin();
  const { data: updated, error } = await supabase
    .from("businesses")
    .update({
      client_owner_email: ownerEmail,
      intake_form_enabled: formData.get("intakeEnabled") === "on",
      name,
      slug,
      workspace_status: workspaceStatus,
    })
    .eq("id", businessId)
    .select("id")
    .single();

  if (error || !updated) {
    logAdminWriteError("update workspace", error);
    redirect(detailPath(businessId, adminSaveErrorMessage));
  }

  await audit(supabase, businessId, "business_settings_updated", "business", { client_owner_email: ownerEmail, name, slug, workspace_status: workspaceStatus });
  revalidatePath("/admin");
  revalidatePath(`/admin/workspaces/${businessId}`);
  revalidatePath("/dashboard");
  redirect(detailPath(businessId, "Workspace settings saved."));
}

export async function createOwnerInvite(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const email = clean(formData.get("email")).toLowerCase();

  if (!businessId || !email) {
    redirect("/admin/workspaces");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect(detailPath(businessId, "Enter a valid owner email before creating an invite."));
  }

  const token = randomBytes(32).toString("base64url");
  const inviteUrl = `${await appOrigin()}/invite/${token}`;
  const { supabase } = await requirePlatformAdmin();
  const { data, error } = await supabase.rpc("platform_admin_create_owner_invite", {
    invite_email: email,
    invite_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    invite_token_hash: hashInviteToken(token),
    target_business_id: businessId,
  });
  const result = data as { ok?: boolean; message?: string } | null;

  if (error || !result?.ok) {
    redirect(detailPath(businessId, error?.message ?? result?.message ?? "Could not create owner invite."));
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/workspaces/${businessId}`);
  redirect(`/admin/workspaces/${businessId}?message=${message("Owner invite created. Copy the invite link now; it will not be shown again.")}&invite=${encodeURIComponent(inviteUrl)}`);
}

export async function revokeOwnerInvite(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const inviteId = clean(formData.get("inviteId"));

  if (!businessId || !inviteId) {
    redirect("/admin/workspaces");
  }

  const { supabase } = await requirePlatformAdmin();
  const { data, error } = await supabase.rpc("platform_admin_revoke_owner_invite", {
    target_invite_id: inviteId,
  });
  const result = data as { ok?: boolean; message?: string } | null;

  if (error || !result?.ok) {
    redirect(detailPath(businessId, error?.message ?? result?.message ?? "Could not revoke invite."));
  }

  revalidatePath(`/admin/workspaces/${businessId}`);
  redirect(detailPath(businessId, "Owner invite revoked."));
}

export async function updateAdminIntakeSettings(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const title = clean(formData.get("intakeTitle")).slice(0, 120);
  const description = clean(formData.get("intakeDescription")).slice(0, 280);

  if (!businessId) redirect("/admin/workspaces");

  const payload = {
    intake_form_description: description || "Share a few details and we will follow up with next steps.",
    intake_form_enabled: formData.get("intakeEnabled") === "on",
    intake_form_title: title || "Tell us about your project",
  };

  const { supabase } = await requirePlatformAdmin();
  const { data: updated, error } = await supabase.from("businesses").update(payload).eq("id", businessId).select("id").single();
  if (error || !updated) {
    logAdminWriteError("update intake settings", error);
    redirect(detailPath(businessId, adminSaveErrorMessage));
  }

  await audit(supabase, businessId, "intake_settings_updated", "business", payload);
  revalidatePath(`/admin/workspaces/${businessId}`);
  revalidatePath("/dashboard");
  redirect(detailPath(businessId, "Public intake settings saved."));
}

export async function updateAdminFollowupSettings(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  if (!businessId) redirect("/admin/workspaces");

  const payload = {
    contacted_followup_days: boundedInteger(formData.get("contactedFollowupDays"), defaultFollowupSettings.contacted_followup_days, 1, 365),
    new_lead_followup_hours: boundedInteger(formData.get("newLeadFollowupHours"), defaultFollowupSettings.new_lead_followup_hours, 1, 720),
    proposal_followup_days: boundedInteger(formData.get("proposalFollowupDays"), defaultFollowupSettings.proposal_followup_days, 1, 365),
    reminders_enabled: formData.get("remindersEnabled") === "on",
    stale_opportunity_days: boundedInteger(formData.get("staleOpportunityDays"), defaultFollowupSettings.stale_opportunity_days, 1, 365),
  };

  const { supabase } = await requirePlatformAdmin();
  const { data: saved, error } = await supabase
    .from("business_followup_settings")
    .upsert({ business_id: businessId, ...payload }, { onConflict: "business_id" })
    .select("business_id")
    .single();
  if (error || !saved) {
    logAdminWriteError("update follow-up settings", error);
    redirect(detailPath(businessId, adminSaveErrorMessage));
  }

  await audit(supabase, businessId, "followup_settings_updated", "business_followup_settings", payload);
  revalidatePath(`/admin/workspaces/${businessId}`);
  revalidatePath("/dashboard");
  redirect(detailPath(businessId, "Follow-up automation saved."));
}

export async function updateAdminTerminology(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  if (!businessId) redirect("/admin/workspaces");

  const payload = {
    active_board_title: optional(formData.get("activeBoardTitle"))?.slice(0, 40) ?? null,
    customer_plural: term(formData, "customerPlural", defaultTerminology.customer_plural),
    customer_singular: term(formData, "customerSingular", defaultTerminology.customer_singular),
    job_plural: term(formData, "jobPlural", defaultTerminology.job_plural),
    job_singular: term(formData, "jobSingular", defaultTerminology.job_singular),
    new_customer_button_label: optional(formData.get("newCustomerButtonLabel"))?.slice(0, 40) ?? null,
    new_job_button_label: optional(formData.get("newJobButtonLabel"))?.slice(0, 40) ?? null,
    quote_plural: term(formData, "quotePlural", defaultTerminology.quote_plural),
    quote_singular: term(formData, "quoteSingular", defaultTerminology.quote_singular),
    upcoming_title: optional(formData.get("upcomingTitle"))?.slice(0, 40) ?? null,
  };

  const { supabase } = await requirePlatformAdmin();
  const { data: saved, error } = await supabase
    .from("business_terminology")
    .upsert({ business_id: businessId, ...payload }, { onConflict: "business_id" })
    .select("business_id")
    .single();
  if (error || !saved) {
    logAdminWriteError("update terminology", error);
    redirect(detailPath(businessId, adminSaveErrorMessage));
  }

  await audit(supabase, businessId, "terminology_updated", "terminology", payload);
  revalidatePath(`/admin/workspaces/${businessId}`);
  revalidatePath("/dashboard");
  redirect(detailPath(businessId, "Terminology saved."));
}

export async function updateAdminService(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const serviceId = clean(formData.get("serviceId"));
  const label = clean(formData.get("label")).slice(0, 80);
  if (!businessId || !serviceId || !label) redirect("/admin/workspaces");

  const { supabase } = await requirePlatformAdmin();
  const { data: updated, error } = await supabase
    .from("business_service_types")
    .update({ enabled: formData.get("enabled") === "on", label })
    .eq("business_id", businessId)
    .eq("id", serviceId)
    .select("id")
    .single();
  if (error || !updated) {
    logAdminWriteError("update service", error);
    redirect(detailPath(businessId, adminSaveErrorMessage));
  }

  await audit(supabase, businessId, "service_updated", "service", { service_id: serviceId, label });
  revalidatePath(`/admin/workspaces/${businessId}`);
  redirect(detailPath(businessId, "Service saved."));
}

export async function createAdminService(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const label = clean(formData.get("label")).slice(0, 80);
  const key = (clean(formData.get("key")) || configKeyFromLabel(label)).toLowerCase();
  if (!businessId || !label) redirect("/admin/workspaces");

  if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) {
    redirect(detailPath(businessId, "Use a stable service key like roof_repair."));
  }

  const { supabase } = await requirePlatformAdmin();
  const { data: lastService } = await supabase
    .from("business_service_types")
    .select("sort_order")
    .eq("business_id", businessId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: inserted, error } = await supabase.from("business_service_types").insert({
    business_id: businessId,
    enabled: true,
    key,
    label,
    sort_order: Number(lastService?.sort_order ?? 0) + 10,
  }).select("id").single();

  if (error || !inserted) {
    logAdminWriteError("create service", error);
    redirect(detailPath(businessId, adminSaveErrorMessage));
  }

  await audit(supabase, businessId, "service_created", "service", { key, label });
  revalidatePath(`/admin/workspaces/${businessId}`);
  redirect(detailPath(businessId, "Service added."));
}

export async function updateAdminPipeline(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const statusId = clean(formData.get("statusId"));
  const semanticType = clean(formData.get("semanticType")) as JobStatus;
  const label = clean(formData.get("label")).slice(0, 80);
  if (!businessId || !statusId || !label || !validStatuses.includes(semanticType)) redirect("/admin/workspaces");

  const required = semanticType === "lead" || semanticType === "completed" || semanticType === "lost";
  const { supabase } = await requirePlatformAdmin();
  const { data: updated, error } = await supabase
    .from("business_pipeline_statuses")
    .update({ enabled: required ? true : formData.get("enabled") === "on", label })
    .eq("business_id", businessId)
    .eq("id", statusId)
    .eq("semantic_type", semanticType)
    .select("id")
    .single();
  if (error || !updated) {
    logAdminWriteError("update pipeline", error);
    redirect(detailPath(businessId, adminSaveErrorMessage));
  }

  await audit(supabase, businessId, "pipeline_config_updated", "pipeline", { status_id: statusId, semantic_type: semanticType, label });
  revalidatePath(`/admin/workspaces/${businessId}`);
  redirect(detailPath(businessId, "Pipeline stage saved."));
}

export async function updateAdminDashboardWidget(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const widgetId = clean(formData.get("widgetId"));
  const widgetKey = clean(formData.get("widgetKey")) as DashboardWidgetKey;
  const labelOverride = optional(formData.get("labelOverride"))?.slice(0, 80) ?? null;
  if (!businessId || !widgetId || !validDashboardWidgets.includes(widgetKey)) redirect("/admin/workspaces");

  const { supabase } = await requirePlatformAdmin();
  const { data: updated, error } = await supabase
    .from("business_dashboard_widgets")
    .update({ enabled: formData.get("enabled") === "on", label_override: labelOverride })
    .eq("business_id", businessId)
    .eq("id", widgetId)
    .eq("widget_key", widgetKey)
    .select("id")
    .single();
  if (error || !updated) {
    logAdminWriteError("update dashboard widget", error);
    redirect(detailPath(businessId, adminSaveErrorMessage));
  }

  await audit(supabase, businessId, "dashboard_config_updated", "dashboard", { widget_id: widgetId, widget_key: widgetKey, label_override: labelOverride });
  revalidatePath(`/admin/workspaces/${businessId}`);
  redirect(detailPath(businessId, "Dashboard item saved."));
}

export async function moveAdminConfigItem(formData: FormData) {
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
    redirect("/admin/workspaces");
  }

  const { supabase } = await requirePlatformAdmin();
  const { data: items, error: itemsError } = await supabase
    .from(table)
    .select("id, sort_order")
    .eq("business_id", businessId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (itemsError || !items?.length) {
    redirect(detailPath(businessId, itemsError?.message ?? "Could not load those settings."));
  }

  const currentIndex = items.findIndex((item) => item.id === itemId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length) {
    redirect(`/admin/workspaces/${businessId}`);
  }

  const current = items[currentIndex];
  const target = items[targetIndex];
  const { data: firstUpdated, error: firstError } = await supabase
    .from(table)
    .update({ sort_order: target.sort_order })
    .eq("business_id", businessId)
    .eq("id", current.id)
    .select("id")
    .single();
  if (firstError || !firstUpdated) {
    logAdminWriteError("move config first update", firstError);
    redirect(detailPath(businessId, adminSaveErrorMessage));
  }

  const { data: secondUpdated, error: secondError } = await supabase
    .from(table)
    .update({ sort_order: current.sort_order })
    .eq("business_id", businessId)
    .eq("id", target.id)
    .select("id")
    .single();
  if (secondError || !secondUpdated) {
    logAdminWriteError("move config second update", secondError);
    redirect(detailPath(businessId, adminSaveErrorMessage));
  }

  await audit(supabase, businessId, `${configType}_reordered`, configType, { direction, item_id: itemId });
  revalidatePath(`/admin/workspaces/${businessId}`);
  redirect(`/admin/workspaces/${businessId}`);
}
