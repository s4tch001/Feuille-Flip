"use client";

import Script from "next/script";

const TURNSTILE_READY_EVENT = "feuille:turnstile-ready";

export function TurnstileScript() {
  function notifyReady() {
    window.dispatchEvent(new Event(TURNSTILE_READY_EVENT));
  }

  return (
    <Script
      src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      strategy="afterInteractive"
      onLoad={notifyReady}
      onReady={notifyReady}
    />
  );
}
