import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminWorkspace } from "@/app/admin/actions";
import { ToastMessage } from "@/app/toast-message";
import { displayWorkspaceName } from "@/lib/job-tracker/config";
import { successFeedbackMessage } from "@/lib/job-tracker/feedback";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AdminWorkspace = {
  id: string;
  name: string;
  slug: string | null;
  workspace_status: "active" | "trial" | "paused";
  intake_form_enabled: boolean;
  created_at: string;
  owner_email: string | null;
  member_count: number;
  customer_count: number;
  job_count: number;
  last_activity_at: string | null;
  terminology_custom: boolean;
  service_count: number;
  pipeline_count: number;
  dashboard_count: number;
};

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; q?: string }>;
}) {
  const params = await searchParams;
  const toastMessage = successFeedbackMessage(params.message);
  const query = (params.q ?? "").trim().toLowerCase();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();

  if (!auth?.claims) {
    redirect("/");
  }

  const { data, error } = await supabase.rpc("platform_admin_workspaces");

  if (error || !data?.ok) {
    redirect("/");
  }

  const workspaces = ((data.workspaces ?? []) as AdminWorkspace[]).filter((workspace) =>
    [workspace.name, workspace.slug, workspace.owner_email].filter(Boolean).join(" ").toLowerCase().includes(query),
  );
  const allWorkspaces = (data.workspaces ?? []) as AdminWorkspace[];
  const activeCount = allWorkspaces.filter((workspace) => workspace.workspace_status === "active").length;
  const totalMembers = allWorkspaces.reduce((sum, workspace) => sum + workspace.member_count, 0);
  const totalJobs = allWorkspaces.reduce((sum, workspace) => sum + workspace.job_count, 0);

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
          <Link className="active" href="/admin">Overview</Link>
          <Link href="/admin/workspaces">Workspaces</Link>
        </nav>
        <Link className="button button-secondary" href="/dashboard">Client dashboard</Link>
      </aside>

      <section className="admin-main">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">Platform</p>
            <h1>Client workspaces</h1>
            <p className="muted">Operate FlowDeck customer accounts without becoming a workspace member.</p>
          </div>
          <div className="header-actions">
            <a className="button" href="#new-workspace">New Workspace</a>
            <form className="admin-search">
              <input name="q" placeholder="Search name, slug, or owner" defaultValue={params.q ?? ""} />
              <button className="button button-secondary" type="submit">Search</button>
            </form>
          </div>
        </header>

        {toastMessage ? <ToastMessage message={toastMessage} /> : null}
        {params.message && !toastMessage ? <p className="success-message">{params.message}</p> : null}

        <section className="kpi-grid kpi-grid-primary">
          <Metric label="Total workspaces" value={allWorkspaces.length} />
          <Metric label="Active workspaces" value={activeCount} />
          <Metric label="Total members" value={totalMembers} />
          <Metric label="Total opportunities" value={totalJobs} />
        </section>

        <section className="data-panel full-width">
          <div className="panel-heading">
            <div>
              <h2>Workspaces</h2>
              <p className="muted">Configuration health and recent activity across client accounts.</p>
            </div>
            <span className="panel-count">{workspaces.length} shown</span>
          </div>
          <div className="jobs-table-wrap">
            <table className="jobs-table">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Owner</th>
                  <th>Usage</th>
                  <th>Config</th>
                  <th>Last activity</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {workspaces.map((workspace) => (
                  <tr key={workspace.id}>
                    <td>
                      <strong>{displayWorkspaceName(workspace.name)}</strong>
                      <span>{workspace.slug ?? "No slug"} · {workspace.workspace_status}</span>
                    </td>
                    <td>{workspace.owner_email ?? "Unknown"}</td>
                    <td>{workspace.member_count} members · {workspace.customer_count} customers · {workspace.job_count} jobs</td>
                    <td>
                      <span className="status-pill status-scheduled">{workspace.intake_form_enabled ? "Intake on" : "Intake off"}</span>
                      <span className="admin-config-line">{workspace.service_count} services · {workspace.pipeline_count} stages · {workspace.dashboard_count} widgets · {workspace.terminology_custom ? "Custom terms" : "Default terms"}</span>
                    </td>
                    <td>{workspace.last_activity_at ? dateLabel(workspace.last_activity_at) : "No activity"}</td>
                    <td>
                      <Link className="link-button" href={`/admin/workspaces/${workspace.id}`}>Manage</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="data-panel full-width" id="new-workspace">
          <div className="panel-heading">
            <div>
              <h2>New Workspace</h2>
              <p className="muted">Create a client tenant with default services, pipeline, dashboard, intake, and follow-up settings.</p>
            </div>
          </div>
          <form className="settings-form admin-create-workspace-form" action={createAdminWorkspace}>
            <div className="split-fields">
              <div className="field">
                <label htmlFor="workspace-name">Business/workspace name</label>
                <input id="workspace-name" name="name" placeholder="North Texas Roofing" required />
              </div>
              <div className="field">
                <label htmlFor="workspace-slug">Workspace slug</label>
                <input id="workspace-slug" name="slug" placeholder="north-texas-roofing" pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]" required />
              </div>
            </div>
            <div className="split-fields">
              <div className="field">
                <label htmlFor="owner-email">Primary owner email</label>
                <input id="owner-email" name="ownerEmail" type="email" placeholder="owner@example.com" />
              </div>
              <div className="field">
                <label htmlFor="new-workspace-status">Status</label>
                <select id="new-workspace-status" name="workspaceStatus" defaultValue="trial">
                  <option value="trial">Trial</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </div>
            </div>
            <p className="muted">
              Owner email is stored for handoff/admin reference. It does not create an auth user or add the FlowDeck admin as a workspace member.
            </p>
            <button className="button" type="submit">Create Workspace</button>
          </form>
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

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
