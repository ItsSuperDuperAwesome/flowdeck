import Link from "next/link";
import { redirect } from "next/navigation";
import { displayWorkspaceName } from "@/lib/job-tracker/config";
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
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
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
          <form className="admin-search">
            <input name="q" placeholder="Search name, slug, or owner" defaultValue={params.q ?? ""} />
            <button className="button button-secondary" type="submit">Search</button>
          </form>
        </header>

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
