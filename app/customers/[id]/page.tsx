import { createJob, updateCustomerByIdWithContactFallback } from "@/app/dashboard/actions";
import { JobFields } from "@/app/dashboard/dashboard-client";
import type { Customer, CustomerSummary, Job, JobStatus } from "@/lib/job-tracker/types";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CustomerEditFields } from "./customer-edit-form";

export const dynamic = "force-dynamic";

type JobRow = Omit<Job, "customer"> & {
  customers: Customer | Customer[] | null;
};

const statusLabels: Record<JobStatus, string> = {
  completed: "Completed",
  contacted: "Contacted",
  in_progress: "In Progress",
  lead: "Lead",
  lost: "Lost",
  quoted: "Quoted",
  scheduled: "Scheduled",
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
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

function dateTimeLabel(value: string | null) {
  if (!value) {
    return "Unscheduled";
  }

  return `${dateLabel(value)} at ${timeLabel(value)}`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function address(customer: Customer) {
  return [customer.address_line1, customer.address_line2, customer.city, customer.state, customer.postal_code]
    .filter(Boolean)
    .join(", ");
}

export default async function CustomerDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; message?: string; newJob?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();

  if (authError || !auth?.claims) {
    redirect("/");
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id, business_id, name, email, phone, address_line1, address_line2, city, state, postal_code, notes, created_at, updated_at")
    .eq("id", id)
    .single();

  if (customerError || !customer) {
    notFound();
  }

  const { data: customerRows } = await supabase
    .from("customers")
    .select("id, business_id, name, email, phone, address_line1, address_line2, city, state, postal_code, notes, created_at, updated_at")
    .eq("business_id", customer.business_id)
    .order("name", { ascending: true });

  const { data: jobRows } = await supabase
    .from("jobs")
    .select("id, business_id, customer_id, title, description, status, price_cents, scheduled_start, scheduled_end, job_address, internal_notes, created_at, updated_at, customers(id, business_id, name, email, phone, address_line1, address_line2, city, state, postal_code, notes, created_at, updated_at)")
    .eq("customer_id", id)
    .order("scheduled_start", { ascending: false, nullsFirst: false });

  const jobs: Job[] = ((jobRows ?? []) as unknown as JobRow[]).map((job) => ({
    ...job,
    customer: Array.isArray(job.customers) ? job.customers[0] ?? null : job.customers,
  }));
  const activeJobs = jobs.filter((job) => job.status !== "completed" && job.status !== "lost");
  const upcomingWork = jobs
    .filter((job) => job.scheduled_start && (job.status === "scheduled" || job.status === "in_progress"))
    .sort((a, b) => String(a.scheduled_start).localeCompare(String(b.scheduled_start)))[0];

  const summary = {
    active: activeJobs.length,
    completed: jobs.filter((job) => job.status === "completed").length,
    total: jobs.length,
    value: jobs.reduce((sum, job) => sum + job.price_cents, 0),
  };
  const lastJob = jobs[0]?.scheduled_start ?? jobs[0]?.created_at ?? null;
  const customers = ((customerRows ?? []) as Customer[]).map((row) => ({
    ...row,
    active_jobs: 0,
    completed_jobs: 0,
    job_count: 0,
    last_job_date: null,
    lifetime_value_cents: 0,
  })) satisfies CustomerSummary[];
  const orderedCustomers = [
    ...customers.filter((row) => row.id === customer.id),
    ...customers.filter((row) => row.id !== customer.id),
  ];

  return (
    <main className="detail-shell">
      <div className="detail-header">
        <div>
          <Link className="back-link" href="/dashboard">
            Back to dashboard
          </Link>
          <p className="eyebrow">Customer</p>
          <h1>{customer.name}</h1>
          <p className="muted">
            {[customer.phone, customer.email, address(customer)].filter(Boolean).join(" | ") || "No contact details yet"}
          </p>
        </div>
        <div className="detail-header-actions">
          {customer.phone ? (
            <a className="button button-secondary" href={`tel:${customer.phone}`}>
              Call
            </a>
          ) : null}
          {customer.email ? (
            <a className="button button-secondary" href={`mailto:${customer.email}`}>
              Email
            </a>
          ) : null}
          <Link className="button button-secondary" href={`/customers/${customer.id}?edit=1#edit-customer`}>
            Edit Customer
          </Link>
          <Link className="button" href={`/customers/${customer.id}?newJob=1#new-job`}>
            New Job
          </Link>
        </div>
      </div>

      {query.message ? <p className="success-message">{query.message}</p> : null}

      <section className="detail-main">
        <section className="kpi-grid detail-kpis">
          <Metric label="Lifetime value" value={money(summary.value)} />
          <Metric label="Total jobs" value={summary.total} />
          <Metric label="Active jobs" value={summary.active} />
          <Metric label="Completed" value={summary.completed} />
          <Metric label="Upcoming work" value={upcomingWork ? dateLabel(upcomingWork.scheduled_start) : "None"} />
        </section>

        <section className="detail-top-grid">
          <section className="data-panel">
            <div className="panel-heading compact">
              <h2>Customer Profile</h2>
              <p className="muted">Contact and service details for this account.</p>
            </div>
            <div className="info-grid info-grid-compact">
              <Info label="Phone" value={customer.phone ?? "No phone"} href={customer.phone ? `tel:${customer.phone}` : undefined} />
              <Info label="Email" value={customer.email ?? "No email"} href={customer.email ? `mailto:${customer.email}` : undefined} />
              <Info label="Primary address" value={address(customer) || "No address yet"} />
              <Info label="Last job" value={dateLabel(lastJob)} />
            </div>
          </section>

          <section className="data-panel">
            <div className="panel-heading compact">
              <h2>Notes</h2>
              <p className="muted">Useful context for future conversations.</p>
            </div>
            <div className={customer.notes ? "detail-copy" : "detail-copy empty-copy"}>
              {customer.notes || "No customer notes yet."}
            </div>
          </section>
        </section>

        <section className="data-panel">
          <div className="panel-heading compact">
            <h2>Job History</h2>
            <p className="muted">
              {jobs.length ? `${pluralize(jobs.length, "job")} tied to this customer, newest first.` : "Work history will appear here once jobs are created."}
            </p>
          </div>
          {jobs.length ? (
            <div className="jobs-table-wrap">
              <table className="jobs-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Scheduled</th>
                    <th>Value</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <Link href={`/jobs/${job.id}`}>
                          <strong>{job.title}</strong>
                        </Link>
                      </td>
                      <td>
                        <span className={`status-pill status-${job.status}`}>{statusLabels[job.status]}</span>
                      </td>
                      <td>{job.scheduled_start ? dateTimeLabel(job.scheduled_start) : "Unscheduled"}</td>
                      <td>{money(job.price_cents)}</td>
                      <td>
                        <Link className="link-button" href={`/jobs/${job.id}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <h2>No jobs yet</h2>
              <p className="muted">Create the first job when this customer has work ready to track.</p>
              <Link className="button" href={`/customers/${customer.id}?newJob=1#new-job`}>
                Create First Job
              </Link>
            </div>
          )}
        </section>

        <details className="data-panel edit-disclosure" id="edit-customer" open={query.edit === "1"}>
          <summary>
            <span>
              <strong>Edit Customer</strong>
              <em>Update contact details, address, and notes.</em>
            </span>
          </summary>
          <form className="settings-form" action={updateCustomerByIdWithContactFallback.bind(null, id, customer.phone ?? "", customer.email ?? "")}>
            <CustomerEditFields
              addressLine1={customer.address_line1 ?? ""}
              city={customer.city ?? ""}
              contactCodeSeed={JSON.stringify([
                Array.from(String(customer.phone ?? ""), (character) => character.charCodeAt(0)),
                Array.from(String(customer.email ?? ""), (character) => character.charCodeAt(0)),
              ])}
              name={customer.name}
              notes={customer.notes ?? ""}
              state={customer.state ?? ""}
            />
            <button className="button" type="submit">
              Save customer
            </button>
          </form>
          <script
            dangerouslySetInnerHTML={{
              __html: `(() => {
                const phone = document.querySelector('input[name="customerPhone"]');
                const email = document.querySelector('input[name="customerEmail"]');
                if (phone && !phone.value) phone.value = ${JSON.stringify(customer.phone ?? "")};
                if (email && !email.value) email.value = ${JSON.stringify(customer.email ?? "")};
              })();`,
            }}
          />
        </details>

        <details className="data-panel edit-disclosure" id="new-job" open={query.newJob === "1"}>
          <summary>
            <span>
              <strong>New Job</strong>
              <em>Create work for this customer when there is something ready to track.</em>
            </span>
          </summary>
          <form className="settings-form" action={createJob}>
            <input type="hidden" name="businessId" value={customer.business_id} />
            <input type="hidden" name="customerId" value={customer.id} />
            <JobFields customers={orderedCustomers} end={{ date: "", time: "" }} job={null} start={{ date: "", time: "" }} />
            <button className="button" type="submit">
              Create job
            </button>
          </form>
        </details>
      </section>
    </main>
  );
}

function Info({ href, label, value }: { href?: string; label: string; value: string }) {
  return (
    <div className="info-item">
      <span>{label}</span>
      {href ? (
        <a href={href}>
          <strong>{value}</strong>
        </a>
      ) : (
        <strong>{value}</strong>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="kpi-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}
