'use client';

import React from 'react';

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Error boundary that catches client-side exceptions during hydration.
 * Shows a user-friendly message with the actual error for debugging.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to console for debugging
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', fontFamily: 'monospace', fontSize: '13px', maxWidth: '800px', margin: '0 auto' }}>
          <h2 style={{ marginBottom: '16px' }}>Something went wrong</h2>
          <p style={{ marginBottom: '16px', color: '#666' }}>
            The app encountered an error. Try refreshing the page (Ctrl+Shift+R for hard refresh).
          </p>
          <pre style={{
            padding: '12px',
            background: '#f5f5f5',
            border: '1px solid #ddd',
            borderRadius: '4px',
            overflow: 'auto',
            fontSize: '11px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {this.state.error?.message || 'Unknown error'}
            {this.state.error?.stack ? '\n\n' + this.state.error.stack : ''}
          </pre>
          <button
            onClick={() => {
              // Clear all caches and SW, then reload
              if ('caches' in window) {
                caches.keys().then(names => names.forEach(n => caches.delete(n)));
              }
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
              }
              localStorage.clear();
              window.location.reload();
            }}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              cursor: 'pointer',
              border: '1px solid #ccc',
              borderRadius: '4px',
              background: '#fff',
            }}
          >
            Clear cache and reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
