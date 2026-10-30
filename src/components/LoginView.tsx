import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, ShieldAlert, Key, Mail, Lock, ShieldCheck } from 'lucide-react';
import { loginUser } from '../services/firebaseService';

interface LoginViewProps {
  onLoginSuccess: (user: any, profile: any) => void;
}

export function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Rate-limiting: Bloqueo de 30 segundos tras 5 intentos fallidos consecutivos
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const interval = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutSeconds > 0) return;

    setError('');
    setLoading(true);

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword) {
      setError('Credenciales incorrectas. Verifique su correo y contraseña.');
      setLoading(false);
      return;
    }

    try {
      const result = await loginUser(cleanEmail, cleanPassword);
      // Reset attempts on successful login
      setFailedAttempts(0);
      onLoginSuccess(result.firebaseUser, result.profile);
    } catch (err: any) {
      console.error("Login attempt failed:", err);
      
      const newAttempts = failedAttempts + 1;
      setFailedAttempts(newAttempts);

      if (newAttempts >= 5) {
        setLockoutSeconds(30);
        setFailedAttempts(0);
        setError('Demasiados intentos fallidos. Por seguridad, el acceso ha sido bloqueado por 30 segundos.');
      } else {
        // Regla de seguridad: Mensaje genérico sin revelar si el correo existe o no
        if (err.code === 'auth/network-request-failed') {
          setError('Error de conexión. Verifique su acceso a internet.');
        } else {
          setError('Credenciales incorrectas. Verifique su correo y contraseña.');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const isLocked = lockoutSeconds > 0;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Decorative subtle ambient lights */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-md bg-slate-900/95 border border-slate-800/90 rounded-3xl p-8 shadow-2xl backdrop-blur-xl relative z-10 space-y-6">
        
        {/* Header / Brand */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-inner">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-black text-white tracking-tight uppercase">
            HOTEL KODIAK POS
          </h1>
          <p className="text-xs text-slate-400">
            Control de Acceso y Operación
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
          
          {/* Correo electrónico */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
              Correo Electrónico
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                <Mail className="h-4 w-4" />
              </span>
              <input
                required
                type="email"
                id="login-email-input"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="correo@hotelkodiak.com"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck="false"
                disabled={loading || isLocked}
                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500/50 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none transition-colors placeholder:text-slate-700 font-mono text-xs disabled:opacity-50"
              />
            </div>
          </div>

          {/* Contraseña */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
              Contraseña
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                <Key className="h-4 w-4" />
              </span>
              <input
                required
                type={showPassword ? 'text' : 'password'}
                id="login-password-input"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                disabled={loading || isLocked}
                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500/50 rounded-xl pl-10 pr-10 py-3 text-sm text-white focus:outline-none transition-colors placeholder:text-slate-700 font-mono disabled:opacity-50"
              />
              <button
                type="button"
                id="login-toggle-password"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                disabled={loading || isLocked}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer disabled:opacity-50"
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

          {/* Feedback message (Error o Bloqueo) */}
          {error && (
            <div className="text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/20 px-4 py-3 rounded-xl flex items-start gap-2.5 animate-shake w-full">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="whitespace-pre-line text-left leading-relaxed">
                {error}
              </span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            id="login-submit-button"
            disabled={loading || isLocked}
            className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:from-slate-800 disabled:to-slate-800 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-lg hover:shadow-emerald-950/20 transition-all active:scale-[0.98] disabled:scale-100 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2 mt-2"
          >
            <Lock className="h-4 w-4" />
            <span>
              {isLocked 
                ? `Bloqueado (${lockoutSeconds}s)` 
                : loading 
                  ? 'Verificando...' 
                  : 'Iniciar Sesión'}
            </span>
          </button>
        </form>

        <div className="text-center pt-2 border-t border-slate-800/60">
          <p className="text-[10px] text-slate-500 font-mono">
            SISTEMA POS HOTEL KODIAK • ACCESO AUTORIZADO
          </p>
        </div>

      </div>
    </div>
  );
}
