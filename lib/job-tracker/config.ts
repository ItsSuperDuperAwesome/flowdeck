import type { BusinessDashboardWidget, BusinessPipelineStatus, BusinessServiceType, DashboardWidgetKey, JobStatus } from "@/lib/job-tracker/types";

export const defaultServiceTypes = [
  { key: "garage_floor", label: "Garage floor" },
  { key: "patio", label: "Patio" },
  { key: "commercial_floor", label: "Commercial floor" },
  { key: "basement", label: "Basement" },
  { key: "other", label: "Other" },
];

export const defaultPipelineStatuses: Array<{ key: JobStatus; label: string; semantic_type: JobStatus }> = [
  { key: "lead", label: "Lead", semantic_type: "lead" },
  { key: "contacted", label: "Contacted", semantic_type: "contacted" },
  { key: "quoted", label: "Quoted", semantic_type: "quoted" },
  { key: "scheduled", label: "Scheduled", semantic_type: "scheduled" },
  { key: "in_progress", label: "In Progress", semantic_type: "in_progress" },
  { key: "completed", label: "Completed", semantic_type: "completed" },
  { key: "lost", label: "Lost", semantic_type: "lost" },
];

export const dashboardWidgetRegistry: Record<DashboardWidgetKey, { defaultLabel: string; helper: string; zone: "primary" | "secondary" | "section" }> = {
  active_job_board: { defaultLabel: "Active job board", helper: "Job table section", zone: "section" },
  avg_job: { defaultLabel: "Avg. Job", helper: "Across all jobs", zone: "secondary" },
  completed: { defaultLabel: "Completed", helper: "Booked revenue", zone: "secondary" },
  in_progress: { defaultLabel: "In Progress", helper: "Active installs", zone: "primary" },
  needs_attention: { defaultLabel: "Needs Attention", helper: "Priority follow-up section", zone: "section" },
  new_leads: { defaultLabel: "New Leads", helper: "Needs first response", zone: "primary" },
  open_pipeline: { defaultLabel: "Open Pipeline", helper: "Not completed", zone: "primary" },
  quoted: { defaultLabel: "Quoted", helper: "Awaiting answer", zone: "secondary" },
  scheduled: { defaultLabel: "Scheduled", helper: "Confirmed work", zone: "primary" },
  upcoming: { defaultLabel: "Upcoming", helper: "Scheduled work section", zone: "section" },
};

export const defaultDashboardWidgets: DashboardWidgetKey[] = [
  "new_leads",
  "scheduled",
  "in_progress",
  "open_pipeline",
  "quoted",
  "completed",
  "avg_job",
  "needs_attention",
  "active_job_board",
  "upcoming",
];

export function normalizeServiceTypes(rows: BusinessServiceType[] = []) {
  const enabledRows = rows
    .filter((service) => service.enabled)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));

  if (enabledRows.length) {
    return enabledRows;
  }

  return defaultServiceTypes.map((service, index) => ({
    business_id: "",
    created_at: "",
    enabled: true,
    id: "",
    key: service.key,
    label: service.label,
    sort_order: (index + 1) * 10,
    updated_at: "",
  }));
}

export function normalizePipelineStatuses(rows: BusinessPipelineStatus[] = []) {
  const bySemantic = new Map(rows.map((status) => [status.semantic_type, status]));

  return defaultPipelineStatuses
    .map((defaultStatus, index) => {
      const configured = bySemantic.get(defaultStatus.semantic_type);

      return {
        business_id: configured?.business_id ?? "",
        created_at: configured?.created_at ?? "",
        enabled: configured?.enabled ?? true,
        id: configured?.id ?? "",
        key: configured?.key ?? defaultStatus.key,
        label: configured?.label ?? defaultStatus.label,
        semantic_type: defaultStatus.semantic_type,
        sort_order: configured?.sort_order ?? (index + 1) * 10,
        updated_at: configured?.updated_at ?? "",
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function enabledPipelineStatuses(rows: BusinessPipelineStatus[] = []) {
  return normalizePipelineStatuses(rows).filter((status) => status.enabled);
}

export function pipelineLabelMap(rows: BusinessPipelineStatus[] = []) {
  return Object.fromEntries(normalizePipelineStatuses(rows).map((status) => [status.semantic_type, status.label])) as Record<JobStatus, string>;
}

export function normalizeDashboardWidgets(rows: BusinessDashboardWidget[] = []) {
  const byKey = new Map(rows.map((widget) => [widget.widget_key, widget]));

  return defaultDashboardWidgets
    .map((key, index) => {
      const configured = byKey.get(key);
      const registry = dashboardWidgetRegistry[key];

      return {
        business_id: configured?.business_id ?? "",
        created_at: configured?.created_at ?? "",
        enabled: configured?.enabled ?? true,
        id: configured?.id ?? "",
        label_override: configured?.label_override ?? null,
        sort_order: configured?.sort_order ?? (index + 1) * 10,
        updated_at: configured?.updated_at ?? "",
        widget_key: key,
        label: configured?.label_override || registry.defaultLabel,
        helper: registry.helper,
        zone: registry.zone,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order);
}
