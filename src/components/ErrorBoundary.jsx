"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { normalizeError } from "@/lib/errorUtils";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error: normalizeError(error) };
  }

  componentDidCatch(error, errorInfo) {
    const normalized = normalizeError(error);
    console.error("ErrorBoundary caught an error:", normalized.message, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] p-6 bg-gray-900 border border-red-800/50 rounded-xl text-white shadow-lg m-4">
          <div className="w-12 h-12 rounded-full bg-red-900/30 border border-red-500/50 flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-red-300 mb-2">
            Something went wrong
          </h3>
          <p className="text-sm text-gray-400 text-center max-w-md mb-4">
            An unexpected error occurred in this section. You can try refreshing or resetting the view.
          </p>
          {process.env.NODE_ENV !== "production" && this.state.error?.message && (
            <pre className="text-xs bg-black/60 text-red-300 p-3 rounded-lg max-w-full overflow-x-auto mb-4 border border-red-900/30">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <RefreshCw className="w-4 h-4" /> Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
