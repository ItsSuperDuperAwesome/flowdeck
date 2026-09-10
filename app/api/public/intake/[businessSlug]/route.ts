import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/env";
import type { IntakeField, IntakeResponse } from "@/lib/job-tracker/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const rateLimit = new Map<string, { count: number; resetAt: number }>();

type CustomFieldValidation = { customData: Record<string, IntakeResponse> } | { error: string };

function text(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

function isRateLimited(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const key = forwarded || request.headers.get("x-real-ip") || "local";
  const now = Date.now();
  const current = rateLimit.get(key);

  if (!current || current.resetAt < now) {
    rateLimit.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }

  current.count += 1;
  return current.count > 8;
}

function extensionFor(type: string) {
  return {
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  }[type] ?? "img";
}

function displayFileName(name: string) {
  return name
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Project photo";
}

function normalizeFields(value: unknown): IntakeField[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((field): field is IntakeField => {
      if (!field || typeof field !== "object") {
        return false;
      }

      const candidate = field as Partial<IntakeField>;
      return Boolean(candidate.field_key && candidate.label && candidate.field_type);
    })
    .map((field) => ({
      ...field,
      options: Array.isArray(field.options) ? field.options.filter((option) => typeof option === "string").slice(0, 20) : [],
    }));
}

function validateCustomFields(formData: FormData, fields: IntakeField[]): CustomFieldValidation {
  const allowedKeys = new Set(fields.map((field) => field.field_key));

  for (const key of formData.keys()) {
    if (key.startsWith("custom_") && !allowedKeys.has(key.slice("custom_".length))) {
      return { error: "That form field is not available for this workspace." };
    }
  }

  const customData: Record<string, IntakeResponse> = {};

  for (const field of fields) {
    const formName = `custom_${field.field_key}`;
    const rawValue = formData.get(formName);
    const stringValue = typeof rawValue === "string" ? rawValue.trim() : "";

    if (field.field_type === "checkbox") {
      const checked = rawValue === "true" || rawValue === "on";

      if (field.required && !checked) {
        return { error: `Please complete: ${field.label}.` };
      }

      if (checked || field.required) {
        customData[field.field_key] = {
          label: field.label,
          type: field.field_type,
          value: checked,
        };
      }

      continue;
    }

    if (!stringValue) {
      if (field.required) {
        return { error: `Please complete: ${field.label}.` };
      }

      continue;
    }

    if (field.field_type === "short_text") {
      if (stringValue.length > 240) {
        return { error: `${field.label} must be 240 characters or fewer.` };
      }

      customData[field.field_key] = {
        label: field.label,
        type: field.field_type,
        value: stringValue,
      };
      continue;
    }

    if (field.field_type === "long_text") {
      if (stringValue.length > 1000) {
        return { error: `${field.label} must be 1,000 characters or fewer.` };
      }

      customData[field.field_key] = {
        label: field.label,
        type: field.field_type,
        value: stringValue,
      };
      continue;
    }

    if (field.field_type === "number") {
      const numberValue = Number(stringValue);

      if (!Number.isFinite(numberValue) || numberValue < -1_000_000_000 || numberValue > 1_000_000_000) {
        return { error: `Please enter a valid number for ${field.label}.` };
      }

      customData[field.field_key] = {
        label: field.label,
        type: field.field_type,
        value: numberValue,
      };
      continue;
    }

    if (field.field_type === "select") {
      if (!field.options.includes(stringValue)) {
        return { error: `Please choose a valid option for ${field.label}.` };
      }

      customData[field.field_key] = {
        label: field.label,
        type: field.field_type,
        value: stringValue,
      };
      continue;
    }

    if (field.field_type === "date") {
      const date = new Date(`${stringValue}T00:00:00Z`);

      if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue) || Number.isNaN(date.getTime())) {
        return { error: `Please enter a valid date for ${field.label}.` };
      }

      customData[field.field_key] = {
        label: field.label,
        type: field.field_type,
        value: stringValue,
      };
    }
  }

  return { customData };
}

function supabase() {
  const { publishableKey, url } = getSupabaseConfig();
  return createClient(url, publishableKey, {
    auth: { persistSession: false },
  });
}

