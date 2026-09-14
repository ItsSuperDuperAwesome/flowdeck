import { login, signUp } from "@/app/auth/actions";
import { acceptBusinessInvite } from "@/app/invite/[token]/actions";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type InviteDetail = {
  accepted_at?: string | null;
  business_name?: string;
  email?: string;
  expires_at?: string;
  ok?: boolean;
  role?: string;
  status?: "accepted" | "expired" | "pending" | "revoked";
};

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ message?: string }>;
}) {
  const { token } = await params;
  const { message } = await searchParams;

  if (!hasSupabaseConfig()) {
    redirect("/");
  }

  const supabase = await createClient();
  const [{ data: inviteData }, { data: auth }] = await Promise.all([
    supabase.rpc("get_business_invite", { invite_token: token }),
    supabase.auth.getClaims(),
  ]);
  const invite = inviteData as InviteDetail | null;
  const userEmail = String(auth?.claims?.email ?? "").toLowerCase();
  const isSignedIn = Boolean(auth?.claims);
  const isMatchingUser = Boolean(userEmail && invite?.email && userEmail === invite.email);
  const next = `/invite/${encodeURIComponent(token)}`;

  return (
    <main className="auth-page invite-page">
      <section className="auth-intro" aria-label="Workspace invite">
        <div className="brand-mark">FD</div>
        <p className="eyebrow">FlowDeck Invite</p>
        <h1>{invite?.business_name ? `Join ${invite.business_name}` : "Workspace invite"}</h1>
        <p>
          Accept this secure invitation to become the owner of the workspace prepared for
          your business.
        </p>
      </section>

      <section className="panel auth-panel">
        <div className="auth-panel-header">
          <p className="eyebrow">Owner handoff</p>
          <h2>{inviteTitle(invite)}</h2>
          <p className="muted">{inviteDescription(invite)}</p>
        </div>

        {message ? <p className="message">{message}</p> : null}

        {invite?.ok ? (
          <div className="invite-summary">
            <span>Workspace <strong>{invite.business_name}</strong></span>
            <span>Invited email <strong>{invite.email}</strong></span>
            <span>Role <strong>{invite.role}</strong></span>
            <span>Status <strong>{invite.status}</strong></span>
            {invite.expires_at ? <span>Expires <strong>{dateLabel(invite.expires_at)}</strong></span> : null}
          </div>
        ) : null}

        {!invite?.ok ? (
          <p className="message">This invite link is invalid.</p>
        ) : invite.status !== "pending" ? (
          <p className="message">{closedInviteMessage(invite.status)}</p>
        ) : !isSignedIn ? (
          <div className="invite-auth-grid">
            <form className="form" action={login}>
              <input type="hidden" name="next" value={next} />
              <div className="field">
                <label htmlFor="invite-login-email">Email</label>
                <input id="invite-login-email" name="email" type="email" defaultValue={invite.email ?? ""} autoComplete="email" required />
              </div>
              <div className="field">
                <label htmlFor="invite-login-password">Password</label>
                <input id="invite-login-password" name="password" type="password" autoComplete="current-password" minLength={6} required />
              </div>
              <button className="button" type="submit">Sign in to accept</button>
            </form>

            <div className="form-divider">
              <span>New to FlowDeck?</span>
            </div>

            <form className="form" action={signUp}>
              <input type="hidden" name="next" value={next} />
              <div className="field">
                <label htmlFor="invite-signup-email">Email</label>
                <input id="invite-signup-email" name="email" type="email" defaultValue={invite.email ?? ""} autoComplete="email" required />
              </div>
              <div className="field">
                <label htmlFor="invite-signup-password">Password</label>
                <input id="invite-signup-password" name="password" type="password" autoComplete="new-password" minLength={6} required />
              </div>
              <button className="button button-secondary" type="submit">Create account</button>
            </form>
          </div>
        ) : !isMatchingUser ? (
          <p className="message">
            This invite is for {invite.email}. You are signed in as {userEmail}. Log out and sign
            in with the invited email to accept it.
          </p>
        ) : (
          <form className="form" action={acceptBusinessInvite}>
            <input type="hidden" name="token" value={token} />
            <button className="button" type="submit">Accept invite</button>
          </form>
        )}
      </section>
    </main>
  );
}

function inviteTitle(invite: InviteDetail | null) {
  if (!invite?.ok) return "Invite unavailable";
  if (invite.status === "pending") return "Accept your workspace invite";
  return "Invite cannot be accepted";
}

function inviteDescription(invite: InviteDetail | null) {
  if (!invite?.ok) return "The invite may have been mistyped or regenerated.";
  if (invite.status === "pending") return "Sign in or create an account with the invited email address.";
  return closedInviteMessage(invite.status);
}

function closedInviteMessage(status?: string) {
  if (status === "accepted") return "This invite has already been accepted.";
  if (status === "expired") return "This invite has expired. Ask the FlowDeck admin for a new link.";
  if (status === "revoked") return "This invite has been revoked.";
  return "This invite is not available.";
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
