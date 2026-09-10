"use client";

import { logout } from "@/app/auth/actions";
import {
  archiveIntakeField,
  createCustomer,
  createIntakeField,
  createJob,
  markJobContacted,
  moveIntakeField,
  resolveQuoteMessage,
  updateBusiness,
  updateCustomer,
  updateIntakeField,
  updateIntakeSettings,
  updateJob,
  updateJobStatus,
} from "@/app/dashboard/actions";
import type { Business, Customer, CustomerSummary, IntakeField, IntakeFieldType, Job, JobActivity, JobSource, JobStatus, QuoteMessage } from "@/lib/job-tracker/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent } from "react";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

type View = "Overview" | "Pipeline" | "Jobs" | "Customers" | "Calendar" | "Analytics" | "Settings";
type CalendarMode = "Week" | "Month" | "Agenda";
type AttentionItem = {
  action: string;
  age: string;
  id: string;
  job: Job;
  priority: number;
  problem: string;
  quoteMessage?: QuoteMessage;
  quickAction?: "contacted" | "resolve_quote_message";
};
type AttentionSeverity = "high" | "warning" | "info";

type DashboardClientProps = {
  activities: JobActivity[];
  business: Business;
  customers: CustomerSummary[];
  intakeFields: IntakeField[];
  initialView?: View;
  jobs: Job[];
  message?: string;
  quoteMessages: (QuoteMessage & { job: Job | null })[];
  userEmail: string;
};

