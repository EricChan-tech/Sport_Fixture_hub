import { onUnmounted, ref } from 'vue'
import { JOB_LABEL } from '../lib/labels'
import type { UpdateJobState } from '../types/schema'

interface JobPayload {
  job_id?: string | null
  state?: UpdateJobState
  reason?: string
  retry_after_ms?: number
  finished_at?: string | null
}

const POLL_MS = 400

export function useUpdateJob(onFinished?: () => void) {
  const state = ref<UpdateJobState>('idle')
  const message = ref('')
  const lastSuccessAt = ref<string | null>(null)
  const retryAfterMs = ref(0)
  let pollTimer = 0
  let stopped = false

  function headers(): HeadersInit {
    const token = import.meta.env.VITE_SCHEDULE_JOB_TOKEN?.trim()
    return token ? { 'content-type': 'application/json', 'x-schedule-token': token } : { 'content-type': 'application/json' }
  }

  async function poll(jobId: string): Promise<void> {
    if (stopped) return
    const response = await fetch(`/api/schedule-jobs/${jobId}`)
    const body = (await response.json()) as JobPayload
    state.value = body.state ?? 'fail'
    message.value = body.reason ?? ''
    if (body.finished_at && body.state === 'success') lastSuccessAt.value = body.finished_at
    if (body.state === 'queued' || body.state === 'running') {
      pollTimer = window.setTimeout(() => void poll(jobId), POLL_MS)
      return
    }
    if (body.state === 'success') onFinished?.()
  }

  async function request(date: string): Promise<void> {
    if (state.value === 'queued' || state.value === 'running') return
    message.value = ''
    state.value = 'queued'
    try {
      const response = await fetch('/api/schedule-jobs', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ base_date: date }),
      })
      const body = (await response.json()) as JobPayload
      state.value = body.state ?? 'fail'
      message.value = body.reason ?? ''
      retryAfterMs.value = body.retry_after_ms ?? 0
      if (body.finished_at && body.state === 'success') lastSuccessAt.value = body.finished_at
      if (body.job_id && (body.state === 'queued' || body.state === 'running')) {
        await poll(body.job_id)
        return
      }
      if (body.state === 'success') onFinished?.()
    } catch {
      state.value = 'fail'
      message.value = '更新入口連不上，未寫入賽程。'
    }
  }

  onUnmounted(() => {
    stopped = true
    window.clearTimeout(pollTimer)
  })

  return { state, message, lastSuccessAt, retryAfterMs, request, label: JOB_LABEL }
}
