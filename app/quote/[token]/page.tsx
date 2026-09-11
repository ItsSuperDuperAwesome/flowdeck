import { createClient } from "@supabase/supabase-js";
import { lowerTerm, normalizeTerminology } from "@/lib/job-tracker/config";
import { acceptPublicQuote, declinePublicQuote, sendPublicQuoteMessage } from "./actions";
import { getSupabaseConfig } from "@/lib/supabase/env";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type PublicQuoteData = {
  ok: boolean;
  business_name?: string;
  job_title?: string;
  quote_amount_cents?: number;
  quote_notes?: string | null;
  quote_status?: "draft" | "sent" | "accepted" | "declined";
  sent_at?: string | null;
  accepted_at?: string | null;
  declined_at?: string | null;
  valid_until?: string | null;
  expired?: boolean;
  messages?: PublicQuoteMessage[];
  terminology?: Record<string, string | null>;
};

type PublicQuoteMessage = {
  source: "customer" | "business";
  message: string;
  created_at: string;
};

const quoteStatusLabels = {
  accepted: "Accepted",
  declined: "Declined",
  draft: "Draft",
  sent: "Sent",
};

function supabase() {
  const { publishableKey, url } = getSupabaseConfig();
  return createClient(url, publishableKey, {
    auth: { persistSession: false },
  });
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function dateLabel(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default async function PublicQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ message?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const { data, error } = await supabase().rpc("get_public_quote", {
    quote_token: token,
  });
  const quote = data as PublicQuoteData | null;

  if (error || !quote?.ok || !quote.quote_status) {
    notFound();
  }

  const isAccepted = quote.quote_status === "accepted";
  const isDeclined = quote.quote_status === "declined";
  const canRespond = quote.quote_status === "sent";
  const canAccept = canRespond && !quote.expired;
  const statusLabel = quoteStatusLabels[quote.quote_status];
  const terminology = normalizeTerminology(quote.terminology);

  return (
    <main className="public-page">
      <div className="public-shell">
        <section className="public-form-card quote-public-card">
          <div className="public-form-heading">
            <p className="eyebrow">{quote.business_name ?? terminology.quote_singular}</p>
            <h1>{quote.job_title ?? `${terminology.job_singular} ${lowerTerm(terminology.quote_singular)}`}</h1>
            <p>Review the {lowerTerm(terminology.quote_singular)} below. You can accept it, decline it, or send a question back to the business.</p>
          </div>

          {query.message ? <p className="form-message">{query.message}</p> : null}

          <div className="public-quote-summary">
            <div>
              <span>{terminology.quote_singular} amount</span>
              <strong>{money(quote.quote_amount_cents ?? 0)}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{statusLabel}</strong>
            </div>
            <div>
              <span>Valid until</span>
              <strong>{dateLabel(quote.valid_until)}</strong>
            </div>
          </div>

          {quote.expired ? <p className="quote-expired">This {lowerTerm(terminology.quote_singular)} is expired. You can still send a question, but it can no longer be accepted.</p> : null}
          {isAccepted ? <p className="quote-accepted">This {lowerTerm(terminology.quote_singular)} was accepted on {dateLabel(quote.accepted_at)}.</p> : null}
          {isDeclined ? <p className="quote-declined">This {lowerTerm(terminology.quote_singular)} was declined on {dateLabel(quote.declined_at)}.</p> : null}

          <section className="public-quote-scope">
            <h2>Scope</h2>
            <p>{quote.quote_notes || "No additional scope notes were added."}</p>
          </section>

          <div className="public-quote-actions">
            <form action={acceptPublicQuote}>
              <input type="hidden" name="token" value={token} />
              <button className="button" disabled={!canAccept} type="submit">
                Accept {terminology.quote_singular}
              </button>
            </form>
            <form action={declinePublicQuote}>
              <input type="hidden" name="token" value={token} />
              <button className="button button-secondary" disabled={!canRespond} type="submit">
                Decline
              </button>
            </form>
          </div>

          <form action={sendPublicQuoteMessage} className="public-quote-message-form">
            <input type="hidden" name="token" value={token} />
            <label>
              Ask a question
              <textarea name="customerMessage" maxLength={1000} placeholder={`Type your question about the ${lowerTerm(terminology.quote_singular)}.`} rows={4} required />
            </label>
            <button className="button button-secondary" type="submit">
              Send Message
            </button>
          </form>

          {quote.messages?.length ? (
            <section className="public-quote-thread">
              <h2>Conversation</h2>
              {quote.messages.map((quoteMessage, index) => (
                <article className={`public-quote-message public-quote-message-${quoteMessage.source}`} key={`${quoteMessage.created_at}-${index}`}>
                  <span>{quoteMessage.source === "business" ? quote.business_name ?? "Business" : "You"} · {dateLabel(quoteMessage.created_at)}</span>
                  <p>{quoteMessage.message}</p>
                </article>
              ))}
            </section>
          ) : null}
        </section>
        <footer>
          <Link href="/">Job Tracker</Link>
        </footer>
      </div>
    </main>
  );
}
