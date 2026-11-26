import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getItem, KEYS, setItem } from '@/lib/storage';

interface StoryState {
  /** False until the saved flag has been read. */
  loaded: boolean;
  seen: boolean;
  markSeen: () => Promise<void>;
}

const Ctx = createContext<StoryState | null>(null);

/** Remembers on this phone whether the first-run story was watched or skipped. */
export function StoryProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    void getItem(KEYS.storySeen).then((v) => {
      setSeen(v === '1');
      setLoaded(true);
    });
  }, []);

  const markSeen = useCallback(async () => {
    await setItem(KEYS.storySeen, '1');
    setSeen(true);
  }, []);

  const value = useMemo(() => ({ loaded, seen, markSeen }), [loaded, seen, markSeen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStory() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStory outside StoryProvider');
  return v;
}
