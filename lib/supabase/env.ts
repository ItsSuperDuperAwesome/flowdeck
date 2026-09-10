export function getSupabaseConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  };
}

export function hasSupabaseConfig() {
  const { url, publishableKey } = getSupabaseConfig();
  return Boolean(url && publishableKey);
}
