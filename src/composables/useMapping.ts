import { computed, ref } from 'vue'
import type { MappingEntity, MappingStore } from '../types/schema'
import {
  adoptMappingStore,
  confirmEntity,
  entityKey,
  importPending,
  loadMappingStore,
  rejectEntity,
  resetMappingStore,
  type ParsedImport,
} from '../services/mappingRepo'

const store = ref<MappingStore>(loadMappingStore())
let dirty = false

void (async () => {
  try {
    const response = await fetch('/api/mapping/workspace')
    if (!response.ok || dirty) return
    const body = (await response.json()) as { store?: MappingStore | null }
    if (!body.store || dirty) return
    store.value = adoptMappingStore(body.store)
  } catch {
    /* 瀏覽器快取仍可用。 */
  }
})()

async function pushWorkspace(next: MappingStore): Promise<void> {
  try {
    await fetch('/api/mapping/workspace', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    })
  } catch {
    /* 本機快取已寫入。 */
  }
}

export function useMapping() {
  const pendingCount = computed(() => store.value.pending.length)

  async function confirm(entity: MappingEntity): Promise<void> {
    dirty = true
    const id = entity.entity === 'competition' ? entity.competition_id : entity.team_id
    try {
      const response = await fetch('/api/mapping/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entity: entity.entity, id }),
      })
      const body = (await response.json()) as { store?: MappingStore }
      if (response.ok && body.store) {
        store.value = adoptMappingStore(body.store)
        return
      }
    } catch {
      /* 改走本機快取。 */
    }
    store.value = confirmEntity(store.value, entity)
    await pushWorkspace(store.value)
  }

  async function reject(entity: MappingEntity): Promise<void> {
    dirty = true
    const id = entity.entity === 'competition' ? entity.competition_id : entity.team_id
    try {
      const response = await fetch('/api/mapping/reject', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entity: entity.entity, id }),
      })
      const body = (await response.json()) as { store?: MappingStore }
      if (response.ok && body.store) {
        store.value = adoptMappingStore(body.store)
        return
      }
    } catch {
      /* 改走本機快取。 */
    }
    store.value = rejectEntity(store.value, entity)
    await pushWorkspace(store.value)
  }

  async function reset(): Promise<void> {
    dirty = true
    store.value = resetMappingStore()
    try {
      await fetch('/api/mapping/workspace', { method: 'DELETE' })
    } catch {
      /* 本機示範已還原。 */
    }
  }

  function addImports(items: readonly ParsedImport[]): string | null {
    dirty = true
    const result = importPending(store.value, items)
    if (result.error) return result.error
    store.value = result.store
    void pushWorkspace(result.store)
    return null
  }

  return { store, pendingCount, confirm, reject, reset, addImports, entityKey }
}
