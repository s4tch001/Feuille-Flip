"use client";

import { useEffect, useRef, useState } from "react";

import { TURNSTILE_ERROR_EVENT, TURNSTILE_READY_EVENT } from "@/components/turnstile-script";

declare global {
  interface Window {
    feuilleTurnstileReady?: boolean;
    feuilleTurnstileToken?: string;
    turnstile?: {
      render: (container: HTMLElement, params: {
        sitekey: string;
        action: string;
        callback: (token: string) => void;
        "error-callback": (code: string) => void;
        "expired-callback": () => void;
      }) => string;
      reset: (widgetId?: string) => void;
    };
    feuilleResetTurnstile?: () => void;
  }
}

function getTurnstileErrorMessage(code: string) {
  if (code === "110100" || code === "110110" || code === "400020") return `Security check failed (${code}): invalid Turnstile site key.`;
  if (code === "110200") return `Security check failed (${code}): this domain is not allowed in the Turnstile widget.`;
  if (code === "400070") return `Security check failed (${code}): this Turnstile site key is disabled.`;
  if (code === "200500") return `Security check failed (${code}): Turnstile iframe could not load. Check browser blockers or network restrictions.`;
  return `Security check failed (${code}). Please try again.`;
}

export function TurnstileGate() {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [message, setMessage] = useState(siteKey ? "Loading security check..." : "Security check is disabled.");

  useEffect(() => {
    if (!siteKey || widgetIdRef.current) return;
    const currentSiteKey = siteKey;
    let cancelled = false;

    function resetGate() {
      window.feuilleTurnstileToken = "";
      setMessage("Complete the security check before your next upload.");
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
    }

    window.feuilleResetTurnstile = resetGate;

    function renderWidget() {
      if (cancelled || widgetIdRef.current || !window.turnstile || !containerRef.current) return;
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: currentSiteKey,
          action: "turnstile-spin-v1",
          callback: (token) => {
            window.feuilleTurnstileToken = token;
            setMessage("Security check complete. You can upload when ready.");
          },
          "error-callback": (code) => {
            window.feuilleTurnstileToken = "";
            setMessage(getTurnstileErrorMessage(code));
          },
          "expired-callback": () => {
            window.feuilleTurnstileToken = "";
            setMessage("Security check expired. Complete it again before your next upload.");
          },
        });
      } catch {
        setMessage("Security check could not render. Refresh the page and try again.");
      }
    }

    function handleScriptError() {
      setMessage("Security check script did not load. Check blockers or network access to challenges.cloudflare.com.");
    }

    if (window.feuilleTurnstileReady) renderWidget();
    window.addEventListener(TURNSTILE_READY_EVENT, renderWidget);
    window.addEventListener(TURNSTILE_ERROR_EVENT, handleScriptError);

    return () => {
      cancelled = true;
      window.removeEventListener(TURNSTILE_READY_EVENT, renderWidget);
      window.removeEventListener(TURNSTILE_ERROR_EVENT, handleScriptError);
      if (window.feuilleResetTurnstile === resetGate) window.feuilleResetTurnstile = undefined;
    };
  }, [siteKey]);

  if (!siteKey) return null;

  return (
    <div className="turnstile-gate" aria-live="polite">
      <div ref={containerRef} />
      <p>{message}</p>
    </div>
  );
}
