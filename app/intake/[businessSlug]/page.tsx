import { createClient } from "@supabase/supabase-js";
import { defaultServiceTypes } from "@/lib/job-tracker/config";
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
};

function supabase() {
  const { publishableKey, url } = getSupabaseConfig();
  return createClient(url, publishableKey, {
    auth: { persistSession: false },
  });
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
          businessName={form.business_name ?? "This business"}
          businessSlug={businessSlug}
          customFields={(form.fields ?? []).map((field) => ({
            ...field,
            options: Array.isArray(field.options) ? field.options : [],
          }))}
          description={form.description ?? "Share a few details and we will follow up with next steps."}
          serviceTypes={(form.service_types?.length ? form.service_types : defaultServiceTypes).map((service) => service.label)}
          title={form.title ?? "Tell us about your project"}
        />
        <footer>
          <Link href="/">Job Tracker</Link>
        </footer>
      </div>
    </main>
  );
}
