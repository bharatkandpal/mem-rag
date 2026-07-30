import type { ReactNode } from 'react';
import './Message.css';

/** A user or assistant turn (design guide §4). Assistant turns get the ◇ mark. */
export function Message({ role, children }: { role: 'user' | 'assistant'; children: ReactNode }) {
  return (
    <div className={`msg msg--${role}`}>
      {role === 'assistant' && (
        <span className="msg__avatar" aria-hidden="true">
          ◇
        </span>
      )}
      {/* Announce the assistant's reply once it settles (design guide §8). */}
      <div className="msg__body" aria-live={role === 'assistant' ? 'polite' : undefined}>
        {children}
      </div>
    </div>
  );
}
