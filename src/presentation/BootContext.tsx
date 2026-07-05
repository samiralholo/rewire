/**
 * Presentation — Boot Context
 * ---------------------------------------------------------------------------
 * Exposes the BootResult (actor handle, behaviorId) plus the database and
 * active pack id to the component tree. Pure plumbing; no logic.
 */

import { createContext, useContext } from 'react';
import type { Database } from '@nozbe/watermelondb';
import type { BootResult } from '../core/boot/bootstrap';
import type { DomainPackId } from '../core/types';

export interface BootValue {
  database: Database;
  boot: BootResult;
  packId: DomainPackId;
}

const BootCtx = createContext<BootValue | null>(null);

export const BootProvider = BootCtx.Provider;

export function useBoot(): BootValue {
  const value = useContext(BootCtx);
  if (value === null) {
    throw new Error('useBoot must be used inside <BootProvider> (see App.tsx).');
  }
  return value;
}
