"use client";

import { useState } from "react";

export function QuoteShareLink({ customerLabel, href, quoteLabel }: { customerLabel: string; href: string; quoteLabel: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const url = `${window.location.origin}${href}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="quote-share">
      <input aria-label={`${customerLabel} ${quoteLabel} link`} readOnly value={href} />
      <button className="button button-secondary" onClick={copyLink} type="button">
        {copied ? "Copied" : `Copy ${customerLabel.toLowerCase()} link`}
      </button>
    </div>
  );
}
