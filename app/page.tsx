import { login, signUp } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const params = await searchParams;

  if (hasSupabaseConfig()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();

    if (data?.claims) {
      redirect("/dashboard");
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro" aria-label="Product overview">
        <div className="brand-mark">JT</div>
        <p className="eyebrow">Job Tracker</p>
        <h1>Run service jobs from quote to completion.</h1>
        <p>
          A focused workspace for small crews to track upcoming work, active installs,
          customer jobs, and day-to-day progress.
        </p>
        <div className="auth-metrics" aria-label="Product highlights">
          <div>
            <strong>4</strong>
            <span>job stages</span>
          </div>
          <div>
            <strong>1</strong>
            <span>crew workspace</span>
          </div>
        </div>
      </section>

      <section className="panel auth-panel">
        <div className="auth-panel-header">
          <p className="eyebrow">Welcome back</p>
          <h2>Sign in</h2>
          <p className="muted">Use your confirmed Supabase account to open the dashboard.</p>
        </div>

        <form className="form" action={login}>
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input id="login-email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              minLength={6}
              required
            />
          </div>
          <button className="button" type="submit">
            Log in
          </button>
        </form>

        <div className="form-divider">
          <span>Create a workspace account</span>
        </div>

        <form className="form" action={signUp}>
          <div className="field">
            <label htmlFor="signup-email">New account email</label>
            <input id="signup-email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="signup-password">New account password</label>
            <input
              id="signup-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          <button className="button button-secondary" type="submit">
            Sign up
          </button>
        </form>

        {!hasSupabaseConfig() ? (
          <p className="message">Add your Supabase values to .env.local before testing auth.</p>
        ) : null}
        {params.message ? <p className="message">{params.message}</p> : null}
      </section>
    </main>
  );
}