const statusLabels: Record<JobStatus, string> = {
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

const intakeFieldTypeLabels: Record<IntakeFieldType, string> = {
  checkbox: "Checkbox",
  date: "Date",
  long_text: "Long text",
  number: "Number",
  select: "Select",
  short_text: "Short text",
};

const statusOrder: JobStatus[] = ["lead", "contacted", "quoted", "scheduled", "in_progress", "completed", "lost"];
const statusChangeOrder: JobStatus[] = ["lead", "contacted", "quoted", "scheduled", "in_progress", "completed"];
const pipelineStatuses: JobStatus[] = ["lead", "contacted", "quoted", "scheduled", "in_progress", "completed", "lost"];
const sourceOrder: JobSource[] = ["website_form", "google", "facebook", "instagram", "referral", "repeat_customer", "phone", "walk_in", "manual", "other"];
const navItems: View[] = ["Overview", "Pipeline", "Jobs", "Customers", "Calendar", "Analytics", "Settings"];
const operationalStatuses: JobStatus[] = ["scheduled", "in_progress"];

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function inputMoney(cents: number) {
  return cents ? String(cents / 100) : "";
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

function todayLabel() {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

function ageLabel(value: string) {
  const ageMs = Date.now() - new Date(value).getTime();
  const days = Math.max(0, Math.floor(ageMs / 86_400_000));

  if (days === 0) {
    return "New today";
  }

  if (days === 1) {
    return "1 day old";
  }

  return `${days} days old`;
}

function isStale(job: Job) {
  if (job.status === "completed" || job.status === "lost") {
    return false;
  }

  return Date.now() - new Date(job.updated_at).getTime() > 3 * 86_400_000;
}

function dueLabel(value: string) {
  const diffMs = new Date(value).getTime() - Date.now();
  const absDays = Math.max(0, Math.ceil(Math.abs(diffMs) / 86_400_000));

  if (diffMs < 0) {
    if (absDays <= 1) {
      return "Due today";
    }

    return `${absDays} days overdue`;
  }

  if (absDays <= 1) {
    return "Due soon";
  }

  return `Due in ${absDays} days`;
}

function daysSince(value: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
}

function buildAttentionItems(jobs: Job[], quoteMessages: (QuoteMessage & { job: Job | null })[]): AttentionItem[] {
  const now = Date.now();
  const staleQuoteMs = 3 * 86_400_000;
  const soonMs = 7 * 86_400_000;
  const items: AttentionItem[] = [];

  quoteMessages.forEach((quoteMessage) => {
    if (!quoteMessage.job || quoteMessage.resolved_at) {
      return;
    }

    items.push({
      action: "Review the question and follow up with the customer.",
      age: ageLabel(quoteMessage.created_at),
      id: `${quoteMessage.id}-quote-message`,
      job: quoteMessage.job,
      priority: 0,
      problem: "Customer has a question about a quote",
      quoteMessage,
      quickAction: "resolve_quote_message",
    });
  });

  jobs.forEach((job) => {
    if (job.status === "completed" || job.status === "lost") {
      return;
    }

    if (job.status === "lead" && !job.first_contact_at) {
      items.push({
        action: "Contact the customer and mark the lead contacted.",
        age: ageLabel(job.created_at),
        id: `${job.id}-new-lead`,
        job,
        priority: 1,
        problem: "New lead has not been contacted",
        quickAction: "contacted",
      });
    }

    if (job.next_follow_up_at && new Date(job.next_follow_up_at).getTime() <= now) {
      items.push({
        action: "Follow up, then set the next follow-up date.",
        age: dueLabel(job.next_follow_up_at),
        id: `${job.id}-follow-up-due`,
        job,
        priority: 0,
        problem: "Follow-up is due",
      });
    }

    if (
      job.status === "quoted" &&
      job.quote_sent_at &&
      !job.next_follow_up_at &&
      now - new Date(job.quote_sent_at).getTime() >= staleQuoteMs
    ) {
      items.push({
        action: "Check in on the quote or set a follow-up.",
        age: `${daysSince(job.quote_sent_at)} days since quote`,
        id: `${job.id}-stale-quote`,
        job,
        priority: 2,
        problem: "Quote is getting stale",
      });
    }

    if ((job.status === "contacted" || job.status === "quoted") && !job.scheduled_start) {
      items.push({
        action: "Schedule the job or mark it lost.",
        age: ageLabel(job.updated_at),
        id: `${job.id}-unscheduled`,
        job,
        priority: 4,
        problem: "Opportunity is not scheduled",
      });
    }

    if (job.status === "scheduled" && !job.scheduled_start) {
      items.push({
        action: "Add a confirmed start date before treating this as scheduled work.",
        age: ageLabel(job.updated_at),
        id: `${job.id}-scheduled-no-date`,
        job,
        priority: 0,
        problem: "Scheduled job has no start date",
      });
    }

    if (
      job.status === "scheduled" &&
      job.scheduled_start &&
      new Date(job.scheduled_start).getTime() - now <= soonMs &&
      new Date(job.scheduled_start).getTime() >= now &&
      !job.job_address
    ) {
      items.push({
        action: "Add the service address before the crew heads out.",
        age: dueLabel(job.scheduled_start),
        id: `${job.id}-missing-address`,
        job,
        priority: 3,
        problem: "Upcoming job is missing an address",
      });
    }
  });

  return items.sort((a, b) => a.priority - b.priority || a.job.updated_at.localeCompare(b.job.updated_at)).slice(0, 8);
}

function attentionSeverity(item: AttentionItem): AttentionSeverity {
  if (item.priority === 0) {
    return "high";
  }

  if (item.problem === "New lead has not been contacted") {
    return daysSince(item.job.created_at) > 0 ? "high" : "warning";
  }

  if (item.priority === 2 || item.priority === 3) {
    return "warning";
  }

  return "info";
}

function attentionLabel(severity: AttentionSeverity) {
  return {
    high: "High",
    info: "Info",
    warning: "Warning",
  }[severity];
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function address(customer: Customer | CustomerSummary | null) {
  if (!customer) {
    return "";
  }

  return [customer.address_line1, customer.address_line2, customer.city, customer.state, customer.postal_code]
    .filter(Boolean)
    .join(", ");
}

function startOfWeek(date: Date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  copy.setUTCDate(copy.getUTCDate() - copy.getUTCDay());
  return copy;
}

function sameDate(a: Date, b: Date) {
  return dateKey(a) === dateKey(b);
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();

  return (
    <button className="button" disabled={pending} type="submit">
      {pending ? "Saving..." : children}
    </button>
  );
}

function openJobRow(event: MouseEvent<HTMLTableRowElement>, jobId: string, navigate: (href: string) => void) {
  const target = event.target as HTMLElement;

  if (target.closest("a, button, input, select, textarea")) {
    return;
  }

  navigate(`/jobs/${jobId}`);
}

function openCustomerRow(event: MouseEvent<HTMLTableRowElement>, customerId: string, navigate: (href: string) => void) {
  const target = event.target as HTMLElement;

  if (target.closest("a, button, input, select, textarea")) {
    return;
  }

  navigate(`/customers/${customerId}`);
}

function openJobRowFromKeyboard(event: KeyboardEvent<HTMLTableRowElement>, jobId: string, navigate: (href: string) => void) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  navigate(`/jobs/${jobId}`);
}

function openCustomerRowFromKeyboard(event: KeyboardEvent<HTMLTableRowElement>, customerId: string, navigate: (href: string) => void) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  navigate(`/customers/${customerId}`);
}

export function DashboardClient({
  activities,
  business,
  customers,
  intakeFields,
  initialView,
  jobs,
  message,
  quoteMessages,
  userEmail,
}: DashboardClientProps) {
  const [activeView, setActiveView] = useState<View>(initialView ?? "Overview");
  const [jobModal, setJobModal] = useState<{ job?: Job; scheduledStart?: Date } | null>(null);
  const [customerModal, setCustomerModal] = useState<CustomerSummary | null | "new">(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | JobStatus>("all");
  const [sort, setSort] = useState("scheduled");
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("Week");
  const [calendarDate, setCalendarDate] = useState(new Date());

  const counts = useMemo(
    () => ({
      lead: jobs.filter((job) => job.status === "lead").length,
      contacted: jobs.filter((job) => job.status === "contacted").length,
      quoted: jobs.filter((job) => job.status === "quoted").length,
      scheduled: jobs.filter((job) => job.status === "scheduled").length,
      in_progress: jobs.filter((job) => job.status === "in_progress").length,
      completed: jobs.filter((job) => job.status === "completed").length,
      lost: jobs.filter((job) => job.status === "lost").length,
    }),
    [jobs],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredJobs = useMemo(
    () =>
      [...jobs]
        .filter((job) => {
          const searchable = [job.customer?.name, job.customer?.email, job.customer?.phone, job.title, job.job_address]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          return (
            (statusFilter === "all" || job.status === statusFilter) &&
            (!normalizedQuery || searchable.includes(normalizedQuery))
          );
        })
        .sort((a, b) => {
          if (sort === "value") {
            return b.price_cents - a.price_cents;
          }

          if (sort === "customer") {
            return (a.customer?.name ?? "").localeCompare(b.customer?.name ?? "");
          }

          if (sort === "updated") {
            return b.updated_at.localeCompare(a.updated_at);
          }

          if (a.status === "lead" && b.status !== "lead") {
            return -1;
          }

          if (b.status === "lead" && a.status !== "lead") {
            return 1;
          }

          const aDate = a.scheduled_start ?? "9999-12-31";
          const bDate = b.scheduled_start ?? "9999-12-31";
          return aDate.localeCompare(bDate);
        }),
    [jobs, normalizedQuery, sort, statusFilter],
  );

  const visibleCustomers = useMemo(
    () =>
      customers.filter((customer) =>
        [customer.name, customer.email, customer.phone, address(customer)].filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery),
      ),
    [customers, normalizedQuery],
  );

  const totalPipeline = jobs
    .filter((job) => job.status !== "completed" && job.status !== "lost")
    .reduce((sum, job) => sum + job.price_cents, 0);
  const completedRevenue = jobs
    .filter((job) => job.status === "completed")
    .reduce((sum, job) => sum + job.revenue_cents, 0);
  const averageJobValue = jobs.length
    ? Math.round(jobs.reduce((sum, job) => sum + job.price_cents, 0) / jobs.length)
    : 0;
  const upcomingJobs = jobs
    .filter((job) => job.scheduled_start && operationalStatuses.includes(job.status))
    .sort((a, b) => String(a.scheduled_start).localeCompare(String(b.scheduled_start)))
    .slice(0, 5);
  const needsAttention = useMemo(() => buildAttentionItems(jobs, quoteMessages), [jobs, quoteMessages]);

  const showSearch = activeView === "Overview" || activeView === "Pipeline" || activeView === "Jobs" || activeView === "Customers";

  function moveCalendar(direction: number) {
    const next = new Date(calendarDate);
    if (calendarMode === "Month") {
      next.setUTCMonth(next.getUTCMonth() + direction);
    } else {
      next.setUTCDate(next.getUTCDate() + direction * 7);
    }
    setCalendarDate(next);
  }

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true">
              JT
            </div>
            <div>
              <p>Workspace</p>
              <strong>{business.name}</strong>
            </div>
          </div>

          <nav className="side-nav" aria-label="Dashboard sections">
            {navItems.map((item) => (
              <button
                className={activeView === item ? "active" : ""}
                key={item}
                onClick={() => setActiveView(item)}
                type="button"
              >
                <span aria-hidden="true">{navIcons[item]}</span>
                {item}
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <p>Today</p>
            <strong>{counts.scheduled + counts.in_progress}</strong>
            <span>{pluralize(counts.scheduled + counts.in_progress, "active job")}</span>
          </div>

          <form className="profile-card" action={logout}>
            <div>
              <p>Signed in</p>
              <strong>{userEmail}</strong>
            </div>
            <button className="button button-secondary" type="submit">
              Log out
            </button>
          </form>
        </aside>

        <section className="dashboard-main">
          <header className="dashboard-header">
            <div>
              <p className="eyebrow">{activeView}</p>
              <h1>{viewTitle(activeView)}</h1>
              <p className="muted">
                {todayLabel()} | {pluralize(jobs.length, "job")} | {pluralize(customers.length, "customer")}
              </p>
            </div>
            <div className="header-actions">
              {showSearch ? (
                <label className="search-field">
                  <span aria-hidden="true">
                    <SearchIcon />
                  </span>
                  <input
                    aria-label="Search jobs and customers"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={activeView === "Customers" ? "Search customers" : "Search jobs"}
                    value={query}
                  />
                </label>
              ) : null}
              {activeView !== "Settings" && (activeView === "Customers" || customers.length === 0) ? (
                <button className="button" onClick={() => setCustomerModal("new")} type="button">
                  <span aria-hidden="true">+</span>
                  New Customer
                </button>
              ) : null}
              {activeView !== "Settings" && activeView !== "Customers" && customers.length > 0 ? (
                <button className="button" onClick={() => setJobModal({})} type="button">
                  <span aria-hidden="true">+</span>
                  New Job
                </button>
              ) : null}
            </div>
          </header>

          {message ? <p className="success-message">{message}</p> : null}

          {activeView === "Overview" ? (
            <OverviewView
              activities={activities}
              completedRevenue={completedRevenue}
              counts={counts}
              jobs={filteredJobs}
              needsAttention={needsAttention}
              onCreateJob={() => setJobModal({})}
              onViewJobs={() => setActiveView("Jobs")}
              totalPipeline={totalPipeline}
              upcomingJobs={upcomingJobs}
              averageJobValue={averageJobValue}
            />
          ) : null}

          {activeView === "Jobs" ? (
            <JobsView
              filteredJobs={filteredJobs}
              jobs={jobs}
              setSort={setSort}
              setStatusFilter={setStatusFilter}
              sort={sort}
              statusFilter={statusFilter}
            />
          ) : null}

          {activeView === "Pipeline" ? <PipelineView jobs={filteredJobs} totalJobs={jobs.length} /> : null}

          {activeView === "Customers" ? (
            <CustomersView customers={visibleCustomers} hasCustomers={customers.length > 0} onCreate={() => setCustomerModal("new")} />
          ) : null}

          {activeView === "Calendar" ? (
            <CalendarView
              calendarDate={calendarDate}
              jobs={jobs}
              mode={calendarMode}
              onCreateJob={(scheduledStart) => setJobModal({ scheduledStart })}
              onModeChange={setCalendarMode}
              onMove={moveCalendar}
              onToday={() => setCalendarDate(new Date())}
            />
          ) : null}

          {activeView === "Analytics" ? (
            <AnalyticsView
              averageJobValue={averageJobValue}
              completedRevenue={completedRevenue}
              counts={counts}
              jobs={jobs}
              totalPipeline={totalPipeline}
            />
          ) : null}

          {activeView === "Settings" ? <SettingsView business={business} intakeFields={intakeFields} /> : null}
        </section>
      </div>

      {jobModal ? (
        <JobModal
          businessId={business.id}
          customers={customers}
          job={jobModal.job ?? null}
          onClose={() => setJobModal(null)}
          scheduledStart={jobModal.scheduledStart}
        />
      ) : null}

      {customerModal ? (
        <CustomerModal
          businessId={business.id}
          customer={customerModal === "new" ? null : customerModal}
          onClose={() => setCustomerModal(null)}
        />
      ) : null}
    </>
  );
}

function OverviewView({
  activities,
  averageJobValue,
  completedRevenue,
  counts,
  jobs,
  needsAttention,
  onCreateJob,
  onViewJobs,
  totalPipeline,
  upcomingJobs,
}: {
  activities: JobActivity[];
  averageJobValue: number;
  completedRevenue: number;
  counts: Record<JobStatus, number>;
  jobs: Job[];
  needsAttention: AttentionItem[];
  onCreateJob: () => void;
  onViewJobs: () => void;
  totalPipeline: number;
  upcomingJobs: Job[];
}) {
  return (
    <>
      <KpiGrid
        averageJobValue={averageJobValue}
        completedRevenue={completedRevenue}
        counts={counts}
        totalPipeline={totalPipeline}
      />
      <NeedsAttentionPanel items={needsAttention} onViewJobs={onViewJobs} />
      <section className="content-grid">
        <JobsPanel jobs={jobs.slice(0, 6)} title="Active job board" />
        <SideSummary activities={activities} onCreateJob={onCreateJob} upcomingJobs={upcomingJobs} />
      </section>
    </>
  );
}

function NeedsAttentionPanel({ items, onViewJobs }: { items: AttentionItem[]; onViewJobs: () => void }) {
  const visibleItems = items.slice(0, 4);
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);
  const severityCounts = items.reduce(
    (counts, item) => {
      counts[attentionSeverity(item)] += 1;
      return counts;
    },
    { high: 0, info: 0, warning: 0 } satisfies Record<AttentionSeverity, number>,
  );
  const panelState = items.length === 0 ? "clear" : severityCounts.high > 0 && severityCounts.warning === 0 && severityCounts.info === 0 ? "critical" : "mixed";

  return (
    <section className={`data-panel full-width attention-panel attention-panel-${panelState}`}>
      <div className="panel-heading">
        <div>
          <h2>Needs Attention</h2>
          <p className="muted">
            {items.length
              ? "Follow-ups, stale leads, and job details that could slow the day down."
              : "Nothing needs attention right now."}
          </p>
        </div>
        <span className="panel-count">{items.length ? pluralize(items.length, "item") : "All clear"}</span>
      </div>

      {items.length ? (
        <>
          <div className="attention-list">
          {visibleItems.map((item) => {
            const severity = attentionSeverity(item);

            return (
              <div className={`attention-item attention-${severity}`} key={item.id}>
                <span className={`attention-severity ${severity}`} aria-label={`${attentionLabel(severity)} priority`}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 2 2.8 19a2 2 0 0 0 1.8 3h14.8a2 2 0 0 0 1.8-3L12 2Zm1 15h-2v2h2v-2Zm0-7h-2v5h2v-5Z" />
                  </svg>
                  {attentionLabel(severity)}
                </span>
                <div>
                  <span>{item.job.customer?.name ?? "Unknown customer"}</span>
                  <strong>{item.job.title}</strong>
                </div>
                <p>{item.problem}</p>
                <span>{item.age}</span>
                <em>{item.action}</em>
                <div className="attention-actions">
                  {item.quickAction === "contacted" ? (
                    <form action={markJobContacted}>
                      <input type="hidden" name="jobId" value={item.job.id} />
                      <input type="hidden" name="returnTo" value="/dashboard" />
                      <button className="link-button" type="submit">
                        Mark Contacted
                      </button>
                    </form>
                  ) : null}
                  {item.quickAction === "resolve_quote_message" && item.quoteMessage ? (
                    <form action={resolveQuoteMessage}>
                      <input type="hidden" name="messageId" value={item.quoteMessage.id} />
                      <button className="link-button" type="submit">
                        Mark Answered
                      </button>
                    </form>
                  ) : null}
                  <Link className="link-button" href={`/jobs/${item.job.id}`}>
                    Open
                  </Link>
                </div>
              </div>
            );
          })}
          </div>
          {hiddenCount ? (
            <div className="attention-footer">
              <span>{pluralize(hiddenCount, "more item")} needs follow-up.</span>
              <button className="link-button" onClick={onViewJobs} type="button">
                View all jobs
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="attention-clear">
          <span aria-hidden="true">
            <CheckIcon />
          </span>
          <div>
            <strong>All clear</strong>
            <p className="muted">Nothing needs attention right now.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function JobsView({
  filteredJobs,
  jobs,
  setSort,
  setStatusFilter,
  sort,
  statusFilter,
}: {
  filteredJobs: Job[];
  jobs: Job[];
  setSort: (value: string) => void;
  setStatusFilter: (value: "all" | JobStatus) => void;
  sort: string;
  statusFilter: "all" | JobStatus;
}) {
  return (
    <JobsPanel
      fullWidth
      jobs={filteredJobs}
      setSort={setSort}
      setStatusFilter={setStatusFilter}
      sort={sort}
      statusFilter={statusFilter}
      title="Jobs"
      totalJobs={jobs.length}
    />
  );
}

function PipelineView({ jobs, totalJobs }: { jobs: Job[]; totalJobs: number }) {
  const groupedJobs = pipelineStatuses.map((status) => ({
    jobs: jobs.filter((job) => job.status === status),
    status,
  }));

  return (
    <section className="data-panel full-width pipeline-panel">
      <div className="panel-heading">
        <div>
          <h2>Pipeline</h2>
          <p className="muted">Move real jobs from first contact through completion without leaving the board.</p>
        </div>
        <span className="panel-count">{pluralize(jobs.length, "visible job")}</span>
      </div>

      {totalJobs ? (
        <div className="pipeline-board" aria-label="Job pipeline by status">
          {groupedJobs.map(({ status, jobs: columnJobs }) => (
            <section className="pipeline-column" key={status}>
              <div className="pipeline-column-header">
                <span className={`status-pill status-${status}`}>{statusLabels[status]}</span>
                <strong>{columnJobs.length}</strong>
              </div>
              <div className="pipeline-cards">
                {columnJobs.length ? (
                  columnJobs.map((job) => <PipelineCard job={job} key={job.id} />)
                ) : (
                  <p className="pipeline-empty">No {statusLabels[status].toLowerCase()} jobs.</p>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          description="Create your first job and it will appear here as a pipeline card."
          title="No jobs in the pipeline yet"
        />
      )}
    </section>
  );
}

function PipelineCard({ job }: { job: Job }) {
  const scheduledText = job.scheduled_start ? `${dateLabel(job.scheduled_start)} at ${timeLabel(job.scheduled_start)}` : null;

  return (
    <article className="pipeline-card">
      <Link className="pipeline-card-main" href={`/jobs/${job.id}`}>
        <div>
          <p>{job.customer?.name ?? "Unknown customer"}</p>
          <h3>{job.title}</h3>
        </div>
        <div className="pipeline-card-facts">
          <span>{money(job.price_cents)}</span>
          <span>{sourceLabels[job.source]}</span>
          {scheduledText && (job.status === "scheduled" || job.status === "in_progress" || job.status === "completed") ? (
            <span>{scheduledText}</span>
          ) : null}
        </div>
        <span className={isStale(job) ? "age-chip stale" : "age-chip"}>{ageLabel(job.created_at)}</span>
      </Link>
      {job.status === "lost" ? (
        <span className={`status-pill status-${job.status}`}>{statusLabels[job.status]}</span>
      ) : (
        <form action={updateJobStatus} className="pipeline-status-form">
          <input type="hidden" name="jobId" value={job.id} />
          <input type="hidden" name="returnTo" value="/dashboard?view=Pipeline" />
          <select
            aria-label={`Update ${job.title} status`}
            className={`status-select status-${job.status}`}
            defaultValue={job.status}
            name="status"
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            {statusChangeOrder.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
        </form>
      )}
    </article>
  );
}

function JobsPanel({
  fullWidth = false,
  jobs,
  setSort,
  setStatusFilter,
  sort,
  statusFilter,
  title,
  totalJobs,
}: {
  fullWidth?: boolean;
  jobs: Job[];
  setSort?: (value: string) => void;
  setStatusFilter?: (value: "all" | JobStatus) => void;
  sort?: string;
  statusFilter?: "all" | JobStatus;
  title: string;
  totalJobs?: number;
}) {
  const router = useRouter();

  return (
    <div className={fullWidth ? "data-panel jobs-panel full-width" : "data-panel jobs-panel"}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p className="muted">Track new leads, estimates, scheduled work, active installs, and completed jobs.</p>
        </div>
        {setStatusFilter && setSort ? (
          <div className="table-controls">
            <select
              aria-label="Filter by status"
              onChange={(event) => setStatusFilter(event.target.value as "all" | JobStatus)}
              value={statusFilter}
            >
              <option value="all">All statuses</option>
              {statusOrder.map((value) => (
                <option key={value} value={value}>
                  {statusLabels[value]}
                </option>
              ))}
            </select>
            <select aria-label="Sort jobs" onChange={(event) => setSort(event.target.value)} value={sort}>
              <option value="scheduled">Scheduled date</option>
              <option value="updated">Last updated</option>
              <option value="value">Job value</option>
              <option value="customer">Customer</option>
            </select>
          </div>
        ) : null}
      </div>

      {jobs.length ? (
        <div className="jobs-table-wrap">
          <table className="jobs-table operational-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Scheduled</th>
                <th>Value</th>
                <th>Last updated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  className="clickable-row"
                  key={job.id}
                  onClick={(event) => openJobRow(event, job.id, router.push)}
                  onKeyDown={(event) => openJobRowFromKeyboard(event, job.id, router.push)}
                  role="link"
                  tabIndex={0}
                >
                  <td className="identity-cell">
                    <Link className="row-title-link" href={`/jobs/${job.id}`}>
                      {job.title}
                    </Link>
                    <span>
                      {job.customer ? (
                        <Link href={`/customers/${job.customer.id}`}>{job.customer.name}</Link>
                      ) : (
                        "Unknown customer"
                      )}
                      {job.source && job.source !== "manual" ? ` · ${sourceLabels[job.source]}` : ""}
                    </span>
                  </td>
                  <td>
                    {job.status === "lost" ? (
                      <span className={`status-pill status-${job.status}`}>{statusLabels[job.status]}</span>
                    ) : (
                      <form action={updateJobStatus}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <input type="hidden" name="returnTo" value="/dashboard?view=Jobs" />
                        <select
                          className={`status-select status-${job.status}`}
                          aria-label={`Update ${job.title} status`}
                          name="status"
                          defaultValue={job.status}
                          onChange={(event) => event.currentTarget.form?.requestSubmit()}
                        >
                          {statusChangeOrder.map((value) => (
                            <option key={value} value={value}>
                              {statusLabels[value]}
                            </option>
                          ))}
                        </select>
                      </form>
                    )}
                  </td>
                  <td>
                    {dateLabel(job.scheduled_start)}
                    {job.scheduled_start ? <span>{timeLabel(job.scheduled_start)}</span> : null}
                  </td>
                  <td className="numeric-cell">{money(job.price_cents)}</td>
                  <td className="muted-cell">{dateLabel(job.updated_at)}</td>
                  <td className="row-arrow" aria-hidden="true">
                    &rarr;
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          description={
            totalJobs
              ? "Try a different search, status filter, or sort."
              : "Create a customer and job to start building an operating history."
          }
          title={totalJobs ? "No matching jobs" : "No jobs yet"}
        />
      )}
    </div>
  );
}

function KpiGrid({
  averageJobValue,
  completedRevenue,
  counts,
  totalPipeline,
}: {
  averageJobValue: number;
  completedRevenue: number;
  counts: Record<JobStatus, number>;
  totalPipeline: number;
}) {
  return (
    <section className="kpi-stack" aria-label="Job metrics">
      <div className="kpi-grid kpi-grid-primary">
        <KpiCard label="New Leads" value={counts.lead} helper="Needs first response" icon={<LeadIcon />} priority="primary" />
        <KpiCard label="Scheduled" value={counts.scheduled} helper="Confirmed work" icon={<CalendarIcon />} priority="primary" />
        <KpiCard label="In Progress" value={counts.in_progress} helper="Active installs" icon={<ProgressIcon />} priority="primary" />
        <KpiCard label="Open Pipeline" value={money(totalPipeline)} helper="Not completed" icon={<DollarIcon />} priority="primary" />
      </div>
      <div className="kpi-secondary-row">
        <KpiCard label="Quoted" value={counts.quoted} helper="Awaiting answer" icon={<QuoteIcon />} />
        <KpiCard label="Completed" value={counts.completed} helper={money(completedRevenue)} icon={<CheckIcon />} />
        <KpiCard label="Avg. Job" value={money(averageJobValue)} helper="Across all jobs" icon={<DollarIcon />} />
      </div>
    </section>
  );
}

function SideSummary({
  activities,
  onCreateJob,
  upcomingJobs,
}: {
  activities: JobActivity[];
  onCreateJob: () => void;
  upcomingJobs: Job[];
}) {
  return (
    <aside className="data-panel side-panel">
      <div className="panel-heading compact">
        <h2>Upcoming</h2>
      </div>
      {upcomingJobs.length ? (
        <ul className="upcoming-list">
          {upcomingJobs.map((job) => (
            <li key={job.id}>
              <span>{dateLabel(job.scheduled_start)} at {timeLabel(job.scheduled_start)}</span>
              <Link href={`/jobs/${job.id}`}>
                <strong>{job.customer?.name ?? "Customer"}</strong>
              </Link>
              <p>{job.title}</p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mini-empty">
          <p className="muted">Confirmed scheduled jobs will appear here.</p>
          <button className="link-button" onClick={onCreateJob} type="button">
            Schedule a job
          </button>
        </div>
      )}

      <div className="activity-block">
        <h2>Recent activity</h2>
        <div className="activity-list">
          {activities.length ? (
            activities.slice(0, 6).map((activity) => (
              <p key={activity.id}>
                {activity.job ? <Link href={`/jobs/${activity.job_id}`}>{activity.job.title}</Link> : "Job"}
                <span> {activity.message}</span>
              </p>
            ))
          ) : (
            <p className="muted">Job updates will appear here as work moves forward.</p>
          )}
        </div>
      </div>
    </aside>
  );
}

function CustomersView({
  customers,
  hasCustomers,
  onCreate,
}: {
  customers: CustomerSummary[];
  hasCustomers: boolean;
  onCreate: () => void;
}) {
  const router = useRouter();

  return (
    <section className="data-panel full-width customers-panel">
      <div className="panel-heading">
        <div>
          <h2>Customers</h2>
          <p className="muted">Manage customer records, contact details, and job history.</p>
        </div>
      </div>
      {customers.length ? (
        <div className="jobs-table-wrap">
          <table className="jobs-table customers-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th>Work</th>
                <th>Last job</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr
                  className="clickable-row"
                  key={customer.id}
                  onClick={(event) => openCustomerRow(event, customer.id, router.push)}
                  onKeyDown={(event) => openCustomerRowFromKeyboard(event, customer.id, router.push)}
                  role="link"
                  tabIndex={0}
                >
                  <td className="identity-cell customer-identity">
                    <Link className="row-title-link" href={`/customers/${customer.id}`}>
                      {customer.name}
                    </Link>
                    {address(customer) ? <span>{address(customer)}</span> : null}
                  </td>
                  <td className="contact-cell">
                    <span>{customer.phone || "No phone"}</span>
                    <span>{customer.email || "No email"}</span>
                  </td>
                  <td>
                    <div className="customer-stat-strip">
                      <span>
                        <strong>{customer.job_count}</strong>
                        {customer.job_count === 1 ? "job" : "jobs"}
                      </span>
                      <span>
                        <strong>{money(customer.lifetime_value_cents)}</strong>
                        lifetime
                      </span>
                    </div>
                  </td>
                  <td className="muted-cell">{dateLabel(customer.last_job_date)}</td>
                  <td className="row-arrow" aria-hidden="true">
                    &rarr;
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          actionLabel="New Customer"
          description={hasCustomers ? "No customers match that search." : "Create customer records before or while adding jobs."}
          onAction={onCreate}
          title={hasCustomers ? "No matching customers" : "No customers yet"}
        />
      )}
    </section>
  );
}

function CalendarView({
  calendarDate,
  jobs,
  mode,
  onCreateJob,
  onModeChange,
  onMove,
  onToday,
}: {
  calendarDate: Date;
  jobs: Job[];
  mode: CalendarMode;
  onCreateJob: (scheduledStart?: Date) => void;
  onModeChange: (mode: CalendarMode) => void;
  onMove: (direction: number) => void;
  onToday: () => void;
}) {
  const operationalJobs = jobs.filter((job) => job.scheduled_start && operationalStatuses.includes(job.status));
  const tentativeJobs = jobs.filter((job) => job.scheduled_start && job.status === "quoted");
  const rangeLabel = calendarRangeLabel(calendarDate, mode);

  return (
    <section className="data-panel full-width calendar-panel">
      <div className="panel-heading calendar-heading">
        <div>
          <h2>Schedule</h2>
          <p className="muted">Confirmed scheduled and in-progress work appears on the operating calendar.</p>
        </div>
        <div className="calendar-controls">
          <div className="segmented-control" aria-label="Calendar view">
            {(["Week", "Month", "Agenda"] as CalendarMode[]).map((value) => (
              <button className={mode === value ? "active" : ""} key={value} onClick={() => onModeChange(value)} type="button">
                {value}
              </button>
            ))}
          </div>
          <button className="button button-secondary" onClick={() => onMove(-1)} type="button">
            Prev
          </button>
          <button className="button button-secondary" onClick={onToday} type="button">
            Today
          </button>
          <button className="button button-secondary" onClick={() => onMove(1)} type="button">
            Next
          </button>
        </div>
      </div>

      <div className="calendar-range">{rangeLabel}</div>
      {mode === "Week" ? <WeekCalendar date={calendarDate} jobs={operationalJobs} onCreateJob={onCreateJob} /> : null}
      {mode === "Month" ? <MonthCalendar date={calendarDate} jobs={operationalJobs} /> : null}
      {mode === "Agenda" ? <AgendaCalendar jobs={operationalJobs} /> : null}

      {tentativeJobs.length ? (
        <div className="tentative-list">
          <h3>Tentative quotes</h3>
          <p className="muted">Quoted jobs with dates are listed separately until they are scheduled.</p>
          <div>
            {tentativeJobs.slice(0, 5).map((job) => (
              <Link className="tentative-item" href={`/jobs/${job.id}`} key={job.id}>
                <span>{dateLabel(job.scheduled_start)}</span>
                <strong>{job.customer?.name ?? "Customer"}</strong>
                <span>{job.title}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function WeekCalendar({
  date,
  jobs,
  onCreateJob,
}: {
  date: Date;
  jobs: Job[];
  onCreateJob: (scheduledStart?: Date) => void;
}) {
  const first = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, index) => addDays(first, index));

  return (
    <div className="week-grid">
      {days.map((day) => {
        const dayJobs = jobs.filter((job) => job.scheduled_start && sameDate(new Date(job.scheduled_start), day));
        return (
          <div className="calendar-day" key={day.toISOString()}>
            <button className="day-head" onClick={() => onCreateJob(day)} type="button">
              <span>{new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(day)}</span>
              <strong>{day.getUTCDate()}</strong>
            </button>
            <div className="day-events">
              {dayJobs.length ? (
                dayJobs.map((job) => <CalendarEvent job={job} key={job.id} />)
              ) : (
                <span className="no-events">Open</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthCalendar({ date, jobs }: { date: Date; jobs: Job[] }) {
  const firstOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const first = startOfWeek(firstOfMonth);
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index));

  return (
    <div className="month-grid">
      {days.map((day) => {
        const dayJobs = jobs.filter((job) => job.scheduled_start && sameDate(new Date(job.scheduled_start), day));
        return (
          <div className={day.getUTCMonth() === date.getUTCMonth() ? "month-day" : "month-day muted-day"} key={day.toISOString()}>
            <strong>{day.getUTCDate()}</strong>
            {dayJobs.slice(0, 2).map((job) => (
              <CalendarEvent compact job={job} key={job.id} />
            ))}
            {dayJobs.length > 2 ? <span className="more-events">+{dayJobs.length - 2} more</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function AgendaCalendar({ jobs }: { jobs: Job[] }) {
  const groups = jobs
    .sort((a, b) => String(a.scheduled_start).localeCompare(String(b.scheduled_start)))
    .reduce<Record<string, Job[]>>((acc, job) => {
      const key = dateLabel(job.scheduled_start);
      acc[key] = acc[key] ?? [];
      acc[key].push(job);
      return acc;
    }, {});

  if (!jobs.length) {
    return (
      <EmptyState
        description="Scheduled and in-progress jobs will appear here once they have dates."
        title="No confirmed schedule yet"
      />
    );
  }

  return (
    <div className="agenda-list">
      {Object.entries(groups).map(([day, dayJobs]) => (
        <section key={day}>
          <h3>{day}</h3>
          {dayJobs.map((job) => (
            <CalendarEvent job={job} key={job.id} />
          ))}
        </section>
      ))}
    </div>
  );
}

function CalendarEvent({ compact = false, job }: { compact?: boolean; job: Job }) {
  return (
    <Link className={compact ? `calendar-event compact status-${job.status}` : `calendar-event status-${job.status}`} href={`/jobs/${job.id}`}>
      <span>{timeLabel(job.scheduled_start)}</span>
      <strong>{job.customer?.name ?? "Customer"}</strong>
      <span>{job.title}</span>
    </Link>
  );
}

function AnalyticsView({
  averageJobValue,
  completedRevenue,
  counts,
  jobs,
  totalPipeline,
}: {
  averageJobValue: number;
  completedRevenue: number;
  counts: Record<JobStatus, number>;
  jobs: Job[];
  totalPipeline: number;
}) {
  const maxCount = Math.max(...Object.values(counts), 1);
  const sourceRows = buildSourcePerformance(jobs);

  return (
    <>
      <KpiGrid
        averageJobValue={averageJobValue}
        completedRevenue={completedRevenue}
        counts={counts}
        totalPipeline={totalPipeline}
      />
      <section className="data-panel full-width analytics-panel">
        <div className="panel-heading compact">
          <h2>Status mix</h2>
          <p className="muted">A quick read on where work sits today.</p>
        </div>
        <div className="bar-list">
          {statusOrder.map((status) => (
            <div className="bar-row" key={status}>
              <span>{statusLabels[status]}</span>
              <div>
                <i style={{ width: `${counts[status] === 0 ? 0 : (counts[status] / maxCount) * 100}%` }} />
              </div>
              <strong>{counts[status]}</strong>
            </div>
          ))}
        </div>
        <div className="analytics-note">
          {jobs.length
            ? "Use this view to spot where work is piling up before the week gets away from you."
            : "Analytics will become useful after you add your first few jobs."}
        </div>
      </section>
      <section className="data-panel full-width analytics-panel">
        <div className="panel-heading compact">
          <h2>Source performance</h2>
          <p className="muted">Lead sources, follow-through, and booked revenue from real job data.</p>
        </div>
        {sourceRows.length ? (
          <div className="jobs-table-wrap">
            <table className="jobs-table source-performance-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Leads</th>
                  <th>Contacted</th>
                  <th>Won / Completed</th>
                  <th>Revenue</th>
                  <th>Conversion</th>
                </tr>
              </thead>
              <tbody>
                {sourceRows.map((row) => (
                  <tr key={row.source}>
                    <td className="identity-cell">
                      <strong>{sourceLabels[row.source]}</strong>
                    </td>
                    <td>{row.leads}</td>
                    <td>{row.contacted}</td>
                    <td>{row.won}</td>
                    <td className="numeric-cell">{money(row.revenue)}</td>
                    <td>{row.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState description="Create jobs with lead sources to compare which channels turn into revenue." title="No source data yet" />
        )}
      </section>
    </>
  );
}

function buildSourcePerformance(jobs: Job[]) {
  return sourceOrder
    .map((source) => {
      const sourceJobs = jobs.filter((job) => job.source === source);
      const leads = sourceJobs.length;
      const contacted = sourceJobs.filter((job) => job.first_contact_at || job.status !== "lead").length;
      const wonJobs = sourceJobs.filter((job) => job.status !== "lost" && (job.won_at || job.completed_at || job.status === "completed"));
      const revenue = wonJobs.reduce((sum, job) => sum + job.revenue_cents, 0);

      return {
        contacted,
        conversionRate: leads ? Math.round((wonJobs.length / leads) * 100) : 0,
        leads,
        revenue,
        source,
        won: wonJobs.length,
      };
    })
    .filter((row) => row.leads > 0);
}

function SettingsView({ business, intakeFields }: { business: Business; intakeFields: IntakeField[] }) {
  const intakePath = business.slug ? `/intake/${business.slug}` : "";
  const enabledFieldCount = intakeFields.filter((field) => field.enabled).length;

  async function copyIntakeLink() {
    if (!intakePath) {
      return;
    }

    await navigator.clipboard?.writeText(`${window.location.origin}${intakePath}`);
  }

  return (
    <div className="settings-stack">
      <section className="data-panel settings-panel">
        <div className="panel-heading compact">
          <h2>Workspace settings</h2>
          <p className="muted">Keep the workspace name clean for dashboards and team context.</p>
        </div>
        <form className="settings-form" action={updateBusiness}>
          <input type="hidden" name="businessId" value={business.id} />
          <div className="field">
            <label htmlFor="businessName">Business name</label>
            <input id="businessName" name="name" defaultValue={business.name} required />
          </div>
          <SubmitButton>Save settings</SubmitButton>
        </form>
      </section>

      <section className="data-panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Public intake form</h2>
            <p className="muted">Share this link with prospects so new requests land as leads.</p>
          </div>
          <span className={business.intake_form_enabled ? "status-pill status-scheduled" : "status-pill"}>
            {business.intake_form_enabled ? "Enabled" : "Disabled"}
          </span>
        </div>

        {intakePath ? (
          <div className="intake-link-card">
            <span>Public URL</span>
            <code>{intakePath}</code>
            <div>
              <button className="button button-secondary" onClick={copyIntakeLink} type="button">
                Copy link
              </button>
              <Link className="button button-secondary" href={intakePath}>
                Open form
              </Link>
            </div>
          </div>
        ) : (
          <p className="message">Run the latest schema to generate a public form slug for this workspace.</p>
        )}

        <form className="settings-form" action={updateIntakeSettings}>
          <input type="hidden" name="businessId" value={business.id} />
          <label className="toggle-row">
            <input name="intakeEnabled" type="checkbox" defaultChecked={business.intake_form_enabled} />
            <span>Accept public submissions</span>
          </label>
          <div className="field">
            <label htmlFor="intakeTitle">Form headline</label>
            <input id="intakeTitle" name="intakeTitle" defaultValue={business.intake_form_title} />
          </div>
          <div className="field">
            <label htmlFor="intakeDescription">Short description</label>
            <textarea id="intakeDescription" name="intakeDescription" defaultValue={business.intake_form_description} />
          </div>
          <SubmitButton>Save intake form</SubmitButton>
        </form>
      </section>

      <section className="data-panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Custom intake fields</h2>
            <p className="muted">Add workspace-specific questions without changing the public form code.</p>
          </div>
          <span className="panel-count">{pluralize(enabledFieldCount, "active field")}</span>
        </div>

        <div className="intake-fields-list">
          {intakeFields.length ? (
            intakeFields.map((field, index) => (
              <details className={field.enabled ? "intake-field-row" : "intake-field-row disabled-field"} key={field.id}>
                <summary>
                  <span>
                    <strong>{field.label}</strong>
                    <em>
                      {field.field_key} · {intakeFieldTypeLabels[field.field_type]}
                      {field.required ? " · Required" : " · Optional"}
                    </em>
                  </span>
                  <span className={field.enabled ? "status-pill status-scheduled" : "status-pill"}>{field.enabled ? "Enabled" : "Disabled"}</span>
                </summary>

                <form className="settings-form intake-field-form" action={updateIntakeField}>
                  <IntakeFieldInputs businessId={business.id} field={field} />
                  <SubmitButton>Save field</SubmitButton>
                </form>

                <div className="intake-field-actions">
                  <form action={moveIntakeField}>
                    <input type="hidden" name="businessId" value={business.id} />
                    <input type="hidden" name="fieldId" value={field.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button className="button button-secondary" disabled={index === 0} type="submit">
                      Move up
                    </button>
                  </form>
                  <form action={moveIntakeField}>
                    <input type="hidden" name="businessId" value={business.id} />
                    <input type="hidden" name="fieldId" value={field.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button className="button button-secondary" disabled={index === intakeFields.length - 1} type="submit">
                      Move down
                    </button>
                  </form>
                  <form action={archiveIntakeField}>
                    <input type="hidden" name="businessId" value={business.id} />
                    <input type="hidden" name="fieldId" value={field.id} />
                    <button className="button button-secondary danger-button" disabled={!field.enabled} type="submit">
                      Disable
                    </button>
                  </form>
                </div>
              </details>
            ))
          ) : (
            <div className="mini-empty-state">
              <strong>No custom fields yet</strong>
              <p className="muted">The public form still collects the core contact and project details. Add only the extra questions this workspace needs.</p>
            </div>
          )}
        </div>

        <details className="intake-field-builder">
          <summary>Add custom field</summary>
          <form className="settings-form intake-field-form" action={createIntakeField}>
            <IntakeFieldInputs businessId={business.id} />
            <SubmitButton>Add field</SubmitButton>
          </form>
        </details>
      </section>
    </div>
  );
}

function IntakeFieldInputs({ businessId, field }: { businessId: string; field?: IntakeField }) {
  return (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      {field ? <input type="hidden" name="fieldId" value={field.id} /> : null}
      <div className="split-fields">
        <div className="field">
          <label htmlFor={field ? `field-label-${field.id}` : "new-field-label"}>Label</label>
          <input
            id={field ? `field-label-${field.id}` : "new-field-label"}
            name="label"
            defaultValue={field?.label ?? ""}
            maxLength={80}
            placeholder="Garage size"
            required
          />
        </div>
        <div className="field">
          <label htmlFor={field ? `field-key-${field.id}` : "new-field-key"}>Stable key</label>
          <input
            id={field ? `field-key-${field.id}` : "new-field-key"}
            name="fieldKey"
            defaultValue={field?.field_key ?? ""}
            pattern="[a-z][a-z0-9_]{1,40}"
            placeholder="garage_size"
          />
          <p className="field-hint">Use lowercase letters, numbers, and underscores. Leave blank to generate from the label.</p>
        </div>
      </div>
      <div className="split-fields">
        <div className="field">
          <label htmlFor={field ? `field-type-${field.id}` : "new-field-type"}>Field type</label>
          <select id={field ? `field-type-${field.id}` : "new-field-type"} name="fieldType" defaultValue={field?.field_type ?? "short_text"}>
            {Object.entries(intakeFieldTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field toggles-field">
          <label className="toggle-row">
            <input name="required" type="checkbox" defaultChecked={field?.required ?? false} />
            <span>Required</span>
          </label>
          <label className="toggle-row">
            <input name="enabled" type="checkbox" defaultChecked={field?.enabled ?? true} />
            <span>Enabled</span>
          </label>
        </div>
      </div>
      <div className="field">
        <label htmlFor={field ? `field-options-${field.id}` : "new-field-options"}>Select options</label>
        <textarea
          id={field ? `field-options-${field.id}` : "new-field-options"}
          name="options"
          defaultValue={field?.options.join("\n") ?? ""}
          placeholder={"Residential\nCommercial\nOther"}
        />
        <p className="field-hint">Only used for Select fields. Put each option on its own line.</p>
      </div>
    </>
  );
}

function CustomerModal({
  businessId,
  customer,
  onClose,
}: {
  businessId: string;
  customer: CustomerSummary | null;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="customer-modal-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{customer ? "Edit Customer" : "New Customer"}</p>
            <h2 id="customer-modal-title">{customer ? "Update customer record" : "Create customer record"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close customer form">
            x
          </button>
        </div>
        <form className="modal-form" action={customer ? updateCustomer : createCustomer}>
          <input type="hidden" name="businessId" value={businessId} />
          {customer ? <input type="hidden" name="customerId" value={customer.id} /> : null}
          <CustomerFields customer={customer} />
          <div className="modal-actions">
            <button className="button button-secondary" onClick={onClose} type="button">
              Cancel
            </button>
            <SubmitButton>{customer ? "Save customer" : "Create customer"}</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}

function JobModal({
  businessId,
  customers,
  job,
  onClose,
  scheduledStart,
}: {
  businessId: string;
  customers: CustomerSummary[];
  job: Job | null;
  onClose: () => void;
  scheduledStart?: Date;
}) {
  const start = job ? dateTimeValue(job.scheduled_start) : scheduledStart ? dateTimeValue(scheduledStart.toISOString()) : { date: "", time: "" };
  const end = job ? dateTimeValue(job.scheduled_end) : { date: "", time: "" };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="job-modal-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{job ? "Edit Job" : "New Job"}</p>
            <h2 id="job-modal-title">{job ? "Update job details" : "Add work to the schedule"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close job form">
            x
          </button>
        </div>
        <form className="modal-form" action={job ? updateJob : createJob}>
          <input type="hidden" name="businessId" value={businessId} />
          {job ? <input type="hidden" name="jobId" value={job.id} /> : null}
          <JobFields customers={customers} end={end} job={job} start={start} />
          <div className="modal-actions">
            <button className="button button-secondary" onClick={onClose} type="button">
              Cancel
            </button>
            <SubmitButton>{job ? "Save job" : "Create job"}</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CustomerFields({ customer }: { customer: Customer | CustomerSummary | null }) {
  return (
    <>
      <div className="field">
        <label htmlFor="name">Customer name</label>
        <input id="name" name="name" defaultValue={customer?.name ?? ""} placeholder="Sarah Mitchell" required />
      </div>
      <div className="split-fields">
        <div className="field">
          <label htmlFor="phone">Phone</label>
          <input id="phone" name="phone" defaultValue={customer?.phone ?? ""} placeholder="(555) 123-0123" />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" defaultValue={customer?.email ?? ""} placeholder="customer@example.com" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="addressLine1">Address line 1</label>
        <input id="addressLine1" name="addressLine1" defaultValue={customer?.address_line1 ?? ""} placeholder="1200 Maple Street" />
      </div>
      <div className="split-fields">
        <div className="field">
          <label htmlFor="city">City</label>
          <input id="city" name="city" defaultValue={customer?.city ?? ""} placeholder="Austin" />
        </div>
        <div className="field two-col">
          <label htmlFor="state">State</label>
          <input id="state" name="state" defaultValue={customer?.state ?? ""} placeholder="TX" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" defaultValue={customer?.notes ?? ""} placeholder="Gate code, preferred contact time, or site notes" />
      </div>
    </>
  );
}

export function JobFields({
  customers,
  end,
  job,
  start,
}: {
  customers: CustomerSummary[];
  end: { date: string; time: string };
  job: Job | null;
  start: { date: string; time: string };
}) {
  return (
    <>
      <div className="field">
        <label htmlFor="customerId">Customer</label>
        <select id="customerId" name="customerId" defaultValue={job?.customer_id ?? customers[0]?.id ?? ""} required>
          <option value="" disabled>
            Select a customer
          </option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="title">Job title</label>
        <input id="title" name="title" defaultValue={job?.title ?? ""} placeholder="Garage floor coating" required />
      </div>
      <div className="field">
        <label htmlFor="description">Description</label>
        <textarea id="description" name="description" defaultValue={job?.description ?? ""} placeholder="Scope, prep, materials, and expectations" />
      </div>
      <div className="split-fields">
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={job?.status ?? "lead"}>
            {(job?.status === "lost" ? statusOrder : statusChangeOrder).map((value) => (
              <option key={value} value={value}>
                {statusLabels[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="price">Job value</label>
          <input id="price" name="price" inputMode="decimal" defaultValue={job ? inputMoney(job.price_cents) : ""} placeholder="3200" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="source">Lead source</label>
        <select id="source" name="source" defaultValue={job?.source ?? "manual"}>
          {sourceOrder.map((value) => (
            <option key={value} value={value}>
              {sourceLabels[value]}
            </option>
          ))}
        </select>
      </div>
      <div className="split-fields">
        <div className="field">
          <label htmlFor="scheduledDate">Start date</label>
          <input id="scheduledDate" name="scheduledDate" type="date" defaultValue={start.date} />
        </div>
        <div className="field">
          <label htmlFor="scheduledTime">Start time</label>
          <input id="scheduledTime" name="scheduledTime" type="time" defaultValue={start.time} />
        </div>
      </div>
      <div className="split-fields">
        <div className="field">
          <label htmlFor="scheduledEndDate">End date</label>
          <input id="scheduledEndDate" name="scheduledEndDate" type="date" defaultValue={end.date} />
        </div>
        <div className="field">
          <label htmlFor="scheduledEndTime">End time</label>
          <input id="scheduledEndTime" name="scheduledEndTime" type="time" defaultValue={end.time} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="jobAddress">Service address</label>
        <input id="jobAddress" name="jobAddress" defaultValue={job?.job_address ?? ""} placeholder="Leave blank to use customer address" />
      </div>
      <div className="field">
        <label htmlFor="internalNotes">Internal notes</label>
        <textarea id="internalNotes" name="internalNotes" defaultValue={job?.internal_notes ?? ""} placeholder="Crew notes, access details, or reminders" />
      </div>
    </>
  );
}

function KpiCard({
  label,
  value,
  helper,
  icon,
  priority = "secondary",
}: {
  label: string;
  value: string | number;
  helper: string;
  icon: React.ReactNode;
  priority?: "primary" | "secondary";
}) {
  return (
    <div className={`kpi-card kpi-card-${priority}`}>
      <div className="kpi-icon" aria-hidden="true">
        {icon}
      </div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{helper}</span>
    </div>
  );
}

function EmptyState({
  actionLabel,
  actionHref,
  description,
  onAction,
  title,
}: {
  actionLabel?: string;
  actionHref?: string;
  description: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        +
      </div>
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      {actionHref ? (
        <Link className="button" href={actionHref}>
          {actionLabel}
        </Link>
      ) : null}
      {onAction ? (
        <button className="button" onClick={onAction} type="button">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function calendarRangeLabel(date: Date, mode: CalendarMode) {
  if (mode === "Month") {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
  }

  const first = startOfWeek(date);
  const last = addDays(first, 6);

  if (mode === "Agenda") {
    return "Upcoming confirmed schedule";
  }

  return `${dateLabel(first.toISOString())} - ${dateLabel(last.toISOString())}`;
}

function viewTitle(view: View) {
  const titles: Record<View, string> = {
    Overview: "Today's work",
    Pipeline: "Pipeline board",
    Jobs: "Job pipeline",
    Customers: "Customer list",
    Calendar: "Field schedule",
    Analytics: "Performance snapshot",
    Settings: "Workspace settings",
  };

  return titles[view];
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.8 4a6.8 6.8 0 0 1 5.4 10.9l3.5 3.4a1 1 0 0 1-1.4 1.4l-3.4-3.5A6.8 6.8 0 1 1 10.8 4Zm0 2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Z" />
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8.7L5 20.2A1 1 0 0 1 3.4 19v-3.2A2 2 0 0 1 3 14.6V6a2 2 0 0 1 2-2Zm1 4v2h12V8H6Zm0 4v2h7v-2H6Z" />
    </svg>
  );
}

function LeadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 4.5 6.8v6.8c0 3.3 2.1 6.3 5.3 7.3l2.2.7 2.2-.7a7.6 7.6 0 0 0 5.3-7.3V6.8L12 3Zm0 2.2 5.5 2.8v5.6c0 2.4-1.5 4.6-3.9 5.4l-1.6.5-1.6-.5a5.6 5.6 0 0 1-3.9-5.4V8L12 5.2Zm-1 4.3v3.1l-1.9 1.9a1 1 0 1 0 1.4 1.4l2.2-2.2c.2-.2.3-.4.3-.7V9.5a1 1 0 1 0-2 0Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.7 8.7-5.2 5.2a1 1 0 0 1-1.4 0l-2.5-2.5A1 1 0 1 1 9 12l1.8 1.8 4.5-4.5a1 1 0 0 1 1.4 1.4Z" />
    </svg>
  );
}

function DollarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 3a1 1 0 1 0-2 0v1.1c-2.4.4-4.2 1.9-4.2 4.1 0 2.7 2.4 3.5 4.6 4.1l.6.2c2.1.6 2.9 1 2.9 2.2 0 1.1-1 2-3 2-1.8 0-3-.7-3.8-1.5a1 1 0 1 0-1.5 1.3A7.1 7.1 0 0 0 11 18.6V21a1 1 0 1 0 2 0v-2.4c2.3-.4 3.9-1.9 3.9-4 0-2.8-2.5-3.6-4.4-4.1l-.7-.2c-2.1-.6-3-1-3-2.1 0-1.2 1.2-2.1 3-2.1 1.4 0 2.4.4 3.2 1.1a1 1 0 0 0 1.4-1.4A6.3 6.3 0 0 0 13 4.1V3Z" />
    </svg>
  );
}

const navIcons: Record<View, React.ReactNode> = {
  Overview: <svg viewBox="0 0 24 24"><path d="M4 13h7V4H4v9Zm0 7h7v-4H4v4Zm10 0h6v-9h-6v9Zm0-12h6V4h-6v4Z" /></svg>,
  Pipeline: <svg viewBox="0 0 24 24"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18.5v-13Zm2 0v13c0 .3.2.5.5.5h9c.3 0 .5-.2.5-.5v-13c0-.3-.2-.5-.5-.5h-9c-.3 0-.5.2-.5.5Zm2 2h6v2H9v-2Zm0 4h6v2H9v-2Zm0 4h4v2H9v-2Z" /></svg>,
  Jobs: <svg viewBox="0 0 24 24"><path d="M8 6V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1h2.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-9A2.5 2.5 0 0 1 5.5 6H8Zm2 0h4V5h-4v1Z" /></svg>,
  Customers: <svg viewBox="0 0 24 24"><path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 19.2c0-3.4 2.8-6.2 6.2-6.2h.6c3.4 0 6.2 2.8 6.2 6.2 0 .4-.3.8-.8.8H3.3c-.5 0-.8-.4-.8-.8Z" /></svg>,
  Calendar: <svg viewBox="0 0 24 24"><path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1.5A2.5 2.5 0 0 1 22 6.5v12a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5v-12A2.5 2.5 0 0 1 4.5 4H6V3a1 1 0 0 1 1-1ZM4 9v9.5c0 .3.2.5.5.5h15c.3 0 .5-.2.5-.5V9H4Z" /></svg>,
  Analytics: <svg viewBox="0 0 24 24"><path d="M4 19h16a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1V4a1 1 0 1 1 2 0v15Zm3-7a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v5H7v-5Zm5-5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v10h-3V7Zm5 3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v7h-3v-7Z" /></svg>,
  Settings: <svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" /></svg>,
};

function CalendarIcon() {
  return navIcons.Calendar;
}

function ProgressIcon() {
  return navIcons.Analytics;
}
