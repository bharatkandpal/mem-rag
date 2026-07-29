import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import './Composer.css';

interface ComposerProps {
  onSubmit: (question: string) => void;
  disabled?: boolean;
}

const MAX_ROWS_PX = 200;

/**
 * The composer (design guide §2, §8): autofocused multiline textarea, auto-grow,
 * `⌘/Ctrl+Enter` to send, disabled while a query is in flight. Plain Enter
 * inserts a newline — sending is an explicit shortcut so the box stays multiline.
 */
export function Composer({ onSubmit, disabled = false }: ComposerProps) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // Autofocus on mount (fast to first answer, §1) and again when re-enabled.
  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  // Auto-grow to fit content, capped.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, [value]);

  function submit() {
    const q = value.trim();
    if (!q || disabled) return;
    onSubmit(q);
    setValue('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        className="composer__input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask a question about the corpus…"
        rows={1}
        disabled={disabled}
        aria-label="Ask a question about the corpus"
        autoFocus
      />
      <button
        type="submit"
        className="composer__send"
        disabled={disabled || value.trim().length === 0}
        aria-label="Send question"
        title="Send  (⌘/Ctrl+Enter)"
      >
        <ArrowUp size={18} strokeWidth={2} />
      </button>
    </form>
  );
}
