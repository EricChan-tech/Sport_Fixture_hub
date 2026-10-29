<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { addDays, formatMacauDay, monthCells } from '../lib/time'

const props = defineProps<{
  date: string
  today: string
  markedDates: string[]
}>()

const emit = defineEmits<{
  'update:date': [value: string]
}>()

const open = ref(false)
const cursor = ref(props.date.slice(0, 7))

watch(
  () => props.date,
  (value) => {
    cursor.value = value.slice(0, 7)
  },
)

const year = computed(() => Number(cursor.value.slice(0, 4)))
const month = computed(() => Number(cursor.value.slice(5, 7)))
const cells = computed(() => monthCells(year.value, month.value))
const marked = computed(() => new Set(props.markedDates))

function shiftMonth(delta: number): void {
  const stamp = new Date(Date.UTC(year.value, month.value - 1 + delta, 1))
  const nextMonth = String(stamp.getUTCMonth() + 1).padStart(2, '0')
  cursor.value = `${stamp.getUTCFullYear()}-${nextMonth}`
}

function pick(value: string): void {
  emit('update:date', value)
  open.value = false
}
</script>

<template>
  <div class="relative flex flex-wrap items-center gap-1.5">
    <button
      type="button"
      class="rounded-md border border-line px-2.5 py-1 text-sm text-paper hover:border-gold"
      @click="emit('update:date', today)"
    >
      今天
    </button>
    <button
      type="button"
      class="rounded-md border border-line px-2.5 py-1 text-sm hover:border-gold"
      aria-label="前一日"
      @click="emit('update:date', addDays(date, -1))"
    >
      ‹
    </button>
    <p data-testid="date-label" class="min-w-40 px-1 text-center font-serif text-base leading-none sm:text-lg">
      {{ formatMacauDay(date) }}
    </p>
    <button
      type="button"
      class="rounded-md border border-line px-2.5 py-1 text-sm hover:border-gold"
      aria-label="後一日"
      @click="emit('update:date', addDays(date, 1))"
    >
      ›
    </button>
    <button
      type="button"
      class="rounded-md border border-line px-2.5 py-1 text-sm hover:border-gold"
      :aria-expanded="open"
      @click="open = !open"
    >
      日曆
    </button>
    <div
      v-if="open"
      class="absolute left-0 top-12 z-30 w-[320px] rounded-xl border border-line bg-panel p-3 shadow-2xl sm:left-auto"
    >
      <div class="mb-2 flex items-center justify-between">
        <button type="button" class="rounded px-2 py-1 hover:bg-panel-2" aria-label="上一個月" @click="shiftMonth(-1)">‹</button>
        <p class="font-serif">{{ year }} 年 {{ month }} 月</p>
        <button type="button" class="rounded px-2 py-1 hover:bg-panel-2" aria-label="下一個月" @click="shiftMonth(1)">›</button>
      </div>
      <div class="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">
        <span v-for="label in ['一', '二', '三', '四', '五', '六', '日']" :key="label">{{ label }}</span>
      </div>
      <div class="mt-1 grid grid-cols-7 gap-1">
        <button
          v-for="cell in cells"
          :key="cell"
          type="button"
          class="relative rounded-md py-1.5 text-sm"
          :class="[
            cell === date ? 'bg-gold text-ink' : 'hover:bg-panel-2',
            cell.slice(5, 7) !== String(month).padStart(2, '0') ? 'text-muted/50' : '',
            cell === today ? 'ring-1 ring-gold' : '',
          ]"
          @click="pick(cell)"
        >
          {{ Number(cell.slice(8, 10)) }}
          <span v-if="marked.has(cell)" class="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-gold" />
        </button>
      </div>
    </div>
  </div>
</template>
