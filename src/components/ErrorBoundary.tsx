import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 my-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-slate-100 max-w-xl mx-auto space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/20 text-red-400 rounded-xl">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-red-200">Error en el módulo</h3>
              <p className="text-xs text-slate-400">
                {this.props.fallbackMessage || 'Este componente ha fallado al cargarse.'}
              </p>
            </div>
          </div>
          <p className="text-xs font-mono bg-slate-950 p-3 rounded-lg text-red-300 max-h-32 overflow-y-auto break-all">
            {this.state.error?.message || 'Error desconocido'}
          </p>
          <button
            onClick={this.handleReset}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition-all"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Reiniciar módulo</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
