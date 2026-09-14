import { lowerTerm, serviceKey, type Terminology } from "@/lib/job-tracker/config";
import type { ActionPlaybookType, BusinessActionPlaybook, BusinessServiceType, Job } from "@/lib/job-tracker/types";

export const actionTypeLabels: Record<ActionPlaybookType, string> = {
  call: "Call",
  custom_instruction: "Guidance",
  email: "Email",
  mark_contacted: "Mark contacted",
  mark_lost: "Mark lost",
  open_opportunity: "Open opportunity",
  review_proposal: "Review proposal",
  schedule: "Schedule",
  set_follow_up: "Set follow-up",
};

export const actionTypeOrder: ActionPlaybookType[] = [
  "mark_contacted",
  "call",
  "email",
  "set_follow_up",
  "schedule",
  "review_proposal",
  "mark_lost",
  "open_opportunity",
  "custom_instruction",
];

export const defaultActionPlaybooks: Array<{ action_key: string; action_label: string; action_type: ActionPlaybookType; pipeline_key: Job["status"]; sort_order: number }> = [
  { action_key: "mark_contacted", action_label: "Mark Contacted", action_type: "mark_contacted", pipeline_key: "lead", sort_order: 10 },
  { action_key: "call_client", action_label: "Call Client", action_type: "call", pipeline_key: "lead", sort_order: 20 },
  { action_key: "set_follow_up", action_label: "Set Follow-Up", action_type: "set_follow_up", pipeline_key: "lead", sort_order: 30 },
  { action_key: "set_follow_up", action_label: "Set Follow-Up", action_type: "set_follow_up", pipeline_key: "contacted", sort_order: 10 },
  { action_key: "schedule", action_label: "Schedule", action_type: "schedule", pipeline_key: "contacted", sort_order: 20 },
  { action_key: "open_opportunity", action_label: "Open Opportunity", action_type: "open_opportunity", pipeline_key: "contacted", sort_order: 30 },
  { action_key: "set_follow_up", action_label: "Set Follow-Up", action_type: "set_follow_up", pipeline_key: "quoted", sort_order: 10 },
  { action_key: "review_proposal", action_label: "Review Proposal", action_type: "review_proposal", pipeline_key: "quoted", sort_order: 20 },
  { action_key: "call_client", action_label: "Call Client", action_type: "call", pipeline_key: "quoted", sort_order: 30 },
  { action_key: "open_opportunity", action_label: "Open Opportunity", action_type: "open_opportunity", pipeline_key: "scheduled", sort_order: 10 },
  { action_key: "open_opportunity", action_label: "Open Opportunity", action_type: "open_opportunity", pipeline_key: "in_progress", sort_order: 10 },
];

export type ResolvedPlaybook = {
  actions: BusinessActionPlaybook[];
  mode: "service" | "default" | "none";
  service: BusinessServiceType | null;
};

export function actionKeyFromLabel(label: string) {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 44);

  return normalized || "custom_action";
}

export function defaultActionLabel(type: ActionPlaybookType, terminology: Terminology) {
  if (type === "open_opportunity") return `Open ${terminology.job_singular}`;
  if (type === "review_proposal") return `Review ${terminology.quote_singular}`;
  if (type === "call") return `Call ${terminology.customer_singular}`;
  if (type === "email") return `Email ${terminology.customer_singular}`;
  return actionTypeLabels[type];
}

export function resolveServiceForJob(job: Pick<Job, "project_type">, services: BusinessServiceType[]) {
  const key = serviceKey(job.project_type, services);
  return services.find((service) => service.id && service.key === key) ?? null;
}

export function resolvePlaybookForJob(job: Pick<Job, "project_type" | "status">, playbooks: BusinessActionPlaybook[], services: BusinessServiceType[]) {
  const service = resolveServiceForJob(job, services);
  const enabledForStatus = playbooks
    .filter((action) => action.is_enabled && action.pipeline_key === job.status)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  const serviceActions = service ? enabledForStatus.filter((action) => action.service_type_id === service.id) : [];

  if (serviceActions.length) {
    return { actions: serviceActions, mode: "service", service } satisfies ResolvedPlaybook;
  }

  const defaults = enabledForStatus.filter((action) => !action.service_type_id);
  if (defaults.length) {
    return { actions: defaults, mode: "default", service } satisfies ResolvedPlaybook;
  }

  return { actions: [], mode: "none", service } satisfies ResolvedPlaybook;
}

export function playbookScopeLabel(serviceId: string | null, services: BusinessServiceType[], terminology: Terminology) {
  if (!serviceId) {
    return `All ${lowerTerm(terminology.job_plural)}`;
  }

  return services.find((service) => service.id === serviceId)?.label ?? "Service override";
}
