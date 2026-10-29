<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

export interface WhitelistOption {
  competition_id: string
  name_zh: string
  name_en: string
  short_zh: string
  aliases: string[]
  pending: boolean
  locked: boolean
  fixtureCount: number
}

const props = defineProps<{
  open: boolean
  options: WhitelistOption[]
  selectedIds: string[]
  notice: string
}>()

const emit = defineEmits<{
  close: []
  toggle: [id: string]
  selectAll: []
  selectNone: []
  resetDefault: []
  clearPrefs: []
}>()

const query = ref('')
const search = ref<HTMLInputElement | null>(null)
const LOCK_TIP = '澳彩賽事固定顯示'
const tipBox = ref<{ x: number; y: number } | null>(null)

function showTip(event: MouseEvent | FocusEvent): void {
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const rect = target.getBoundingClientRect()
  const width = 148
  tipBox.value = {
    x: Math.max(16, rect.left - width - 10),
    y: rect.top + rect.height / 2 - 16,
  }
}

function hideTip(): void {
  tipBox.value = null
}

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return props.options
  return props.options.filter((option) =>
    [option.name_zh, option.name_en, option.short_zh, option.competition_id, ...option.aliases]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  )
})

const lockedCount = computed(() => props.options.filter((option) => option.locked).length)

watch(
  () => props.open,
  (value) => {
    document.body.classList.toggle('overflow-hidden', value)
    if (value) {
      query.value = ''
      requestAnimationFrame(() => search.value?.focus())
    }
  },
)

onUnmounted(() => document.body.classList.remove('overflow-hidden'))

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
      @keydown="onKeydown"
    >
      <button type="button" class="absolute inset-0 cursor-default" aria-label="關閉白名單" @click="emit('close')" />
      <section
        data-testid="whitelist-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whitelist-title"
        class="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl border border-line bg-panel shadow-2xl sm:rounded-2xl"
      >
        <header class="border-b border-line px-4 py-4 sm:px-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 id="whitelist-title" class="font-serif text-2xl">賽事白名單</h2>
              <p class="mt-1 text-sm text-muted">只顯示已勾選的賽事。澳彩有賽程的項目會鎖住，不能取消。</p>
            </div>
            <button type="button" class="rounded-md border border-line px-3 py-1.5 text-sm" @click="emit('close')">關閉</button>
          </div>
          <input
            ref="search"
            v-model="query"
            type="search"
            placeholder="搜尋中文、英文或簡稱"
            class="mt-3 w-full rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none"
          />
        </header>
        <ul class="min-h-0 flex-1 overflow-auto px-2 py-2">
          <li v-for="option in filtered" :key="option.competition_id">
            <label
              class="flex items-center gap-3 rounded-lg px-3 py-1.5"
              :class="option.locked ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-panel-2'"
            >
              <input
                type="checkbox"
                class="h-4 w-4"
                :checked="selectedIds.includes(option.competition_id)"
                :disabled="option.locked"
                :data-testid="`whitelist-${option.competition_id}`"
                @change="emit('toggle', option.competition_id)"
              />
              <span class="min-w-0 flex-1">
                <span class="block text-sm">{{ option.name_zh }}</span>
                <span class="block text-xs text-muted">{{ option.name_en }} · {{ option.fixtureCount }} 場樣本</span>
              </span>
              <span v-if="option.pending" class="rounded-full border border-gold/40 px-2 py-0.5 text-[11px] text-gold">待對照</span>
              <span
                v-if="option.locked"
                class="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold"
                tabindex="0"
                :data-tip="LOCK_TIP"
                :title="LOCK_TIP"
                :data-testid="`lock-${option.competition_id}`"
                @mouseenter="showTip"
                @mouseleave="hideTip"
                @focus="showTip"
                @blur="hideTip"
              >
                澳彩鎖定
              </span>
            </label>
          </li>
          <li v-if="filtered.length === 0" class="px-3 py-8 text-center text-sm text-muted">沒有符合的賽事。</li>
        </ul>
        <footer class="space-y-3 border-t border-line px-4 py-4 sm:px-5">
          <p class="text-xs text-muted">已選 {{ selectedIds.length }} 項，其中澳彩鎖定 {{ lockedCount }} 項。全不選仍會留下鎖定項。</p>
          <p v-if="notice" data-testid="whitelist-notice" class="text-sm text-gold">{{ notice }}</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="rounded-md border border-line px-3 py-2 text-sm" @click="emit('selectAll')">全選</button>
            <button type="button" data-testid="select-none" class="rounded-md border border-line px-3 py-2 text-sm" @click="emit('selectNone')">
              全不選
            </button>
            <button type="button" class="rounded-md border border-line px-3 py-2 text-sm" @click="emit('resetDefault')">還原預設</button>
            <button type="button" data-testid="clear-prefs" class="rounded-md border border-gold px-3 py-2 text-sm text-gold" @click="emit('clearPrefs')">
              清除本機偏好
            </button>
          </div>
        </footer>
      </section>
      <p
        v-if="tipBox"
        data-testid="macau-lock-tooltip"
        class="pointer-events-none fixed z-[80] w-[148px] rounded-md border border-gold bg-[#2a2116] px-2.5 py-1.5 text-center text-sm text-paper shadow-xl"
        :style="{ left: `${tipBox.x}px`, top: `${tipBox.y}px` }"
      >
        {{ LOCK_TIP }}
      </p>
    </div>
  </Teleport>
</template>
