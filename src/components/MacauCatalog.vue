<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { Sport } from '../types/schema'

interface CatalogRow {
  entity_id: string
  sport: Sport
  kind: 'team' | 'competition'
  canonical_name_zh: string
  canonical_name_en: string
  status: 'confirmed' | 'pending'
  source: 'auto' | 'manual' | 'import'
  continent: string
  category: string
}

const sport = ref<Sport>('football')
const kind = ref<'team' | 'competition'>('team')
const query = ref('')
const page = ref(1)
const pageSize = 40
const total = ref(0)
const rows = ref<CatalogRow[]>([])
const loading = ref(false)
const error = ref('')
const editingId = ref('')
const draftZh = ref('')
const draftEn = ref('')
const saveMessage = ref('')
let timer = 0

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const rangeLabel = computed(() => {
  if (total.value === 0) return '0 筆'
  const start = (page.value - 1) * pageSize + 1
  const end = Math.min(total.value, page.value * pageSize)
  return `${start}–${end} / ${total.value.toLocaleString('zh-Hant')}`
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  const params = new URLSearchParams({
    sport: sport.value,
    kind: kind.value,
    q: query.value.trim(),
    page: String(page.value),
    page_size: String(pageSize),
  })
  try {
    const response = await fetch(`/api/mapping/catalog?${params}`)
    const body = await response.json()
    if (!response.ok) throw new Error(body.reason || '對照表讀取失敗。')
    rows.value = body.items
    total.value = body.total
  } catch (cause) {
    rows.value = []
    total.value = 0
    error.value = cause instanceof Error ? cause.message : '對照表讀取失敗。'
  } finally {
    loading.value = false
  }
}

watch([sport, kind], () => {
  page.value = 1
  void load()
})

watch(query, () => {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    page.value = 1
    void load()
  }, 200)
})

watch(page, () => void load())

void load()
onUnmounted(() => window.clearTimeout(timer))

function beginEdit(row: CatalogRow): void {
  editingId.value = row.entity_id
  draftZh.value = row.canonical_name_zh
  draftEn.value = row.canonical_name_en
  saveMessage.value = ''
}

async function save(row: CatalogRow): Promise<void> {
  saveMessage.value = ''
  const response = await fetch('/api/mapping/overrides', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      entity_id: row.entity_id,
      canonical_name_zh: draftZh.value,
      canonical_name_en: draftEn.value,
    }),
  })
  const body = await response.json()
  if (!response.ok) {
    saveMessage.value = body.reason || '儲存失敗。'
    return
  }
  editingId.value = ''
  saveMessage.value = '已寫入本機對照儲存。'
  await load()
}

function sourceLabel(source: CatalogRow['source']): string {
  if (source === 'manual') return '人手'
  if (source === 'auto') return '自動'
  return '匯入'
}
</script>

<template>
  <section class="rounded-xl border border-line bg-panel p-3" data-testid="macau-catalog">
    <div class="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h2 class="font-serif text-xl">完整對照表</h2>
        <p class="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          澳彩種子全量可查。每次只畫一頁。修改中英文後寫入本機儲存，重新整理仍會讀回，不必提交 Git。
        </p>
      </div>
      <p class="font-mono text-xs text-muted" data-testid="catalog-range">{{ rangeLabel }}</p>
    </div>
    <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
      <div class="flex rounded-md border border-line p-0.5 text-sm">
        <button type="button" class="rounded px-2.5 py-1" :class="sport === 'football' ? 'bg-gold text-ink' : 'text-muted'" @click="sport = 'football'">足球</button>
        <button type="button" class="rounded px-2.5 py-1" :class="sport === 'basketball' ? 'bg-gold text-ink' : 'text-muted'" @click="sport = 'basketball'">籃球</button>
      </div>
      <div class="flex rounded-md border border-line p-0.5 text-sm">
        <button type="button" data-testid="catalog-kind-team" class="rounded px-2.5 py-1" :class="kind === 'team' ? 'bg-gold text-ink' : 'text-muted'" @click="kind = 'team'">球隊</button>
        <button type="button" data-testid="catalog-kind-competition" class="rounded px-2.5 py-1" :class="kind === 'competition' ? 'bg-gold text-ink' : 'text-muted'" @click="kind = 'competition'">賽事</button>
      </div>
      <input
        v-model="query"
        data-testid="catalog-search"
        type="search"
        placeholder="搜尋中文、英文或 id"
        class="w-full rounded-md border border-line bg-ink px-3 py-1.5 text-sm sm:max-w-xs"
      />
    </div>
    <p v-if="loading" class="mt-2 text-xs text-muted">正在讀取這一頁…</p>
    <p v-if="error" class="mt-2 text-xs text-miss">{{ error }}</p>
    <p v-if="saveMessage" class="mt-2 text-xs text-gold">{{ saveMessage }}</p>
    <div class="mt-2 overflow-x-auto">
      <table data-testid="catalog-table" class="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
        <thead class="text-[11px] uppercase tracking-wider text-muted">
          <tr>
            <th class="px-2 py-1.5">id</th>
            <th class="px-2 py-1.5">中文</th>
            <th class="px-2 py-1.5">英文</th>
            <th class="px-2 py-1.5">運動</th>
            <th class="px-2 py-1.5">類型</th>
            <th class="px-2 py-1.5">狀態</th>
            <th class="px-2 py-1.5"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.entity_id" class="border-t border-line" data-testid="catalog-row">
            <td class="border-t border-line px-2 py-1 font-mono text-[11px] text-muted">{{ row.entity_id }}</td>
            <td class="border-t border-line px-2 py-1">
              <input v-if="editingId === row.entity_id" v-model="draftZh" data-testid="catalog-zh" class="w-full rounded border border-line bg-ink px-2 py-1" />
              <span v-else>{{ row.canonical_name_zh }}</span>
            </td>
            <td class="border-t border-line px-2 py-1">
              <input v-if="editingId === row.entity_id" v-model="draftEn" data-testid="catalog-en" class="w-full rounded border border-line bg-ink px-2 py-1" />
              <span v-else>{{ row.canonical_name_en }}</span>
            </td>
            <td class="border-t border-line px-2 py-1">{{ row.sport === 'football' ? '足球' : '籃球' }}</td>
            <td class="border-t border-line px-2 py-1">{{ row.kind === 'team' ? '球隊' : '賽事' }}</td>
            <td class="border-t border-line px-2 py-1 text-xs text-muted">
              {{ row.status === 'confirmed' ? '已確認' : '待確認' }} · {{ sourceLabel(row.source) }}
            </td>
            <td class="border-t border-line px-2 py-1 text-right">
              <button v-if="editingId !== row.entity_id" type="button" class="rounded border border-line px-2 py-1 text-xs" @click="beginEdit(row)">修改</button>
              <button v-else type="button" data-testid="catalog-save" class="rounded bg-gold px-2 py-1 text-xs font-semibold text-ink" @click="save(row)">儲存</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="mt-2 flex items-center justify-between text-sm">
      <button type="button" class="rounded border border-line px-2 py-1 disabled:opacity-40" :disabled="page <= 1" @click="page -= 1">上一頁</button>
      <span class="text-xs text-muted">第 {{ page }} / {{ pageCount }} 頁</span>
      <button type="button" data-testid="catalog-next" class="rounded border border-line px-2 py-1 disabled:opacity-40" :disabled="page >= pageCount" @click="page += 1">下一頁</button>
    </div>
  </section>
</template>
