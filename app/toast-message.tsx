"use client";

import { useEffect, useState } from "react";

type ToastMessageProps = {
  message: string;
};

export function ToastMessage({ message }: ToastMessageProps) {
  const [visible, setVisible] = useState(Boolean(message));

  useEffect(() => {
    if (!message) return;

    const url = new URL(window.location.href);
    if (url.searchParams.has("message")) {
      url.searchParams.delete("message");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }

    const timeout = window.setTimeout(() => setVisible(false), 4200);
    return () => window.clearTimeout(timeout);
  }, [message]);

  if (!visible) return null;

  return (
    <div className="toast-region" aria-live="polite" aria-atomic="true">
      <div className="toast-card" role="status">
        <span className="toast-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="M13.3 4.7 6.8 11.2 3.4 7.8" />
          </svg>
        </span>
        <span>{message}</span>
        <button className="toast-close" type="button" onClick={() => setVisible(false)} aria-label="Dismiss notification">
          x
        </button>
      </div>
    </div>
  );
}
