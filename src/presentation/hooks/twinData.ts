/**
 * Presentation — shared reactive reads from the local twin.
 * Extracted from InterceptorScreen so Dashboard/Reflection can reuse them.
 */

import { useEffect, useState } from 'react';
import { Q } from '@nozbe/watermelondb';
import { useTranslation } from 'react-i18next';
import { TableName } from '../../core/db/schema';
import { InterventionModel, TriggerModel } from '../../core/db/models';
import { useBoot } from '../BootContext';

export function useTriggerChips(): TriggerModel[] {
  const { database, boot } = useBoot();
  const [rows, setRows] = useState<TriggerModel[]>([]);
  useEffect(() => {
    const subscription = database
      .get<TriggerModel>(TableName.TRIGGERS)
      .query(
        Q.where('behavior_id', boot.behaviorId),
        Q.sortBy('weight', Q.desc), // most likely cues first: fewer scrolls
      )
      .observe()
      .subscribe(setRows);
    return () => subscription.unsubscribe();
  }, [database, boot.behaviorId]);
  return rows;
}

export function useInterventions(): InterventionModel[] {
  const { database, packId } = useBoot();
  const [rows, setRows] = useState<InterventionModel[]>([]);
  useEffect(() => {
    const subscription = database
      .get<InterventionModel>(TableName.INTERVENTIONS)
      .query(Q.where('domain_pack_id', packId), Q.where('is_enabled', true))
      .observe()
      .subscribe(setRows);
    return () => subscription.unsubscribe();
  }, [database, packId]);
  return rows;
}

/**
 * Resolve a DomainPack vocabulary key through the i18n 'domain' namespace
 * (fed by registerDomainVocabulary at boot). Falls back to the key itself.
 */
export function useDomainLabel(): (key: string) => string {
  const { t } = useTranslation('domain');
  return (key: string) => t(key, { defaultValue: key });
}
