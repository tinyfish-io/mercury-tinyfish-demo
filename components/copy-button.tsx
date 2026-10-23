'use client';
import { useEffect, useState } from 'react';

import { Icon } from './icon';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <button
      type="button"
      className="answer-copy"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => {});
      }}
      aria-label="Copy"
    >
      <Icon name={copied ? 'check' : 'layers'} size={11} /> {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
