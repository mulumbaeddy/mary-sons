// Creates the single Supabase client. Keys come from config.js (anon key only!).
const cfg = window.APP_CONFIG || {};

export const isConfigured = Boolean(
  cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
  !cfg.SUPABASE_URL.includes('YOUR_') && !cfg.SUPABASE_ANON_KEY.includes('YOUR_') &&
  window.supabase
);

export const supabase = isConfigured
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
