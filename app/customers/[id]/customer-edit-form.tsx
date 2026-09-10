"use client";

import { useEffect, useState } from "react";

type CustomerEditFormProps = {
  addressLine1: string;
  city: string;
  contactCodeSeed: string;
  name: string;
  notes: string;
  state: string;
};

export function CustomerEditFields({ addressLine1, city, contactCodeSeed, name, notes, state }: CustomerEditFormProps) {
  const [phoneCodes, emailCodes] = JSON.parse(contactCodeSeed) as [number[], number[]];
  const contactPhone = String.fromCharCode(...phoneCodes);
  const contactEmail = String.fromCharCode(...emailCodes);
  const [fields, setFields] = useState(() => {
    const contactLine =
      typeof document === "undefined" || contactPhone || contactEmail
        ? ""
        : document.querySelector(".detail-header .muted")?.textContent ?? "";
    const [headerPhone, headerEmail] = contactLine.split(" | ");

    return {
      addressLine1,
      city,
      email: contactEmail || headerEmail || "",
      name,
      notes,
      phone: contactPhone || headerPhone || "",
      state,
    };
  });

  useEffect(() => {
    const phoneInput = document.querySelector<HTMLInputElement>('input[name="customerPhone"]');
    const emailInput = document.querySelector<HTMLInputElement>('input[name="customerEmail"]');

    if (!phoneInput || !emailInput || phoneInput.value || emailInput.value) {
      return;
    }

    const contactLine = document.querySelector(".detail-header .muted")?.textContent ?? "";
    const [headerPhone, headerEmail] = contactLine.split(" | ");

    phoneInput.value = headerPhone ?? "";
    emailInput.value = headerEmail ?? "";
  }, []);

  function updateField(field: keyof typeof fields, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
  }

  return (
    <>
      <div className="field">
        <label htmlFor="name">Customer name</label>
        <input id="name" name="name" onChange={(event) => updateField("name", event.target.value)} placeholder="Sarah Mitchell" required value={fields.name} />
      </div>
      <div className="split-fields">
        <div className="field">
          <label htmlFor="customerPhone">Phone</label>
          <input id="customerPhone" name="customerPhone" onChange={(event) => updateField("phone", event.target.value)} placeholder="(555) 123-0123" value={fields.phone} />
        </div>
        <div className="field">
          <label htmlFor="customerEmail">Email</label>
          <input id="customerEmail" name="customerEmail" onChange={(event) => updateField("email", event.target.value)} placeholder="customer@example.com" type="email" value={fields.email} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="addressLine1">Address line 1</label>
        <input id="addressLine1" name="addressLine1" onChange={(event) => updateField("addressLine1", event.target.value)} placeholder="1200 Maple Street" value={fields.addressLine1} />
      </div>
      <div className="split-fields">
        <div className="field">
          <label htmlFor="city">City</label>
          <input id="city" name="city" onChange={(event) => updateField("city", event.target.value)} placeholder="Austin" value={fields.city} />
        </div>
        <div className="field two-col">
          <label htmlFor="state">State</label>
          <input id="state" name="state" onChange={(event) => updateField("state", event.target.value)} placeholder="TX" value={fields.state} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" onChange={(event) => updateField("notes", event.target.value)} placeholder="Gate codes, decision makers, or special preferences" value={fields.notes} />
      </div>
    </>
  );
}
