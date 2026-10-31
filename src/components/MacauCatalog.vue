<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useMapping } from '../composables/useMapping'
import { SOURCE_IDS, SOURCE_META } from '../lib/sources.mjs'
import type { SourceId, Sport } from '../types/schema'

const catalogSources = SOURCE_IDS.filter((id) => id !== 'macau_lottery')

interface SourceColumn {
  name: string
  status?: 'confirmed' | 'pending'
  source?: 'auto' | 'manual' | 'import'
  editable: boolean
}

interface CatalogRow {
  entity_id: string
  sport: Sport
  kind: 'team' | 'competition'
  canonical_name_zh: string
  canonical_name_en: string
  short_name_zh: string
  source_names?: Partial<Record<SourceId, string>>
  source_columns?: Partial<Record<SourceId, SourceColumn>>
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
const draftShort = ref('')
const draftSources = ref<Partial<Record<SourceId, string>>>({})
const focusSource = ref<SourceId | ''>('')
const saving = ref(false)
const saveMessage = ref('')
const { revision } = useMapping()
const scroller = ref<HTMLElement | null>(null)
const overflowing = ref(false)
let timer = 0
let requestId = 0
let resizeObserver: ResizeObserver | undefined

function syncOverflow(): void {
  const el = scroller.value
  overflowing.value = !!el && el.scrollWidth > el.clientWidth + 1
}

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const rangeLabel = computed(() => {
  if (total.value === 0) return '0 筆'
  const start = (page.value - 1) * pageSize + 1
  const end = Math.min(total.value, page.value * pageSize)
  return `${start}–${end} / ${total.value.toLocaleString('zh-Hant')}`
})

async function load(): Promise<void> {
  const id = ++requestId
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
    if (id !== requestId) return
    if (!response.ok) throw new Error(body.reason || '對照表讀取失敗。')
    rows.value = body.items
    total.value = body.total
  } catch (cause) {
    if (id !== requestId) return
    rows.value = []
    total.value = 0
    error.value = cause instanceof Error ? cause.message : '對照表讀取失敗。'
  } finally {
    if (id === requestId) {
      loading.value = false
      void nextTick(syncOverflow)
    }
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
watch(revision, () => void load())

void load()

onMounted(() => {
  syncOverflow()
  resizeObserver = new ResizeObserver(() => syncOverflow())
  if (scroller.value) {
    resizeObserver.observe(scroller.value)
    if (scroller.value.firstElementChild) resizeObserver.observe(scroller.value.firstElementChild)
  }
})

onUnmounted(() => {
  window.clearTimeout(timer)
  resizeObserver?.disconnect()
})

function column(row: CatalogRow, sourceId: SourceId): SourceColumn {
  return row.source_columns?.[sourceId] ?? {
    name: row.source_names?.[sourceId]?.trim() || '',
    editable: true,
  }
}

function columnTitle(row: CatalogRow, sourceId: SourceId): string {
  const cell = column(row, sourceId)
  if (!cell.editable) return '已確認 · 自動，不能修改'
  if (!cell.name) return `填寫${SOURCE_META[sourceId].zh}名稱`
  if (!cell.source) return ''
  const status = cell.status === 'pending' ? '待確認' : '已確認'
  return `${status} · ${sourceLabel(cell.source)}`
}

async function beginEdit(row: CatalogRow, sourceId?: SourceId): Promise<void> {
  editingId.value = row.entity_id
  draftZh.value = row.canonical_name_zh
  draftEn.value = row.canonical_name_en
  draftShort.value = row.short_name_zh
  const next: Partial<Record<SourceId, string>> = {}
  for (const id of catalogSources) {
    if (!column(row, id).editable) continue
    next[id] = column(row, id).name
  }
  draftSources.value = next
  focusSource.value = sourceId && column(row, sourceId).editable ? sourceId : ''
  saveMessage.value = ''
  if (!focusSource.value) return
  await nextTick()
  document.querySelector<HTMLInputElement>(`[data-testid="catalog-source-input-${focusSource.value}"]`)?.focus()
}

function cancelEdit(): void {
  editingId.value = ''
  focusSource.value = ''
}

async function save(row: CatalogRow): Promise<void> {
  if (saving.value) return
  saveMessage.value = ''
  saving.value = true
  const sourceNames: Partial<Record<SourceId, string>> = {}
  for (const sourceId of catalogSources) {
    if (!column(row, sourceId).editable) continue
    const next = (draftSources.value[sourceId] ?? '').trim()
    if (next === column(row, sourceId).name.trim()) continue
    sourceNames[sourceId] = next
  }
  const payload: {
    entity_id: string
    canonical_name_zh: string
    canonical_name_en: string
    short_name_zh?: string
    source_names?: Partial<Record<SourceId, string>>
  } = {
    entity_id: row.entity_id,
    canonical_name_zh: draftZh.value,
    canonical_name_en: draftEn.value,
  }
  if (row.kind === 'competition') payload.short_name_zh = draftShort.value
  if (Object.keys(sourceNames).length > 0) payload.source_names = sourceNames
  try {
    const response = await fetch('/api/mapping/overrides', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await response.json()
    if (!response.ok) {
      saveMessage.value = body.reason || '儲存失敗。'
      return
    }
    editingId.value = ''
    focusSource.value = ''
    saveMessage.value = '已寫入對照儲存。'
    await load()
  } finally {
    saving.value = false
  }
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
        <p class="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
          澳彩種子全量可查。中文、英文是澳彩名稱，賽事列另有繁體簡稱，這三欄維持可改。其餘四欄是其他來源的隊名或賽事名：沒有名稱時顯示 —，點 — 或「修改」就能填。已確認而且來源是自動的名稱會標成自動，不能改寫。待確認、人手、匯入或空白都可以改。儲存後寫入對照儲存，重新整理仍會讀回，不必提交 Git。每日更新仍只會把高置信度對照寫進工作區；待確認要按「確認」後，別名會寫進這一列並出現在這些欄。
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
        placeholder="搜尋中文、簡稱、英文、其他來源名稱或 id"
        class="w-full rounded-md border border-line bg-ink px-3 py-1.5 text-sm sm:max-w-xs"
      />
    </div>
    <p v-if="loading" class="mt-2 text-xs text-muted">正在讀取這一頁…</p>
    <p v-if="error" class="mt-2 text-xs text-miss">{{ error }}</p>
    <p v-if="saveMessage" class="mt-2 text-xs text-gold">{{ saveMessage }}</p>
    <div ref="scroller" class="catalog-scroll mt-2 overflow-x-auto" :class="{ 'is-overflowing': overflowing }">
      <table data-testid="catalog-table" class="catalog-table w-full border-separate border-spacing-0 text-left text-[13px] leading-tight">
        <colgroup>
          <col style="width: var(--col-id)" />
          <col />
          <col v-if="kind === 'competition'" style="width: var(--col-short)" />
          <col />
          <col v-for="sourceId in catalogSources" :key="`col-${sourceId}`" />
          <col style="width: var(--col-sport)" />
          <col style="width: var(--col-kind)" />
          <col style="width: var(--col-status)" />
          <col style="width: var(--col-action)" />
        </colgroup>
        <thead class="text-[11px] tracking-normal text-muted">
          <tr>
            <th class="px-1.5 py-1.5 font-medium">id</th>
            <th class="px-1.5 py-1.5 font-medium">中文</th>
            <th v-if="kind === 'competition'" class="px-1.5 py-1.5 font-medium">簡稱</th>
            <th class="px-1.5 py-1.5 font-medium">英文</th>
            <th
              v-for="sourceId in catalogSources"
              :key="sourceId"
              class="px-1.5 py-1.5 font-medium normal-case"
              :data-testid="`catalog-head-${sourceId}`"
            >
              {{ SOURCE_META[sourceId].zh }}
            </th>
            <th class="catalog-pin catalog-pin-sport px-1 py-1.5 font-medium">運動</th>
            <th class="catalog-pin catalog-pin-kind px-1 py-1.5 font-medium">類型</th>
            <th class="catalog-pin catalog-pin-status px-1.5 py-1.5 font-medium">狀態</th>
            <th class="catalog-pin catalog-pin-action px-1 py-1.5 text-right font-medium">修改</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.entity_id" data-testid="catalog-row">
            <td class="overflow-hidden border-t border-line px-1.5 py-1 font-mono text-[11px] text-muted" :title="row.entity_id">
              <span class="block truncate">{{ row.entity_id }}</span>
            </td>
            <td class="overflow-hidden border-t border-line px-1.5 py-1">
              <input v-if="editingId === row.entity_id" v-model="draftZh" data-testid="catalog-zh" class="catalog-input" />
              <span v-else class="block truncate" :title="row.canonical_name_zh">{{ row.canonical_name_zh }}</span>
            </td>
            <td v-if="kind === 'competition'" class="overflow-hidden border-t border-line px-1.5 py-1">
              <input v-if="editingId === row.entity_id" v-model="draftShort" data-testid="catalog-short" class="catalog-input" />
              <span v-else class="block truncate" data-testid="catalog-short-text" :title="row.short_name_zh || undefined">{{ row.short_name_zh || '—' }}</span>
            </td>
            <td class="overflow-hidden border-t border-line px-1.5 py-1">
              <input v-if="editingId === row.entity_id" v-model="draftEn" data-testid="catalog-en" class="catalog-input" />
              <span v-else class="block truncate" :title="row.canonical_name_en">{{ row.canonical_name_en }}</span>
            </td>
            <td
              v-for="sourceId in catalogSources"
              :key="sourceId"
              class="overflow-hidden border-t border-line px-1.5 py-1"
              :data-testid="`catalog-source-${sourceId}`"
              :data-editable="column(row, sourceId).editable ? 'true' : 'false'"
              :data-origin="column(row, sourceId).source || 'empty'"
              :title="columnTitle(row, sourceId)"
            >
              <input
                v-if="editingId === row.entity_id && column(row, sourceId).editable"
                v-model="draftSources[sourceId]"
                :data-testid="`catalog-source-input-${sourceId}`"
                class="catalog-input"
              />
              <div v-else-if="column(row, sourceId).editable" class="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  class="min-w-0 truncate text-left hover:text-gold"
                  :data-testid="column(row, sourceId).name ? `catalog-source-edit-${sourceId}` : `catalog-fill-${sourceId}`"
                  @click="beginEdit(row, sourceId)"
                >
                  <span :class="column(row, sourceId).name ? '' : 'text-muted'">{{ column(row, sourceId).name || '—' }}</span>
                </button>
                <span v-if="column(row, sourceId).source" class="shrink-0 text-[10px] text-muted">{{ sourceLabel(column(row, sourceId).source!) }}</span>
              </div>
              <div v-else class="flex min-w-0 items-center gap-1">
                <span class="min-w-0 truncate">{{ column(row, sourceId).name }}</span>
                <span class="shrink-0 text-[10px] tracking-wider text-gold">自動</span>
              </div>
            </td>
            <td class="catalog-pin catalog-pin-sport whitespace-nowrap border-t border-line px-1 py-1">{{ row.sport === 'football' ? '足球' : '籃球' }}</td>
            <td class="catalog-pin catalog-pin-kind whitespace-nowrap border-t border-line px-1 py-1">{{ row.kind === 'team' ? '球隊' : '賽事' }}</td>
            <td class="catalog-pin catalog-pin-status whitespace-nowrap border-t border-line px-1.5 py-1 text-xs text-muted">
              {{ row.status === 'confirmed' ? '已確認' : '待確認' }} · {{ sourceLabel(row.source) }}
            </td>
            <td class="catalog-pin catalog-pin-action whitespace-nowrap border-t border-line px-1 py-1 text-right">
              <button v-if="editingId !== row.entity_id" type="button" data-testid="catalog-edit" class="rounded border border-line px-1.5 py-1 text-xs" @click="beginEdit(row)">修改</button>
              <div v-else class="inline-flex flex-col items-stretch gap-1">
                <button type="button" data-testid="catalog-save" class="rounded bg-gold px-1.5 py-1 text-xs font-semibold text-ink disabled:opacity-40" :disabled="saving" @click="save(row)">儲存</button>
                <button type="button" data-testid="catalog-cancel" class="rounded border border-line px-1.5 py-1 text-xs" @click="cancelEdit">取消</button>
              </div>
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

<style scoped>
.catalog-table {
  --col-id: 14rem;
  --col-short: 8.5rem;
  --col-sport: 2.75rem;
  --col-kind: 2.75rem;
  --col-status: 6.75rem;
  --col-action: 3.25rem;
  table-layout: fixed;
  min-width: 68rem;
}

.catalog-input {
  width: 100%;
  min-width: 0;
  border-radius: 0.25rem;
  border: 1px solid var(--color-line);
  background: var(--color-ink);
  padding: 0.125rem 0.375rem;
}

.catalog-pin {
  position: sticky;
  z-index: 1;
  background-color: var(--color-panel);
}

.catalog-pin-sport {
  right: calc(var(--col-kind) + var(--col-status) + var(--col-action));
}

.is-overflowing .catalog-pin-sport {
  border-left: 1px solid var(--color-line);
  box-shadow: -8px 0 8px -8px rgb(0 0 0 / 0.55);
}

.catalog-pin-kind {
  right: calc(var(--col-status) + var(--col-action));
}

.catalog-pin-status {
  right: var(--col-action);
}

.catalog-pin-action {
  right: 0;
  z-index: 2;
}
</style>
