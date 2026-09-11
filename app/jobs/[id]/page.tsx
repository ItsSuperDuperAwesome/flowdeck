import { JobFields } from "@/app/dashboard/dashboard-client";
import { PhotoUploadForm } from "@/app/jobs/[id]/photo-upload-form";
import { QuoteShareLink } from "@/app/jobs/[id]/quote-share-link";
import {
  markJobContacted,
  markJobLost,
  markQuoteAccepted,
  markQuoteDeclined,
  markQuoteSent,
  saveQuote,
  sendQuoteReply,
  setJobFollowUp,
  updateJob,
  updateJobStatus,
} from "@/app/dashboard/actions";
import { enabledPipelineStatuses, normalizeServiceTypes, normalizeTerminology, pipelineLabelMap, lowerTerm, type Terminology } from "@/lib/job-tracker/config";
import type {
  BusinessTerminology,
  BusinessPipelineStatus,
  BusinessServiceType,
  Customer,
  CustomerSummary,
  IntakeResponse,
  Job,
  JobActivity,
  JobFile,
  JobSource,
  JobStatus,
  Quote,
  QuoteMessage,
  QuoteStatus,
} from "@/lib/job-tracker/types";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type JobRow = Omit<Job, "customer"> & {
  customers: Customer | Customer[] | null;
};

type ActivityRow = JobActivity;

const defaultStatusLabels: Record<JobStatus, string> = {
  lead: "Lead",
  contacted: "Contacted",
  quoted: "Quoted",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
  lost: "Lost",
};

const sourceLabels: Record<JobSource, string> = {
  facebook: "Facebook",
  google: "Google",
  instagram: "Instagram",
  manual: "Manual",
  other: "Other",
  phone: "Phone",
  referral: "Referral",
  repeat_customer: "Repeat customer",
  walk_in: "Walk-in",
  website_form: "Website form",
};

const lostReasonLabels: Record<string, string> = {
  price: "Price",
  no_response: "No response",
  competitor: "Competitor",
  timing: "Timing",
  canceled_project: "Canceled project",
  not_qualified: "Not qualified",
  other: "Other",
};

const quoteStatusLabels: Record<QuoteStatus, string> = {
  accepted: "Accepted",
  declined: "Declined",
  draft: "Draft",
  sent: "Sent",
};

const photoCategoryLabels: Record<string, string> = {
  before: "Before",
  completed: "Completed",
  damage: "Damage",
  intake: "Intake",
  other: "Other",
  prep: "Prep",
  progress: "Progress",
};

