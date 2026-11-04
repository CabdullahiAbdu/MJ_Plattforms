import React, { useState } from 'react';
import {
  signInWithGoogle,
  signInWithApple,
  signInWithEmail,
  registerWithEmail,
} from '../services/firebase';
import { Tv, Mail, Lock, ArrowRight, X } from './Icons';

interface AuthScreenProps {
  onSuccess: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onSuccess }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isRegistering) {
        await registerWithEmail(email, password, email.split('@')[0] || 'Cinephile');
      } else {
        await signInWithEmail(email, password);
      }
      onSuccess();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSocialSignIn = async (provider: 'google' | 'apple') => {
    setError(null);
    setLoading(true);
    try {
      if (provider === 'google') await signInWithGoogle();
      else await signInWithApple();
      onSuccess();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Social sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black text-white flex items-center justify-center p-6 overflow-hidden">
      {/* Animated Backdrop */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/20 via-purple-500/10 to-transparent animate-lava-flow blur-3xl opacity-50" />
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      </div>

      <div className="relative z-10 w-full max-w-md animate-slide-up">
        <div className="bg-zinc-900/80 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-8 md:p-10 shadow-2xl flex flex-col items-center">
          
          <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-6 border border-white/10 shadow-inner">
            <Tv size={32} className="text-indigo-400" />
          </div>

          <div className="text-center mb-8">
            <h1 className="text-3xl font-black tracking-tighter mb-2">MovieJournal</h1>
            <p className="text-zinc-400 font-medium">Step into your cinematic sanctuary.</p>
          </div>

          {error && (
            <div className="w-full mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium flex items-center gap-3">
              <X size={16} /> {error}
            </div>
          )}

          {/* Social Buttons */}
          <div className="w-full space-y-3 mb-8">
            <button 
              onClick={() => handleSocialSignIn('google')}
              className="w-full h-14 bg-white text-black rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-zinc-200 transition-all active:scale-[0.98]"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/smartlock/google.svg" className="w-5 h-5" alt="" />
              Continue with Google
            </button>
            <button 
              onClick={() => handleSocialSignIn('apple')}
              className="w-full h-14 bg-zinc-800 text-white rounded-2xl font-bold flex items-center justify-center gap-3 border border-white/10 hover:bg-zinc-700 transition-all active:scale-[0.98]"
            >
              <svg viewBox="0 0 384 512" className="w-5 h-5 fill-current"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-39-19.9-56-54.4-56-91.9zm-3.3-174.7c14.6-18.1 24.1-43.5 21.2-68.9-22 .9-48.4 14.8-64.1 33.1-13.6 15.6-25.2 41.5-22.1 66.2 24.5 1.9 49.3-12.2 65-30.4z"></path></svg>
              Continue with Apple
            </button>
          </div>

          <div className="w-full flex items-center gap-4 mb-8 opacity-30">
            <div className="flex-1 h-px bg-white" />
            <span className="text-[10px] font-black uppercase tracking-widest">or email</span>
            <div className="flex-1 h-px bg-white" />
          </div>

          {/* Email Form */}
          <form onSubmit={handleSubmit} className="w-full space-y-4">
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
              <input 
                type="email" 
                placeholder="Email Address" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-14 bg-black/40 border border-white/10 rounded-2xl pl-12 pr-4 text-white focus:border-indigo-500 outline-none transition-all placeholder-zinc-600"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
              <input 
                type="password" 
                placeholder="Password" 
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-14 bg-black/40 border border-white/10 rounded-2xl pl-12 pr-4 text-white focus:border-indigo-500 outline-none transition-all placeholder-zinc-600"
              />
            </div>
            <button 
              type="submit"
              disabled={loading}
              className="w-full h-14 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  {isRegistering ? 'Create Account' : 'Sign In'}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <button 
            onClick={() => setIsRegistering(!isRegistering)}
            className="mt-8 text-sm font-bold text-zinc-500 hover:text-white transition-colors"
          >
            {isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Register"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes lavaFlow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-lava-flow {
          background-size: 200% 200%;
          animation: lavaFlow 15s ease infinite;
        }
      `}</style>
    </div>
  );
};