export async function POST(request: Request, context: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await context.params;

  if (isRateLimited(request)) {
    return errorResponse("Too many submissions. Please wait a minute and try again.", 429);
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return errorResponse("We could not read that submission. Please check the form and try again.");
  }

  if (text(formData.get("companyWebsite"), 200)) {
    return errorResponse("We could not accept that submission.", 400);
  }

  const fullName = text(formData.get("fullName"), 120);
  const contactEmail = text(formData.get("email"), 180).toLowerCase();
  const contactPhone = text(formData.get("phone"), 40);
  const normalizedPhone = normalizePhone(contactPhone);
  const serviceType = text(formData.get("serviceType"), 120);
  const projectDescription = text(formData.get("projectDescription"), 2000);
  const streetAddress = text(formData.get("streetAddress"), 180);
  const city = text(formData.get("city"), 80);
  const state = text(formData.get("state"), 40);
  const postalCode = text(formData.get("postalCode"), 20);
  const preferredDate = text(formData.get("preferredDate"), 20) || null;
  const squareFeetRaw = text(formData.get("squareFeet"), 20);
  const squareFeet = squareFeetRaw ? Number(squareFeetRaw) : null;
  const budgetRange = text(formData.get("budgetRange"), 80);
  const dedupeKey = text(formData.get("dedupeKey"), 120) || crypto.randomUUID();
  const intakeUploadToken = crypto.randomUUID();

  if (!fullName || !serviceType || !projectDescription) {
    return errorResponse("Please add your name, project type, and project details.");
  }

  if (!contactEmail && !normalizedPhone) {
    return errorResponse("Please include either an email address or phone number.");
  }

  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return errorResponse("Please enter a valid email address.");
  }

  if (contactPhone && normalizedPhone.length < 7) {
    return errorResponse("Please enter a valid phone number.");
  }

  if (squareFeet !== null && (!Number.isFinite(squareFeet) || squareFeet < 0 || squareFeet > 1_000_000)) {
    return errorResponse("Please enter a realistic square footage.");
  }

  const client = supabase();
  const { data: formConfig, error: formError } = await client.rpc("get_public_intake_form", {
    business_slug: businessSlug,
  });

  if (formError || !formConfig?.ok) {
    return errorResponse("This intake form is not available.", formConfig?.code === "not_found" ? 404 : 400);
  }

  const customFields = normalizeFields(formConfig.fields);
  const customResult = validateCustomFields(formData, customFields);

  if ("error" in customResult) {
    return errorResponse(customResult.error);
  }

  const photos = formData.getAll("photos").filter((value): value is File => value instanceof File && value.size > 0);

  if (photos.length > MAX_IMAGES) {
    return errorResponse(`Please upload ${MAX_IMAGES} photos or fewer.`);
  }

  for (const photo of photos) {
    if (!IMAGE_TYPES.has(photo.type)) {
      return errorResponse("Photos must be JPG, PNG, WebP, or GIF images.");
    }

    if (photo.size > MAX_IMAGE_SIZE) {
      return errorResponse("Each photo must be 10 MB or smaller.");
    }
  }

  const { data, error } = await client.rpc("submit_public_intake", {
    budget_range: budgetRange || null,
    business_slug: businessSlug,
    city: city || null,
    contact_email: contactEmail || null,
    contact_phone: contactPhone || null,
    dedupe_key: dedupeKey,
    full_name: fullName,
    custom_data: customResult.customData,
    intake_upload_token: intakeUploadToken,
    postal_code: postalCode || null,
    preferred_date: preferredDate,
    project_description: projectDescription,
    service_type: serviceType,
    square_feet: squareFeet,
    state: state || null,
    street_address: streetAddress || null,
  });

  if (error || !data?.ok) {
    return errorResponse("We could not save that request. Please check the form and try again.", data?.code === "not_found" ? 404 : 400);
  }

  const businessId = data.business_id as string | undefined;
  const jobId = data.job_id as string | undefined;
  let uploadWarning = false;

  if (businessId && jobId && photos.length && !data.duplicate) {
    for (const photo of photos) {
      const storagePath = `${businessId}/${jobId}/intake/${intakeUploadToken}/${crypto.randomUUID()}.${extensionFor(photo.type)}`;
      const upload = await client.storage.from("job-files").upload(storagePath, await photo.arrayBuffer(), {
        contentType: photo.type,
        metadata: {
          mimetype: photo.type,
          size: String(photo.size),
        },
        upsert: false,
      });

      if (upload.error) {
        uploadWarning = true;
        continue;
      }

      await client.rpc("record_intake_file", {
        business_id: businessId,
        file_name: displayFileName(photo.name),
        job_id: jobId,
        intake_upload_token: intakeUploadToken,
        mime_type: photo.type,
        size_bytes: photo.size,
        storage_path: storagePath,
      }).then(async (record) => {
        if (record.error) {
          uploadWarning = true;
          await client.storage.from("job-files").remove([storagePath]);
        }
      });
    }
  }

  return NextResponse.json({
    ok: true,
    message: uploadWarning
      ? "Your request was received, but one or more photos could not be uploaded."
      : "Your request was received.",
  });
}