const photoSourceLabels: Record<string, string> = {
  intake: "Public intake",
  job_detail: "Job upload",
  manual: "Manual",
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function moneyInputValue(cents: number) {
  return cents > 0 ? String(cents / 100) : "";
}

function dateLabel(value: string | null) {
  if (!value) {
    return "Unscheduled";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function dateTimeLabel(value: string | null) {
  if (!value) {
    return "Unscheduled";
  }

  return `${dateLabel(value)} at ${timeLabel(value)}`;
}

function optionalDateLabel(value: string | null) {
  return value ? dateLabel(value) : "Not recorded";
}

function timeLabel(value: string | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function address(customer: Customer | null) {
  if (!customer) {
    return "";
  }

  return [customer.address_line1, customer.address_line2, customer.city, customer.state, customer.postal_code]
    .filter(Boolean)
    .join(", ");
}

function dateTimeValue(value: string | null) {
  if (!value) {
    return { date: "", time: "" };
  }

  const date = new Date(value);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");

  return {
    date: date.toISOString().slice(0, 10),
    time: `${hours}:${minutes}`,
  };
}

export default async function JobDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; message?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();

  if (authError || !auth?.claims) {
    redirect("/");
  }

  const { data: jobRow, error: jobError } = await supabase
    .from("jobs")
    .select("id, business_id, customer_id, title, description, status, price_cents, scheduled_start, scheduled_end, job_address, internal_notes, source, project_type, preferred_date, square_feet, budget_range, first_contact_at, quote_sent_at, won_at, next_follow_up_at, lost_at, completed_at, lost_reason, revenue_cents, intake_data, created_at, updated_at, customers(id, business_id, name, email, phone, address_line1, address_line2, city, state, postal_code, notes, created_at, updated_at)")
    .eq("id", id)
    .single();

  if (jobError || !jobRow) {
    notFound();
  }

  const normalizedJob = jobRow as unknown as JobRow;
  const job: Job = {
    ...normalizedJob,
    customer: Array.isArray(normalizedJob.customers)
      ? normalizedJob.customers[0] ?? null
      : normalizedJob.customers,
  };

  const { data: customerRows } = await supabase
    .from("customers")
    .select("id, business_id, name, email, phone, address_line1, address_line2, city, state, postal_code, notes, created_at, updated_at")
    .eq("business_id", job.business_id)
    .order("name", { ascending: true });

  const customers = ((customerRows ?? []) as Customer[]).map((customer) => ({
    ...customer,
    active_jobs: 0,
    completed_jobs: 0,
    job_count: 0,
    last_job_date: null,
    lifetime_value_cents: 0,
  })) satisfies CustomerSummary[];

  const { data: serviceTypeRows } = await supabase
    .from("business_service_types")
    .select("id, business_id, key, label, enabled, sort_order, created_at, updated_at")
    .eq("business_id", job.business_id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const { data: pipelineStatusRows } = await supabase
    .from("business_pipeline_statuses")
    .select("id, business_id, key, label, semantic_type, enabled, sort_order, created_at, updated_at")
    .eq("business_id", job.business_id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const { data: terminologyRow } = await supabase
    .from("business_terminology")
    .select("id, business_id, job_singular, job_plural, customer_singular, customer_plural, quote_singular, quote_plural, active_board_title, upcoming_title, new_job_button_label, new_customer_button_label, created_at, updated_at")
    .eq("business_id", job.business_id)
    .maybeSingle();
  const serviceTypes = normalizeServiceTypes((serviceTypeRows ?? []) as BusinessServiceType[]);
  const pipelineConfig = (pipelineStatusRows ?? []) as BusinessPipelineStatus[];
  const pipelineStatuses = enabledPipelineStatuses(pipelineConfig);
  const statusLabels = pipelineConfig.length ? pipelineLabelMap(pipelineConfig) : defaultStatusLabels;
  const terminology = normalizeTerminology((terminologyRow ?? null) as BusinessTerminology | null);

  const { data: quoteRows } = await supabase
    .from("quotes")
    .select("id, business_id, job_id, amount_cents, notes, status, public_token, public_token_created_at, public_access_revoked_at, sent_at, accepted_at, declined_at, valid_until, created_at, updated_at")
    .eq("job_id", id)
    .eq("business_id", job.business_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const quote = ((quoteRows ?? []) as Quote[])[0] ?? null;

  const { data: quoteMessageRows } = quote
    ? await supabase
        .from("quote_messages")
        .select("id, business_id, quote_id, job_id, message, source, resolved_at, created_at")
        .eq("quote_id", quote.id)
        .eq("business_id", job.business_id)
        .order("created_at", { ascending: true })
    : { data: [] };
  const quoteMessages = (quoteMessageRows ?? []) as QuoteMessage[];

  const { data: activityRows } = await supabase
    .from("job_activity")
    .select("id, business_id, job_id, user_id, event_type, message, metadata, created_at")
    .eq("job_id", id)
    .order("created_at", { ascending: false });

  const { data: fileRows } = await supabase
    .from("job_files")
    .select("id, business_id, job_id, storage_bucket, storage_path, file_name, mime_type, size_bytes, category, source_context, created_at")
    .eq("job_id", id)
    .order("created_at", { ascending: true });

  const files = await Promise.all(
    ((fileRows ?? []) as JobFile[]).map(async (file) => {
      const { data: signed } = await supabase.storage.from(file.storage_bucket).createSignedUrl(file.storage_path, 60 * 15);
      return {
        ...file,
        signed_url: signed?.signedUrl,
      };
    }),
  );

  const start = dateTimeValue(job.scheduled_start);
  const end = dateTimeValue(job.scheduled_end);
  const serviceAddress = job.job_address || address(job.customer) || "No service address yet";
  const salesItems = [
    { label: "First contact", value: optionalDateLabel(job.first_contact_at) },
    { label: `${terminology.quote_singular} status`, value: quote ? quoteStatusLabels[quote.status] : job.quote_sent_at ? `${terminology.quote_singular} sent` : `No ${lowerTerm(terminology.quote_singular)} yet` },
    { label: `${terminology.quote_singular} sent`, value: optionalDateLabel(quote?.sent_at ?? job.quote_sent_at) },
    { label: "Won", value: optionalDateLabel(job.won_at) },
    { label: "Next follow-up", value: optionalDateLabel(job.next_follow_up_at) },
    ...(job.completed_at ? [{ label: "Completed", value: optionalDateLabel(job.completed_at) }] : []),
    ...(job.revenue_cents > 0 ? [{ label: "Revenue", value: money(job.revenue_cents) }] : []),
    ...(job.status === "lost" ? [{ label: "Lost reason", value: job.lost_reason ? lostReasonLabels[job.lost_reason] ?? job.lost_reason : "Not recorded" }] : []),
  ];

  return (
    <main className="detail-shell">
      <div className="detail-header">
        <div>
          <Link className="back-link" href="/dashboard">
            Back to dashboard
          </Link>
          <p className="eyebrow">{terminology.job_singular}</p>
          <h1>{job.title}</h1>
          <p className="muted">
            {job.customer?.name ?? "Unknown customer"} | {statusLabels[job.status]} | {money(job.price_cents)}
          </p>
        </div>
        <div className="detail-header-actions">
          <PrimaryJobAction job={job} terminology={terminology} />
          <Link className="button button-secondary" href={`/jobs/${job.id}?edit=1#edit-job`}>
            Edit {terminology.job_singular}
          </Link>
        </div>
      </div>

      {query.message ? <p className="success-message">{query.message}</p> : null}

      <section className="detail-main">
        <section className="detail-top-grid">
          <section className="data-panel">
            <div className="panel-heading compact">
              <h2>{terminology.job_singular} Summary</h2>
              <p className="muted">The key details needed to move this {lowerTerm(terminology.job_singular)} forward.</p>
            </div>
            <div className="info-grid info-grid-compact">
              <Info label={terminology.customer_singular} value={job.customer?.name ?? `Unknown ${lowerTerm(terminology.customer_singular)}`} href={job.customer ? `/customers/${job.customer.id}` : undefined} />
              <Info label="Phone" value={job.customer?.phone ?? "No phone"} href={job.customer?.phone ? `tel:${job.customer.phone}` : undefined} />
              <Info label="Email" value={job.customer?.email ?? "No email"} href={job.customer?.email ? `mailto:${job.customer.email}` : undefined} />
              <Info label="Service address" value={serviceAddress} />
              <Info label="Schedule" value={job.scheduled_start ? dateTimeLabel(job.scheduled_start) : "Unscheduled"} />
              <Info label="Value" value={money(job.price_cents)} />
              <Info label="Lead source" value={sourceLabels[job.source]} />
            </div>
          </section>

          <section className="data-panel">
            <div className="panel-heading compact">
              <h2>Sales & Follow-Up</h2>
              <p className="muted">Current sales state without the database noise.</p>
            </div>
            <div className="info-grid info-grid-compact">
              {salesItems.map((item) => (
                <Info key={item.label} label={item.label} value={item.value} />
              ))}
              {job.project_type ? <Info label="Project type" value={job.project_type} /> : null}
              {job.preferred_date ? <Info label="Preferred date" value={dateLabel(job.preferred_date)} /> : null}
              {job.square_feet ? <Info label="Square footage" value={`${job.square_feet.toLocaleString()} sq ft`} /> : null}
              {job.budget_range ? <Info label="Budget range" value={job.budget_range} /> : null}
            </div>
          </section>
        </section>

        <QuotePanel job={job} quote={quote} quoteMessages={quoteMessages} terminology={terminology} />

        <JobQuickActions job={job} terminology={terminology} />

        <IntakeResponsesPanel intakeData={job.intake_data} />

        <section className="detail-top-grid">
          <section className="data-panel">
            <div className="panel-heading compact">
              <h2>Description</h2>
            </div>
            <div className={job.description ? "detail-copy" : "detail-copy empty-copy"}>{job.description || "No description yet."}</div>
          </section>

          <section className="data-panel">
            <div className="panel-heading compact">
              <h2>Internal notes</h2>
            </div>
            <div className={job.internal_notes ? "detail-copy" : "detail-copy empty-copy"}>{job.internal_notes || "No internal notes yet."}</div>
          </section>
        </section>

        <PhotoGallery files={files} jobId={job.id} terminology={terminology} />

          <section className="data-panel" id="activity">
            <div className="panel-heading compact">
              <h2>Activity</h2>
              <p className="muted">Recent meaningful changes for this {lowerTerm(terminology.job_singular)}.</p>
            </div>
            <div className="activity-timeline">
              {activityRows?.length ? (
                (activityRows as ActivityRow[]).map((activity) => (
                  <div className="activity-item" key={activity.id}>
                    <span>{dateTimeLabel(activity.created_at)}</span>
                    <p>{terminologyActivityMessage(activity.message, terminology)}</p>
                  </div>
                ))
              ) : (
                <p className="detail-copy empty-copy">Changes will appear here after the job is updated.</p>
              )}
            </div>
          </section>

        <details className="data-panel edit-disclosure" id="edit-job" open={query.edit === "1"}>
          <summary>
            <span>
              <strong>Edit {terminology.job_singular}</strong>
              <em>Update {lowerTerm(terminology.customer_singular)}, schedule, status, value, and notes.</em>
            </span>
          </summary>
          <form className="settings-form" action={updateJob}>
            <input type="hidden" name="jobId" value={job.id} />
          <JobFields customers={customers} end={end} job={job} pipelineStatuses={pipelineStatuses} serviceTypes={serviceTypes} start={start} statusLabels={statusLabels} terminology={terminology} />
            <button className="button" type="submit">
              Save {lowerTerm(terminology.job_singular)}
            </button>
          </form>
        </details>
      </section>
    </main>
  );
}

function IntakeResponsesPanel({ intakeData }: { intakeData: Record<string, IntakeResponse> | null }) {
  const responses = Object.entries(intakeData ?? {})
    .map(([key, response]) => ({ key, response }))
    .filter(({ response }) => {
      if (response.value === null || response.value === undefined) {
        return false;
      }

      if (typeof response.value === "string") {
        return response.value.trim().length > 0;
      }

      return true;
    });

  if (!responses.length) {
    return null;
  }

  return (
    <section className="data-panel">
      <div className="panel-heading compact">
        <h2>Intake responses</h2>
        <p className="muted">Custom answers submitted through the public intake form.</p>
      </div>
      <div className="intake-response-grid">
        {responses.map(({ key, response }) => (
          <Info key={key} label={response.label} value={formatIntakeResponse(response)} />
        ))}
      </div>
    </section>
  );
}

function formatIntakeResponse(response: IntakeResponse) {
  if (typeof response.value === "boolean") {
    return response.value ? "Yes" : "No";
  }

  if (typeof response.value === "number") {
    return response.value.toLocaleString();
  }

  return response.value ?? "";
}

function PhotoGallery({ files, jobId, terminology }: { files: JobFile[]; jobId: string; terminology: Terminology }) {
  return (
    <section className="data-panel photo-panel">
      <div className="panel-heading compact">
        <div>
          <h2>Project Photos</h2>
          <p className="muted">{terminology.job_singular} photos are private to this workspace and open with short-lived preview links.</p>
        </div>
        <span className="panel-count">{files.length === 1 ? "1 photo" : `${files.length} photos`}</span>
      </div>

      <PhotoUploadForm jobId={jobId} />

      {files.length ? (
        <div className="photo-grid">
          {files.map((file) => (
            <article className="photo-card" key={file.id}>
              {file.signed_url ? (
                <Link href={`/jobs/${jobId}/photos/${file.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={file.signed_url} alt={file.file_name} />
                </Link>
              ) : (
                <div className="photo-preview-error">Preview unavailable</div>
              )}
              <div className="photo-meta">
                <strong>{file.file_name}</strong>
                <span>
                  {photoCategoryLabels[file.category] ?? "Other"} · {photoSourceLabels[file.source_context] ?? "Job upload"} · {dateLabel(file.created_at)}
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="photo-empty-state">
          <strong>No photos yet</strong>
          <p className="muted">Upload before, progress, damage, or completed-work photos so the {lowerTerm(terminology.job_singular)} record has visual context.</p>
        </div>
      )}
    </section>
  );
}

function PrimaryJobAction({ job, terminology }: { job: Job; terminology: Terminology }) {
  if (job.status === "lead") {
    return (
      <form action={markJobContacted}>
        <input type="hidden" name="jobId" value={job.id} />
        <button className="button" type="submit">
          Mark Contacted
        </button>
      </form>
    );
  }

  if (job.status === "scheduled") {
    return (
      <form action={updateJobStatus}>
        <input type="hidden" name="jobId" value={job.id} />
        <input type="hidden" name="returnTo" value={`/jobs/${job.id}`} />
        <input type="hidden" name="status" value="in_progress" />
        <button className="button" type="submit">
          Start {terminology.job_singular}
        </button>
      </form>
    );
  }

  if (job.status === "in_progress") {
    return (
      <form action={updateJobStatus}>
        <input type="hidden" name="jobId" value={job.id} />
        <input type="hidden" name="returnTo" value={`/jobs/${job.id}`} />
        <input type="hidden" name="status" value="completed" />
        <button className="button" type="submit">
          Complete {terminology.job_singular}
        </button>
      </form>
    );
  }

  if (job.status === "completed" || job.status === "lost") {
    return (
      <a className="button" href="#activity">
        View Activity
      </a>
    );
  }

  return (
    <a className="button" href="#quote">
      Review {terminology.quote_singular}
    </a>
  );
}

function QuotePanel({ job, quote, quoteMessages, terminology }: { job: Job; quote: Quote | null; quoteMessages: QuoteMessage[]; terminology: Terminology }) {
  const isClosed = job.status === "completed" || job.status === "lost";
  const canSend = quote && quote.status === "draft";
  const canAccept = quote && quote.status !== "accepted" && quote.status !== "declined";
  const canDecline = quote && quote.status !== "accepted" && quote.status !== "declined";
  const publicHref = quote?.public_token ? `/quote/${quote.public_token}` : null;
  const unresolvedMessages = quoteMessages.filter((message) => message.source === "customer" && !message.resolved_at);

  return (
    <section className="data-panel quote-panel" id="quote">
      <div className="panel-heading compact">
        <div>
          <h2>{terminology.quote_singular}</h2>
          <p className="muted">A lightweight estimate tied to this {lowerTerm(terminology.job_singular)}.</p>
        </div>
        {quote ? <span className={`quote-status quote-status-${quote.status}`}>{quoteStatusLabels[quote.status]}</span> : null}
      </div>

      {quote ? (
        <div className="quote-summary">
          <Info label={`${terminology.quote_singular} amount`} value={money(quote.amount_cents)} />
          <Info label="Valid until" value={quote.valid_until ? dateLabel(quote.valid_until) : "Not set"} />
          <Info label="Sent" value={quote.sent_at ? dateLabel(quote.sent_at) : "Not sent"} />
          <Info label={`Current ${lowerTerm(terminology.job_singular)} value`} value={money(job.price_cents)} />
          <Info label={`${terminology.customer_singular} response`} value={quote.accepted_at ? `Accepted ${dateLabel(quote.accepted_at)}` : quote.declined_at ? `Declined ${dateLabel(quote.declined_at)}` : "Awaiting response"} />
        </div>
      ) : (
        <div className="quote-empty">
          <strong>No {lowerTerm(terminology.quote_singular)} yet</strong>
          <p className="muted">Create a draft {lowerTerm(terminology.quote_singular)} when this opportunity is ready for pricing.</p>
        </div>
      )}

      {isClosed ? (
        <p className="detail-copy empty-copy">{terminology.quote_singular} changes are locked once a {lowerTerm(terminology.job_singular)} is completed or lost.</p>
      ) : (
        <form action={saveQuote} className="quote-form">
          <input type="hidden" name="jobId" value={job.id} />
          {quote ? <input type="hidden" name="quoteId" value={quote.id} /> : null}
          <div className="split-fields">
            <label>
              Amount
              <input name="amount" type="number" min="1" step="0.01" defaultValue={quote ? moneyInputValue(quote.amount_cents) : moneyInputValue(job.price_cents)} required />
            </label>
            <label>
              Valid until
              <input name="validUntil" type="date" defaultValue={quote?.valid_until ?? ""} />
            </label>
          </div>
          <label>
            Scope / notes
            <textarea name="quoteNotes" rows={4} defaultValue={quote?.notes ?? ""} placeholder="Short scope, assumptions, or exclusions." />
          </label>
          <button className="button" type="submit">
            {quote ? `Save ${terminology.quote_singular}` : `Create ${terminology.quote_singular}`}
          </button>
        </form>
      )}

      {quote && !isClosed ? (
        <div className="quote-actions">
          {canSend ? (
            <form action={markQuoteSent}>
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="quoteId" value={quote.id} />
              <button className="button button-secondary" type="submit">
                Mark Sent
              </button>
            </form>
          ) : null}
          {canAccept ? (
            <form action={markQuoteAccepted}>
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="quoteId" value={quote.id} />
              <button className="button button-secondary" type="submit">
                Mark Accepted
              </button>
            </form>
          ) : null}
          {canDecline ? (
            <form action={markQuoteDeclined}>
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="quoteId" value={quote.id} />
              <button className="button button-secondary" type="submit">
                Mark Declined
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {quote && publicHref ? (
        <div className="quote-customer-area">
          <div className="panel-heading compact">
            <div>
              <h3>{terminology.customer_singular} link</h3>
            <p className="muted">Share this link after marking the {lowerTerm(terminology.quote_singular)} sent.</p>
            </div>
            <Link className="link-button" href={publicHref} target="_blank">
              Open {lowerTerm(terminology.customer_singular)} view
            </Link>
          </div>
          <QuoteShareLink customerLabel={lowerTerm(terminology.customer_singular)} href={publicHref} quoteLabel={lowerTerm(terminology.quote_singular)} />
          {unresolvedMessages.length ? (
            <p className="quote-message-alert">{unresolvedMessages.length === 1 ? `1 ${lowerTerm(terminology.customer_singular)} message needs a reply.` : `${unresolvedMessages.length} ${lowerTerm(terminology.customer_singular)} messages need a reply.`}</p>
          ) : null}
        </div>
      ) : null}

      {quoteMessages.length ? (
        <div className="quote-messages quote-thread">
          <h3>{terminology.quote_singular} conversation</h3>
          {quoteMessages.map((quoteMessage) => (
            <article className={`quote-message quote-message-${quoteMessage.source}${quoteMessage.resolved_at ? " resolved" : ""}`} key={quoteMessage.id}>
              <div>
                <span>{quoteMessage.source === "business" ? "Business" : terminology.customer_singular} · {dateTimeLabel(quoteMessage.created_at)}</span>
                <p>{quoteMessage.message}</p>
                {quoteMessage.source === "customer" && quoteMessage.resolved_at ? <em>Answered {dateLabel(quoteMessage.resolved_at)}</em> : null}
                {quoteMessage.source === "customer" && !quoteMessage.resolved_at ? <em>Waiting for a reply</em> : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {quote ? (
        <form action={sendQuoteReply} className="quote-reply-form">
          <input type="hidden" name="quoteId" value={quote.id} />
          <label>
            Reply to {lowerTerm(terminology.customer_singular)}
            <textarea name="reply" maxLength={1000} placeholder={`Write a short reply about this ${lowerTerm(terminology.quote_singular)}.`} rows={3} required />
          </label>
          <button className="button button-secondary" type="submit">
            Send Reply
          </button>
        </form>
      ) : null}
    </section>
  );
}

function Info({ href, label, value }: { href?: string; label: string; value: string }) {
  return (
    <div className="info-item">
      <span>{label}</span>
      {href ? (
        <Link href={href}>
          <strong>{value}</strong>
        </Link>
      ) : (
        <strong>{value}</strong>
      )}
    </div>
  );
}

function JobQuickActions({ job, terminology }: { job: Job; terminology: Terminology }) {
  if (job.status === "completed" || job.status === "lost") {
    return null;
  }

  return (
    <section className="data-panel quick-actions-panel">
      <div className="panel-heading compact">
        <h2>Quick actions</h2>
        <p className="muted">Move this {lowerTerm(terminology.job_singular)} forward and keep the activity timeline accurate.</p>
      </div>
      <div className="quick-actions-grid">
        {job.customer?.phone ? (
          <a className="button button-secondary" href={`tel:${job.customer.phone}`}>
            Call {terminology.customer_singular}
          </a>
        ) : null}
        {job.customer?.email ? (
          <a className="button button-secondary" href={`mailto:${job.customer.email}`}>
            Email {terminology.customer_singular}
          </a>
        ) : null}

        {job.status === "lead" ? (
          <>
            <form action={markJobContacted}>
              <input type="hidden" name="jobId" value={job.id} />
              <button className="button button-secondary" type="submit">
                Mark Contacted
              </button>
            </form>
            <FollowUpForm jobId={job.id} />
            <LostForm jobId={job.id} />
          </>
        ) : null}

        {job.status === "contacted" || job.status === "quoted" ? (
          <>
            <FollowUpForm jobId={job.id} />
            <Link className="button button-secondary" href={`/jobs/${job.id}?edit=1#edit-job`}>
              Schedule
            </Link>
            <Link className="button button-secondary" href={`/jobs/${job.id}?edit=1#edit-job`}>
              Add Note
            </Link>
            <LostForm jobId={job.id} />
          </>
        ) : null}

        {job.status === "scheduled" ? (
          <form action={updateJobStatus}>
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="returnTo" value={`/jobs/${job.id}`} />
            <input type="hidden" name="status" value="in_progress" />
            <button className="button" type="submit">
              Start {terminology.job_singular}
            </button>
          </form>
        ) : null}

        {job.status === "in_progress" ? (
          <form action={updateJobStatus}>
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="returnTo" value={`/jobs/${job.id}`} />
            <input type="hidden" name="status" value="completed" />
            <button className="button" type="submit">
              Complete {terminology.job_singular}
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}

function terminologyActivityMessage(message: string, terminology: Terminology) {
  return message
    .replace(/\bCustomer\b/g, terminology.customer_singular)
    .replace(/\bcustomer\b/g, lowerTerm(terminology.customer_singular))
    .replace(/\bCustomers\b/g, terminology.customer_plural)
    .replace(/\bcustomers\b/g, lowerTerm(terminology.customer_plural))
    .replace(/\bQuote\b/g, terminology.quote_singular)
    .replace(/\bquote\b/g, lowerTerm(terminology.quote_singular))
    .replace(/\bQuotes\b/g, terminology.quote_plural)
    .replace(/\bquotes\b/g, lowerTerm(terminology.quote_plural))
    .replace(/\bJob\b/g, terminology.job_singular)
    .replace(/\bjob\b/g, lowerTerm(terminology.job_singular))
    .replace(/\bJobs\b/g, terminology.job_plural)
    .replace(/\bjobs\b/g, lowerTerm(terminology.job_plural));
}

function FollowUpForm({ jobId }: { jobId: string }) {
  return (
    <form action={setJobFollowUp} className="quick-action-form">
      <input type="hidden" name="jobId" value={jobId} />
      <label>
        Follow-up
        <input name="nextFollowUpAt" type="datetime-local" required />
      </label>
      <button className="button button-secondary" type="submit">
        Add Follow-Up
      </button>
    </form>
  );
}

function LostForm({ jobId }: { jobId: string }) {
  return (
    <form action={markJobLost} className="quick-action-form">
      <input type="hidden" name="jobId" value={jobId} />
      <label>
        Lost reason
        <select name="lostReason" required defaultValue="">
          <option value="" disabled>
            Select a reason
          </option>
          {Object.entries(lostReasonLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button className="button button-secondary" type="submit">
        Mark Lost
      </button>
    </form>
  );
}
