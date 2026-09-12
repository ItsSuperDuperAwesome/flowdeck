import { lowerTerm, normalizeTerminology } from "@/lib/job-tracker/config";
import type { BusinessTerminology } from "@/lib/job-tracker/types";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type PhotoPreviewPageProps = {
  params: Promise<{
    fileId: string;
    id: string;
  }>;
  searchParams: Promise<{ adminBusinessId?: string }>;
};

type SupportMode = { businessId: string; businessName: string } | null;

function scopedHref(href: string, supportMode: SupportMode) {
  if (!supportMode || href.startsWith("#") || href.startsWith("tel:") || href.startsWith("mailto:") || href.startsWith("http")) {
    return href;
  }

  const [beforeHash, hash = ""] = href.split("#");
  if (beforeHash.includes("adminBusinessId=")) {
    return href;
  }

  const separator = beforeHash.includes("?") ? "&" : "?";
  const scoped = `${beforeHash}${separator}adminBusinessId=${encodeURIComponent(supportMode.businessId)}`;
  return hash ? `${scoped}#${hash}` : scoped;
}

function SupportModeBanner({ supportMode }: { supportMode: SupportMode }) {
  return supportMode ? (
    <div className="support-mode-banner">
      <strong>Viewing {supportMode.businessName} as FlowDeck Admin</strong>
      <Link href={`/admin/workspaces/${supportMode.businessId}`}>Exit admin view</Link>
    </div>
  ) : null;
}

export default async function PhotoPreviewPage({ params, searchParams }: PhotoPreviewPageProps) {
  const { fileId, id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: photo } = await supabase
    .from("job_files")
    .select("id, job_id, storage_bucket, storage_path, file_name, mime_type, size_bytes, category, source_context, created_at")
    .eq("id", fileId)
    .eq("job_id", id)
    .single();

  if (!photo) {
    notFound();
  }

  const { data: job } = await supabase.from("jobs").select("business_id").eq("id", id).maybeSingle();
  let supportMode: SupportMode = null;

  if (query.adminBusinessId) {
    const { data: isPlatformAdmin } = await supabase.rpc("is_platform_admin");

    if (isPlatformAdmin !== true || query.adminBusinessId !== job?.business_id) {
      notFound();
    }

    const { data: supportBusiness } = await supabase
      .from("businesses")
      .select("id, name")
      .eq("id", query.adminBusinessId)
      .maybeSingle();

    if (!supportBusiness) {
      notFound();
    }

    supportMode = { businessId: supportBusiness.id, businessName: supportBusiness.name };
  }

  const { data: terminologyRow } = job?.business_id
    ? await supabase.from("business_terminology").select("*").eq("business_id", job.business_id).maybeSingle()
    : { data: null };
  const terminology = normalizeTerminology(terminologyRow as BusinessTerminology | null);

  const { data: signed } = await supabase.storage.from(photo.storage_bucket).createSignedUrl(photo.storage_path, 60 * 15);

  return (
    <>
    <SupportModeBanner supportMode={supportMode} />
    <main className="detail-shell photo-preview-page">
      <div className="detail-header">
        <div>
          <Link className="back-link" href={scopedHref(`/jobs/${id}`, supportMode)}>
            Back to {lowerTerm(terminology.job_singular)}
          </Link>
          <p className="eyebrow">Photo</p>
          <h1>{photo.file_name}</h1>
          <p className="muted">
            {photo.mime_type} | {formatBytes(photo.size_bytes)}
          </p>
        </div>
        {signed?.signedUrl ? (
          <a className="button button-secondary" href={signed.signedUrl} target="_blank" rel="noreferrer">
            Open original
          </a>
        ) : null}
      </div>

      <section className="data-panel photo-preview-panel">
        {signed?.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={signed.signedUrl} alt={photo.file_name} />
        ) : (
          <div className="photo-preview-error">Preview unavailable</div>
        )}
      </section>
    </main>
    </>
  );
}

function formatBytes(size: number | null) {
  if (!size) {
    return "Unknown size";
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
