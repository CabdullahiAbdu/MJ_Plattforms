import React, { useState } from 'react';
import { Tv, ArrowRight, Key } from './Icons';

export const ApiKeyScreen = ({ setApiKey }: { setApiKey: (k: string) => void }) => {
  const [inputVal, setInputVal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputVal.trim();
    if (!trimmed) {
      setError('Please enter a valid TMDB v3 API key.');
      return;
    }

    setTesting(true);
    setError(null);
    try {
      const res = await fetch(
        `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(trimmed)}`
      );
      if (!res.ok) {
        setError('Invalid TMDB API Key. Please check your v3 key at themoviedb.org.');
        setTesting(false);
        return;
      }
      setApiKey(trimmed);
    } catch {
      setError('Network error while verifying key. Please check your connection.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-zinc-900/90 backdrop-blur-2xl p-8 rounded-3xl border border-white/10 shadow-2xl text-center space-y-6">
        <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto border border-white/10">
          <Tv size={32} className="text-indigo-400" />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-black tracking-tight text-white">MovieJournal</h1>
          <p className="text-zinc-400 text-sm leading-relaxed">
            Connect your TMDB v3 API key to unlock the full movie and series catalogue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <Key
              size={16}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
            />
            <input
              type="text"
              value={inputVal}
              onChange={(e) => {
                setInputVal(e.target.value);
                if (error) setError(null);
              }}
              className="w-full bg-black border border-zinc-700 rounded-xl pl-11 pr-4 py-3.5 text-white focus:border-indigo-500 outline-none transition-all placeholder-zinc-600 font-mono text-sm"
              placeholder="Paste TMDB v3 API Key..."
              autoFocus
            />
          </div>

          {error && <p className="text-xs text-red-400 font-medium text-left px-1">{error}</p>}

          <button
            type="submit"
            disabled={testing || !inputVal.trim()}
            className="w-full h-12 bg-white text-black hover:bg-zinc-200 disabled:opacity-40 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          >
            {testing ? (
              <span>Verifying Key...</span>
            ) : (
              <>
                <span>Connect Catalogue</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <p className="text-xs text-zinc-500">
          Your key is verified and stored locally. Get a free key at{' '}
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-400 hover:underline"
          >
            themoviedb.org
          </a>
        </p>
      </div>
    </div>
  );
};