import { logout } from "@/app/auth/actions";
import { createBusiness } from "@/app/dashboard/actions";
import { DashboardClient } from "@/app/dashboard/dashboard-client";
import type { Business, Customer, CustomerSummary, IntakeField, Job, JobActivity, QuoteMessage } from "@/lib/job-tracker/types";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type JobRow = Omit<Job, "customer"> & {
  customers: Customer | Customer[] | null;
};

type ActivityRow = Omit<JobActivity, "job"> & {
  jobs: Pick<Job, "id" | "title" | "status"> | Pick<Job, "id" | "title" | "status">[] | null;
};

type QuoteMessageRow = QuoteMessage & {
  jobs: JobRow | JobRow[] | null;
};

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; view?: string }>;
}) {
  const params = await searchParams;
  const initialView = isDashboardView(params.view) ? params.view : undefined;

  if (!hasSupabaseConfig()) {
    redirect("/");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/");
  }

  const email = data.claims.email ?? "Signed-in user";

  const { data: memberships, error: membershipError } = await supabase
    .from("business_members")
    .select("businesses(id, name, slug, intake_form_enabled, intake_form_title, intake_form_description)")
    .limit(1);

  const business = memberships?.[0]?.businesses as Business | null | undefined;

  const { data: customerRows, error: customersError } = business
    ? await supabase
        .from("customers")
        .select(
          "id, business_id, name, email, phone, address_line1, address_line2, city, state, postal_code, notes, created_at, updated_at",
        )
        .eq("business_id", business.id)
        .order("name", { ascending: true })
    : { data: [], error: null };

  const { data: jobRows, error: jobsError } = business
      ? await supabase
        .from("jobs")
        .select(
          "id, business_id, customer_id, title, description, status, price_cents, scheduled_start, scheduled_end, job_address, internal_notes, source, project_type, preferred_date, square_feet, budget_range, first_contact_at, quote_sent_at, won_at, next_follow_up_at, lost_at, completed_at, lost_reason, revenue_cents, intake_data, created_at, updated_at, customers(id, business_id, name, email, phone, address_line1, address_line2, city, state, postal_code, notes, created_at, updated_at)",
        )
        .eq("business_id", business.id)
        .order("scheduled_start", { ascending: true, nullsFirst: false })
        .order("updated_at", { ascending: false })
    : { data: [], error: null };

  const { data: activityRows, error: activityError } = business
    ? await supabase
        .from("job_activity")
        .select("id, business_id, job_id, user_id, event_type, message, metadata, created_at, jobs(id, title, status)")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
        .limit(12)
    : { data: [], error: null };

  const { data: intakeFieldRows, error: intakeFieldsError } = business
    ? await supabase
        .from("intake_fields")
        .select("id, business_id, field_key, label, field_type, required, enabled, options, sort_order, created_at, updated_at")
        .eq("business_id", business.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
    : { data: [], error: null };

  const { data: quoteMessageRows, error: quoteMessagesError } = business
    ? await supabase
        .from("quote_messages")
        .select(
          "id, business_id, quote_id, job_id, message, source, resolved_at, created_at, jobs(id, business_id, customer_id, title, description, status, price_cents, scheduled_start, scheduled_end, job_address, internal_notes, source, project_type, preferred_date, square_feet, budget_range, first_contact_at, quote_sent_at, won_at, next_follow_up_at, lost_at, completed_at, lost_reason, revenue_cents, intake_data, created_at, updated_at, customers(id, business_id, name, email, phone, address_line1, address_line2, city, state, postal_code, notes, created_at, updated_at))",
        )
        .eq("business_id", business.id)
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(8)
    : { data: [], error: null };

  const schemaNeedsSetup =
    Boolean(membershipError || customersError || jobsError || activityError || intakeFieldsError || quoteMessagesError);

  const jobs: Job[] = ((jobRows ?? []) as unknown as JobRow[]).map((job) => ({
    ...job,
    customer: Array.isArray(job.customers) ? job.customers[0] ?? null : job.customers,
  }));

  const customers = buildCustomerSummaries((customerRows ?? []) as Customer[], jobs);
  const activities: JobActivity[] = ((activityRows ?? []) as unknown as ActivityRow[]).map((activity) => ({
    ...activity,
    job: Array.isArray(activity.jobs) ? activity.jobs[0] ?? null : activity.jobs,
  }));
  const intakeFields: IntakeField[] = ((intakeFieldRows ?? []) as IntakeField[]).map((field) => ({
    ...field,
    options: Array.isArray(field.options) ? field.options : [],
  }));
  const quoteMessages = ((quoteMessageRows ?? []) as unknown as QuoteMessageRow[]).map((quoteMessage) => {
    const rowJob = Array.isArray(quoteMessage.jobs) ? quoteMessage.jobs[0] ?? null : quoteMessage.jobs;

    return {
      ...quoteMessage,
      job: rowJob
        ? {
            ...rowJob,
            customer: Array.isArray(rowJob.customers) ? rowJob.customers[0] ?? null : rowJob.customers,
          }
        : null,
    };
  });

  return (
    <main className="app-page">
      {schemaNeedsSetup ? (
        <section className="setup-shell">
          <div className="setup-panel">
            <p className="eyebrow">Database setup</p>
            <h1>Update the schema</h1>
            <p className="muted">
              Paste the latest <code>supabase/schema.sql</code> into the Supabase SQL
              Editor, run it, then refresh this page.
            </p>
            <form action={logout}>
              <button className="button button-secondary" type="submit">
                Log out
              </button>
            </form>
          </div>
        </section>
      ) : business ? (
        <DashboardClient
          activities={activities}
          business={business}
          customers={customers}
          intakeFields={intakeFields}
          jobs={jobs}
          initialView={initialView}
          message={params.message}
          quoteMessages={quoteMessages}
          userEmail={email}
        />
      ) : (
        <section className="setup-shell">
          <div className="setup-panel">
            <p className="eyebrow">Job Tracker</p>
            <h1>Create your workspace</h1>
            <p className="muted">
              Start with the business name. Customers, jobs, schedules, and activity
              will attach to this workspace.
            </p>
            <form className="form setup-form" action={createBusiness}>
              <div className="field">
                <label htmlFor="businessName">Business name</label>
                <input id="businessName" name="name" placeholder="Nachef Epoxy Floors" required />
              </div>
              <button className="button" type="submit">
                Create business
              </button>
            </form>
            {params.message ? <p className="message">{params.message}</p> : null}
            <p className="muted signed-in">Signed in as {email}</p>
          </div>
        </section>
      )}
    </main>
  );
}

function buildCustomerSummaries(customers: Customer[], jobs: Job[]): CustomerSummary[] {
  return customers.map((customer) => {
    const customerJobs = jobs.filter((job) => job.customer_id === customer.id);
    const sortedJobs = [...customerJobs].sort((a, b) =>
      String(b.scheduled_start ?? b.created_at).localeCompare(String(a.scheduled_start ?? a.created_at)),
    );

    return {
      ...customer,
      active_jobs: customerJobs.filter((job) => job.status !== "completed" && job.status !== "lost").length,
      completed_jobs: customerJobs.filter((job) => job.status === "completed").length,
      job_count: customerJobs.length,
      last_job_date: sortedJobs[0]?.scheduled_start ?? sortedJobs[0]?.created_at ?? null,
      lifetime_value_cents: customerJobs.reduce((sum, job) => sum + job.revenue_cents, 0),
    };
  });
}

function isDashboardView(value: string | undefined): value is "Overview" | "Pipeline" | "Jobs" | "Customers" | "Calendar" | "Analytics" | "Settings" {
  return Boolean(value && ["Overview", "Pipeline", "Jobs", "Customers", "Calendar", "Analytics", "Settings"].includes(value));
}
