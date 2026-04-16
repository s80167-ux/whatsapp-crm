import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;
const configuredPublicAppUrl = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
const fallbackPublicAppUrl = "https://rezekicrm.vercel.app";

if (!supabaseUrl || !supabasePublishableKey) {
  console.warn("Missing Supabase frontend environment variables.");
}

export const supabase = createClient(
  supabaseUrl || "https://kavumbilqekhzkzzxnhc.supabase.co",
  supabasePublishableKey || "missing-publishable-key"
);

function normalizeUrl(url: string | undefined) {
  if (!url) {
    return undefined;
  }

  const trimmedUrl = url.trim();

  if (!trimmedUrl) {
    return undefined;
  }

  return trimmedUrl.replace(/\/+$/, "");
}

function isLocalhostOrigin(origin: string) {
  try {
    const parsedUrl = new URL(origin);
    return ["localhost", "127.0.0.1"].includes(parsedUrl.hostname);
  } catch {
    return false;
  }
}

function getAuthRedirectBaseUrl() {
  if (typeof window === "undefined") {
    return normalizeUrl(configuredPublicAppUrl) || fallbackPublicAppUrl;
  }

  const currentUrl = `${window.location.origin}${window.location.pathname}`;
  const publicAppUrl = normalizeUrl(configuredPublicAppUrl) || fallbackPublicAppUrl;

  if (isLocalhostOrigin(window.location.origin)) {
    return publicAppUrl;
  }

  return currentUrl;
}

export function getPasswordRecoveryRedirectUrl() {
  const baseUrl = getAuthRedirectBaseUrl();
  return baseUrl ? `${baseUrl}?type=recovery` : undefined;
}

export function getEmailVerificationRedirectUrl() {
  return getAuthRedirectBaseUrl();
}

export function isPasswordRecoveryCallback() {
  if (typeof window === "undefined") {
    return false;
  }

  const callbackPayload = `${window.location.search}${window.location.hash}`;
  return /(^|[?#&])type=recovery(?:[&#]|$)/.test(callbackPayload);
}

export function clearPasswordRecoveryCallback() {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);

  if (url.searchParams.get("type") === "recovery") {
    url.searchParams.delete("type");
  }

  if (url.hash.includes("type=recovery")) {
    url.hash = "";
  }

  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}
