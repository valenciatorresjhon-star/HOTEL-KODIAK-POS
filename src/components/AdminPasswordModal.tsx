import React, { useState } from 'react';
import { Eye, EyeOff, ShieldAlert, Key } from 'lucide-react';

interface AdminPasswordModalProps {
  open: boolean;
  title?: string;
  message?: string;
  onConfirm: (password: string) => boolean;
  onCancel: () => void;
}

export function AdminPasswordModal({
  open,
  title = 'Validación administrativa',
  message = 'Ingrese la contraseña administrativa para continuar.',
  onConfirm,
  onCancel,
}: AdminPasswordModalProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const isCorrect = onConfirm(password);
    if (isCorrect) {
      setPassword('');
      setError('');
    } else {
      setError('Contraseña incorrecta.');
    }
  };

  const handleClose = () => {
    setPassword('');
    setError('');
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative space-y-5">
        
        {/* Header decoration */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight uppercase">
              {title}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {message}
            </p>
          </div>
        </div>

        {/* Input field */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5 relative">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
              Contraseña
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                <Key className="h-4 w-4" />
              </span>
              <input
                autoFocus
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••"
                className="w-full bg-slate-950 border border-slate-800 focus:border-red-500/50 rounded-xl pl-9 pr-10 py-2.5 text-sm text-white font-mono placeholder:text-slate-700 focus:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Validation Error Message */}
          {error && (
            <div className="text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl flex items-center gap-1.5 animate-shake">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="py-2.5 px-4 border border-slate-800 hover:border-slate-700 bg-slate-950 hover:bg-slate-900 text-slate-300 text-xs font-bold rounded-xl transition-all active:scale-[0.98]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="py-2.5 px-4 bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white text-xs font-bold rounded-xl shadow-lg hover:shadow-red-950/20 transition-all active:scale-[0.98]"
            >
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
