"use server";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

function encodedMessage(message: string) {
  return encodeURIComponent(message);
}

function safeNext(value: FormDataEntryValue | null) {
  const next = String(value ?? "").trim();
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("://")) {
    return "/dashboard";
  }

  return next;
}

function authMessage(error: { code?: string; message: string }) {
  if (error.code === "over_email_send_rate_limit") {
    return "Supabase hit its built-in email limit. Wait for the cooldown, add custom SMTP, or create a confirmed test user in Supabase Auth.";
  }

  if (error.code === "email_not_confirmed") {
    return "That user exists, but the email is not confirmed yet. Confirm it from the email link or create a confirmed test user in Supabase Auth.";
  }

  return error.message;
}

export async function login(formData: FormData) {
  if (!hasSupabaseConfig()) {
    redirect(`/?message=${encodedMessage("Add your Supabase URL and publishable key to .env.local first.")}`);
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(`/?message=${encodedMessage(authMessage(error))}`);
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signUp(formData: FormData) {
  if (!hasSupabaseConfig()) {
    redirect(`/?message=${encodedMessage("Add your Supabase URL and publishable key to .env.local first.")}`);
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host");
  const protocol = headersList.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${protocol}://${host}` : "http://localhost:3000";
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    redirect(`/?message=${encodedMessage(authMessage(error))}`);
  }

  revalidatePath("/", "layout");

  if (data.session) {
    redirect(next);
  }

  redirect(
    `/?message=${encodedMessage("Check your email to confirm your account, then log in.")}`,
  );
}

export async function logout() {
  const supabase = await createClient();

  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
