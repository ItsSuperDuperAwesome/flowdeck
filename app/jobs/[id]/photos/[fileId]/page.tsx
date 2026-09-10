import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type PhotoPreviewPageProps = {
  params: Promise<{
    fileId: string;
    id: string;
  }>;
};

export default async function PhotoPreviewPage({ params }: PhotoPreviewPageProps) {
  const { fileId, id } = await params;
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

  const { data: signed } = await supabase.storage.from(photo.storage_bucket).createSignedUrl(photo.storage_path, 60 * 15);

  return (
    <main className="detail-shell photo-preview-page">
      <div className="detail-header">
        <div>
          <Link className="back-link" href={`/jobs/${id}`}>
            Back to job
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
