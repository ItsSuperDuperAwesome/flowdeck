"use client";

import { lowerTerm, normalizeTerminology, type Terminology } from "@/lib/job-tracker/config";
import type { IntakeField } from "@/lib/job-tracker/types";
import { useMemo, useState } from "react";

type IntakeFormProps = {
  businessName: string;
  businessSlug: string;
  customFields: IntakeField[];
  description: string;
  serviceTypes: Array<{ key: string; label: string }>;
  terminology?: Terminology;
  title: string;
};

const budgetRanges = ["Not sure yet", "Under $2,500", "$2,500 - $5,000", "$5,000 - $10,000", "$10,000+"];
const maxPhotoCount = 5;
const maxPhotoSize = 10 * 1024 * 1024;
const allowedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function IntakeForm({ businessName, businessSlug, customFields, description, serviceTypes, terminology = normalizeTerminology(), title }: IntakeFormProps) {
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [photoNames, setPhotoNames] = useState<string[]>([]);
  const dedupeKey = useMemo(() => crypto.randomUUID(), []);

  async function submit(formData: FormData) {
    setError("");
    setSuccess("");
    setIsSubmitting(true);
    formData.set("dedupeKey", dedupeKey);

    try {
      const photos = formData.getAll("photos").filter((value): value is File => value instanceof File && value.size > 0);
      const photoError = validatePhotos(photos);

      if (photoError) {
        setError(photoError);
        return;
      }

      const response = await fetch(`/api/public/intake/${businessSlug}`, {
        body: formData,
        method: "POST",
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        setError(result.message ?? "We could not send that request. Please try again.");
        return;
      }

      setSuccess(result.message ?? "Your request was received.");
    } catch {
      setError("We could not send that request. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (success) {
    const hasUploadWarning = success.toLowerCase().includes("photo");

    return (
      <section className="public-form-card success-card">
        <p className="eyebrow">{businessName}</p>
        <h1>{hasUploadWarning ? "Request received, but photos need attention." : "Thanks — your request was received."}</h1>
        <p>{success}</p>
        <p>{businessName} will review your details and get back to you.</p>
      </section>
    );
  }

  return (
    <section className="public-form-card">
      <div className="public-form-heading">
        <p className="eyebrow">{businessName}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>

      <form action={submit} className="public-intake-form">
        <input aria-hidden="true" autoComplete="off" className="honeypot" name="companyWebsite" tabIndex={-1} />
        <div className="field">
          <label htmlFor="fullName">Full name</label>
          <input id="fullName" name="fullName" placeholder="Sarah Mitchell" required />
        </div>
        <div className="split-fields">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" placeholder="sarah@example.com" type="email" />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone</label>
            <input id="phone" name="phone" placeholder="(214) 555-0102" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="serviceType">Service / {lowerTerm(terminology.job_singular)} type</label>
          <select id="serviceType" name="serviceType" required>
            <option value="">Select one</option>
            {serviceTypes.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="projectDescription">{terminology.job_singular} description</label>
          <textarea id="projectDescription" name="projectDescription" placeholder="Tell us about the scope, timeline, current condition, and anything important." required />
        </div>
        <div className="field">
          <label htmlFor="streetAddress">Street address</label>
          <input id="streetAddress" name="streetAddress" placeholder="1200 Maple Street" />
        </div>
        <div className="three-fields">
          <div className="field">
            <label htmlFor="city">City</label>
            <input id="city" name="city" placeholder="Austin" />
          </div>
          <div className="field">
            <label htmlFor="state">State</label>
            <input id="state" name="state" placeholder="TX" />
          </div>
          <div className="field">
            <label htmlFor="postalCode">Postal code</label>
            <input id="postalCode" name="postalCode" placeholder="78701" />
          </div>
        </div>
        <div className="split-fields">
          <div className="field">
            <label htmlFor="preferredDate">Preferred {lowerTerm(terminology.job_singular)} date</label>
            <input id="preferredDate" name="preferredDate" type="date" />
          </div>
          <div className="field">
            <label htmlFor="squareFeet">Estimated square footage</label>
            <input id="squareFeet" inputMode="numeric" name="squareFeet" placeholder="500" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="budgetRange">Budget range</label>
          <select id="budgetRange" name="budgetRange">
            {budgetRanges.map((range) => (
              <option key={range} value={range}>
                {range}
              </option>
            ))}
          </select>
        </div>
        {customFields.length ? (
          <div className="custom-intake-fields">
            {customFields.map((field) => (
              <CustomIntakeField field={field} key={field.id} />
            ))}
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="photos">{terminology.job_singular} photos</label>
          <input
            accept="image/jpeg,image/png,image/webp,image/gif"
            id="photos"
            multiple
            name="photos"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              setPhotoNames(files.map((file) => file.name));
              setError(validatePhotos(files) ?? "");
            }}
            type="file"
          />
          <p className="field-hint">Optional. Up to 5 images, 10 MB each.</p>
          {photoNames.length ? (
            <ul className="selected-photo-list" aria-label="Selected photos">
              {photoNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          ) : null}
        </div>

        {error ? <p className="message error-message">{error}</p> : null}

        <button className="button" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Sending..." : "Send request"}
        </button>
      </form>
    </section>
  );
}

function validatePhotos(files: File[]) {
  if (files.length > maxPhotoCount) {
    return `Please upload ${maxPhotoCount} photos or fewer.`;
  }

  for (const file of files) {
    if (!allowedPhotoTypes.has(file.type)) {
      return "Photos must be JPG, PNG, WebP, or GIF images.";
    }

    if (file.size > maxPhotoSize) {
      return "Each photo must be 10 MB or smaller.";
    }
  }

  return null;
}

function CustomIntakeField({ field }: { field: IntakeField }) {
  const inputId = `custom-${field.field_key}`;
  const name = `custom_${field.field_key}`;
  const requiredText = field.required ? "Required" : "Optional";

  if (field.field_type === "long_text") {
    return (
      <div className="field">
        <label htmlFor={inputId}>
          {field.label} <span>{requiredText}</span>
        </label>
        <textarea id={inputId} maxLength={1000} name={name} required={field.required} />
      </div>
    );
  }

  if (field.field_type === "select") {
    return (
      <div className="field">
        <label htmlFor={inputId}>
          {field.label} <span>{requiredText}</span>
        </label>
        <select id={inputId} name={name} required={field.required}>
          <option value="">Select one</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.field_type === "checkbox") {
    return (
      <label className="public-checkbox-field" htmlFor={inputId}>
        <input id={inputId} name={name} required={field.required} type="checkbox" value="true" />
        <span>
          <strong>{field.label}</strong>
          <em>{requiredText}</em>
        </span>
      </label>
    );
  }

  return (
    <div className="field">
      <label htmlFor={inputId}>
        {field.label} <span>{requiredText}</span>
      </label>
      <input
        id={inputId}
        inputMode={field.field_type === "number" ? "decimal" : undefined}
        maxLength={field.field_type === "short_text" ? 240 : undefined}
        name={name}
        required={field.required}
        type={field.field_type === "date" ? "date" : field.field_type === "number" ? "number" : "text"}
      />
    </div>
  );
}
