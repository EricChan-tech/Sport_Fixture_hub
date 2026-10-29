import { ref, watch, type Ref } from 'vue'
import { clearedPreferenceIds, effectiveCompetitionIds, selectNoneIds } from '../lib/productRules.mjs'
import { clearWhitelist, readWhitelist, writeWhitelist } from '../lib/storage'
import type { Sport } from '../types/schema'
import whitelistFile from '../config/default_whitelist.json'

export function defaultCompetitionIds(sport: Sport): string[] {
  const list = whitelistFile.sports[sport]
  return Array.isArray(list) ? [...list] : []
}

export function useWhitelist(sport: Ref<Sport>, macauLocked: Ref<string[]>) {
  const ids = ref<string[]>([])
  const notice = ref('')

  function apply(): void {
    ids.value = effectiveCompetitionIds({
      stored: readWhitelist(sport.value),
      defaults: defaultCompetitionIds(sport.value),
      macauLocked: macauLocked.value,
    })
  }

  watch([sport, macauLocked], apply, { immediate: true, deep: true })

  function persist(next: readonly string[]): void {
    const saved = effectiveCompetitionIds({
      stored: [...next],
      defaults: defaultCompetitionIds(sport.value),
      macauLocked: macauLocked.value,
    })
    ids.value = saved
    writeWhitelist(sport.value, saved)
  }

  function toggle(id: string): void {
    if (macauLocked.value.includes(id)) return
    const next = ids.value.includes(id) ? ids.value.filter((item) => item !== id) : [...ids.value, id]
    persist(next)
    notice.value = ''
  }

  function selectAll(allIds: readonly string[]): void {
    persist(allIds)
    notice.value = '已勾選此運動的全部賽事。'
  }

  function selectNone(): void {
    persist(selectNoneIds(macauLocked.value))
    notice.value = '已取消可選賽事。澳彩賽事仍然固定顯示。'
  }

  function resetDefault(): void {
    const next = clearedPreferenceIds({
      defaults: defaultCompetitionIds(sport.value),
      macauLocked: macauLocked.value,
    })
    ids.value = next
    writeWhitelist(sport.value, next)
    notice.value = '已還原預設白名單，並保留澳彩鎖定。'
  }

  function clearPrefs(): void {
    clearWhitelist(sport.value)
    ids.value = clearedPreferenceIds({
      defaults: defaultCompetitionIds(sport.value),
      macauLocked: macauLocked.value,
    })
    notice.value = '已清除本機偏好。預設白名單與澳彩鎖定已重新套用。'
  }

  return { ids, notice, toggle, selectAll, selectNone, resetDefault, clearPrefs }
}
