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
      <div className="msg__body">{children}</div>
    </div>
  );
}
