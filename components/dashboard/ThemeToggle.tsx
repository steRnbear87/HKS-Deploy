'use client';

import { Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/providers/theme-context';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <Button
      variant="ghost"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="text-text-secondary hover:text-text-primary hover:bg-overlay/5 transition-all"
    >
      {/* Render both icons and let the .dark class pick one, so server HTML
          matches the first client render regardless of stored theme */}
      <Sun className="w-5 h-5 dark:hidden" aria-hidden="true" />
      <Moon className="w-5 h-5 hidden dark:block" aria-hidden="true" />
    </Button>
  );
}
