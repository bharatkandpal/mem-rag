import { Info } from 'lucide-react';
import './CapabilityNote.css';

/**
 * Honest capability note (design guide §6, RAG-62) — shown only when the answer
 * stands but the provider can't verify citations (`!citationsSupported`).
 * `--info`, never a fabricated citation marker. Pairs with the answer, in place
 * of the "grounded ✓" badge.
 */
export function CapabilityNote() {
  return (
    <p className="capability-note" role="note">
      <Info className="capability-note__icon" size={15} strokeWidth={1.5} aria-hidden="true" />
      <span>
        This answer isn’t citation-verified — the configured provider can’t return citation spans.
        It’s still grounded in the retrieved context.
      </span>
    </p>
  );
}
