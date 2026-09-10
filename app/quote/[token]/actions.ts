"use server";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/env";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type PublicMutationResult = {
  ok?: boolean;
  code?: string;
  status?: string;
};

function message(value: string) {
  return encodeURIComponent(value);
}

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function supabase() {
  const { publishableKey, url } = getSupabaseConfig();
  return createClient(url, publishableKey, {
    auth: { persistSession: false },
  });
}

function resultMessage(result: PublicMutationResult, success: string) {
  if (result.ok) {
    return success;
  }

  return {
    accepted: "This quote has already been accepted.",
    declined: "This quote has already been declined.",
    empty: "Add a message before sending.",
    expired: "This quote is expired and can no longer be accepted.",
    not_found: "That quote link is not available.",
    not_sent: "This quote is not ready for customer response yet.",
  }[result.code ?? ""] ?? "We could not update this quote. Please try again.";
}

export async function acceptPublicQuote(formData: FormData) {
  const token = clean(formData.get("token"));

  if (!token) {
    redirect(`/quote/missing?message=${message("That quote link is not available.")}`);
  }

  const { data, error } = await supabase().rpc("public_accept_quote", {
    quote_token: token,
  });
  const result = (data ?? {}) as PublicMutationResult;

  revalidatePath(`/quote/${token}`);
  redirect(`/quote/${token}?message=${message(error ? "We could not accept this quote. Please try again." : resultMessage(result, "Quote accepted. Thank you."))}`);
}

export async function declinePublicQuote(formData: FormData) {
  const token = clean(formData.get("token"));

  if (!token) {
    redirect(`/quote/missing?message=${message("That quote link is not available.")}`);
  }

  const { data, error } = await supabase().rpc("public_decline_quote", {
    quote_token: token,
  });
  const result = (data ?? {}) as PublicMutationResult;

  revalidatePath(`/quote/${token}`);
  redirect(`/quote/${token}?message=${message(error ? "We could not decline this quote. Please try again." : resultMessage(result, "Quote declined."))}`);
}

export async function sendPublicQuoteMessage(formData: FormData) {
  const token = clean(formData.get("token"));
  const customerMessage = clean(formData.get("customerMessage")).slice(0, 1000);

  if (!token) {
    redirect(`/quote/missing?message=${message("That quote link is not available.")}`);
  }

  if (!customerMessage) {
    redirect(`/quote/${token}?message=${message("Add a message before sending.")}`);
  }

  const { data, error } = await supabase().rpc("public_send_quote_message", {
    customer_message: customerMessage,
    quote_token: token,
  });
  const result = (data ?? {}) as PublicMutationResult;

  revalidatePath(`/quote/${token}`);
  redirect(`/quote/${token}?message=${message(error ? "We could not send that message. Please try again." : resultMessage(result, "Message sent."))}`);
}
