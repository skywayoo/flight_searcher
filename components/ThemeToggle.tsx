'use client';
import { useEffect, useState } from 'react';

/** Persists user choice across reloads. Defaults to dark. */
function getInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const t = getInitialTheme();
    setTheme(t);
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  }

  return (
    <button
      onClick={toggle}
      aria-label="切換主題"
      className="rounded-lg border border-gray-800 px-2 py-1 text-xs hover:bg-gray-800/40 transition-colors"
      title={theme === 'dark' ? '切換到淺色' : '切換到深色'}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
