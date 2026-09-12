"use server";

import { defaultTerminology } from "@/lib/job-tracker/config";
import type { DashboardWidgetKey, JobStatus } from "@/lib/job-tracker/types";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
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

export async function updateAdminBusiness(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const name = clean(formData.get("name"));
  const workspaceStatus = clean(formData.get("workspaceStatus"));

  if (!businessId || !name || !validWorkspaceStatuses.includes(workspaceStatus)) {
    redirect("/admin/workspaces");
  }

  const { supabase } = await requirePlatformAdmin();
  const { error } = await supabase
    .from("businesses")
    .update({
      intake_form_enabled: formData.get("intakeEnabled") === "on",
      name,
      workspace_status: workspaceStatus,
    })
    .eq("id", businessId);

  if (error) {
    redirect(detailPath(businessId, error.message));
  }

  await audit(supabase, businessId, "business_settings_updated", "business", { name, workspace_status: workspaceStatus });
  revalidatePath("/admin");
  revalidatePath(`/admin/workspaces/${businessId}`);
  revalidatePath("/dashboard");
  redirect(detailPath(businessId, "Workspace settings saved."));
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
  const { error } = await supabase.from("business_terminology").upsert({ business_id: businessId, ...payload }, { onConflict: "business_id" });
  if (error) redirect(detailPath(businessId, error.message));

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
  const { error } = await supabase.from("business_service_types").update({ enabled: formData.get("enabled") === "on", label }).eq("business_id", businessId).eq("id", serviceId);
  if (error) redirect(detailPath(businessId, error.message));

  await audit(supabase, businessId, "service_updated", "service", { service_id: serviceId, label });
  revalidatePath(`/admin/workspaces/${businessId}`);
  redirect(detailPath(businessId, "Service saved."));
}

export async function updateAdminPipeline(formData: FormData) {
  const businessId = clean(formData.get("businessId"));
  const statusId = clean(formData.get("statusId"));
  const semanticType = clean(formData.get("semanticType")) as JobStatus;
  const label = clean(formData.get("label")).slice(0, 80);
  if (!businessId || !statusId || !label || !validStatuses.includes(semanticType)) redirect("/admin/workspaces");

  const required = semanticType === "lead" || semanticType === "completed" || semanticType === "lost";
  const { supabase } = await requirePlatformAdmin();
  const { error } = await supabase.from("business_pipeline_statuses").update({ enabled: required ? true : formData.get("enabled") === "on", label }).eq("business_id", businessId).eq("id", statusId).eq("semantic_type", semanticType);
  if (error) redirect(detailPath(businessId, error.message));

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
  const { error } = await supabase.from("business_dashboard_widgets").update({ enabled: formData.get("enabled") === "on", label_override: labelOverride }).eq("business_id", businessId).eq("id", widgetId).eq("widget_key", widgetKey);
  if (error) redirect(detailPath(businessId, error.message));

  await audit(supabase, businessId, "dashboard_config_updated", "dashboard", { widget_id: widgetId, widget_key: widgetKey, label_override: labelOverride });
  revalidatePath(`/admin/workspaces/${businessId}`);
  redirect(detailPath(businessId, "Dashboard item saved."));
}
