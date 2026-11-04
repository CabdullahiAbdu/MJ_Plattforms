import React, { useState, useRef, useEffect } from 'react';
import { X, Sparkles, ArrowRight } from './Icons';
import { generateMovieInsights, chatWithMovieExpert } from '../services/geminiService';
import { MovieDetails, TvShowDetails } from '../types';

interface AiAssistantProps {
  movie: MovieDetails | TvShowDetails | null;
  language?: string;
  onClose: () => void;
}

export const AiAssistant: React.FC<AiAssistantProps> = ({
  movie,
  language = 'en-US',
  onClose,
}) => {
  const title = movie?.title || movie?.name || 'this title';
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initializedForId = useRef<number | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // Automatically fetch initial critic summary when opened for a title
  useEffect(() => {
    if (!movie || initializedForId.current === movie.id) return;
    initializedForId.current = movie.id;

    let mounted = true;
    const loadInitialCritique = async () => {
      setLoading(true);
      const critique = await generateMovieInsights(movie, undefined, language);
      if (mounted) {
        setMessages([{ role: 'ai', text: critique }]);
        setLoading(false);
      }
    };
    loadInitialCritique();
    return () => {
      mounted = false;
    };
  }, [movie, language]);

  const handleSend = async (customPrompt?: string) => {
    const textToSend = (customPrompt ?? query).trim();
    if (!textToSend || !movie || loading) return;

    const nextHistory = [...messages, { role: 'user' as const, text: textToSend }];
    setMessages(nextHistory);
    if (!customPrompt) setQuery('');
    setLoading(true);

    const mediaContext = `${title} (${(movie.release_date || movie.first_air_date || '').slice(0, 4)}): ${
      movie.overview || ''
    }`;

    const response = await chatWithMovieExpert(nextHistory, textToSend, mediaContext, language);
    setMessages((prev) => [...prev, { role: 'ai', text: response }]);
    setLoading(false);
  };

  if (!movie) return null;

  const quickQuestions = language.startsWith('de')
    ? ['Lohnt sich das Anschauen?', 'Wie ist die Stimmung?', 'Ähnliche Meisterwerke?']
    : ['Is it worth watching?', 'What is the tone & pacing?', 'Similar films to watch next?'];

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[420px] bg-zinc-950/95 backdrop-blur-2xl border-l border-white/10 shadow-2xl z-[90] flex flex-col animate-slide-in-right">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-2.5 text-accent">
          <Sparkles size={18} />
          <div>
            <h3 className="font-bold text-white text-sm leading-tight">Film Critic Assistant</h3>
            <p className="text-[11px] text-zinc-400 truncate max-w-[240px]">{title}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI Assistant"
          className="min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-white/10 rounded-full transition-colors text-zinc-400 hover:text-white"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[88%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-accent text-white rounded-tr-sm font-medium'
                  : 'bg-zinc-900 border border-white/10 text-zinc-200 rounded-tl-sm'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-zinc-900 border border-white/10 px-4 py-3 rounded-2xl rounded-tl-sm">
              <div className="flex space-x-1.5 items-center h-4">
                <div
                  className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <div
                  className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <div
                  className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts */}
      <div className="px-4 py-2 flex gap-2 overflow-x-auto no-scrollbar border-t border-white/5">
        {quickQuestions.map((q) => (
          <button
            key={q}
            type="button"
            disabled={loading}
            onClick={() => handleSend(q)}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-zinc-300 hover:text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      <div className="p-4 border-t border-white/10 bg-black/40">
        <div className="relative flex items-center">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={`Ask about ${title}...`}
            className="w-full bg-zinc-900 border border-white/10 text-white pl-4 pr-12 py-3 rounded-xl focus:outline-none focus:border-accent placeholder-zinc-500 text-sm"
          />
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={loading || !query.trim()}
            aria-label="Send message"
            className="absolute right-2 min-w-[36px] min-h-[36px] flex items-center justify-center bg-white text-black rounded-lg disabled:opacity-40 hover:bg-zinc-200 transition-colors"
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};