import { updateAdminBusiness, updateAdminDashboardWidget, updateAdminPipeline, updateAdminService, updateAdminTerminology } from "@/app/admin/actions";
import { dashboardWidgetRegistry, displayWorkspaceName, normalizeTerminology } from "@/lib/job-tracker/config";
import type { BusinessDashboardWidget, BusinessPipelineStatus, BusinessServiceType, BusinessTerminology } from "@/lib/job-tracker/types";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type AdminWorkspaceDetail = {
  ok: boolean;
  code?: string;
  workspace: {
    id: string;
    name: string;
    slug: string | null;
    workspace_status: "active" | "trial" | "paused";
    intake_form_enabled: boolean;
    intake_form_title: string;
    intake_form_description: string;
    created_at: string;
    owner_email: string | null;
    member_count: number;
    customer_count: number;
    job_count: number;
    last_activity_at: string | null;
  };
  terminology: BusinessTerminology | null;
  services: BusinessServiceType[];
  pipeline: BusinessPipelineStatus[];
  dashboard_widgets: BusinessDashboardWidget[];
  audit_logs: {
    id: string;
    action: string;
    entity_type: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }[];
};

const statusLabels = {
  completed: "Completed",
  contacted: "Contacted",
  in_progress: "In Progress",
  lead: "Lead",
  lost: "Lost",
  quoted: "Quoted",
  scheduled: "Scheduled",
};

