import {
  createOwnerInvite,
  createAdminService,
  moveAdminConfigItem,
  revokeOwnerInvite,
  updateAdminBusiness,
  updateAdminDashboardWidget,
  updateAdminFollowupSettings,
  updateAdminIntakeSettings,
  updateAdminPipeline,
  updateAdminService,
  updateAdminTerminology,
} from "@/app/admin/actions";
import { ToastMessage } from "@/app/toast-message";
import { dashboardWidgetRegistry, displayWorkspaceName, normalizeFollowupSettings, normalizeTerminology } from "@/lib/job-tracker/config";
import { successFeedbackMessage } from "@/lib/job-tracker/feedback";
import type { BusinessDashboardWidget, BusinessFollowupSettings, BusinessPipelineStatus, BusinessServiceType, BusinessTerminology } from "@/lib/job-tracker/types";
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
  followup_settings: BusinessFollowupSettings | null;
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
  searchParams: Promise<{ invite?: string; message?: string }>;
}) {
  const { businessId } = await params;
  const { invite, message } = await searchParams;
  const toastMessage = successFeedbackMessage(message);
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
  const { data: invites } = await supabase
    .from("business_invites")
    .select("id, email, role, expires_at, accepted_at, revoked_at, created_at")
    .eq("business_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(8);
  const workspaceName = displayWorkspaceName(workspace.name);
  const terms = normalizeTerminology(detail.terminology);
  const enabledServices = detail.services.filter((service) => service.enabled).length;
  const enabledPipeline = detail.pipeline.filter((stage) => stage.enabled).length;
  const enabledWidgets = detail.dashboard_widgets.filter((widget) => widget.enabled).length;
  const followup = normalizeFollowupSettings(detail.followup_settings);

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

        {toastMessage ? <ToastMessage message={toastMessage} /> : null}
        {message && !toastMessage ? <p className="success-message">{message}</p> : null}
        {invite ? (
          <section className="data-panel invite-copy-panel">
            <div className="panel-heading compact">
              <h2>Owner invite link</h2>
              <p className="muted">Email delivery is not automated yet. Send this secure link to the owner.</p>
            </div>
            <input readOnly value={invite} aria-label="Owner invite link" />
          </section>
        ) : null}

        <section className="kpi-grid kpi-grid-primary">
          <Metric label="Members" value={workspace.member_count} />
          <Metric label={terms.customer_plural} value={workspace.customer_count} />
          <Metric label={terms.job_plural} value={workspace.job_count} />
          <Metric label="Services" value={enabledServices} />
        </section>

        <nav className="settings-tabs admin-section-nav" aria-label="Workspace setup sections">
          {["Overview", "Owner Invite", "Terminology", "Services", "Pipeline", "Dashboard", "Public Intake", "Follow-Up Automation"].map((section) => (
            <a href={`#${section.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`} key={section}>
              {section}
            </a>
          ))}
        </nav>

        <section className="admin-detail-grid" id="overview">
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
                <label htmlFor="admin-business-slug">Workspace slug</label>
                <input id="admin-business-slug" name="slug" defaultValue={workspace.slug ?? ""} pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]" required />
              </div>
              <div className="field">
                <label htmlFor="admin-owner-email">Primary owner email</label>
                <input id="admin-owner-email" name="ownerEmail" defaultValue={workspace.owner_email ?? ""} type="email" />
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

        <section className="data-panel full-width" id="owner-invite">
          <div className="panel-heading compact">
            <div>
              <h2>Owner invite</h2>
              <p className="muted">Create a secure, single-use handoff link for the client owner.</p>
            </div>
          </div>
          <form className="admin-invite-form" action={createOwnerInvite}>
            <input type="hidden" name="businessId" value={workspace.id} />
            <div className="field">
              <label htmlFor="owner-invite-email">Owner email</label>
              <input id="owner-invite-email" name="email" type="email" defaultValue={workspace.owner_email ?? ""} required />
            </div>
            <button className="button" type="submit">Invite Owner</button>
          </form>
          <div className="admin-invite-list">
            {(invites ?? []).length ? (
              (invites ?? []).map((ownerInvite) => (
                <form className="admin-invite-row" action={revokeOwnerInvite} key={ownerInvite.id}>
                  <input type="hidden" name="businessId" value={workspace.id} />
                  <input type="hidden" name="inviteId" value={ownerInvite.id} />
                  <div>
                    <strong>{ownerInvite.email}</strong>
                    <span>{inviteStatus(ownerInvite)} · expires {dateLabel(ownerInvite.expires_at)}</span>
                  </div>
                  {!ownerInvite.accepted_at && !ownerInvite.revoked_at ? (
                    <button className="link-button" type="submit">Revoke</button>
                  ) : (
                    <span className="muted">No action</span>
                  )}
                </form>
              ))
            ) : (
              <p className="muted">No owner invites have been created yet.</p>
            )}
          </div>
        </section>

        <section className="data-panel full-width" id="terminology">
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
          <ConfigPanel title="Services" count={enabledServices} id="services">
            {detail.services.map((service, index) => (
              <form className="admin-inline-form" action={updateAdminService} key={service.id}>
                <input type="hidden" name="businessId" value={workspace.id} />
                <input type="hidden" name="serviceId" value={service.id} />
                <input name="label" defaultValue={service.label} />
                <label><input name="enabled" type="checkbox" defaultChecked={service.enabled} /> Enabled</label>
                <AdminMoveButtons businessId={workspace.id} configType="services" disabledDown={index === detail.services.length - 1} disabledUp={index === 0} itemId={service.id} />
                <button className="link-button" type="submit">Save</button>
              </form>
            ))}
            <form className="admin-inline-form" action={createAdminService}>
              <input type="hidden" name="businessId" value={workspace.id} />
              <input name="label" placeholder="New service label" required />
              <input name="key" placeholder="service_key" />
              <span />
              <button className="link-button" type="submit">Add</button>
            </form>
          </ConfigPanel>

          <ConfigPanel title="Pipeline" count={enabledPipeline} id="pipeline">
            {detail.pipeline.map((stage, index) => (
              <form className="admin-inline-form" action={updateAdminPipeline} key={stage.id}>
                <input type="hidden" name="businessId" value={workspace.id} />
                <input type="hidden" name="statusId" value={stage.id} />
                <input type="hidden" name="semanticType" value={stage.semantic_type} />
                <input name="label" defaultValue={stage.label} />
                <span>{statusLabels[stage.semantic_type]}</span>
                <label><input name="enabled" type="checkbox" defaultChecked={stage.enabled} disabled={stage.semantic_type === "lead" || stage.semantic_type === "completed" || stage.semantic_type === "lost"} /> Enabled</label>
                <AdminMoveButtons businessId={workspace.id} configType="pipeline" disabledDown={index === detail.pipeline.length - 1} disabledUp={index === 0} itemId={stage.id} />
                <button className="link-button" type="submit">Save</button>
              </form>
            ))}
          </ConfigPanel>
        </section>

        <section className="admin-detail-grid">
          <ConfigPanel title="Dashboard widgets" count={enabledWidgets} id="dashboard">
            {detail.dashboard_widgets.map((widget, index) => (
              <form className="admin-inline-form" action={updateAdminDashboardWidget} key={widget.id}>
                <input type="hidden" name="businessId" value={workspace.id} />
                <input type="hidden" name="widgetId" value={widget.id} />
                <input type="hidden" name="widgetKey" value={widget.widget_key} />
                <span>{dashboardWidgetRegistry[widget.widget_key].defaultLabel}</span>
                <input name="labelOverride" defaultValue={widget.label_override ?? ""} placeholder="Optional label" />
                <label><input name="enabled" type="checkbox" defaultChecked={widget.enabled} /> Visible</label>
                <AdminMoveButtons businessId={workspace.id} configType="dashboard" disabledDown={index === detail.dashboard_widgets.length - 1} disabledUp={index === 0} itemId={widget.id} />
                <button className="link-button" type="submit">Save</button>
              </form>
            ))}
          </ConfigPanel>

          <section className="data-panel" id="public-intake">
            <div className="panel-heading compact">
              <h2>Public Intake</h2>
              <p className="muted">Customer-facing headline and availability for this workspace.</p>
            </div>
            <form className="settings-form" action={updateAdminIntakeSettings}>
              <input type="hidden" name="businessId" value={workspace.id} />
              <label className="toggle-row">
                <input name="intakeEnabled" type="checkbox" defaultChecked={workspace.intake_form_enabled} />
                <span>Public intake enabled</span>
              </label>
              <div className="field">
                <label htmlFor="admin-intake-title">Form headline</label>
                <input id="admin-intake-title" name="intakeTitle" defaultValue={workspace.intake_form_title} maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor="admin-intake-description">Short description</label>
                <textarea id="admin-intake-description" name="intakeDescription" defaultValue={workspace.intake_form_description} maxLength={280} />
              </div>
              <button className="button" type="submit">Save public intake</button>
            </form>
          </section>
        </section>

        <section className="admin-detail-grid">
          <section className="data-panel" id="follow-up-automation">
            <div className="panel-heading compact">
              <h2>Follow-Up Automation</h2>
              <p className="muted">Reminder timing used by Needs Attention.</p>
            </div>
            <form className="settings-form" action={updateAdminFollowupSettings}>
              <input type="hidden" name="businessId" value={workspace.id} />
              <label className="toggle-row">
                <input name="remindersEnabled" type="checkbox" defaultChecked={followup.reminders_enabled} />
                <span>Needs Attention reminders enabled</span>
              </label>
              <div className="split-fields">
                <div className="field">
                  <label htmlFor="admin-new-lead-hours">New lead reminder after hours</label>
                  <input id="admin-new-lead-hours" name="newLeadFollowupHours" type="number" min="1" max="720" defaultValue={followup.new_lead_followup_hours} required />
                </div>
                <div className="field">
                  <label htmlFor="admin-contacted-days">Contacted follow-up after days</label>
                  <input id="admin-contacted-days" name="contactedFollowupDays" type="number" min="1" max="365" defaultValue={followup.contacted_followup_days} required />
                </div>
              </div>
              <div className="split-fields">
                <div className="field">
                  <label htmlFor="admin-proposal-days">{terms.quote_singular} follow-up after days</label>
                  <input id="admin-proposal-days" name="proposalFollowupDays" type="number" min="1" max="365" defaultValue={followup.proposal_followup_days} required />
                </div>
                <div className="field">
                  <label htmlFor="admin-stale-days">Stale opportunity after days</label>
                  <input id="admin-stale-days" name="staleOpportunityDays" type="number" min="1" max="365" defaultValue={followup.stale_opportunity_days} required />
                </div>
              </div>
              <button className="button" type="submit">Save follow-up automation</button>
            </form>
          </section>

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

function ConfigPanel({ children, count, id, title }: { children: React.ReactNode; count: number; id: string; title: string }) {
  return (
    <section className="data-panel" id={id}>
      <div className="panel-heading compact">
        <h2>{title}</h2>
        <span className="panel-count">{count} active</span>
      </div>
      <div className="admin-config-stack">{children}</div>
    </section>
  );
}

function AdminMoveButtons({
  configType,
  disabledDown,
  disabledUp,
  itemId,
}: {
  businessId: string;
  configType: "dashboard" | "pipeline" | "services";
  disabledDown: boolean;
  disabledUp: boolean;
  itemId: string;
}) {
  return (
    <span className="admin-move-actions">
      <input type="hidden" name="configType" value={configType} />
      <input type="hidden" name="itemId" value={itemId} />
      <button className="icon-button" disabled={disabledUp} formAction={moveAdminConfigItem} name="direction" title="Move up" type="submit" value="up">↑</button>
      <button className="icon-button" disabled={disabledDown} formAction={moveAdminConfigItem} name="direction" title="Move down" type="submit" value="down">↓</button>
    </span>
  );
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function inviteStatus(invite: { accepted_at: string | null; expires_at: string; revoked_at: string | null }) {
  if (invite.accepted_at) return "Accepted";
  if (invite.revoked_at) return "Revoked";
  if (new Date(invite.expires_at).getTime() <= Date.now()) return "Expired";
  return "Pending";
}
