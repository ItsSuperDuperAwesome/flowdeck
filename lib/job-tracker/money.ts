import type { Job, JobStatus } from "./types";

type MoneyJob = Pick<Job, "completed_at" | "price_cents" | "revenue_cents" | "status" | "won_at">;

export function opportunityValueCents(job: Pick<MoneyJob, "price_cents">) {
  return Math.max(0, job.price_cents ?? 0);
}

export function isOpenPipelineStatus(status: JobStatus) {
  return status !== "completed" && status !== "lost";
}

export function openPipelineValueCents(job: Pick<MoneyJob, "price_cents" | "status">) {
  return isOpenPipelineStatus(job.status) ? opportunityValueCents(job) : 0;
}

export function wonValueCents(job: Pick<MoneyJob, "price_cents" | "status" | "won_at">) {
  return job.status !== "lost" && job.won_at ? opportunityValueCents(job) : 0;
}

export function completedRevenueCents(job: Pick<MoneyJob, "price_cents" | "revenue_cents" | "status">) {
  if (job.status !== "completed") {
    return 0;
  }

  return Math.max(0, job.revenue_cents ?? job.price_cents ?? 0);
}

export function revenueForStatus(status: JobStatus, priceCents: number) {
  return status === "completed" ? Math.max(0, priceCents) : 0;
}
