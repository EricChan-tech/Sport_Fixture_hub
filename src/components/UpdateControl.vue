<script setup lang="ts">
import { computed } from 'vue'
import { useUpdateJob } from '../composables/useUpdateJob'
import { formatMacauStamp } from '../lib/time'
import { withinManualWindow } from '../lib/productRules.mjs'

const props = defineProps<{
  date: string
  today: string
  windowDays: number
  storedSuccess?: string | null
}>()

const emit = defineEmits<{ finished: [] }>()
const { state, message, lastSuccessAt, retryAfterMs, request } = useUpdateJob(() => emit('finished'))

const outside = computed(() => !withinManualWindow(props.date, props.today, props.windowDays))
const busy = computed(() => state.value === 'queued' || state.value === 'running')
const buttonLabel = computed(() => {
  if (state.value === 'queued') return '排隊中'
  if (state.value === 'running') return '更新中'
  if (retryAfterMs.value > 0 && state.value === 'fail') return '稍後再試'
  return '更新此日'
})
const successLabel = computed(() => {
  const stamp = lastSuccessAt.value || props.storedSuccess
  return stamp ? formatMacauStamp(stamp) : '尚未手動更新'
})
</script>

<template>
  <div class="flex flex-col items-stretch gap-1 sm:items-end">
    <div class="flex items-center gap-2">
      <span
        data-testid="job-state"
        class="rounded-full border px-2 py-1 text-[11px] tracking-wide"
        :class="{
          'border-line text-muted': state === 'idle',
          'border-gold text-gold': state === 'queued' || state === 'running' || state === 'success',
          'border-miss text-miss': state === 'fail',
        }"
      >
        {{ state === 'idle' ? '閒置' : state === 'queued' ? '排隊中' : state === 'running' ? '更新中' : state === 'success' ? '成功' : '失敗' }}
      </span>
      <button
        type="button"
        data-testid="update-button"
        class="rounded-md bg-gold px-2.5 py-1 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="busy"
        @click="request(date)"
      >
        {{ buttonLabel }}
      </button>
    </div>
    <p class="text-[11px] text-muted">
      上次成功
      <span data-testid="last-success">{{ successLabel }}</span>
    </p>
    <p v-if="message" class="max-w-xs text-right text-xs leading-snug" :class="state === 'fail' ? 'text-miss' : 'text-muted'" data-testid="update-message">
      {{ message }}
    </p>
    <p class="max-w-xs text-right text-[11px] leading-snug text-muted">
      {{ outside ? '此日超出手動更新窗口。按下更新會進入失敗狀態。' : '手動更新與每日 06:00 走同一條管線，最短間隔 5 分鐘。' }}
    </p>
  </div>
</template>
