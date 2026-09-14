import { createClient } from "@supabase/supabase-js";
import { defaultServiceTypes } from "@/lib/job-tracker/config";
import { getSupabaseConfig } from "@/lib/supabase/env";
import type { IntakeField, IntakeResponse } from "@/lib/job-tracker/types";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_UPLOADS_PER_INTAKE_TOKEN = 10;
const MAX_BODY_SIZE = 58 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type CustomFieldValidation = { customData: Record<string, IntakeResponse> } | { error: string };

function text(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function isTooLong(value: FormDataEntryValue | null, maxLength: number) {
  return typeof value === "string" && value.trim().length > maxLength;
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requestFingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "local";
  const userAgent = request.headers.get("user-agent") || "unknown";
  const language = request.headers.get("accept-language") || "unknown";
  return sha256([ip, userAgent, language].join("|"));
}

function stableDedupeKey(input: {
  budgetRange: string;
  businessSlug: string;
  city: string;
  contactEmail: string;
  normalizedPhone: string;
  postalCode: string;
  preferredDate: string | null;
  projectDescription: string;
  serviceType: string;
  squareFeet: number | null;
  state: string;
  streetAddress: string;
  customData: Record<string, IntakeResponse>;
}) {
  const now = Date.now();
  const windowMs = 30 * 60_000;
  const windowBucket = Math.floor(now / windowMs);
  return sha256(JSON.stringify({
    ...input,
    budgetRange: input.budgetRange.toLowerCase(),
    businessSlug: input.businessSlug.trim().toLowerCase(),
    city: input.city.toLowerCase(),
    contactEmail: input.contactEmail.toLowerCase(),
    postalCode: input.postalCode.toLowerCase(),
    projectDescription: input.projectDescription.toLowerCase().replace(/\s+/g, " "),
    serviceType: input.serviceType.toLowerCase(),
    state: input.state.toLowerCase(),
    streetAddress: input.streetAddress.toLowerCase().replace(/\s+/g, " "),
    windowBucket,
  }));
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
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (contentLength > MAX_BODY_SIZE) {
    return errorResponse("That submission is too large. Please reduce the photos or message length and try again.", 413);
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return errorResponse("We could not read that submission. Please check the form and try again.");
  }

  if (text(formData.get("companyWebsite"), 200)) {
    return NextResponse.json({ ok: true, message: "Your request was received." });
  }

  const startedAt = Number(text(formData.get("intakeStartedAt"), 20));

  if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < 1_500) {
    return errorResponse("We could not submit your request. Please review the form and try again.");
  }

  if (
    isTooLong(formData.get("fullName"), 120) ||
    isTooLong(formData.get("email"), 180) ||
    isTooLong(formData.get("phone"), 40) ||
    isTooLong(formData.get("serviceType"), 120) ||
    isTooLong(formData.get("projectDescription"), 2000) ||
    isTooLong(formData.get("streetAddress"), 180) ||
    isTooLong(formData.get("city"), 80) ||
    isTooLong(formData.get("state"), 40) ||
    isTooLong(formData.get("postalCode"), 20) ||
    isTooLong(formData.get("budgetRange"), 80)
  ) {
    return errorResponse("One of the form fields is too long. Please shorten it and try again.");
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
  const configuredServices = ((formConfig as { service_types?: Array<{ key?: unknown; label?: unknown }> }).service_types ?? [])
    .map((service) => ({
      key: typeof service.key === "string" ? service.key : "",
      label: typeof service.label === "string" ? service.label : "",
    }))
    .filter((service) => service.key && service.label);
  const validServiceTypes = configuredServices.length ? configuredServices : defaultServiceTypes;
  const matchedService = validServiceTypes.find((service) => service.key === serviceType || service.label === serviceType);

  if (!matchedService) {
    return errorResponse("Please choose an available service type.");
  }

  const customResult = validateCustomFields(formData, customFields);

  if ("error" in customResult) {
    return errorResponse(customResult.error);
  }

  const dedupeKey = stableDedupeKey({
    budgetRange,
    businessSlug,
    city,
    contactEmail,
    customData: customResult.customData,
    normalizedPhone,
    postalCode,
    preferredDate,
    projectDescription,
    serviceType: matchedService.key,
    squareFeet,
    state,
    streetAddress,
  });

  const { data: throttle, error: throttleError } = await client.rpc("check_public_intake_throttle", {
    business_slug: businessSlug,
    dedupe_key_hash: dedupeKey,
    request_fingerprint_hash: requestFingerprint(request),
  });

  if (throttleError || !throttle?.ok) {
    return errorResponse(
      throttle?.code === "rate_limited"
        ? "Too many requests. Please wait a moment and try again."
        : "We could not submit your request. Please try again.",
      throttle?.code === "rate_limited" ? 429 : 400,
    );
  }

  const photos = formData.getAll("photos").filter((value): value is File => value instanceof File && value.size > 0);

  if (photos.length > MAX_IMAGES) {
    return errorResponse(`Please upload ${MAX_IMAGES} photos or fewer.`);
  }

  if (photos.length > MAX_UPLOADS_PER_INTAKE_TOKEN) {
    return errorResponse("Please upload fewer photos with this request.");
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
    service_type: matchedService.key,
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
