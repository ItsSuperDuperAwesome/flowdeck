"use client";

import { uploadJobPhotos } from "@/app/dashboard/actions";
import type { JobFileCategory } from "@/lib/job-tracker/types";
import { useFormStatus } from "react-dom";

const categoryLabels: Record<Exclude<JobFileCategory, "intake">, string> = {
  before: "Before",
  completed: "Completed",
  damage: "Damage",
  other: "Other",
  prep: "Prep",
  progress: "Progress",
};

export function PhotoUploadForm({ jobId, supportBusinessId }: { jobId: string; supportBusinessId?: string | null }) {
  return (
    <form action={uploadJobPhotos} className="photo-upload-form">
      <input type="hidden" name="jobId" value={jobId} />
      {supportBusinessId ? <input type="hidden" name="adminBusinessId" value={supportBusinessId} /> : null}
      <div className="split-fields">
        <label>
          Category
          <select name="category" defaultValue="progress">
            {Object.entries(categoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Photos
          <input accept="image/jpeg,image/png,image/webp,image/gif" multiple name="photos" type="file" required />
        </label>
      </div>
      <p className="field-hint">Upload up to 5 JPG, PNG, WebP, or GIF images. Each photo must be 10 MB or smaller.</p>
      <PhotoSubmitButton />
    </form>
  );
}

function PhotoSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="button button-secondary" disabled={pending} type="submit">
      {pending ? "Uploading..." : "Upload photos"}
    </button>
  );
}
