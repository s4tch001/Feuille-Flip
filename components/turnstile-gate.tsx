"use client";

import { useEffect, useRef, useState } from "react";

import {
  TURNSTILE_CHALLENGE_ERROR_EVENT,
  TURNSTILE_ERROR_EVENT,
  TURNSTILE_READY_EVENT,
  TURNSTILE_TOKEN_EVENT,
} from "@/components/turnstile-script";

declare global {
  interface Window {
    feuilleTurnstileReady?: boolean;
    feuilleTurnstileToken?: string;
    feuilleTurnstileError?: string;
    turnstile?: {
      render: (container: HTMLElement, params: {
        sitekey: string;
        action: string;
        callback: (token: string) => void;
        "error-callback": (code: string) => void;
        "expired-callback": () => void;
      }) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
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
  const tokenRef = useRef("");
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [message, setMessage] = useState(siteKey ? "Loading security check..." : "Security check is disabled.");

  useEffect(() => {
    if (!siteKey || widgetIdRef.current) return;
    const currentSiteKey = siteKey;
    let cancelled = false;

    // Never reuse a token created by a gate from a previous client-side route.
    window.feuilleTurnstileToken = "";
    window.feuilleTurnstileError = "";

    function reportChallengeError(message: string) {
      window.feuilleTurnstileError = message;
      window.dispatchEvent(new CustomEvent(TURNSTILE_CHALLENGE_ERROR_EVENT, { detail: { message } }));
    }

    function resetGate() {
      tokenRef.current = "";
      window.feuilleTurnstileToken = "";
      window.feuilleTurnstileError = "";
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
            tokenRef.current = token;
            window.feuilleTurnstileToken = token;
            window.feuilleTurnstileError = "";
            setMessage("Security check complete. You can upload when ready.");
            window.dispatchEvent(new Event(TURNSTILE_TOKEN_EVENT));
          },
          "error-callback": (code) => {
            const errorMessage = getTurnstileErrorMessage(code);
            tokenRef.current = "";
            window.feuilleTurnstileToken = "";
            setMessage(errorMessage);
            reportChallengeError(errorMessage);
          },
          "expired-callback": () => {
            const errorMessage = "Security check expired. Complete it again before your next upload.";
            tokenRef.current = "";
            window.feuilleTurnstileToken = "";
            setMessage(errorMessage);
            reportChallengeError(errorMessage);
          },
        });
      } catch {
        const errorMessage = "Security check could not render. Refresh the page and try again.";
        setMessage(errorMessage);
        reportChallengeError(errorMessage);
      }
    }

    function handleScriptError() {
      const errorMessage = "Security check script did not load. Check blockers or network access to challenges.cloudflare.com.";
      setMessage(errorMessage);
      reportChallengeError(errorMessage);
    }

    if (window.feuilleTurnstileReady) renderWidget();
    window.addEventListener(TURNSTILE_READY_EVENT, renderWidget);
    window.addEventListener(TURNSTILE_ERROR_EVENT, handleScriptError);

    return () => {
      cancelled = true;
      window.removeEventListener(TURNSTILE_READY_EVENT, renderWidget);
      window.removeEventListener(TURNSTILE_ERROR_EVENT, handleScriptError);
      if (window.feuilleResetTurnstile === resetGate) window.feuilleResetTurnstile = undefined;
      if (window.feuilleTurnstileToken === tokenRef.current) window.feuilleTurnstileToken = "";
      if (widgetIdRef.current) {
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
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
