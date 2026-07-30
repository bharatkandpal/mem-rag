import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render faults in the conversation subtree (design guide §9) so a
 * component bug degrades to a recoverable message instead of a blank screen.
 * Distinct from `ErrorState`, which handles *query* failures — this is for
 * unexpected React render errors.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI render error', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="error-boundary" role="alert">
          <TriangleAlert size={20} strokeWidth={1.5} aria-hidden="true" />
          <p className="error-boundary__title">Something went wrong displaying this.</p>
          <button type="button" className="error-boundary__btn" onClick={this.reset}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
