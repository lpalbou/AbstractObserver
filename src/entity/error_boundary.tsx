/**
 * Error boundaries for the entity app (maintainer's critical, 2026-07-08
 * 23:49: a chat-door 409 was followed by React #31 and the WHOLE APP
 * died — twice he lost the window to his entity to a render error).
 *
 * The rule this encodes: a render error in one panel may never take the
 * observer down. Each drawer panel and the app root degrade to an honest
 * error card naming the error — the graph keeps drawing, the other
 * panels keep working, and the message tells the maintainer exactly what
 * broke instead of a dead white screen.
 */

import React from "react";

interface ErrorBoundaryProps {
  /** Names the surface in the error card ("the chat drawer", "the app"). */
  label: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[observer] render error in ${this.props.label}:`, error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="eb_card" role="alert">
          <div className="eb_title">⚠ {this.props.label} hit a render error</div>
          <div className="eb_message">{String(this.state.error.message || this.state.error)}</div>
          <button className="eb_retry" onClick={() => this.setState({ error: null })}>
            try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
