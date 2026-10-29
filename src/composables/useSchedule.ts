import { ref } from 'vue'
import { loadSchedule } from '../services/scheduleRepo'
import type { DayFile, Manifest } from '../types/schema'

const manifest = ref<Manifest | null>(null)
const days = ref<DayFile[]>([])
const loadState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const errorMessage = ref('')
const scheduleNotice = ref('')
let inflight: Promise<void> | null = null

async function load(): Promise<void> {
  if (inflight) return inflight
  loadState.value = manifest.value ? 'ready' : 'loading'
  inflight = (async () => {
    try {
      const result = await loadSchedule()
      manifest.value = result.manifest
      days.value = result.days
      scheduleNotice.value = result.notice
      loadState.value = 'ready'
      errorMessage.value = ''
    } catch (error) {
      loadState.value = 'error'
      errorMessage.value = error instanceof Error ? error.message : '賽程讀取失敗。'
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function useSchedule() {
  return { manifest, days, loadState, errorMessage, scheduleNotice, load }
}
