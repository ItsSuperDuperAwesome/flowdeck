import { createClient } from "@supabase/supabase-js";
import { defaultServiceTypes, normalizeTerminology } from "@/lib/job-tracker/config";
import { getSupabaseConfig } from "@/lib/supabase/env";
import type { IntakeField } from "@/lib/job-tracker/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IntakeForm } from "./intake-form";

export const dynamic = "force-dynamic";

type IntakeFormData = {
  ok: boolean;
  business_name?: string;
  title?: string;
  description?: string;
  fields?: IntakeField[];
  service_types?: Array<{ key: string; label: string; sort_order: number }>;
  terminology?: Record<string, string | null>;
};

function supabase() {
  const { publishableKey, url } = getSupabaseConfig();
  return createClient(url, publishableKey, {
    auth: { persistSession: false },
  });
}

function customerFacingCopy(value: string | undefined, fallback: string) {
  const copy = String(value ?? "").trim();

  if (!copy || /\b(flowdeck|workspace|saas|dashboard|job tracker)\b/i.test(copy)) {
    return fallback;
  }

  return copy;
}

function displayBusinessName(value: string | undefined) {
  const name = String(value ?? "This business").trim() || "This business";
  return name.toLowerCase() === "flowdeck" ? "FlowDeck" : name;
}

export default async function PublicIntakePage({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { data, error } = await supabase().rpc("get_public_intake_form", {
    business_slug: businessSlug,
  });

  const form = data as IntakeFormData | null;

  if (error || !form?.ok) {
    notFound();
  }

  return (
    <main className="public-page">
      <div className="public-shell">
        <IntakeForm
          businessName={displayBusinessName(form.business_name)}
          businessSlug={businessSlug}
          customFields={(form.fields ?? []).map((field) => ({
            ...field,
            options: Array.isArray(field.options) ? field.options : [],
          }))}
          description={customerFacingCopy(form.description, "Tell us what you need and we will follow up with next steps.")}
          serviceTypes={form.service_types?.length ? form.service_types : defaultServiceTypes}
          terminology={normalizeTerminology(form.terminology)}
          title={customerFacingCopy(form.title, `Request service from ${displayBusinessName(form.business_name)}`)}
        />
        <footer>
          <span>{displayBusinessName(form.business_name)}</span>
          <Link href="/">Powered by FlowDeck</Link>
        </footer>
      </div>
    </main>
  );
}
