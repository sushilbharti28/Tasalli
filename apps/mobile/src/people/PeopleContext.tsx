import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, unwrap } from '@/api/client';
import type { Person } from '@/api/types';

interface PeopleState {
  people: Person[];
  loading: boolean;
  error: boolean;
  reload: () => Promise<void>;
  selectedId: string | null;
  select: (id: string) => void;
  selected: Person | undefined;
}

const Ctx = createContext<PeopleState | null>(null);

export function PeopleProvider({ children }: { children: React.ReactNode }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = await unwrap(api.GET('/people'));
      setPeople(list);
      setError(false);
      setSelectedId((cur) => (cur && list.some((p) => p.id === cur) ? cur : (list[0]?.id ?? null)));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(
    () => ({
      people,
      loading,
      error,
      reload,
      selectedId,
      select: setSelectedId,
      selected: people.find((p) => p.id === selectedId),
    }),
    [people, loading, error, reload, selectedId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePeople() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePeople outside PeopleProvider');
  return v;
}
