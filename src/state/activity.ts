import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiActivity } from '@shared/api';
import { persistStorage } from './storage';

/** Alerts the phone raised itself (phone-only mode), shown alongside the server's. */
interface ActivityState {
  items: ApiActivity[];
  add: (a: Omit<ApiActivity, 'id' | 'createdAt'>) => void;
}

export const useLocalActivity = create<ActivityState>()(
  persist(
    (set) => ({
      items: [],
      // Negative ids never collide with the server's
      add: (a) => set((s) => ({ items: [{ ...a, id: -Date.now() - Math.floor(Math.random() * 1000), createdAt: Date.now() }, ...s.items].slice(0, 60) })),
    }),
    { name: 'gamely.activity', storage: persistStorage, version: 1 },
  ),
);
