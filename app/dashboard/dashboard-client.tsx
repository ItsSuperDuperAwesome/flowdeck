"use client";

import { logout } from "@/app/auth/actions";
import { ToastMessage } from "@/app/toast-message";
import {
  archiveIntakeField,
  createActionPlaybook,
  createCustomer,
  createIntakeField,
  createJob,
  createServiceType,
  markJobContacted,
  moveConfigItem,
  moveIntakeField,
  resolveQuoteMessage,
  updateActionPlaybook,
  updateBusiness,
  updateOnboardingState,
  updateCustomer,
  updateDashboardWidgetConfig,
  updateFollowupSettings,
  updateIntakeField,
  updateIntakeSettings,
  updateJob,
  updateJobStatus,
  updatePipelineStatusConfig,
  updateServiceType,
  updateTerminology,
} from "@/app/dashboard/actions";
import {
  attentionLabel,
  buildAttentionIssues,
  issuesByJobId,
  type AttentionIssue,
  type AttentionSeverity,
} from "@/lib/job-tracker/attention";
import {
  dashboardWidgetRegistry,
  enabledPipelineStatuses,
  normalizeFollowupSettings,
  normalizeDashboardWidgets,
  normalizePipelineStatuses,
  normalizeServiceTypes,
  normalizeTerminology,
  pipelineLabelMap,
  displayWorkspaceName,
  lowerTerm,
  serviceLabel,
  serviceKey,
  type Terminology,
} from "@/lib/job-tracker/config";
import { completedRevenueCents, isOpenPipelineStatus, openPipelineValueCents, opportunityValueCents, wonValueCents } from "@/lib/job-tracker/money";
import { successFeedbackMessage } from "@/lib/job-tracker/feedback";
import { actionTypeOrder, defaultActionLabel, resolvePlaybookForJob } from "@/lib/job-tracker/playbooks";
import type {
  BusinessActionPlaybook,
  Business,
  BusinessDashboardWidget,
  BusinessFollowupSettings,
  BusinessOnboardingState,
  BusinessPipelineStatus,
  BusinessServiceType,
  BusinessTerminology,
  Customer,
  CustomerSummary,
  DashboardWidgetKey,
  IntakeField,
  IntakeFieldType,
  Job,
  JobActivity,
  JobSource,
  JobStatus,
  ActionPlaybookType,
  Quote,
  QuoteMessage,
} from "@/lib/job-tracker/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

type View = "Overview" | "Pipeline" | "Jobs" | "Customers" | "Calendar" | "Analytics" | "Settings";
type CalendarMode = "Week" | "Month" | "Agenda";
type SupportMode = { businessId: string; businessName: string } | null;
type JobFilterMode = "all" | "needs-attention" | "open-pipeline";
type DashboardFilter = JobFilterMode | JobStatus;
type SettingsTab = "Workspace" | "Terminology" | "Services" | "Pipeline" | "Dashboard" | "Public intake" | "Team Steps";

