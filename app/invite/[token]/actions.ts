"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function message(value: string) {
  return encodeURIComponent(value);
}

export async function acceptBusinessInvite(formData: FormData) {
  const token = clean(formData.get("token"));

  if (!token) {
    redirect("/");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_business_invite", {
    invite_token: token,
  });
  const result = data as { ok?: boolean; message?: string } | null;

  if (error || !result?.ok) {
    redirect(`/invite/${encodeURIComponent(token)}?message=${message(error?.message ?? result?.message ?? "Could not accept this invite.")}`);
  }

  revalidatePath("/", "layout");
  revalidatePath("/dashboard");
  redirect(`/dashboard?message=${message("Workspace invite accepted. Welcome to FlowDeck.")}`);
}