export default async function AdminWorkspaceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ message?: string }>;
}) {
  const { businessId } = await params;
  const { message } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();

  if (!auth?.claims) {
    redirect("/");
  }

  const { data, error } = await supabase.rpc("platform_admin_workspace_detail", { target_business_id: businessId });
  const detail = data as AdminWorkspaceDetail | null;

  if (error || !detail?.ok) {
    if (detail?.code === "not_found") {
      notFound();
    }
    redirect("/");
  }

  const workspace = detail.workspace;
  const workspaceName = displayWorkspaceName(workspace.name);
  const terms = normalizeTerminology(detail.terminology);
  const enabledServices = detail.services.filter((service) => service.enabled).length;
  const enabledPipeline = detail.pipeline.filter((stage) => stage.enabled).length;
  const enabledWidgets = detail.dashboard_widgets.filter((widget) => widget.enabled).length;

  return (
    <main className="admin-page">
      <aside className="admin-sidebar">
        <div className="brand-block">
          <div className="brand-mark">FD</div>
          <div>
            <p>FlowDeck</p>
            <strong>Platform Admin</strong>
          </div>
        </div>
        <nav className="side-nav" aria-label="Admin sections">
          <Link href="/admin">Overview</Link>
          <Link className="active" href="/admin/workspaces">Workspaces</Link>
        </nav>
        <Link className="button button-secondary" href="/dashboard">Client dashboard</Link>
      </aside>

      <section className="admin-main">
        <header className="dashboard-header">
          <div>
            <Link className="back-link" href="/admin/workspaces">Back to workspaces</Link>
            <p className="eyebrow">Workspace</p>
            <h1>{workspaceName}</h1>
            <p className="muted">{workspace.slug ?? "No slug"} · {workspace.owner_email ?? "Unknown owner"} · {workspace.workspace_status}</p>
          </div>
          <div className="header-actions">
            <Link className="button button-secondary" href={`/intake/${workspace.slug}`} target="_blank">Public intake</Link>
            <Link className="button" href={`/dashboard?adminBusinessId=${workspace.id}`}>Open workspace</Link>
          </div>
        </header>

        {message ? <p className="success-message">{message}</p> : null}

        <section className="kpi-grid kpi-grid-primary">
          <Metric label="Members" value={workspace.member_count} />
          <Metric label={terms.customer_plural} value={workspace.customer_count} />
          <Metric label={terms.job_plural} value={workspace.job_count} />
          <Metric label="Services" value={enabledServices} />
        </section>

        <section className="admin-detail-grid">
          <section className="data-panel">
            <div className="panel-heading compact">
              <h2>Workspace settings</h2>
              <p className="muted">Operational status and public intake state.</p>
            </div>
            <form className="settings-form" action={updateAdminBusiness}>
              <input type="hidden" name="businessId" value={workspace.id} />
              <div className="field">
                <label htmlFor="admin-business-name">Workspace name</label>
                <input id="admin-business-name" name="name" defaultValue={workspace.name} required />
              </div>
              <div className="field">
                <label htmlFor="workspace-status">Status</label>
                <select id="workspace-status" name="workspaceStatus" defaultValue={workspace.workspace_status}>
                  <option value="active">Active</option>
                  <option value="trial">Trial</option>
                  <option value="paused">Paused</option>
                </select>
              </div>
              <label className="toggle-row">
                <input name="intakeEnabled" type="checkbox" defaultChecked={workspace.intake_form_enabled} />
                <span>Public intake enabled</span>
              </label>
              <button className="button" type="submit">Save workspace</button>
            </form>
          </section>

          <section className="data-panel">
            <div className="panel-heading compact">
              <h2>Configuration health</h2>
              <p className="muted">Fast setup summary for this client.</p>
            </div>
            <div className="admin-health-list">
              <span>Intake <strong>{workspace.intake_form_enabled ? "On" : "Off"}</strong></span>
              <span>Services <strong>{enabledServices}</strong></span>
              <span>Pipeline <strong>{enabledPipeline ? "Configured" : "Missing"}</strong></span>
              <span>Dashboard <strong>{enabledWidgets ? "Configured" : "Missing"}</strong></span>
              <span>Terminology <strong>{terms.job_singular === "Job" && terms.customer_singular === "Customer" && terms.quote_singular === "Quote" ? "Default" : "Custom"}</strong></span>
            </div>
          </section>
        </section>

        <section className="data-panel full-width">
          <div className="panel-heading compact">
            <h2>Terminology</h2>
            <p className="muted">Client-facing nouns used throughout this workspace.</p>
          </div>
          <form className="settings-form" action={updateAdminTerminology}>
            <input type="hidden" name="businessId" value={workspace.id} />
            <div className="split-fields">
              <Field name="jobSingular" label="Job singular" value={terms.job_singular} />
              <Field name="jobPlural" label="Job plural" value={terms.job_plural} />
            </div>
            <div className="split-fields">
              <Field name="customerSingular" label="Customer singular" value={terms.customer_singular} />
              <Field name="customerPlural" label="Customer plural" value={terms.customer_plural} />
            </div>
            <div className="split-fields">
              <Field name="quoteSingular" label="Quote singular" value={terms.quote_singular} />
              <Field name="quotePlural" label="Quote plural" value={terms.quote_plural} />
            </div>
            <div className="split-fields">
              <Field name="activeBoardTitle" label="Active board title" value={terms.active_board_title} required={false} />
              <Field name="upcomingTitle" label="Upcoming title" value={terms.upcoming_title} required={false} />
            </div>
            <div className="split-fields">
              <Field name="newJobButtonLabel" label="New job button" value={terms.new_job_button_label} required={false} />
              <Field name="newCustomerButtonLabel" label="New customer button" value={terms.new_customer_button_label} required={false} />
            </div>
            <button className="button" type="submit">Save terminology</button>
          </form>
        </section>

        <section className="admin-detail-grid">
          <ConfigPanel title="Services" count={enabledServices}>
            {detail.services.map((service) => (
              <form className="admin-inline-form" action={updateAdminService} key={service.id}>
                <input type="hidden" name="businessId" value={workspace.id} />
                <input type="hidden" name="serviceId" value={service.id} />
                <input name="label" defaultValue={service.label} />
                <label><input name="enabled" type="checkbox" defaultChecked={service.enabled} /> Enabled</label>
                <button className="link-button" type="submit">Save</button>
              </form>
            ))}
          </ConfigPanel>

          <ConfigPanel title="Pipeline" count={enabledPipeline}>
            {detail.pipeline.map((stage) => (
              <form className="admin-inline-form" action={updateAdminPipeline} key={stage.id}>
                <input type="hidden" name="businessId" value={workspace.id} />
                <input type="hidden" name="statusId" value={stage.id} />
                <input type="hidden" name="semanticType" value={stage.semantic_type} />
                <input name="label" defaultValue={stage.label} />
                <span>{statusLabels[stage.semantic_type]}</span>
                <label><input name="enabled" type="checkbox" defaultChecked={stage.enabled} disabled={stage.semantic_type === "lead" || stage.semantic_type === "completed" || stage.semantic_type === "lost"} /> Enabled</label>
                <button className="link-button" type="submit">Save</button>
              </form>
            ))}
          </ConfigPanel>
        </section>

        <section className="admin-detail-grid">
          <ConfigPanel title="Dashboard widgets" count={enabledWidgets}>
            {detail.dashboard_widgets.map((widget) => (
              <form className="admin-inline-form" action={updateAdminDashboardWidget} key={widget.id}>
                <input type="hidden" name="businessId" value={workspace.id} />
                <input type="hidden" name="widgetId" value={widget.id} />
                <input type="hidden" name="widgetKey" value={widget.widget_key} />
                <span>{dashboardWidgetRegistry[widget.widget_key].defaultLabel}</span>
                <input name="labelOverride" defaultValue={widget.label_override ?? ""} placeholder="Optional label" />
                <label><input name="enabled" type="checkbox" defaultChecked={widget.enabled} /> Visible</label>
                <button className="link-button" type="submit">Save</button>
              </form>
            ))}
          </ConfigPanel>

          <section className="data-panel">
            <div className="panel-heading compact">
              <h2>Recent admin activity</h2>
              <p className="muted">Platform-admin configuration changes.</p>
            </div>
            <div className="activity-list">
              {detail.audit_logs.length ? (
                detail.audit_logs.map((entry) => (
                  <p key={entry.id}>
                    <strong>{entry.action}</strong>
                    <span> {entry.entity_type} · {dateLabel(entry.created_at)}</span>
                  </p>
                ))
              ) : (
                <p className="muted">No platform-admin edits recorded yet.</p>
              )}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article className="kpi-card">
      <p>{label}</p>
      <strong>{value.toLocaleString()}</strong>
    </article>
  );
}

function Field({ label, name, required = true, value }: { label: string; name: string; required?: boolean; value: string }) {
  return (
    <div className="field">
      <label htmlFor={`admin-${name}`}>{label}</label>
      <input id={`admin-${name}`} name={name} defaultValue={value} maxLength={40} required={required} />
    </div>
  );
}

function ConfigPanel({ children, count, title }: { children: React.ReactNode; count: number; title: string }) {
  return (
    <section className="data-panel">
      <div className="panel-heading compact">
        <h2>{title}</h2>
        <span className="panel-count">{count} active</span>
      </div>
      <div className="admin-config-stack">{children}</div>
    </section>
  );
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
