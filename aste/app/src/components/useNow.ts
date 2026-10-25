import { useEffect, useState } from 'react';

// Orologio condiviso per i conti alla rovescia: un solo timer per tutta l'app.
const listeners = new Set<(t: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

export function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    listeners.add(setNow);
    timer ??= setInterval(() => {
      const t = Date.now();
      listeners.forEach((fn) => fn(t));
    }, 1000);
    return () => {
      listeners.delete(setNow);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return now;
}
