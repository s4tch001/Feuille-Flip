"use client";

import Script from "next/script";

export const TURNSTILE_READY_EVENT = "feuille:turnstile-ready";
export const TURNSTILE_ERROR_EVENT = "feuille:turnstile-error";

declare global {
  interface Window {
    feuilleTurnstileReady?: boolean;
  }
}

export function TurnstileScript() {
  function notifyReady() {
    window.feuilleTurnstileReady = true;
    window.dispatchEvent(new Event(TURNSTILE_READY_EVENT));
  }

  function notifyError() {
    window.feuilleTurnstileReady = false;
    window.dispatchEvent(new Event(TURNSTILE_ERROR_EVENT));
  }

  return (
    <Script
      id="cf-turnstile-script"
      src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      strategy="afterInteractive"
      onLoad={notifyReady}
      onReady={notifyReady}
      onError={notifyError}
    />
  );
}