type DashboardClientProps = {
  activities: JobActivity[];
  attentionActivities: JobActivity[];
  adminMode?: SupportMode;
  business: Business;
  customers: CustomerSummary[];
  actionPlaybooks: BusinessActionPlaybook[];
  dashboardWidgets: BusinessDashboardWidget[];
  followupSettings: BusinessFollowupSettings | null;
  intakeFields: IntakeField[];
  initialView?: View;
  initialJobFilter?: JobFilterMode;
  initialSettingsTab?: SettingsTab;
  initialStatusFilter?: "all" | JobStatus;
  jobs: Job[];
  message?: string;
  onboardingState: BusinessOnboardingState | null;
  pipelineStatuses: BusinessPipelineStatus[];
  quoteMessages: (QuoteMessage & { job: Job | null })[];
  quotes: Quote[];
  serviceTypes: BusinessServiceType[];
  terminology: BusinessTerminology | null;
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

function isStale(job: Job) {
  if (job.status === "completed" || job.status === "lost") {
    return false;
  }

  return Date.now() - new Date(job.updated_at).getTime() > 3 * 86_400_000;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function indefiniteTerm(term: string) {
  const normalized = lowerTerm(term).trim();
  const article = /^[aeiou]/i.test(normalized) ? "an" : "a";
  return `${article} ${normalized}`;
}

function isOpenPipelineJob(job: Job) {
  return isOpenPipelineStatus(job.status);
}

function scopedHref(href: string, supportMode: SupportMode) {
  if (!supportMode || href.startsWith("#") || href.startsWith("tel:") || href.startsWith("mailto:") || href.startsWith("http")) {
    return href;
  }

  const [beforeHash, hash = ""] = href.split("#");
  const separator = beforeHash.includes("?") ? "&" : "?";
  const scoped = `${beforeHash}${separator}adminBusinessId=${encodeURIComponent(supportMode.businessId)}`;
  return hash ? `${scoped}#${hash}` : scoped;
}

function dashboardHref(view: View, supportMode: SupportMode, filter?: DashboardFilter) {
  const params = new URLSearchParams();

  if (view !== "Overview") {
    params.set("view", view);
  }

  if (filter && filter !== "all") {
    params.set("filter", filter);
  }

  const query = params.toString();
  const base = query ? `/dashboard?${query}` : "/dashboard";
  return scopedHref(base, supportMode);
}

function settingsHref(tab: SettingsTab, supportMode: SupportMode) {
  return scopedHref(`/dashboard?view=Settings&settings=${settingsParam(tab)}`, supportMode);
}

function settingsParam(tab: SettingsTab) {
  return tab.toLowerCase().replaceAll(" ", "-");
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

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
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

function SupportModeInput({ supportMode }: { supportMode: SupportMode }) {
  return supportMode ? <input type="hidden" name="adminBusinessId" value={supportMode.businessId} /> : null;
}

function issueHref(jobId: string, issueId: string, supportMode: SupportMode) {
  return scopedHref(`/jobs/${jobId}?issue=${encodeURIComponent(issueId)}#action-required`, supportMode);
}

function openJobRow(event: MouseEvent<HTMLTableRowElement>, jobId: string, navigate: (href: string) => void, supportMode: SupportMode, issueId?: string) {
  const target = event.target as HTMLElement;

  if (target.closest("a, button, input, select, textarea")) {
    return;
  }

  navigate(issueId ? issueHref(jobId, issueId, supportMode) : scopedHref(`/jobs/${jobId}`, supportMode));
}

function openCustomerRow(event: MouseEvent<HTMLTableRowElement>, customerId: string, navigate: (href: string) => void, supportMode: SupportMode) {
  const target = event.target as HTMLElement;

  if (target.closest("a, button, input, select, textarea")) {
    return;
  }

  navigate(scopedHref(`/customers/${customerId}`, supportMode));
}

function openJobRowFromKeyboard(event: KeyboardEvent<HTMLTableRowElement>, jobId: string, navigate: (href: string) => void, supportMode: SupportMode, issueId?: string) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  navigate(issueId ? issueHref(jobId, issueId, supportMode) : scopedHref(`/jobs/${jobId}`, supportMode));
}

function openCustomerRowFromKeyboard(event: KeyboardEvent<HTMLTableRowElement>, customerId: string, navigate: (href: string) => void, supportMode: SupportMode) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  navigate(scopedHref(`/customers/${customerId}`, supportMode));
}

export function DashboardClient({
  activities,
  actionPlaybooks,
  attentionActivities,
  adminMode,
  business,
  customers,
  dashboardWidgets,
  followupSettings,
  initialJobFilter = "all",
  initialSettingsTab,
  initialStatusFilter = "all",
  intakeFields,
  initialView,
  jobs,
  message,
  onboardingState,
  pipelineStatuses,
  quoteMessages,
  quotes,
  serviceTypes,
  terminology,
  userEmail,
}: DashboardClientProps) {
  const toastMessage = successFeedbackMessage(message);
  const router = useRouter();
  const supportMode = adminMode ?? null;
  const workspaceName = displayWorkspaceName(business.name);
  const supportWorkspaceName = displayWorkspaceName(supportMode?.businessName);
  const [activeView, setActiveView] = useState<View>(initialView ?? "Overview");
  const [jobFilterMode, setJobFilterMode] = useState<JobFilterMode>(initialJobFilter);
  const [jobModal, setJobModal] = useState<{ job?: Job; scheduledStart?: Date } | null>(null);
  const [customerModal, setCustomerModal] = useState<CustomerSummary | null | "new">(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | JobStatus>(initialStatusFilter);
  const [sort, setSort] = useState("scheduled");
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("Week");
  const [calendarDate, setCalendarDate] = useState(new Date());
  const showOnboarding = Boolean(onboardingState && !onboardingState.completed_at && !onboardingState.skipped_at && !supportMode);

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

  const configuredServices = useMemo(() => normalizeServiceTypes(serviceTypes), [serviceTypes]);
  const configuredPipelineStatuses = useMemo(() => normalizePipelineStatuses(pipelineStatuses), [pipelineStatuses]);
  const enabledStatuses = useMemo(() => enabledPipelineStatuses(pipelineStatuses), [pipelineStatuses]);
  const configuredStatusLabels = useMemo(() => pipelineLabelMap(pipelineStatuses), [pipelineStatuses]);
  const configuredDashboardWidgets = useMemo(() => normalizeDashboardWidgets(dashboardWidgets), [dashboardWidgets]);
  const configuredFollowupSettings = useMemo(() => normalizeFollowupSettings(followupSettings), [followupSettings]);
  const terms = useMemo(() => normalizeTerminology(terminology), [terminology]);
  const needsAttention = useMemo(
    () => buildAttentionIssues({ activities: attentionActivities, followupSettings: configuredFollowupSettings, jobs, quoteMessages, quotes, terminology: terms }),
    [attentionActivities, configuredFollowupSettings, jobs, quoteMessages, quotes, terms],
  );
  const attentionByJob = useMemo(() => issuesByJobId(needsAttention), [needsAttention]);
  const attentionJobIds = useMemo(() => new Set(attentionByJob.keys()), [attentionByJob]);
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
            ((activeView !== "Jobs" || jobFilterMode === "all") ||
              (jobFilterMode === "needs-attention" && attentionJobIds.has(job.id)) ||
              (jobFilterMode === "open-pipeline" && isOpenPipelineJob(job))) &&
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
    [activeView, attentionJobIds, jobFilterMode, jobs, normalizedQuery, sort, statusFilter],
  );

  const visibleCustomers = useMemo(
    () =>
      customers.filter((customer) =>
        [customer.name, customer.email, customer.phone, address(customer)].filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery),
      ),
    [customers, normalizedQuery],
  );

  const totalPipeline = jobs
    .filter(isOpenPipelineJob)
    .reduce((sum, job) => sum + openPipelineValueCents(job), 0);
  const completedRevenue = jobs
    .reduce((sum, job) => sum + completedRevenueCents(job), 0);
  const averageJobValue = jobs.length
    ? Math.round(jobs.reduce((sum, job) => sum + opportunityValueCents(job), 0) / jobs.length)
    : 0;
  const upcomingJobs = jobs
    .filter((job) => job.scheduled_start && operationalStatuses.includes(job.status))
    .sort((a, b) => String(a.scheduled_start).localeCompare(String(b.scheduled_start)))
    .slice(0, 5);
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
      {supportMode ? (
        <div className="support-mode-banner">
          <strong>Viewing {supportWorkspaceName} as FlowDeck Admin</strong>
          <a href={`/admin/workspaces/${supportMode.businessId}`}>Exit admin view</a>
        </div>
      ) : null}
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true">
              FD
            </div>
            <div>
              <p>Workspace</p>
              <strong>{workspaceName}</strong>
            </div>
          </div>

          <nav className="side-nav" aria-label="Dashboard sections">
            {navItems.map((item) => (
              <button
                className={activeView === item ? "active" : ""}
                data-onboarding-target={item === "Pipeline" ? "pipeline-nav" : item === "Jobs" ? "jobs-nav" : item === "Customers" ? "customers-nav" : item === "Settings" ? "settings-nav" : undefined}
                key={item}
                onClick={() => {
                  if (item === "Jobs") {
                    setJobFilterMode("all");
                    setStatusFilter("all");
                  }
                  setActiveView(item);
                  router.replace(dashboardHref(item, supportMode), { scroll: false });
                }}
                type="button"
              >
                <span aria-hidden="true">{navIcons[item]}</span>
                {item === "Jobs" ? terms.job_plural : item === "Customers" ? terms.customer_plural : item}
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <p>Today</p>
            <strong>{counts.scheduled + counts.in_progress}</strong>
            <span>{pluralize(counts.scheduled + counts.in_progress, `active ${lowerTerm(terms.job_singular)}`, `active ${lowerTerm(terms.job_plural)}`)}</span>
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
              <p className="eyebrow">{viewLabel(activeView, terms)}</p>
              <h1>{viewTitle(activeView, terms)}</h1>
              <p className="muted">
                {todayLabel()} | {pluralize(jobs.length, lowerTerm(terms.job_singular), lowerTerm(terms.job_plural))} | {pluralize(customers.length, lowerTerm(terms.customer_singular), lowerTerm(terms.customer_plural))}
              </p>
            </div>
            <div className="header-actions">
              {showSearch ? (
                <label className="search-field">
                  <span aria-hidden="true">
                    <SearchIcon />
                  </span>
                  <input
                    aria-label={`Search ${lowerTerm(terms.job_plural)} and ${lowerTerm(terms.customer_plural)}`}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={activeView === "Customers" ? `Search ${lowerTerm(terms.customer_plural)}` : `Search ${lowerTerm(terms.job_plural)}`}
                    value={query}
                  />
                </label>
              ) : null}
              {activeView !== "Settings" && (activeView === "Customers" || (customers.length === 0 && activeView !== "Calendar")) ? (
                <button className="button" onClick={() => setCustomerModal("new")} type="button">
                  <span aria-hidden="true">+</span>
                  {terms.new_customer_button_label}
                </button>
              ) : null}
              {activeView !== "Settings" && activeView !== "Customers" && (customers.length > 0 || activeView === "Calendar") ? (
                <button className="button" onClick={() => setJobModal({})} type="button">
                  <span aria-hidden="true">+</span>
                  {terms.new_job_button_label}
                </button>
              ) : null}
            </div>
          </header>

          {toastMessage ? <ToastMessage message={toastMessage} /> : null}
          {message && !toastMessage ? <p className="success-message">{message}</p> : null}
          {showOnboarding ? (
            <OwnerOnboarding
              business={business}
              jobs={jobs}
              terminology={terms}
            />
          ) : null}

          {activeView === "Overview" ? (
            <OverviewView
              activities={activities}
              completedRevenue={completedRevenue}
              counts={counts}
              dashboardWidgets={configuredDashboardWidgets}
              openPipelineCount={jobs.filter(isOpenPipelineJob).length}
              jobs={filteredJobs}
              needsAttention={needsAttention}
              onCreateJob={() => setJobModal({})}
              pipelineStatuses={configuredPipelineStatuses}
              supportMode={supportMode}
              totalPipeline={totalPipeline}
              upcomingJobs={upcomingJobs}
              averageJobValue={averageJobValue}
              statusLabels={configuredStatusLabels}
              terminology={terms}
            />
          ) : null}

          {activeView === "Jobs" ? (
            <JobsView
              filteredJobs={filteredJobs}
              jobs={jobs}
              pipelineStatuses={configuredPipelineStatuses}
              setSort={setSort}
              setJobFilterMode={setJobFilterMode}
              setStatusFilter={setStatusFilter}
              sort={sort}
              attentionByJob={attentionByJob}
              attentionFilterCount={attentionJobIds.size}
              jobFilterMode={jobFilterMode}
              statusFilter={statusFilter}
              supportMode={supportMode}
              terminology={terms}
            />
          ) : null}

          {activeView === "Pipeline" ? (
            <PipelineView
              attentionByJob={attentionByJob}
              jobs={filteredJobs}
              activities={activities}
              actionPlaybooks={actionPlaybooks}
              pipelineStatuses={enabledStatuses}
              serviceTypes={configuredServices}
              statusLabels={configuredStatusLabels}
              supportMode={supportMode}
              terminology={terms}
              totalJobs={jobs.length}
            />
          ) : null}

          {activeView === "Customers" ? (
            <CustomersView customers={visibleCustomers} hasCustomers={customers.length > 0} onCreate={() => setCustomerModal("new")} supportMode={supportMode} terminology={terms} />
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
              supportMode={supportMode}
            />
          ) : null}

          {activeView === "Analytics" ? (
            <AnalyticsView
              averageJobValue={averageJobValue}
              completedRevenue={completedRevenue}
              counts={counts}
              jobs={jobs}
              statusLabels={configuredStatusLabels}
              statusOrder={configuredPipelineStatuses.map((status) => status.semantic_type)}
              totalPipeline={totalPipeline}
              terminology={terms}
            />
          ) : null}

          {activeView === "Settings" ? (
            <SettingsView
              business={business}
              dashboardWidgets={configuredDashboardWidgets}
              followupSettings={configuredFollowupSettings}
              initialSettingsTab={initialSettingsTab}
              intakeFields={intakeFields}
              jobs={jobs}
              customers={customers}
              onboardingState={onboardingState}
              pipelineStatuses={configuredPipelineStatuses}
              actionPlaybooks={actionPlaybooks}
              serviceTypes={serviceTypes.length ? serviceTypes : configuredServices}
              supportMode={supportMode}
              terminology={terms}
            />
          ) : null}
        </section>
      </div>

      {jobModal ? (
        <JobModal
          businessId={business.id}
          customers={customers}
          job={jobModal.job ?? null}
          onClose={() => setJobModal(null)}
          scheduledStart={jobModal.scheduledStart}
          serviceTypes={configuredServices}
          supportBusinessId={supportMode?.businessId ?? null}
          pipelineStatuses={enabledStatuses}
          statusLabels={configuredStatusLabels}
          terminology={terms}
        />
      ) : null}

      {customerModal ? (
        <CustomerModal
          businessId={business.id}
          customer={customerModal === "new" ? null : customerModal}
          onClose={() => setCustomerModal(null)}
          supportBusinessId={supportMode?.businessId ?? null}
          terminology={terms}
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
  dashboardWidgets,
  openPipelineCount,
  jobs,
  needsAttention,
  onCreateJob,
  pipelineStatuses,
  statusLabels,
  supportMode,
  terminology,
  totalPipeline,
  upcomingJobs,
}: {
  activities: JobActivity[];
  averageJobValue: number;
  completedRevenue: number;
  counts: Record<JobStatus, number>;
  dashboardWidgets: ReturnType<typeof normalizeDashboardWidgets>;
  openPipelineCount: number;
  jobs: Job[];
  needsAttention: AttentionIssue[];
  onCreateJob: () => void;
  pipelineStatuses: BusinessPipelineStatus[];
  statusLabels: Record<JobStatus, string>;
  supportMode: SupportMode;
  terminology: Terminology;
  totalPipeline: number;
  upcomingJobs: Job[];
}) {
  const widgetEnabled = (key: DashboardWidgetKey) => dashboardWidgets.some((widget) => widget.widget_key === key && widget.enabled);

  return (
    <>
        <KpiGrid
          averageJobValue={averageJobValue}
          completedRevenue={completedRevenue}
          counts={counts}
          dashboardWidgets={dashboardWidgets}
          openPipelineCount={openPipelineCount}
          statusLabels={statusLabels}
          supportMode={supportMode}
          terminology={terminology}
          totalPipeline={totalPipeline}
        />
      {widgetEnabled("needs_attention") ? <NeedsAttentionPanel items={needsAttention} supportMode={supportMode} terminology={terminology} /> : null}
      <section className="content-grid">
        {widgetEnabled("active_job_board") ? <JobsPanel jobs={jobs.slice(0, 6)} pipelineStatuses={pipelineStatuses} supportMode={supportMode} terminology={terminology} title={terminology.active_board_title} /> : null}
        {widgetEnabled("upcoming") ? <SideSummary activities={activities} onCreateJob={onCreateJob} supportMode={supportMode} terminology={terminology} upcomingJobs={upcomingJobs} /> : null}
      </section>
    </>
  );
}

function OwnerOnboarding({
  business,
  jobs,
  terminology,
}: {
  business: Business;
  jobs: Job[];
  terminology: Terminology;
}) {
  const [phase, setPhase] = useState<"welcome" | "tour">("welcome");
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const finalNext = jobs.length ? "/dashboard" : "/dashboard?view=Jobs";
  const walkthrough: {
    copy: string;
    target: string;
    title: string;
  }[] = [
    { copy: "Start here. FlowDeck surfaces follow-ups and work that needs attention.", target: "attention-panel", title: "Dashboard" },
    { copy: `Use Pipeline to see where ${lowerTerm(terminology.job_plural)} are stuck and what needs action.`, target: "pipeline-nav", title: "Pipeline" },
    { copy: `Manage follow-ups, ${lowerTerm(terminology.quote_plural)}, scheduling, and active ${lowerTerm(terminology.job_plural)} here.`, target: "jobs-nav", title: terminology.job_plural },
    { copy: "See client details, history, and related work in one place.", target: "customers-nav", title: terminology.customer_plural },
    { copy: "Review services, stages, terminology, and the customer-facing intake form here.", target: "settings-nav", title: "Settings" },
  ];
  const current = walkthrough[step];

  useEffect(() => {
    if (phase !== "tour") return;

    function updateTarget() {
      const target = document.querySelector<HTMLElement>(`[data-onboarding-target="${current.target}"]`);
      if (!target) {
        setTargetRect(null);
        return;
      }

      target.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => setTargetRect(target.getBoundingClientRect()), 220);
    }

    updateTarget();
    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget, true);
    return () => {
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget, true);
    };
  }, [current.target, phase]);

  if (phase === "welcome") {
    return (
      <div className="onboarding-backdrop" role="presentation">
        <section className="onboarding-welcome" aria-labelledby="onboarding-welcome-title" role="dialog" aria-modal="true">
          <div className="brand-mark">FD</div>
          <p className="eyebrow">Welcome</p>
          <h2 id="onboarding-welcome-title">Welcome to FlowDeck</h2>
          <p>Here’s a quick tour so you know where everything lives.</p>
          <span>Takes about a minute</span>
          <div className="onboarding-button-row">
            <form action={updateOnboardingState}>
              <input type="hidden" name="businessId" value={business.id} />
              <button className="button button-secondary" name="intent" type="submit" value="skip">Skip for now</button>
            </form>
            <button className="button" onClick={() => setPhase("tour")} type="button">Start walkthrough</button>
          </div>
        </section>
      </div>
    );
  }

  const spotlightStyle = targetRect
    ? {
        height: Math.round(targetRect.height + 16),
        left: Math.round(targetRect.left - 8),
        top: Math.round(targetRect.top - 8),
        width: Math.round(targetRect.width + 16),
      }
    : undefined;
  const popoverStyle = targetRect ? popoverPosition(targetRect) : undefined;

  return (
    <div className="tour-layer" aria-label="FlowDeck walkthrough" role="dialog" aria-modal="true">
      <div className="tour-scrim" />
      {targetRect ? <div className="tour-spotlight" style={spotlightStyle} /> : null}
      <section className="tour-popover" style={popoverStyle}>
        <span className="tour-progress">{step + 1} of {walkthrough.length}</span>
        <h2>{current.title}</h2>
        <p>{current.copy}</p>
        <div className="tour-actions">
          <button className="button button-secondary" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))} type="button">Back</button>
          <form action={updateOnboardingState}>
            <input type="hidden" name="businessId" value={business.id} />
            <button className="button button-secondary" name="intent" type="submit" value="skip">Skip</button>
          </form>
          {step < walkthrough.length - 1 ? (
            <button className="button" onClick={() => setStep((value) => Math.min(walkthrough.length - 1, value + 1))} type="button">Next</button>
          ) : (
            <form action={updateOnboardingState}>
              <input type="hidden" name="businessId" value={business.id} />
              <input type="hidden" name="next" value={finalNext} />
              <button className="button" name="intent" type="submit" value="complete">Finish</button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

function popoverPosition(rect: DOMRect) {
  const width = Math.min(360, window.innerWidth - 32);
  const spaceRight = window.innerWidth - rect.right;
  const placeRight = spaceRight >= width + 28;
  const placeLeft = rect.left >= width + 28;
  const top = Math.min(Math.max(16, rect.top + rect.height / 2 - 110), window.innerHeight - 260);

  if (window.innerWidth <= 760) {
    return { bottom: 16, left: 16, right: 16 };
  }

  if (placeRight) {
    return { left: rect.right + 20, top, width };
  }

  if (placeLeft) {
    return { left: rect.left - width - 20, top, width };
  }

  return { left: Math.max(16, Math.min(window.innerWidth - width - 16, rect.left)), top: Math.min(rect.bottom + 18, window.innerHeight - 260), width };
}

function NeedsAttentionPanel({ items, supportMode, terminology }: { items: AttentionIssue[]; supportMode: SupportMode; terminology: Terminology }) {
  const visibleItems = items.slice(0, 4);
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);
  const severityCounts = items.reduce(
    (counts, item) => {
      counts[item.severity] += 1;
      return counts;
    },
    { high: 0, info: 0, warning: 0 } satisfies Record<AttentionSeverity, number>,
  );
  const panelState = items.length === 0 ? "clear" : severityCounts.high > 0 && severityCounts.warning === 0 && severityCounts.info === 0 ? "critical" : "mixed";

  return (
    <section className={`data-panel full-width attention-panel attention-panel-${panelState}`} data-onboarding-target="attention-panel">
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
            const severity = item.severity;

            return (
              <div className={`attention-item attention-${severity}`} key={item.id}>
                <span className={`attention-severity ${severity}`} aria-label={`${attentionLabel(severity)} priority`}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 2 2.8 19a2 2 0 0 0 1.8 3h14.8a2 2 0 0 0 1.8-3L12 2Zm1 15h-2v2h2v-2Zm0-7h-2v5h2v-5Z" />
                  </svg>
                  {attentionLabel(severity)}
                </span>
                <div>
                  <span>{item.job.customer?.name ?? `Unknown ${lowerTerm(terminology.customer_singular)}`}</span>
                  <strong>{item.job.title}</strong>
                </div>
                <p>{item.problem}</p>
                <span>{item.age}</span>
                <em>{item.action}</em>
                <div className="attention-actions">
                  {item.quickAction === "contacted" ? (
                    <form action={markJobContacted}>
                      <input type="hidden" name="jobId" value={item.job.id} />
                      <input type="hidden" name="returnTo" value={dashboardHref("Overview", supportMode)} />
                      <button className="link-button" type="submit">
                        Mark Contacted
                      </button>
                    </form>
                  ) : null}
                  {item.quickAction === "resolve_quote_message" && item.quoteMessage ? (
                    <form action={resolveQuoteMessage}>
                      <input type="hidden" name="messageId" value={item.quoteMessage.id} />
                      <SupportModeInput supportMode={supportMode} />
                      <button className="link-button" type="submit">
                        Mark Answered
                      </button>
                    </form>
                  ) : null}
                  <Link className="link-button" href={issueHref(item.job.id, item.id, supportMode)}>
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
              <Link className="link-button" href={dashboardHref("Jobs", supportMode, "needs-attention")}>
                View all attention items
              </Link>
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
  attentionByJob,
  attentionFilterCount,
  filteredJobs,
  jobFilterMode,
  jobs,
  pipelineStatuses,
  setJobFilterMode,
  setSort,
  setStatusFilter,
  sort,
  statusFilter,
  supportMode,
  terminology,
}: {
  attentionByJob: Map<string, AttentionIssue[]>;
  attentionFilterCount: number;
  filteredJobs: Job[];
  jobFilterMode: JobFilterMode;
  jobs: Job[];
  pipelineStatuses: BusinessPipelineStatus[];
  setJobFilterMode: (value: JobFilterMode) => void;
  setSort: (value: string) => void;
  setStatusFilter: (value: "all" | JobStatus) => void;
  sort: string;
  statusFilter: "all" | JobStatus;
  supportMode: SupportMode;
  terminology: Terminology;
}) {
  return (
    <JobsPanel
      fullWidth
      attentionByJob={attentionByJob}
      attentionFilterCount={attentionFilterCount}
      jobFilterMode={jobFilterMode}
      jobs={filteredJobs}
      pipelineStatuses={pipelineStatuses}
      setJobFilterMode={setJobFilterMode}
      setSort={setSort}
      setStatusFilter={setStatusFilter}
      sort={sort}
      statusFilter={statusFilter}
      supportMode={supportMode}
      terminology={terminology}
      title={terminology.job_plural}
      totalJobs={jobs.length}
    />
  );
}

function PipelineView({
  activities,
  actionPlaybooks,
  attentionByJob,
  jobs,
  pipelineStatuses,
  serviceTypes,
  statusLabels,
  supportMode,
  terminology,
  totalJobs,
}: {
  activities: JobActivity[];
  actionPlaybooks: BusinessActionPlaybook[];
  attentionByJob: Map<string, AttentionIssue[]>;
  jobs: Job[];
  pipelineStatuses: BusinessPipelineStatus[];
  serviceTypes: BusinessServiceType[];
  statusLabels: Record<JobStatus, string>;
  supportMode: SupportMode;
  terminology: Terminology;
  totalJobs: number;
}) {
  const groupedJobs = pipelineStatuses.map((statusConfig) => ({
    jobs: sortPipelineJobs(jobs.filter((job) => job.status === statusConfig.semantic_type), attentionByJob, activities),
    status: statusConfig.semantic_type,
  }));

  return (
    <section className="data-panel full-width pipeline-panel">
      <div className="panel-heading">
        <div>
          <h2>Pipeline</h2>
          <p className="muted">Move real {lowerTerm(terminology.job_plural)} from first contact through completion without leaving the board.</p>
        </div>
        <span className="panel-count">{pluralize(jobs.length, `visible ${lowerTerm(terminology.job_singular)}`, `visible ${lowerTerm(terminology.job_plural)}`)}</span>
      </div>

      {totalJobs ? (
        <div className="pipeline-board" aria-label={`${terminology.job_singular} pipeline by status`}>
          {groupedJobs.map(({ status, jobs: columnJobs }) => (
            <section className="pipeline-column" key={status}>
              <div className="pipeline-column-header">
                <div>
                  <span className={`status-pill status-${status}`}>{statusLabels[status]}</span>
                  <p>{pluralize(columnJobs.length, "opportunity", "opportunities")} · {money(stageOpenValue(status, columnJobs))}</p>
                </div>
              </div>
              <div className="pipeline-cards">
                {columnJobs.length ? (
                  columnJobs.map((job) => (
                    <PipelineCard
                      issues={attentionByJob.get(job.id) ?? []}
                      job={job}
                      key={job.id}
                      playbooks={actionPlaybooks}
                      pipelineStatuses={pipelineStatuses}
                      serviceTypes={serviceTypes}
                      stageAge={stageAgeLabel(job, activities)}
                      statusLabels={statusLabels}
                      supportMode={supportMode}
                      terminology={terminology}
                    />
                  ))
                ) : (
                  <p className="pipeline-empty">No {statusLabels[status].toLowerCase()} jobs.</p>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          description={`Create your first ${lowerTerm(terminology.job_singular)} and it will appear here as a pipeline card.`}
          title={`No ${lowerTerm(terminology.job_plural)} in the pipeline yet`}
        />
      )}
    </section>
  );
}

function stageOpenValue(status: JobStatus, jobs: Job[]) {
  if (status === "lost") {
    return 0;
  }

  return jobs.reduce((sum, job) => sum + openPipelineValueCents(job), 0);
}

function stageEnteredAt(job: Job, activities: JobActivity[]) {
  if (job.status === "lead") {
    return job.created_at;
  }

  const matchingActivity = activities.find((activity) => {
    if (activity.job_id !== job.id) {
      return false;
    }

    if ((activity.metadata as { to?: unknown } | null)?.to === job.status) {
      return true;
    }

    return (
      (job.status === "contacted" && activity.event_type === "contacted") ||
      (job.status === "quoted" && (activity.event_type === "quoted" || activity.event_type === "quote_sent")) ||
      (job.status === "completed" && activity.event_type === "completed") ||
      (job.status === "lost" && activity.event_type === "lost")
    );
  });

  return matchingActivity?.created_at ?? null;
}

function stageAgeLabel(job: Job, activities: JobActivity[]) {
  const enteredAt = stageEnteredAt(job, activities);

  if (!enteredAt) {
    return "Stage age unavailable";
  }

  const days = Math.max(0, Math.floor((Date.now() - new Date(enteredAt).getTime()) / 86_400_000));

  if (days === 0) {
    return "Entered today";
  }

  return `${days} ${days === 1 ? "day" : "days"} in stage`;
}

function sortPipelineJobs(jobs: Job[], attentionByJob: Map<string, AttentionIssue[]>, activities: JobActivity[]) {
  return [...jobs].sort((a, b) => {
    if (a.status === "lost" && b.status === "lost") {
      return b.updated_at.localeCompare(a.updated_at);
    }

    const aIssue = attentionByJob.get(a.id)?.[0];
    const bIssue = attentionByJob.get(b.id)?.[0];
    const aPriority = aIssue ? aIssue.priority : 99;
    const bPriority = bIssue ? bIssue.priority : 99;

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    const aEnteredAt = stageEnteredAt(a, activities) ?? a.created_at;
    const bEnteredAt = stageEnteredAt(b, activities) ?? b.created_at;

    if (aEnteredAt !== bEnteredAt) {
      return aEnteredAt.localeCompare(bEnteredAt);
    }

    return b.price_cents - a.price_cents || a.title.localeCompare(b.title);
  });
}

function PipelineCard({
  issues,
  job,
  playbooks,
  pipelineStatuses,
  serviceTypes,
  stageAge,
  statusLabels,
  supportMode,
  terminology,
}: {
  issues: AttentionIssue[];
  job: Job;
  playbooks: BusinessActionPlaybook[];
  pipelineStatuses: BusinessPipelineStatus[];
  serviceTypes: BusinessServiceType[];
  stageAge: string;
  statusLabels: Record<JobStatus, string>;
  supportMode: SupportMode;
  terminology: Terminology;
}) {
  const scheduledText = job.scheduled_start ? `${dateLabel(job.scheduled_start)} at ${timeLabel(job.scheduled_start)}` : null;
  const recommendation = resolvePlaybookForJob(job, playbooks, serviceTypes).actions[0] ?? null;

  return (
    <article className="pipeline-card">
      <Link className="pipeline-card-main" href={scopedHref(`/jobs/${job.id}`, supportMode)}>
        <div>
          <p>{job.customer?.name ?? "Unknown customer"}</p>
          <h3>{job.title}</h3>
        </div>
        <div className="pipeline-card-facts">
          <span>{money(opportunityValueCents(job))}</span>
          <span>{sourceLabels[job.source]}</span>
          {scheduledText && (job.status === "scheduled" || job.status === "in_progress" || job.status === "completed") ? (
            <span>{scheduledText}</span>
          ) : null}
        </div>
        <span className={isStale(job) ? "age-chip stale" : "age-chip"}>{stageAge}</span>
      </Link>
      <AttentionIndicator issues={issues} supportMode={supportMode} />
      {recommendation ? <PipelineRecommendation action={recommendation} job={job} supportMode={supportMode} terminology={terminology} /> : null}
      <PipelineQuickActions issues={issues} job={job} supportMode={supportMode} terminology={terminology} />
      {job.status === "lost" ? (
        <span className={`status-pill status-${job.status}`}>{statusLabels[job.status]}</span>
      ) : (
        <form action={updateJobStatus} className="pipeline-status-form">
          <input type="hidden" name="jobId" value={job.id} />
          <input type="hidden" name="returnTo" value={dashboardHref("Pipeline", supportMode)} />
          <select
            aria-label={`Update ${job.title} status`}
            className={`status-select status-${job.status}`}
            defaultValue={job.status}
            name="status"
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            {pipelineStatuses.filter((status) => status.semantic_type !== "lost").map((status) => (
              <option key={status.semantic_type} value={status.semantic_type}>
                {statusLabels[status.semantic_type]}
              </option>
            ))}
          </select>
        </form>
      )}
    </article>
  );
}

function PipelineRecommendation({ action, job, supportMode, terminology }: { action: BusinessActionPlaybook; job: Job; supportMode: SupportMode; terminology: Terminology }) {
  return (
    <div className="pipeline-recommendation">
      <span>Recommended</span>
      <PlaybookActionControl action={action} compact job={job} supportMode={supportMode} terminology={terminology} />
    </div>
  );
}

function PlaybookActionControl({
  action,
  compact = false,
  job,
  supportMode,
  terminology,
}: {
  action: BusinessActionPlaybook;
  compact?: boolean;
  job: Job;
  supportMode: SupportMode;
  terminology: Terminology;
}) {
  const className = compact ? "link-button" : "button button-secondary";
  const customer = job.customer;

  if (action.action_type === "call") {
    return customer?.phone ? (
      <a className={className} href={`tel:${customer.phone}`}>
        {action.action_label}
      </a>
    ) : (
      <Link className={className} href={scopedHref(`/jobs/${job.id}?edit=1#edit-job`, supportMode)}>
        Add phone
      </Link>
    );
  }

  if (action.action_type === "email") {
    return customer?.email ? (
      <a className={className} href={`mailto:${customer.email}`}>
        {action.action_label}
      </a>
    ) : (
      <Link className={className} href={scopedHref(`/jobs/${job.id}?edit=1#edit-job`, supportMode)}>
        Add email
      </Link>
    );
  }

  if (action.action_type === "mark_contacted") {
    return (
      <form action={markJobContacted}>
        <input type="hidden" name="jobId" value={job.id} />
        <input type="hidden" name="returnTo" value={scopedHref(`/jobs/${job.id}`, supportMode)} />
        <SupportModeInput supportMode={supportMode} />
        <button className={className} type="submit">
          {action.action_label}
        </button>
      </form>
    );
  }

  if (action.action_type === "set_follow_up") {
    return <Link className={className} href={scopedHref(`/jobs/${job.id}#quick-actions`, supportMode)}>{action.action_label}</Link>;
  }

  if (action.action_type === "schedule") {
    return <Link className={className} href={scopedHref(`/jobs/${job.id}?edit=1#edit-job`, supportMode)}>{action.action_label}</Link>;
  }

  if (action.action_type === "review_proposal") {
    return <Link className={className} href={scopedHref(`/jobs/${job.id}#quote`, supportMode)}>{action.action_label}</Link>;
  }

  if (action.action_type === "mark_lost") {
    return <Link className={className} href={scopedHref(`/jobs/${job.id}#quick-actions`, supportMode)}>{action.action_label}</Link>;
  }

  if (action.action_type === "custom_instruction") {
    return <span className={compact ? "playbook-instruction compact" : "playbook-instruction"}>{action.action_label}</span>;
  }

  return (
    <Link className={className} href={scopedHref(`/jobs/${job.id}`, supportMode)}>
      {action.action_label || `Open ${terminology.job_singular}`}
    </Link>
  );
}

function PipelineQuickActions({ issues, job, supportMode, terminology }: { issues: AttentionIssue[]; job: Job; supportMode: SupportMode; terminology: Terminology }) {
  const primaryIssue = issues[0];

  if (job.status === "lost" || job.status === "completed") {
    return (
      <div className="pipeline-card-actions">
        <Link className="link-button" href={scopedHref(`/jobs/${job.id}`, supportMode)}>
          Open
        </Link>
      </div>
    );
  }

  if (primaryIssue?.quickAction === "contacted" || job.status === "lead") {
    return (
      <div className="pipeline-card-actions">
        <form action={markJobContacted}>
          <input type="hidden" name="jobId" value={job.id} />
          <input type="hidden" name="returnTo" value={dashboardHref("Pipeline", supportMode)} />
          <SupportModeInput supportMode={supportMode} />
          <button className="link-button" type="submit">
            Mark Contacted
          </button>
        </form>
        <Link className="link-button" href={primaryIssue ? issueHref(job.id, primaryIssue.id, supportMode) : scopedHref(`/jobs/${job.id}`, supportMode)}>
          Open
        </Link>
      </div>
    );
  }

  if (primaryIssue?.type === "unscheduled" || primaryIssue?.type === "scheduled_no_date" || primaryIssue?.type === "missing_address") {
    return (
      <div className="pipeline-card-actions">
        <Link className="link-button" href={scopedHref(`/jobs/${job.id}?edit=1#edit-job`, supportMode)}>
          {primaryIssue.type === "missing_address" ? "Add Address" : "Schedule"}
        </Link>
        <Link className="link-button" href={issueHref(job.id, primaryIssue.id, supportMode)}>
          Open
        </Link>
      </div>
    );
  }

  if (
    primaryIssue?.type === "follow_up_due" ||
    primaryIssue?.type === "follow_up_today" ||
    primaryIssue?.type === "contacted_follow_up" ||
    primaryIssue?.type === "proposal_awaiting_response" ||
    primaryIssue?.type === "stale_opportunity"
  ) {
    return (
      <div className="pipeline-card-actions">
        <Link className="link-button" href={issueHref(job.id, primaryIssue.id, supportMode)}>
          Set Follow-Up
        </Link>
        {job.status === "quoted" || primaryIssue.type === "proposal_awaiting_response" ? (
          <Link className="link-button" href={scopedHref(`/jobs/${job.id}#quote`, supportMode)}>
            Review {terminology.quote_singular}
          </Link>
        ) : null}
      </div>
    );
  }

  if (job.status === "quoted") {
    return (
      <div className="pipeline-card-actions">
        <Link className="link-button" href={scopedHref(`/jobs/${job.id}#quote`, supportMode)}>
          Review {terminology.quote_singular}
        </Link>
        <Link className="link-button" href={primaryIssue ? issueHref(job.id, primaryIssue.id, supportMode) : scopedHref(`/jobs/${job.id}`, supportMode)}>
          Open
        </Link>
      </div>
    );
  }

  return (
    <div className="pipeline-card-actions">
      <Link className="link-button" href={primaryIssue ? issueHref(job.id, primaryIssue.id, supportMode) : scopedHref(`/jobs/${job.id}#action-required`, supportMode)}>
        {primaryIssue ? "Resolve" : "Open"}
      </Link>
    </div>
  );
}

function AttentionIndicator({ issues, supportMode }: { issues: AttentionIssue[]; supportMode: SupportMode }) {
  const primary = issues[0];

  if (!primary) {
    return null;
  }

  const label = issues.length > 1 ? `${issues.length} issues` : "1 issue";

  return (
    <Link className={`attention-chip attention-chip-${primary.severity}`} href={issueHref(primary.job.id, primary.id, supportMode)}>
      <span aria-hidden="true">!</span>
      <strong>{label}</strong>
      <em>{primary.problem}</em>
    </Link>
  );
}

function JobsPanel({
  attentionByJob,
  attentionFilterCount = 0,
  fullWidth = false,
  jobFilterMode = "all",
  jobs,
  pipelineStatuses = normalizePipelineStatuses(),
  setJobFilterMode,
  setSort,
  setStatusFilter,
  sort,
  statusFilter,
  supportMode,
  terminology = normalizeTerminology(),
  title,
  totalJobs,
}: {
  attentionByJob?: Map<string, AttentionIssue[]>;
  attentionFilterCount?: number;
  fullWidth?: boolean;
  jobFilterMode?: JobFilterMode;
  jobs: Job[];
  pipelineStatuses?: BusinessPipelineStatus[];
  setJobFilterMode?: (value: JobFilterMode) => void;
  setSort?: (value: string) => void;
  setStatusFilter?: (value: "all" | JobStatus) => void;
  sort?: string;
  statusFilter?: "all" | JobStatus;
  supportMode?: SupportMode;
  terminology?: Terminology;
  title: string;
  totalJobs?: number;
}) {
  const router = useRouter();
  const statusLabelMap = Object.fromEntries(pipelineStatuses.map((status) => [status.semantic_type, status.label])) as Record<JobStatus, string>;
  const showAttentionFilter = Boolean(setJobFilterMode && setStatusFilter && setSort);
  const currentStatusFilter = statusFilter ?? "all";
  let activeFilterLabel: string | null = null;

  if (jobFilterMode === "open-pipeline") {
    activeFilterLabel = "Open Pipeline";
  } else if (currentStatusFilter !== "all") {
    activeFilterLabel = statusLabelMap[currentStatusFilter];
  }

  return (
    <div className={fullWidth ? "data-panel jobs-panel full-width" : "data-panel jobs-panel"}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p className="muted">Track new leads, {lowerTerm(terminology.quote_plural)}, scheduled work, active work, and completed work.</p>
        </div>
        {setStatusFilter && setSort ? (
          <div className="table-controls">
            <select
              aria-label="Filter by status"
              onChange={(event) => {
                const nextStatus = event.target.value as "all" | JobStatus;
                setJobFilterMode?.("all");
                setStatusFilter(nextStatus);
                router.replace(nextStatus === "all" ? dashboardHref("Jobs", supportMode ?? null) : dashboardHref("Jobs", supportMode ?? null, nextStatus), { scroll: false });
              }}
              value={currentStatusFilter}
            >
              <option value="all">All statuses</option>
              {pipelineStatuses.map((status) => (
                <option key={status.semantic_type} value={status.semantic_type}>
                  {status.label}
                </option>
              ))}
            </select>
            <select aria-label="Sort jobs" onChange={(event) => setSort(event.target.value)} value={sort}>
              <option value="scheduled">Scheduled date</option>
              <option value="updated">Last updated</option>
              <option value="value">{terminology.job_singular} value</option>
              <option value="customer">{terminology.customer_singular}</option>
            </select>
          </div>
        ) : null}
      </div>
      {showAttentionFilter ? (
        <div className="opportunity-filter-tabs" aria-label={`${terminology.job_plural} filters`}>
          <button
            className={jobFilterMode === "all" ? "active" : ""}
            onClick={() => {
              setJobFilterMode?.("all");
              setStatusFilter?.("all");
              router.replace(dashboardHref("Jobs", supportMode ?? null), { scroll: false });
            }}
            type="button"
          >
            All {terminology.job_plural}
          </button>
          <button
            className={jobFilterMode === "needs-attention" ? "active attention-filter" : "attention-filter"}
            onClick={() => {
              setJobFilterMode?.("needs-attention");
              setStatusFilter?.("all");
              router.replace(dashboardHref("Jobs", supportMode ?? null, "needs-attention"), { scroll: false });
            }}
            type="button"
          >
            Needs Attention <span>{attentionFilterCount}</span>
          </button>
          <button
            className={jobFilterMode === "open-pipeline" ? "active" : ""}
            onClick={() => {
              setJobFilterMode?.("open-pipeline");
              setStatusFilter?.("all");
              router.replace(dashboardHref("Jobs", supportMode ?? null, "open-pipeline"), { scroll: false });
            }}
            type="button"
          >
            Open Pipeline
          </button>
          {activeFilterLabel ? <span className="active-filter-note">Showing {activeFilterLabel}</span> : null}
        </div>
      ) : null}

      {jobs.length ? (
        <div className="jobs-table-wrap">
          <table className="jobs-table operational-table">
            <thead>
              <tr>
                <th>{terminology.job_singular}</th>
                <th>Status</th>
                <th>Scheduled</th>
                <th>Value</th>
                <th>Last updated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const issues = attentionByJob?.get(job.id) ?? [];
                const primaryIssue = issues[0];

                return (
                <tr
                  className="clickable-row"
                  key={job.id}
                  onClick={(event) => openJobRow(event, job.id, router.push, supportMode ?? null, jobFilterMode === "needs-attention" ? primaryIssue?.id : undefined)}
                  onKeyDown={(event) => openJobRowFromKeyboard(event, job.id, router.push, supportMode ?? null, jobFilterMode === "needs-attention" ? primaryIssue?.id : undefined)}
                  role="link"
                  tabIndex={0}
                >
                  <td className="identity-cell">
                    <Link className="row-title-link" href={scopedHref(`/jobs/${job.id}`, supportMode ?? null)}>
                      {job.title}
                    </Link>
                    <span>
                      {job.customer ? (
                        <Link href={scopedHref(`/customers/${job.customer.id}`, supportMode ?? null)}>{job.customer.name}</Link>
                      ) : (
                        "Unknown customer"
                      )}
                      {job.source && job.source !== "manual" ? ` · ${sourceLabels[job.source]}` : ""}
                    </span>
                    <AttentionIndicator issues={issues} supportMode={supportMode ?? null} />
                  </td>
                  <td>
                    {job.status === "lost" ? (
                      <span className={`status-pill status-${job.status}`}>{statusLabelMap[job.status]}</span>
                    ) : (
                      <form action={updateJobStatus}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <input type="hidden" name="returnTo" value={dashboardHref("Jobs", supportMode ?? null, jobFilterMode)} />
                        <select
                          className={`status-select status-${job.status}`}
                          aria-label={`Update ${job.title} status`}
                          name="status"
                          defaultValue={job.status}
                          onChange={(event) => event.currentTarget.form?.requestSubmit()}
                        >
                          {pipelineStatuses.filter((status) => status.enabled && status.semantic_type !== "lost").map((status) => (
                            <option key={status.semantic_type} value={status.semantic_type}>
                              {status.label}
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
                  <td className="numeric-cell">{money(opportunityValueCents(job))}</td>
                  <td className="muted-cell">{dateLabel(job.updated_at)}</td>
                  <td className="row-arrow" aria-hidden="true">
                    &rarr;
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          description={
            totalJobs
              ? "Try a different search, status filter, or sort."
              : `Create a ${lowerTerm(terminology.customer_singular)} and ${lowerTerm(terminology.job_singular)} to start building an operating history.`
          }
          title={totalJobs ? `No matching ${lowerTerm(terminology.job_plural)}` : `No ${lowerTerm(terminology.job_plural)} yet`}
        />
      )}
    </div>
  );
}

function KpiGrid({
  averageJobValue,
  completedRevenue,
  counts,
  dashboardWidgets,
  openPipelineCount,
  statusLabels,
  supportMode,
  terminology = normalizeTerminology(),
  totalPipeline,
}: {
  averageJobValue: number;
  completedRevenue: number;
  counts: Record<JobStatus, number>;
  dashboardWidgets?: ReturnType<typeof normalizeDashboardWidgets>;
  openPipelineCount: number;
  statusLabels: Record<JobStatus, string>;
  supportMode: SupportMode;
  terminology?: Terminology;
  totalPipeline: number;
}) {
  const widgets = (dashboardWidgets ?? normalizeDashboardWidgets()).filter((widget) => widget.enabled && widget.zone !== "section");
  const values: Record<DashboardWidgetKey, string | number> = {
    active_job_board: "",
    avg_job: money(averageJobValue),
    completed: counts.completed,
    in_progress: counts.in_progress,
    needs_attention: "",
    new_leads: counts.lead,
    open_pipeline: money(totalPipeline),
    quoted: counts.quoted,
    scheduled: counts.scheduled,
    upcoming: "",
  };
  const filters: Partial<Record<DashboardWidgetKey, DashboardFilter>> = {
    avg_job: "all",
    completed: "completed",
    in_progress: "in_progress",
    new_leads: "lead",
    open_pipeline: "open-pipeline",
    quoted: "quoted",
    scheduled: "scheduled",
  };
  const helpers: Partial<Record<DashboardWidgetKey, string>> = {
    completed: money(completedRevenue),
    in_progress: statusLabels.in_progress,
    new_leads: "Needs first response",
    open_pipeline: `${pluralize(openPipelineCount, lowerTerm(terminology.job_singular), lowerTerm(terminology.job_plural))} contributing`,
    quoted: "Awaiting answer",
    scheduled: statusLabels.scheduled,
  };
  const icons: Record<DashboardWidgetKey, React.ReactNode> = {
    active_job_board: <ProgressIcon />,
    avg_job: <DollarIcon />,
    completed: <CheckIcon />,
    in_progress: <ProgressIcon />,
    needs_attention: <LeadIcon />,
    new_leads: <LeadIcon />,
    open_pipeline: <DollarIcon />,
    quoted: <QuoteIcon />,
    scheduled: <CalendarIcon />,
    upcoming: <CalendarIcon />,
  };
  const primary = widgets.filter((widget) => widget.zone === "primary");
  const secondary = widgets.filter((widget) => widget.zone === "secondary");

  return (
    <section className="kpi-stack" aria-label={`${dashboardWidgets ? "Workspace" : terminology.job_singular} metrics`}>
      {primary.length ? (
        <div className="kpi-grid kpi-grid-primary">
          {primary.map((widget) => (
            <KpiCard
              helper={helpers[widget.widget_key] ?? widget.helper}
              href={dashboardHref("Jobs", supportMode, filters[widget.widget_key] ?? "all")}
              icon={icons[widget.widget_key]}
              key={widget.widget_key}
              label={widgetLabel(widget, terminology)}
              priority="primary"
              value={values[widget.widget_key]}
            />
          ))}
        </div>
      ) : null}
      {secondary.length ? (
        <div className="kpi-secondary-row">
          {secondary.map((widget) => (
            <KpiCard
              helper={helpers[widget.widget_key] ?? widget.helper}
              href={dashboardHref("Jobs", supportMode, filters[widget.widget_key] ?? "all")}
              icon={icons[widget.widget_key]}
              key={widget.widget_key}
              label={widgetLabel(widget, terminology)}
              value={values[widget.widget_key]}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function widgetLabel(widget: ReturnType<typeof normalizeDashboardWidgets>[number], terminology: Terminology) {
  if (widget.label_override) {
    return widget.label_override;
  }

  if (widget.widget_key === "avg_job") {
    return `Avg. ${terminology.job_singular}`;
  }

  return widget.label;
}

function SideSummary({
  activities,
  onCreateJob,
  supportMode,
  terminology,
  upcomingJobs,
}: {
  activities: JobActivity[];
  onCreateJob: () => void;
  supportMode: SupportMode;
  terminology: Terminology;
  upcomingJobs: Job[];
}) {
  return (
    <aside className="data-panel side-panel">
      <div className="panel-heading compact">
        <h2>{terminology.upcoming_title}</h2>
      </div>
      {upcomingJobs.length ? (
        <ul className="upcoming-list">
          {upcomingJobs.map((job) => (
            <li key={job.id}>
              <span>{dateLabel(job.scheduled_start)} at {timeLabel(job.scheduled_start)}</span>
              <Link href={scopedHref(`/jobs/${job.id}`, supportMode)}>
                <strong>{job.customer?.name ?? terminology.customer_singular}</strong>
              </Link>
              <p>{job.title}</p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mini-empty">
          <p className="muted">Confirmed scheduled jobs will appear here.</p>
          <button className="link-button" onClick={onCreateJob} type="button">
            Schedule a {lowerTerm(terminology.job_singular)}
          </button>
        </div>
      )}

      <div className="activity-block">
        <h2>Recent activity</h2>
        <div className="activity-list">
          {activities.length ? (
            activities.slice(0, 6).map((activity) => (
              <p key={activity.id}>
                {activity.job ? <Link href={scopedHref(`/jobs/${activity.job_id}`, supportMode)}>{activity.job.title}</Link> : terminology.job_singular}
                <span> {terminologyActivityMessage(activity.message, terminology)}</span>
              </p>
            ))
          ) : (
            <p className="muted">{terminology.job_singular} updates will appear here as work moves forward.</p>
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
  supportMode,
  terminology,
}: {
  customers: CustomerSummary[];
  hasCustomers: boolean;
  onCreate: () => void;
  supportMode: SupportMode;
  terminology: Terminology;
}) {
  const router = useRouter();

  return (
    <section className="data-panel full-width customers-panel">
      <div className="panel-heading">
        <div>
          <h2>{terminology.customer_plural}</h2>
          <p className="muted">Manage {lowerTerm(terminology.customer_singular)} records, contact details, and {lowerTerm(terminology.job_singular)} history.</p>
        </div>
      </div>
      {customers.length ? (
        <div className="jobs-table-wrap">
          <table className="jobs-table customers-table">
            <thead>
              <tr>
                <th>{terminology.customer_singular}</th>
                <th>Contact</th>
                <th>Work</th>
                <th>Last {lowerTerm(terminology.job_singular)}</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr
                  className="clickable-row"
                  key={customer.id}
                  onClick={(event) => openCustomerRow(event, customer.id, router.push, supportMode)}
                  onKeyDown={(event) => openCustomerRowFromKeyboard(event, customer.id, router.push, supportMode)}
                  role="link"
                  tabIndex={0}
                >
                  <td className="identity-cell customer-identity">
                    <Link className="row-title-link" href={scopedHref(`/customers/${customer.id}`, supportMode)}>
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
                        {customer.job_count === 1 ? lowerTerm(terminology.job_singular) : lowerTerm(terminology.job_plural)}
                      </span>
                      <span>
                        <strong>{money(customer.lifetime_value_cents)}</strong>
                        completed revenue
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
          actionLabel={terminology.new_customer_button_label}
          description={hasCustomers ? `No ${lowerTerm(terminology.customer_plural)} match that search.` : `Create ${lowerTerm(terminology.customer_singular)} records before or while adding ${lowerTerm(terminology.job_plural)}.`}
          onAction={onCreate}
          title={hasCustomers ? `No matching ${lowerTerm(terminology.customer_plural)}` : `No ${lowerTerm(terminology.customer_plural)} yet`}
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
  supportMode,
}: {
  calendarDate: Date;
  jobs: Job[];
  mode: CalendarMode;
  onCreateJob: (scheduledStart?: Date) => void;
  onModeChange: (mode: CalendarMode) => void;
  onMove: (direction: number) => void;
  onToday: () => void;
  supportMode: SupportMode;
}) {
  const operationalJobs = jobs.filter((job) => job.scheduled_start && operationalStatuses.includes(job.status));
  const tentativeJobs = jobs.filter((job) => job.scheduled_start && job.status === "quoted");
  const rangeLabel = calendarRangeLabel(calendarDate, mode);
  const visibleUpcoming = operationalJobs
    .filter((job) => job.scheduled_start && new Date(job.scheduled_start) >= startOfDay(new Date()))
    .sort((a, b) => String(a.scheduled_start).localeCompare(String(b.scheduled_start)))
    .slice(0, 5);

  return (
    <section className="calendar-workspace">
      <div className="calendar-topbar">
        <div className="calendar-period-controls">
          <button className="button button-secondary" onClick={onToday} type="button">
            Today
          </button>
          <div className="calendar-arrow-group">
            <button className="icon-button" aria-label="Previous period" onClick={() => onMove(-1)} type="button">
              ‹
            </button>
            <button className="icon-button" aria-label="Next period" onClick={() => onMove(1)} type="button">
              ›
            </button>
          </div>
          <strong>{rangeLabel}</strong>
        </div>
        <div className="segmented-control calendar-mode-control" aria-label="Calendar view">
          {(["Week", "Month", "Agenda"] as CalendarMode[]).map((value) => (
            <button className={mode === value ? "active" : ""} key={value} onClick={() => onModeChange(value)} type="button">
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="calendar-layout">
        <div className="calendar-main-panel">
          {mode === "Week" ? <WeekCalendar date={calendarDate} jobs={operationalJobs} onCreateJob={onCreateJob} supportMode={supportMode} /> : null}
          {mode === "Month" ? <MonthCalendar date={calendarDate} jobs={operationalJobs} supportMode={supportMode} /> : null}
          {mode === "Agenda" ? <AgendaCalendar jobs={operationalJobs} supportMode={supportMode} /> : null}
        </div>
        <CalendarSidePanel
          date={calendarDate}
          jobs={visibleUpcoming}
          onCreateJob={onCreateJob}
          supportMode={supportMode}
          tentativeJobs={tentativeJobs}
        />
      </div>
    </section>
  );
}

const calendarHours = Array.from({ length: 10 }, (_, index) => index + 8);

function WeekCalendar({
  date,
  jobs,
  onCreateJob,
  supportMode,
}: {
  date: Date;
  jobs: Job[];
  onCreateJob: (scheduledStart?: Date) => void;
  supportMode: SupportMode;
}) {
  const first = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, index) => addDays(first, index));
  const today = new Date();

  return (
    <div className="week-schedule-grid">
      <div className="week-corner" />
      {days.map((day) => (
        <button className={sameDate(day, today) ? "week-day-head today" : "week-day-head"} key={day.toISOString()} onClick={() => onCreateJob(day)} type="button">
          <span>{new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(day)}</span>
          <strong>{day.getUTCDate()}</strong>
        </button>
      ))}
      <div className="week-time-rail">
        <span>All day</span>
        {calendarHours.map((hour) => (
          <span key={hour}>{hour === 12 ? "12 PM" : hour < 12 ? `${hour} AM` : `${hour - 12} PM`}</span>
        ))}
      </div>
      {days.map((day) => {
        const dayJobs = jobs.filter((job) => job.scheduled_start && sameDate(new Date(job.scheduled_start), day));
        return (
          <div className={sameDate(day, today) ? "week-day-column today" : "week-day-column"} key={`body-${day.toISOString()}`}>
            <button className="calendar-add-slot" onClick={() => onCreateJob(day)} type="button">
              + Add event
            </button>
            {calendarHours.map((hour) => (
              <button
                aria-label={`Add event at ${hour}:00`}
                className="week-hour-slot"
                key={hour}
                onClick={() => {
                  const scheduled = new Date(day);
                  scheduled.setUTCHours(hour, 0, 0, 0);
                  onCreateJob(scheduled);
                }}
                type="button"
              />
            ))}
            {dayJobs.map((job, index) => (
              <CalendarEvent job={job} key={job.id} style={calendarEventStyle(job, index)} supportMode={supportMode} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function MonthCalendar({ date, jobs, supportMode }: { date: Date; jobs: Job[]; supportMode: SupportMode }) {
  const firstOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const first = startOfWeek(firstOfMonth);
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index));
  const today = new Date();

  return (
    <div className="month-calendar-grid">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
        <span className="month-weekday" key={day}>{day}</span>
      ))}
      {days.map((day) => {
        const dayJobs = jobs.filter((job) => job.scheduled_start && sameDate(new Date(job.scheduled_start), day));
        return (
          <div className={`${day.getUTCMonth() === date.getUTCMonth() ? "month-day" : "month-day muted-day"}${sameDate(day, today) ? " today" : ""}`} key={day.toISOString()}>
            <strong>{day.getUTCDate()}</strong>
            {dayJobs.slice(0, 3).map((job) => (
              <CalendarEvent compact job={job} key={job.id} supportMode={supportMode} />
            ))}
            {dayJobs.length > 3 ? <span className="more-events">+{dayJobs.length - 3} more</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function AgendaCalendar({ jobs, supportMode }: { jobs: Job[]; supportMode: SupportMode }) {
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
    <div className="agenda-list polished-agenda-list">
      {Object.entries(groups).map(([day, dayJobs]) => (
        <section key={day}>
          <h3>{day}</h3>
          {dayJobs.map((job) => (
            <CalendarEvent agenda job={job} key={job.id} supportMode={supportMode} />
          ))}
        </section>
      ))}
    </div>
  );
}

function CalendarSidePanel({
  date,
  jobs,
  onCreateJob,
  supportMode,
  tentativeJobs,
}: {
  date: Date;
  jobs: Job[];
  onCreateJob: (scheduledStart?: Date) => void;
  supportMode: SupportMode;
  tentativeJobs: Job[];
}) {
  const firstOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const first = startOfWeek(firstOfMonth);
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index));
  const today = new Date();

  return (
    <aside className="calendar-side-panel">
      <section className="mini-calendar-card">
        <div className="mini-calendar-head">
          <strong>{new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC", year: "numeric" }).format(date)}</strong>
          <span aria-hidden="true">‹ ›</span>
        </div>
        <div className="mini-calendar-grid">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
            <span className="mini-weekday" key={day}>{day}</span>
          ))}
          {days.map((day) => (
            <span className={`${day.getUTCMonth() === date.getUTCMonth() ? "" : "muted"}${sameDate(day, today) ? " active" : ""}`} key={day.toISOString()}>
              {day.getUTCDate()}
            </span>
          ))}
        </div>
      </section>

      <section className="upcoming-calendar-card">
        <div className="calendar-side-heading">
          <h3>Upcoming this week</h3>
          <button onClick={() => onCreateJob()} type="button">New</button>
        </div>
        <div className="calendar-side-list">
          {jobs.length ? jobs.map((job) => (
            <Link className={`calendar-side-item status-${job.status}`} href={scopedHref(`/jobs/${job.id}`, supportMode)} key={job.id}>
              <span>{timeLabel(job.scheduled_start)}</span>
              <strong>{job.customer?.name ?? "Customer"}</strong>
              <em>{job.title}</em>
              <b aria-hidden="true">›</b>
            </Link>
          )) : <p className="muted">No confirmed work coming up.</p>}
        </div>
      </section>

      {tentativeJobs.length ? (
        <section className="upcoming-calendar-card tentative-card">
          <div className="calendar-side-heading">
            <h3>Tentative quotes</h3>
          </div>
          <div className="calendar-side-list">
            {tentativeJobs.slice(0, 4).map((job) => (
              <Link className="calendar-side-item status-quoted" href={scopedHref(`/jobs/${job.id}`, supportMode)} key={job.id}>
                <span>{dateLabel(job.scheduled_start)}</span>
                <strong>{job.customer?.name ?? "Customer"}</strong>
                <em>{job.title}</em>
                <b aria-hidden="true">›</b>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </aside>
  );
}

function calendarEventStyle(job: Job, index: number) {
  const start = job.scheduled_start ? new Date(job.scheduled_start) : null;
  const end = job.scheduled_end ? new Date(job.scheduled_end) : null;
  if (!start) {
    return undefined;
  }
  const startHour = start.getUTCHours() + start.getUTCMinutes() / 60;
  const endHour = end ? end.getUTCHours() + end.getUTCMinutes() / 60 : startHour + 1;
  const top = Math.max(42, 42 + (startHour - 8) * 54);
  const height = Math.max(48, (Math.max(endHour, startHour + 1) - startHour) * 54 - 7);

  return {
    height,
    left: `${8 + (index % 2) * 4}px`,
    right: `${8 + (index % 2) * 4}px`,
    top,
  };
}

function CalendarEvent({ agenda = false, compact = false, job, style, supportMode }: { agenda?: boolean; compact?: boolean; job: Job; style?: React.CSSProperties; supportMode: SupportMode }) {
  const className = agenda
    ? `calendar-event agenda-event status-${job.status}`
    : compact
      ? `calendar-event compact status-${job.status}`
      : `calendar-event status-${job.status}`;

  return (
    <Link className={className} href={scopedHref(`/jobs/${job.id}`, supportMode)} style={style}>
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
  statusLabels,
  statusOrder,
  terminology,
  totalPipeline,
}: {
  averageJobValue: number;
  completedRevenue: number;
  counts: Record<JobStatus, number>;
  jobs: Job[];
  statusLabels: Record<JobStatus, string>;
  statusOrder: JobStatus[];
  terminology: Terminology;
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
        openPipelineCount={jobs.filter(isOpenPipelineJob).length}
        statusLabels={statusLabels}
        supportMode={null}
        terminology={terminology}
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
          <p className="muted">Lead sources, follow-through, and booked revenue from real {lowerTerm(terminology.job_singular)} data.</p>
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
      const wonJobs = sourceJobs.filter((job) => wonValueCents(job) > 0 || job.status === "completed");
      const revenue = sourceJobs.reduce((sum, job) => sum + completedRevenueCents(job), 0);

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

function SettingsView({
  actionPlaybooks,
  business,
  dashboardWidgets,
  followupSettings,
  initialSettingsTab,
  intakeFields,
  jobs,
  customers,
  onboardingState,
  pipelineStatuses,
  serviceTypes,
  supportMode,
  terminology,
}: {
  actionPlaybooks: BusinessActionPlaybook[];
  business: Business;
  dashboardWidgets: ReturnType<typeof normalizeDashboardWidgets>;
  followupSettings: ReturnType<typeof normalizeFollowupSettings>;
  initialSettingsTab?: SettingsTab;
  intakeFields: IntakeField[];
  jobs: Job[];
  customers: CustomerSummary[];
  onboardingState: BusinessOnboardingState | null;
  pipelineStatuses: BusinessPipelineStatus[];
  serviceTypes: BusinessServiceType[];
  supportMode: SupportMode;
  terminology: Terminology;
}) {
  const router = useRouter();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(initialSettingsTab ?? "Workspace");
  const intakePath = business.slug ? `/intake/${business.slug}` : "";
  const enabledFieldCount = intakeFields.filter((field) => field.enabled).length;
  const enabledServiceCount = serviceTypes.filter((service) => service.enabled).length;
  const enabledDashboardCount = dashboardWidgets.filter((widget) => widget.enabled).length;
  const openOpportunityCount = jobs.filter(isOpenPipelineJob).length;
  const pipelineValue = jobs.filter(isOpenPipelineJob).reduce((sum, job) => sum + openPipelineValueCents(job), 0);
  const settingsSections: Array<{ description: string; eyebrow: string; icon: SettingsIconName; label: SettingsTab; meta: string }> = [
    {
      description: "Business identity, onboarding, and follow-up timing.",
      eyebrow: followupSettings.reminders_enabled ? "Automation on" : "Automation paused",
      icon: "workspace",
      label: "Workspace",
      meta: onboardingState?.completed_at ? "Tour complete" : onboardingState?.skipped_at ? "Tour skipped" : "Tour available",
    },
    {
      description: "Rename the core objects your team and customers see.",
      eyebrow: "Language",
      icon: "terminology",
      label: "Terminology",
      meta: `${terminology.job_plural} / ${terminology.customer_plural}`,
    },
    {
      description: "Manage the services shown in jobs and public intake.",
      eyebrow: "Catalog",
      icon: "services",
      label: "Services",
      meta: pluralize(enabledServiceCount, "active service"),
    },
    {
      description: "Control visible stages while keeping workflow meaning stable.",
      eyebrow: "Workflow",
      icon: "pipeline",
      label: "Pipeline",
      meta: pluralize(pipelineStatuses.filter((status) => status.enabled).length, "visible stage"),
    },
    {
      description: "Choose what appears on the Overview dashboard.",
      eyebrow: "Overview",
      icon: "dashboard",
      label: "Dashboard",
      meta: pluralize(enabledDashboardCount, "visible item"),
    },
    {
      description: "Shape the customer-facing request form and extra questions.",
      eyebrow: "Public form",
      icon: "intake",
      label: "Public intake",
      meta: pluralize(enabledFieldCount, "custom field"),
    },
    {
      description: "Decide what your team should do next at each stage.",
      eyebrow: "Guidance",
      icon: "steps",
      label: "Team Steps",
      meta: pluralize(actionPlaybooks.filter((action) => action.is_enabled).length, "active step"),
    },
  ];
  const activeSettingsSection = settingsSections.find((section) => section.label === settingsTab) ?? settingsSections[0];

  async function copyIntakeLink() {
    if (!intakePath) {
      return;
    }

    await navigator.clipboard?.writeText(`${window.location.origin}${intakePath}`);
  }

  function selectSettingsTab(tab: SettingsTab) {
    setSettingsTab(tab);
    router.replace(settingsHref(tab, supportMode), { scroll: false });
  }

  return (
    <div className="settings-workspace-shell">
      <div className="settings-product-nav" role="tablist" aria-label="Settings sections">
          {settingsSections.map((section) => (
            <Link
              aria-selected={settingsTab === section.label}
              className={settingsTab === section.label ? "active" : ""}
              href={settingsHref(section.label, supportMode)}
              key={section.label}
              onClick={() => selectSettingsTab(section.label)}
              role="tab"
            >
              <SettingsSectionIcon type={section.icon} />
              <span>
                <strong>{section.label}</strong>
              </span>
            </Link>
          ))}
      </div>

      <SettingsSummaryBanner
        business={business}
        customerCount={customers.length}
        openOpportunityCount={openOpportunityCount}
        pipelineValue={pipelineValue}
        terminology={terminology}
      />

      <div className="settings-content-grid">
        <div className="settings-workbench">
          <header className="settings-workbench-header">
            <span className="settings-module-icon">
              <SettingsSectionIcon type={activeSettingsSection.icon} />
            </span>
            <div>
              <p>{activeSettingsSection.eyebrow}</p>
              <h2>{activeSettingsSection.label}</h2>
              <span>{activeSettingsSection.description}</span>
            </div>
            <strong>{activeSettingsSection.meta}</strong>
          </header>

          <div className="settings-module-stack">

      {settingsTab === "Workspace" ? (
      <section className="data-panel settings-panel">
        <div className="panel-heading compact">
          <h2>Workspace settings</h2>
          <p className="muted">Keep the workspace name clean for dashboards and team context.</p>
        </div>
        <form className="settings-form" action={updateBusiness}>
          <input type="hidden" name="businessId" value={business.id} />
          <SupportModeInput supportMode={supportMode} />
          <div className="field">
            <label htmlFor="businessName">Business name</label>
            <input id="businessName" name="name" defaultValue={business.name} required />
          </div>
          <SubmitButton>Save settings</SubmitButton>
        </form>
      </section>
      ) : null}

      {settingsTab === "Workspace" && !supportMode && onboardingState ? (
      <section className="data-panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Getting Started</h2>
            <p className="muted">Restart the lightweight welcome checklist and product walkthrough.</p>
          </div>
          <span className={onboardingState?.completed_at || onboardingState?.skipped_at ? "status-pill status-scheduled" : "status-pill"}>
            {onboardingState?.completed_at ? "Completed" : onboardingState?.skipped_at ? "Skipped" : "Available"}
          </span>
        </div>
        <form action={updateOnboardingState}>
          <input type="hidden" name="businessId" value={business.id} />
          <button className="button button-secondary" name="intent" type="submit" value="restart">Restart walkthrough</button>
        </form>
      </section>
      ) : null}

      {settingsTab === "Workspace" ? (
      <section className="data-panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Follow-up automation</h2>
            <p className="muted">Control when FlowDeck surfaces prospects, proposals, and quiet opportunities in Needs Attention.</p>
          </div>
          <span className={followupSettings.reminders_enabled ? "status-pill status-scheduled" : "status-pill"}>
            {followupSettings.reminders_enabled ? "Enabled" : "Paused"}
          </span>
        </div>
        <form className="settings-form" action={updateFollowupSettings}>
          <input type="hidden" name="businessId" value={business.id} />
          <SupportModeInput supportMode={supportMode} />
          <label className="toggle-row">
            <input name="remindersEnabled" type="checkbox" defaultChecked={followupSettings.reminders_enabled} />
            <span>Show follow-up reminders in Needs Attention</span>
          </label>
          <div className="split-fields">
            <div className="field">
              <label htmlFor="new-lead-followup-hours">New prospect reminder after</label>
              <input id="new-lead-followup-hours" name="newLeadFollowupHours" type="number" min="1" max="720" defaultValue={followupSettings.new_lead_followup_hours} required />
              <p className="field-hint">Hours after a new lead arrives without first contact.</p>
            </div>
            <div className="field">
              <label htmlFor="contacted-followup-days">Contacted follow-up after</label>
              <input id="contacted-followup-days" name="contactedFollowupDays" type="number" min="1" max="365" defaultValue={followupSettings.contacted_followup_days} required />
              <p className="field-hint">Days after first contact if no proposal or follow-up is set.</p>
            </div>
          </div>
          <div className="split-fields">
            <div className="field">
              <label htmlFor="proposal-followup-days">{terminology.quote_singular} follow-up after</label>
              <input id="proposal-followup-days" name="proposalFollowupDays" type="number" min="1" max="365" defaultValue={followupSettings.proposal_followup_days} required />
              <p className="field-hint">Days after a sent {lowerTerm(terminology.quote_singular)} with no response.</p>
            </div>
            <div className="field">
              <label htmlFor="stale-opportunity-days">Stale opportunity warning after</label>
              <input id="stale-opportunity-days" name="staleOpportunityDays" type="number" min="1" max="365" defaultValue={followupSettings.stale_opportunity_days} required />
              <p className="field-hint">Days without meaningful sales activity or a future follow-up.</p>
            </div>
          </div>
          <SubmitButton>Save follow-up automation</SubmitButton>
        </form>
      </section>
      ) : null}

      {settingsTab === "Terminology" ? (
      <section className="data-panel settings-panel">
        <div className="panel-heading compact">
          <h2>Terminology</h2>
          <p className="muted">Customize the main business nouns customers and team members see.</p>
        </div>
        <form className="settings-form" action={updateTerminology}>
          <input type="hidden" name="businessId" value={business.id} />
          <SupportModeInput supportMode={supportMode} />
          <div className="split-fields">
            <div className="field">
              <label htmlFor="term-job-singular">Work item singular</label>
              <input id="term-job-singular" name="jobSingular" defaultValue={terminology.job_singular} maxLength={40} required />
            </div>
            <div className="field">
              <label htmlFor="term-job-plural">Work item plural</label>
              <input id="term-job-plural" name="jobPlural" defaultValue={terminology.job_plural} maxLength={40} required />
            </div>
          </div>
          <div className="split-fields">
            <div className="field">
              <label htmlFor="term-customer-singular">Contact singular</label>
              <input id="term-customer-singular" name="customerSingular" defaultValue={terminology.customer_singular} maxLength={40} required />
            </div>
            <div className="field">
              <label htmlFor="term-customer-plural">Contact plural</label>
              <input id="term-customer-plural" name="customerPlural" defaultValue={terminology.customer_plural} maxLength={40} required />
            </div>
          </div>
          <div className="split-fields">
            <div className="field">
              <label htmlFor="term-quote-singular">Pricing document singular</label>
              <input id="term-quote-singular" name="quoteSingular" defaultValue={terminology.quote_singular} maxLength={40} required />
            </div>
            <div className="field">
              <label htmlFor="term-quote-plural">Pricing document plural</label>
              <input id="term-quote-plural" name="quotePlural" defaultValue={terminology.quote_plural} maxLength={40} required />
            </div>
          </div>
          <div className="split-fields">
            <div className="field">
              <label htmlFor="term-active-board">Overview board title</label>
              <input id="term-active-board" name="activeBoardTitle" defaultValue={terminology.active_board_title} maxLength={40} />
            </div>
            <div className="field">
              <label htmlFor="term-upcoming">Upcoming section title</label>
              <input id="term-upcoming" name="upcomingTitle" defaultValue={terminology.upcoming_title} maxLength={40} />
            </div>
          </div>
          <div className="split-fields">
            <div className="field">
              <label htmlFor="term-new-job">New work button</label>
              <input id="term-new-job" name="newJobButtonLabel" defaultValue={terminology.new_job_button_label} maxLength={40} />
            </div>
            <div className="field">
              <label htmlFor="term-new-customer">New contact button</label>
              <input id="term-new-customer" name="newCustomerButtonLabel" defaultValue={terminology.new_customer_button_label} maxLength={40} />
            </div>
          </div>
          <SubmitButton>Save terminology</SubmitButton>
        </form>
      </section>
      ) : null}

      {settingsTab === "Services" ? (
      <section className="data-panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Services</h2>
            <p className="muted">Control the service choices used when creating jobs and collecting public requests.</p>
          </div>
          <span className="panel-count">{pluralize(enabledServiceCount, "active service")}</span>
        </div>
        <div className="intake-fields-list">
          {serviceTypes.map((service, index) => (
            <details className={service.enabled ? "intake-field-row" : "intake-field-row disabled-field"} key={service.key}>
              <summary>
                <span>
                  <strong>{service.label}</strong>
                  <em>{service.key}</em>
                </span>
                <span className={service.enabled ? "status-pill status-scheduled" : "status-pill"}>{service.enabled ? "Enabled" : "Disabled"}</span>
              </summary>
              {service.id ? (
                <>
                  <form className="settings-form intake-field-form" action={updateServiceType}>
                    <input type="hidden" name="businessId" value={business.id} />
                    <input type="hidden" name="serviceId" value={service.id} />
                    <SupportModeInput supportMode={supportMode} />
                    <div className="field">
                      <label htmlFor={`service-label-${service.key}`}>Display label</label>
                      <input id={`service-label-${service.key}`} name="label" defaultValue={service.label} maxLength={80} required />
                    </div>
                    <label className="toggle-row">
                      <input name="enabled" type="checkbox" defaultChecked={service.enabled} />
                      <span>Enabled</span>
                    </label>
                    <SubmitButton>Save service</SubmitButton>
                  </form>
                  <ConfigMoveButtons businessId={business.id} configType="services" disabledDown={index === serviceTypes.length - 1} disabledUp={index === 0} itemId={service.id} supportMode={supportMode} />
                </>
              ) : (
                <p className="message">Run the workspace config migration to edit service settings.</p>
              )}
            </details>
          ))}
        </div>
        <details className="intake-field-builder">
          <summary>Add service type</summary>
          <form className="settings-form intake-field-form" action={createServiceType}>
            <input type="hidden" name="businessId" value={business.id} />
            <SupportModeInput supportMode={supportMode} />
            <div className="split-fields">
              <div className="field">
                <label htmlFor="new-service-label">Display label</label>
                <input id="new-service-label" name="label" placeholder="Window Cleaning" required />
              </div>
              <div className="field">
                <label htmlFor="new-service-key">Stable key</label>
                <input id="new-service-key" name="key" pattern="[a-z][a-z0-9_]{1,40}" placeholder="window_cleaning" />
                <p className="field-hint">Leave blank to generate from the label.</p>
              </div>
            </div>
            <SubmitButton>Add service</SubmitButton>
          </form>
        </details>
      </section>
      ) : null}

      {settingsTab === "Pipeline" ? (
      <section className="data-panel settings-panel">
        <div className="panel-heading compact">
          <h2>Pipeline</h2>
          <p className="muted">Rename or reorder visible stages while preserving the internal workflow meaning.</p>
        </div>
        <div className="intake-fields-list">
          {pipelineStatuses.map((status, index) => (
            <details className={status.enabled ? "intake-field-row" : "intake-field-row disabled-field"} key={status.semantic_type}>
              <summary>
                <span>
                  <strong>{status.label}</strong>
                  <em>Meaning: {statusLabels[status.semantic_type]}</em>
                </span>
                <span className={status.enabled ? "status-pill status-scheduled" : "status-pill"}>{status.enabled ? "Enabled" : "Disabled"}</span>
              </summary>
              {status.id ? (
                <>
                  <form className="settings-form intake-field-form" action={updatePipelineStatusConfig}>
                    <input type="hidden" name="businessId" value={business.id} />
                    <input type="hidden" name="statusId" value={status.id} />
                    <input type="hidden" name="semanticType" value={status.semantic_type} />
                    <SupportModeInput supportMode={supportMode} />
                    <div className="field">
                      <label htmlFor={`pipeline-label-${status.semantic_type}`}>Display label</label>
                      <input id={`pipeline-label-${status.semantic_type}`} name="label" defaultValue={status.label} maxLength={80} required />
                    </div>
                    <label className="toggle-row">
                      <input
                        disabled={status.semantic_type === "lead" || status.semantic_type === "completed" || status.semantic_type === "lost"}
                        name="enabled"
                        type="checkbox"
                        defaultChecked={status.enabled}
                      />
                      <span>{status.semantic_type === "lead" || status.semantic_type === "completed" || status.semantic_type === "lost" ? "Required workflow stage" : "Enabled"}</span>
                    </label>
                    <SubmitButton>Save stage</SubmitButton>
                  </form>
                  <ConfigMoveButtons businessId={business.id} configType="pipeline" disabledDown={index === pipelineStatuses.length - 1} disabledUp={index === 0} itemId={status.id} supportMode={supportMode} />
                </>
              ) : (
                <p className="message">Run the workspace config migration to edit pipeline settings.</p>
              )}
            </details>
          ))}
        </div>
      </section>
      ) : null}

      {settingsTab === "Dashboard" ? (
      <section className="data-panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Dashboard</h2>
            <p className="muted">Choose which supported KPIs and sections appear on the Overview.</p>
          </div>
          <span className="panel-count">{pluralize(enabledDashboardCount, "visible item")}</span>
        </div>
        <div className="intake-fields-list">
          {dashboardWidgets.map((widget, index) => (
            <details className={widget.enabled ? "intake-field-row" : "intake-field-row disabled-field"} key={widget.widget_key}>
              <summary>
                <span>
                  <strong>{widget.label}</strong>
                  <em>{dashboardWidgetRegistry[widget.widget_key].defaultLabel} · {widget.zone}</em>
                </span>
                <span className={widget.enabled ? "status-pill status-scheduled" : "status-pill"}>{widget.enabled ? "Visible" : "Hidden"}</span>
              </summary>
              {widget.id ? (
                <>
                  <form className="settings-form intake-field-form" action={updateDashboardWidgetConfig}>
                    <input type="hidden" name="businessId" value={business.id} />
                    <input type="hidden" name="widgetId" value={widget.id} />
                    <input type="hidden" name="widgetKey" value={widget.widget_key} />
                    <SupportModeInput supportMode={supportMode} />
                    <div className="field">
                      <label htmlFor={`widget-label-${widget.widget_key}`}>Optional label override</label>
                      <input id={`widget-label-${widget.widget_key}`} name="labelOverride" defaultValue={widget.label_override ?? ""} maxLength={80} placeholder={dashboardWidgetRegistry[widget.widget_key].defaultLabel} />
                    </div>
                    <label className="toggle-row">
                      <input name="enabled" type="checkbox" defaultChecked={widget.enabled} />
                      <span>Visible on Overview</span>
                    </label>
                    <SubmitButton>Save dashboard item</SubmitButton>
                  </form>
                  <ConfigMoveButtons businessId={business.id} configType="dashboard" disabledDown={index === dashboardWidgets.length - 1} disabledUp={index === 0} itemId={widget.id} supportMode={supportMode} />
                </>
              ) : (
                <p className="message">Run the workspace config migration to edit dashboard settings.</p>
              )}
            </details>
          ))}
        </div>
      </section>
      ) : null}

      {settingsTab === "Public intake" ? (
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
          <SupportModeInput supportMode={supportMode} />
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
      ) : null}

      {settingsTab === "Public intake" ? (
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
                  <IntakeFieldInputs businessId={business.id} field={field} supportMode={supportMode} />
                  <SubmitButton>Save field</SubmitButton>
                </form>

                <div className="intake-field-actions">
                  <form action={moveIntakeField}>
                    <input type="hidden" name="businessId" value={business.id} />
                    <input type="hidden" name="fieldId" value={field.id} />
                    <input type="hidden" name="direction" value="up" />
                    <SupportModeInput supportMode={supportMode} />
                    <button className="button button-secondary" disabled={index === 0} type="submit">
                      Move up
                    </button>
                  </form>
                  <form action={moveIntakeField}>
                    <input type="hidden" name="businessId" value={business.id} />
                    <input type="hidden" name="fieldId" value={field.id} />
                    <input type="hidden" name="direction" value="down" />
                    <SupportModeInput supportMode={supportMode} />
                    <button className="button button-secondary" disabled={index === intakeFields.length - 1} type="submit">
                      Move down
                    </button>
                  </form>
                  <form action={archiveIntakeField}>
                    <input type="hidden" name="businessId" value={business.id} />
                    <input type="hidden" name="fieldId" value={field.id} />
                    <SupportModeInput supportMode={supportMode} />
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
            <IntakeFieldInputs businessId={business.id} supportMode={supportMode} />
            <SubmitButton>Add field</SubmitButton>
          </form>
        </details>
      </section>
      ) : null}

      {settingsTab === "Team Steps" ? (
      <ActionPlaybooksSettings
        actionPlaybooks={actionPlaybooks}
        business={business}
        pipelineStatuses={pipelineStatuses}
        serviceTypes={serviceTypes}
        supportMode={supportMode}
        terminology={terminology}
      />
      ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

type SettingsIconName = "dashboard" | "intake" | "pipeline" | "services" | "steps" | "terminology" | "workspace";

function SettingsSummaryBanner({
  business,
  customerCount,
  openOpportunityCount,
  pipelineValue,
  terminology,
}: {
  business: Business;
  customerCount: number;
  openOpportunityCount: number;
  pipelineValue: number;
  terminology: Terminology;
}) {
  return (
    <section className="settings-summary-banner" aria-label="Workspace summary">
      <div className="settings-summary-identity">
        <span className="settings-summary-mark">FD</span>
        <div>
          <h2>{displayWorkspaceName(business.name)}</h2>
          <p>Manage workspace settings and preferences.</p>
        </div>
        <span className={business.intake_form_enabled ? "settings-summary-status active" : "settings-summary-status"}>
          {business.intake_form_enabled ? "Active" : "Intake paused"}
        </span>
      </div>
      <div className="settings-summary-stats">
        <div>
          <span>{openOpportunityCount}</span>
          <p>Open {lowerTerm(terminology.job_plural)}</p>
        </div>
        <div>
          <span>{customerCount}</span>
          <p>{terminology.customer_plural}</p>
        </div>
        <div>
          <span>{money(pipelineValue)}</span>
          <p>Pipeline value</p>
        </div>
      </div>
    </section>
  );
}

function SettingsSectionIcon({ type }: { type: SettingsIconName }) {
  const paths: Record<SettingsIconName, string> = {
    dashboard: "M4 13h6v7H4Zm10-9h6v16h-6ZM4 4h6v5H4Z",
    intake: "M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm7 0v5h5M8 13h8M8 17h6",
    pipeline: "M4 7h5v10H4Zm8-3h5v16h-5Zm8 6h5v7h-5",
    services: "M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Z",
    steps: "M6 6h12M6 12h12M6 18h12M3 6h.01M3 12h.01M3 18h.01",
    terminology: "M4 6h16M4 12h10M4 18h13M8 6v12",
    workspace: "M4 21V7l8-4 8 4v14M9 21v-8h6v8M4 10h16",
  };

  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d={paths[type]} />
    </svg>
  );
}

function ActionPlaybooksSettings({
  actionPlaybooks,
  business,
  pipelineStatuses,
  serviceTypes,
  supportMode,
  terminology,
}: {
  actionPlaybooks: BusinessActionPlaybook[];
  business: Business;
  pipelineStatuses: BusinessPipelineStatus[];
  serviceTypes: BusinessServiceType[];
  supportMode: SupportMode;
  terminology: Terminology;
}) {
  const [pipelineKey, setPipelineKey] = useState<JobStatus>(pipelineStatuses[0]?.semantic_type ?? "lead");
  const [customizeService, setCustomizeService] = useState(false);
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [addingStep, setAddingStep] = useState(false);
  const [newActionType, setNewActionType] = useState<ActionPlaybookType>("call");
  const selectedActions = actionPlaybooks
    .filter((action) => action.pipeline_key === pipelineKey && (customizeService && serviceTypeId ? action.service_type_id === serviceTypeId : !action.service_type_id))
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  const defaultActions = actionPlaybooks
    .filter((action) => action.pipeline_key === pipelineKey && !action.service_type_id && action.is_enabled)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  const selectedStatus = pipelineStatuses.find((status) => status.semantic_type === pipelineKey);
  const selectedService = serviceTypes.find((service) => service.id === serviceTypeId);
  const showingInherited = customizeService && Boolean(serviceTypeId) && selectedActions.length === 0 && defaultActions.length > 0;
  const visibleActions = showingInherited ? defaultActions : selectedActions;
  const appliesToLabel = customizeService && selectedService ? selectedService.label : "All services";

  function chooseAllServices() {
    setCustomizeService(false);
    setServiceTypeId("");
    setAddingStep(false);
  }

  return (
    <section className="data-panel settings-panel action-playbook-editor">
      <div className="playbook-hero">
        <div>
          <h2>Team Steps</h2>
          <p>When {indefiniteTerm(terminology.job_singular)} is at this stage, what should your team do next?</p>
        </div>
        <span>{pluralize(actionPlaybooks.filter((action) => action.is_enabled).length, "active step")}</span>
      </div>

      <div className="playbook-picker">
        <label>
          Stage
          <select value={pipelineKey} onChange={(event) => setPipelineKey(event.target.value as JobStatus)}>
            {pipelineStatuses.map((status) => (
              <option key={status.semantic_type} value={status.semantic_type}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <div className="playbook-applies-control" aria-label="Choose which services use these steps">
          <span>Applies to</span>
          <div>
            <button aria-pressed={!customizeService} className={!customizeService ? "active" : ""} onClick={chooseAllServices} type="button">
              All services
            </button>
            <button
              className={customizeService ? "active" : ""}
              aria-pressed={customizeService}
              onClick={() => {
                setCustomizeService(true);
                setServiceTypeId(serviceTypeId || serviceTypes[0]?.id || "");
              }}
              type="button"
            >
              A specific service
            </button>
          </div>
        </div>
      </div>

      {customizeService ? (
        <div className="playbook-service-strip">
          <label>
            Service
            <select value={serviceTypeId} onChange={(event) => setServiceTypeId(event.target.value)}>
              {serviceTypes.map((service) => (
                <option key={service.id || service.key} value={service.id}>
                  {service.label}
                </option>
              ))}
            </select>
          </label>
          <p>
            {showingInherited
              ? `${selectedService?.label ?? "This service"} is currently using the All services steps.`
              : `Using custom steps for ${selectedService?.label ?? "this service"}.`}
          </p>
        </div>
      ) : (
        <p className="playbook-fallback-note">These steps apply to every service unless a service has its own steps.</p>
      )}

      {showingInherited ? (
        <div className="playbook-inherited-callout">
          <div>
            <strong>Based on All services</strong>
            <p>Customize this service when its sales or delivery steps need to be different.</p>
          </div>
          <button className="button button-secondary" onClick={() => setAddingStep(true)} type="button">
            Customize for this service
          </button>
        </div>
      ) : null}

      <div className="playbook-section-heading">
        <div>
          <h3>Recommended next steps</h3>
          <p>What should your team do when {indefiniteTerm(terminology.job_singular)} reaches {selectedStatus?.label ?? "this stage"}?</p>
        </div>
        <button className="button" onClick={() => setAddingStep((current) => !current)} type="button">
          + Add next step
        </button>
      </div>

      <div className="intake-fields-list playbook-list">
        {visibleActions.length ? (
          visibleActions.map((action, index) => (
            <details className={action.is_enabled ? "playbook-step-row" : "playbook-step-row disabled-field"} key={`${showingInherited ? "inherited" : "own"}-${action.id}`}>
              <summary>
                <span className="playbook-reorder-handle" aria-hidden="true">::</span>
                <span className="playbook-action-icon" aria-hidden="true">
                  <ActionTypeIcon type={action.action_type} />
                </span>
                <span className="playbook-step-copy">
                  <strong>{action.action_label}</strong>
                  <em>{actionDescription(action.action_type, terminology)}</em>
                </span>
                {showingInherited ? <span className="playbook-inherited-badge">All services</span> : <span className={action.is_enabled ? "switch-pill on" : "switch-pill"}>{action.is_enabled ? "On" : "Off"}</span>}
              </summary>
              {showingInherited ? (
                <p className="playbook-row-note">To change this for {selectedService?.label ?? "this service"}, add a custom step below.</p>
              ) : (
                <>
              <form className="settings-form intake-field-form" action={updateActionPlaybook}>
                <input type="hidden" name="businessId" value={business.id} />
                <input type="hidden" name="playbookId" value={action.id} />
                <input type="hidden" name="actionType" value={action.action_type} />
                <SupportModeInput supportMode={supportMode} />
                <div className="field">
                  <label htmlFor={`playbook-label-${action.id}`}>{action.action_type === "custom_instruction" ? "Instruction" : "Button label"}</label>
                  <input id={`playbook-label-${action.id}`} name="actionLabel" defaultValue={action.action_label} maxLength={120} required />
                </div>
                <label className="toggle-row">
                  <input name="enabled" type="checkbox" defaultChecked={action.is_enabled} />
                  <span>Show this step to the team</span>
                </label>
                <SubmitButton>Save action</SubmitButton>
              </form>
              <ConfigMoveButtons
                businessId={business.id}
                configType="playbooks"
                disabledDown={index === selectedActions.length - 1}
                disabledUp={index === 0}
                itemId={action.id}
                pipelineKey={pipelineKey}
                serviceTypeId={serviceTypeId}
                supportMode={supportMode}
              />
              </>
              )}
            </details>
          ))
        ) : (
          <div className="empty-state compact-empty-state">
            <h3>No steps yet</h3>
            <p>Add one or two next steps your team should take at this stage.</p>
          </div>
        )}
      </div>

      {addingStep ? (
        <div className="playbook-add-sheet">
          <div className="panel-heading compact">
            <div>
              <h3>Add next step</h3>
              <p className="muted">Choose what your team should see for {appliesToLabel}.</p>
            </div>
            <button className="icon-button" onClick={() => setAddingStep(false)} type="button" aria-label="Close add next step">
              x
            </button>
          </div>
          <div className="playbook-action-picker">
            {actionTypeOrder.map((type) => (
              <button aria-pressed={newActionType === type} className={newActionType === type ? "active" : ""} key={type} onClick={() => setNewActionType(type)} type="button">
                <ActionTypeIcon type={type} />
                <span>{defaultActionLabel(type, terminology)}</span>
                <em>{actionDescription(type, terminology)}</em>
              </button>
            ))}
          </div>
          <form className="settings-form intake-field-form" action={createActionPlaybook}>
          <input type="hidden" name="businessId" value={business.id} />
          <input type="hidden" name="pipelineKey" value={pipelineKey} />
          <input type="hidden" name="serviceTypeId" value={customizeService ? serviceTypeId : ""} />
          <input type="hidden" name="actionType" value={newActionType} />
          <SupportModeInput supportMode={supportMode} />
          <div className="field">
            <label htmlFor="new-playbook-label">{newActionType === "custom_instruction" ? "Custom step" : "Step label"}</label>
            <input
              id="new-playbook-label"
              key={newActionType}
              name="actionLabel"
              placeholder={customStepPlaceholder(newActionType, terminology)}
              defaultValue={newActionType === "custom_instruction" ? "" : defaultActionLabel(newActionType, terminology)}
              maxLength={120}
              required
            />
          </div>
          <SubmitButton>Add next step</SubmitButton>
        </form>
        </div>
      ) : null}
    </section>
  );
}

function IntakeFieldInputs({ businessId, field, supportMode }: { businessId: string; field?: IntakeField; supportMode: SupportMode }) {
  return (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      {field ? <input type="hidden" name="fieldId" value={field.id} /> : null}
      <SupportModeInput supportMode={supportMode} />
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

function actionDescription(type: ActionPlaybookType, terminology: Terminology) {
  const customer = lowerTerm(terminology.customer_singular);
  const job = lowerTerm(terminology.job_singular);
  const quote = lowerTerm(terminology.quote_singular);

  return {
    call: `Reach out to the ${customer} directly.`,
    custom_instruction: "Show a custom instruction for your team.",
    email: `Send an email to the ${customer}.`,
    mark_contacted: `Record that the ${customer} has been contacted.`,
    mark_lost: `Close out work that is not moving forward.`,
    open_opportunity: `Open the full ${job} record.`,
    review_proposal: `Open and review the current ${quote}.`,
    schedule: `Add or update the confirmed schedule.`,
    set_follow_up: "Choose the next contact date.",
  }[type];
}

function customStepPlaceholder(type: ActionPlaybookType, terminology: Terminology) {
  if (type === "custom_instruction") {
    return "Confirm insurance claim number";
  }

  return defaultActionLabel(type, terminology);
}

function ActionTypeIcon({ type }: { type: ActionPlaybookType }) {
  const paths: Record<ActionPlaybookType, string> = {
    call: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2.1Z",
    custom_instruction: "M12 20h9M12 4h9M4 9h16M4 15h16M4 4h.01M4 20h.01",
    email: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm18 3-10 6L2 7",
    mark_contacted: "M20 6 9 17l-5-5",
    mark_lost: "M18 6 6 18M6 6l12 12",
    open_opportunity: "M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5",
    review_proposal: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8M8 17h6",
    schedule: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
    set_follow_up: "M12 8v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z",
  };

  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d={paths[type]} />
    </svg>
  );
}

function ConfigMoveButtons({
  businessId,
  configType,
  disabledDown,
  disabledUp,
  itemId,
  pipelineKey,
  serviceTypeId,
  supportMode,
}: {
  businessId: string;
  configType: "services" | "pipeline" | "dashboard" | "playbooks";
  disabledDown: boolean;
  disabledUp: boolean;
  itemId: string;
  pipelineKey?: JobStatus;
  serviceTypeId?: string;
  supportMode: SupportMode;
}) {
  return (
    <div className="intake-field-actions">
      <form action={moveConfigItem}>
        <input type="hidden" name="businessId" value={businessId} />
        <input type="hidden" name="configType" value={configType} />
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="direction" value="up" />
        {pipelineKey ? <input type="hidden" name="pipelineKey" value={pipelineKey} /> : null}
        {serviceTypeId !== undefined ? <input type="hidden" name="serviceTypeId" value={serviceTypeId} /> : null}
        <SupportModeInput supportMode={supportMode} />
        <button className="button button-secondary" disabled={disabledUp} type="submit">
          Move up
        </button>
      </form>
      <form action={moveConfigItem}>
        <input type="hidden" name="businessId" value={businessId} />
        <input type="hidden" name="configType" value={configType} />
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="direction" value="down" />
        {pipelineKey ? <input type="hidden" name="pipelineKey" value={pipelineKey} /> : null}
        {serviceTypeId !== undefined ? <input type="hidden" name="serviceTypeId" value={serviceTypeId} /> : null}
        <SupportModeInput supportMode={supportMode} />
        <button className="button button-secondary" disabled={disabledDown} type="submit">
          Move down
        </button>
      </form>
    </div>
  );
}

function CustomerModal({
  businessId,
  customer,
  onClose,
  supportBusinessId,
  terminology,
}: {
  businessId: string;
  customer: CustomerSummary | null;
  onClose: () => void;
  supportBusinessId: string | null;
  terminology: Terminology;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="customer-modal-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{customer ? `Edit ${terminology.customer_singular}` : terminology.new_customer_button_label}</p>
            <h2 id="customer-modal-title">{customer ? `Update ${lowerTerm(terminology.customer_singular)} record` : `Create ${lowerTerm(terminology.customer_singular)} record`}</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close customer form">
            x
          </button>
        </div>
        <form className="modal-form" action={customer ? updateCustomer : createCustomer}>
          <input type="hidden" name="businessId" value={businessId} />
          {customer ? <input type="hidden" name="customerId" value={customer.id} /> : null}
          {supportBusinessId ? <input type="hidden" name="adminBusinessId" value={supportBusinessId} /> : null}
          <CustomerFields customer={customer} terminology={terminology} />
          <div className="modal-actions">
            <button className="button button-secondary" onClick={onClose} type="button">
              Cancel
            </button>
            <SubmitButton>{customer ? `Save ${lowerTerm(terminology.customer_singular)}` : `Create ${lowerTerm(terminology.customer_singular)}`}</SubmitButton>
          </div>
        </form>
      </div>
    </div>
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

function JobModal({
  businessId,
  customers,
  job,
  onClose,
  pipelineStatuses,
  scheduledStart,
  serviceTypes,
  statusLabels,
  supportBusinessId,
  terminology,
}: {
  businessId: string;
  customers: CustomerSummary[];
  job: Job | null;
  onClose: () => void;
  pipelineStatuses: BusinessPipelineStatus[];
  scheduledStart?: Date;
  serviceTypes: BusinessServiceType[];
  statusLabels: Record<JobStatus, string>;
  supportBusinessId: string | null;
  terminology: Terminology;
}) {
  const start = job ? dateTimeValue(job.scheduled_start) : scheduledStart ? dateTimeValue(scheduledStart.toISOString()) : { date: "", time: "" };
  const end = job ? dateTimeValue(job.scheduled_end) : { date: "", time: "" };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="job-modal-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{job ? `Edit ${terminology.job_singular}` : terminology.new_job_button_label}</p>
            <h2 id="job-modal-title">{job ? `Update ${lowerTerm(terminology.job_singular)} details` : "Add work to the schedule"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close job form">
            x
          </button>
        </div>
        <form className="modal-form" action={job ? updateJob : createJob}>
          <input type="hidden" name="businessId" value={businessId} />
          {job ? <input type="hidden" name="jobId" value={job.id} /> : null}
          {supportBusinessId ? <input type="hidden" name="adminBusinessId" value={supportBusinessId} /> : null}
          <JobFields customers={customers} end={end} job={job} pipelineStatuses={pipelineStatuses} serviceTypes={serviceTypes} start={start} statusLabels={statusLabels} terminology={terminology} />
          <div className="modal-actions">
            <button className="button button-secondary" onClick={onClose} type="button">
              Cancel
            </button>
            <SubmitButton>{job ? `Save ${lowerTerm(terminology.job_singular)}` : `Create ${lowerTerm(terminology.job_singular)}`}</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CustomerFields({ customer, terminology = normalizeTerminology() }: { customer: Customer | CustomerSummary | null; terminology?: Terminology }) {
  return (
    <>
      <div className="field">
        <label htmlFor="name">{terminology.customer_singular} name</label>
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
      <div className="field">
        <label htmlFor="addressLine2">Address line 2</label>
        <input id="addressLine2" name="addressLine2" defaultValue={customer?.address_line2 ?? ""} placeholder="Suite, unit, building, or gate" />
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
        <div className="field two-col">
          <label htmlFor="postalCode">Postal code</label>
          <input id="postalCode" name="postalCode" defaultValue={customer?.postal_code ?? ""} placeholder="78701" />
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
  pipelineStatuses = normalizePipelineStatuses(),
  serviceTypes = normalizeServiceTypes(),
  start,
  statusLabels = pipelineLabelMap(),
  terminology = normalizeTerminology(),
}: {
  customers: CustomerSummary[];
  end: { date: string; time: string };
  job: Job | null;
  pipelineStatuses?: BusinessPipelineStatus[];
  serviceTypes?: BusinessServiceType[];
  start: { date: string; time: string };
  statusLabels?: Record<JobStatus, string>;
  terminology?: Terminology;
}) {
  const enabledStatusOptions = job?.status === "lost" ? pipelineStatuses : pipelineStatuses.filter((status) => status.enabled && status.semantic_type !== "lost");
  const currentServiceKey = serviceKey(job?.project_type, serviceTypes) ?? "";
  const hasCurrentService = currentServiceKey ? serviceTypes.some((service) => service.key === currentServiceKey || service.label === job?.project_type) : true;

  return (
    <>
      <div className="field">
        <label htmlFor="customerId">{terminology.customer_singular}</label>
        <select id="customerId" name="customerId" defaultValue={job?.customer_id ?? customers[0]?.id ?? "__new__"} required={Boolean(job)}>
          <option value="" disabled>
            Select a {lowerTerm(terminology.customer_singular)}
          </option>
          {!job ? <option value="__new__">Create a new {lowerTerm(terminology.customer_singular)} below</option> : null}
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </div>
      {!job ? (
        <details className="inline-new-customer">
          <summary>Create a new {lowerTerm(terminology.customer_singular)} instead</summary>
          <div className="split-fields">
            <div className="field">
              <label htmlFor="newCustomerName">New {lowerTerm(terminology.customer_singular)} name</label>
              <input id="newCustomerName" name="newCustomerName" placeholder="Sarah Mitchell" />
            </div>
            <div className="field">
              <label htmlFor="newCustomerPhone">Phone</label>
              <input id="newCustomerPhone" name="newCustomerPhone" placeholder="(555) 123-0123" />
            </div>
          </div>
          <div className="split-fields">
            <div className="field">
              <label htmlFor="newCustomerEmail">Email</label>
              <input id="newCustomerEmail" name="newCustomerEmail" type="email" placeholder="customer@example.com" />
            </div>
            <div className="field">
              <label htmlFor="newCustomerAddressLine1">Address line 1</label>
              <input id="newCustomerAddressLine1" name="newCustomerAddressLine1" placeholder="1200 Maple Street" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="newCustomerAddressLine2">Address line 2</label>
            <input id="newCustomerAddressLine2" name="newCustomerAddressLine2" placeholder="Suite, unit, building, or gate" />
          </div>
          <div className="three-fields">
            <div className="field">
              <label htmlFor="newCustomerCity">City</label>
              <input id="newCustomerCity" name="newCustomerCity" placeholder="Austin" />
            </div>
            <div className="field">
              <label htmlFor="newCustomerState">State</label>
              <input id="newCustomerState" name="newCustomerState" placeholder="TX" />
            </div>
            <div className="field">
              <label htmlFor="newCustomerPostalCode">Postal code</label>
              <input id="newCustomerPostalCode" name="newCustomerPostalCode" placeholder="78701" />
            </div>
          </div>
        </details>
      ) : null}
      <div className="field">
        <label htmlFor="title">{terminology.job_singular} title</label>
        <input id="title" name="title" defaultValue={job?.title ?? ""} placeholder="Repair estimate" required />
      </div>
      <div className="field">
        <label htmlFor="description">Description</label>
        <textarea id="description" name="description" defaultValue={job?.description ?? ""} placeholder="Scope, prep, materials, and expectations" />
      </div>
      <div className="split-fields">
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={job?.status ?? "lead"}>
            {enabledStatusOptions.map((status) => (
              <option key={status.semantic_type} value={status.semantic_type}>
                {statusLabels[status.semantic_type]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="price">{terminology.job_singular} value</label>
          <input id="price" name="price" inputMode="decimal" defaultValue={job ? inputMoney(job.price_cents) : ""} placeholder="3200" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="projectType">Service type</label>
        <select id="projectType" name="projectType" defaultValue={currentServiceKey}>
          <option value="">Not specified</option>
          {serviceTypes.map((service) => (
            <option key={service.key} value={service.key}>
              {service.label}
            </option>
          ))}
          {job?.project_type && !hasCurrentService ? (
            <option value={job.project_type}>{serviceLabel(job.project_type, serviceTypes)}</option>
          ) : null}
        </select>
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
  helper,
  href,
  icon,
  label,
  priority = "secondary",
  value,
}: {
  helper: string;
  href: string;
  icon: React.ReactNode;
  label: string;
  priority?: "primary" | "secondary";
  value: string | number;
}) {
  return (
    <Link className={`kpi-card kpi-card-${priority} kpi-card-link`} href={href}>
      <div className="kpi-icon" aria-hidden="true">
        {icon}
      </div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{helper}</span>
    </Link>
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

function viewTitle(view: View, terminology: Terminology) {
  const titles: Record<View, string> = {
    Overview: "Today's work",
    Pipeline: "Pipeline board",
    Jobs: `${terminology.job_singular} pipeline`,
    Customers: `${terminology.customer_singular} list`,
    Calendar: "Field schedule",
    Analytics: "Performance snapshot",
    Settings: "Settings",
  };

  return titles[view];
}

function viewLabel(view: View, terminology: Terminology) {
  if (view === "Jobs") {
    return terminology.job_plural;
  }

  if (view === "Customers") {
    return terminology.customer_plural;
  }

  return view;
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
