<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useMapping } from '../composables/useMapping'
import { ORIGIN_LABEL, SPORT_LABEL } from '../lib/labels'
import { parseMappingImport, type ParsedImportItem } from '../lib/mappingImport.mjs'
import { SOURCE_META } from '../lib/sources.mjs'
import { entityKey, entityTitle } from '../services/mappingRepo'
import { macauSeedFiles } from '../lib/macauSeeds'
import MacauCatalog from '../components/MacauCatalog.vue'
import type { MappingEntity, Sport } from '../types/schema'

const route = useRoute()
const { store, pendingCount, confirm, reject, reset, addImports } = useMapping()

const tab = ref<'pending' | 'confirmed'>('pending')
const sportFilter = ref<'all' | Sport>('all')
const search = ref('')
const draft = ref('')
const parsed = ref<ReturnType<typeof parseMappingImport> | null>(null)
const importMessage = ref('')
const armReset = ref(false)
const seedLabels: Record<string, string> = {
  'football_teams.json': '足球球隊',
  'basketball_teams.json': '籃球球隊',
  'football_competitions.json': '足球賽事',
  'basketball_competitions.json': '籃球賽事',
}

const focus = computed(() => (typeof route.query.focus === 'string' ? route.query.focus : ''))

const confirmed = computed(() =>
  [...store.value.competitions, ...store.value.teams].filter((item) => item.status === 'confirmed'),
)

const pool = computed(() => (tab.value === 'pending' ? store.value.pending : confirmed.value))

const visible = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return pool.value.filter((item) => {
    if (sportFilter.value !== 'all' && item.sport !== sportFilter.value) return false
    if (!needle) return true
    const id = item.entity === 'competition' ? item.competition_id : item.team_id
    const shortName = item.entity === 'competition' ? item.short_zh : ''
    return [item.name_zh, shortName, item.name_en, id].join(' ').toLowerCase().includes(needle)
  })
})

function scrollToFocus(): void {
  if (!focus.value) return
  document.getElementById(focus.value)?.scrollIntoView({ block: 'center' })
}

watch(
  focus,
  () => {
    if (!focus.value) return
    const entity = [...store.value.competitions, ...store.value.teams].find((item) => entityKey(item) === focus.value)
    if (!entity) return
    tab.value = entity.status === 'pending' ? 'pending' : 'confirmed'
    sportFilter.value = 'all'
    search.value = ''
    void nextTick(scrollToFocus)
  },
  { immediate: true },
)

function checkDraft(): void {
  parsed.value = parseMappingImport(draft.value)
  importMessage.value = ''
}

async function loadSample(): Promise<void> {
  const response = await fetch('/samples/mapping-import.sample.json')
  draft.value = await response.text()
  parsed.value = null
  importMessage.value = response.ok ? '已載入 JSON 範例，按「檢查格式」預覽。' : '範例檔讀取失敗。'
}

function commitImport(): void {
  if (!parsed.value?.ok) return
  const error = addImports(parsed.value.items)
  if (error) {
    importMessage.value = error
    return
  }
  importMessage.value = `已加入 ${parsed.value.items.length} 筆到待確認。正式匯入仍會由日後的澳彩中英對照流程處理。`
  tab.value = 'pending'
  parsed.value = null
}

function onReject(entity: MappingEntity): void {
  reject(entity)
}

function previewItems(): ParsedImportItem[] {
  return parsed.value?.ok ? parsed.value.items : []
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-3 py-4 pb-12 sm:px-6">
    <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        <p class="text-xs uppercase tracking-[0.22em] text-gold">Mapping</p>
        <h1 class="mt-1 font-serif text-3xl">賽事與球隊對照</h1>
        <p class="mt-2 max-w-2xl text-sm text-muted">
          完整對照表可搜尋、分頁與修改。修改寫入本機儲存，重新整理後仍在。待確認佇列的確認與拒絕也寫入同一儲存。
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button type="button" class="rounded-md border border-line px-3 py-2 text-sm" @click="armReset = !armReset">還原本機示範</button>
        <button
          v-if="armReset"
          type="button"
          class="rounded-md bg-gold px-3 py-2 text-sm font-semibold text-ink"
          @click="reset(); armReset = false"
        >
          確定還原
        </button>
      </div>
    </div>

    <section class="mt-3" data-testid="macau-seed-summary">
      <ul class="mb-2 grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
        <li v-for="file in macauSeedFiles" :key="file.file" class="rounded-md border border-line px-2 py-1">
          <span class="block text-muted">{{ seedLabels[file.file] }}</span>
          <span class="font-mono text-sm text-paper">{{ file.count.toLocaleString('zh-Hant') }}</span>
        </li>
      </ul>
      <MacauCatalog />
    </section>

    <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex rounded-md border border-line p-0.5 text-sm">
        <button
          type="button"
          class="rounded px-3 py-2"
          :class="tab === 'pending' ? 'bg-gold text-ink' : 'text-muted'"
          @click="tab = 'pending'"
        >
          待確認 {{ pendingCount }}
        </button>
        <button
          type="button"
          class="rounded px-3 py-2"
          :class="tab === 'confirmed' ? 'bg-gold text-ink' : 'text-muted'"
          @click="tab = 'confirmed'"
        >
          已確認 {{ confirmed.length }}
        </button>
      </div>
      <div class="flex flex-1 flex-col gap-2 sm:flex-row sm:justify-end">
        <select v-model="sportFilter" class="rounded-md border border-line bg-panel px-3 py-2 text-sm">
          <option value="all">全部運動</option>
          <option value="football">足球</option>
          <option value="basketball">籃球</option>
        </select>
        <input
          v-model="search"
          type="search"
          placeholder="搜尋名稱、簡稱或 id"
          class="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm sm:max-w-xs"
        />
      </div>
    </div>

    <div v-if="visible.length === 0" class="mt-6 rounded-xl border border-dashed border-line px-4 py-10 text-center" data-testid="mapping-empty">
      <p class="font-serif text-2xl">{{ tab === 'pending' ? '待確認佇列是空的' : '沒有已確認項目' }}</p>
      <p class="mt-2 text-sm text-muted">可以還原種子，或在下方貼上日後的澳彩中英對照。</p>
    </div>

    <ul v-else class="mt-3 grid gap-2 lg:grid-cols-2">
      <li
        v-for="entity in visible"
        :id="entityKey(entity)"
        :key="entityKey(entity)"
        class="rounded-xl border border-line bg-panel p-3"
        :class="focus === entityKey(entity) ? 'ring-1 ring-gold' : ''"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-[11px] uppercase tracking-widest text-muted">
              {{ entity.entity === 'competition' ? '賽事' : '球隊' }} · {{ SPORT_LABEL[entity.sport] }}
            </p>
            <h2 class="mt-1 font-serif text-2xl">{{ entityTitle(entity) }}</h2>
            <p class="text-sm text-muted">{{ entity.name_en }}</p>
          </div>
          <span class="rounded-full border border-line px-2 py-1 text-[11px] text-gold">{{ ORIGIN_LABEL[entity.source] }}</span>
        </div>
        <p class="mt-2 font-mono text-[11px] text-muted">
          {{ entity.entity === 'competition' ? entity.competition_id : entity.team_id }}
        </p>
        <ul class="mt-3 space-y-1 text-xs text-muted">
          <li v-for="alias in entity.aliases" :key="alias.source_id">
            {{ SOURCE_META[alias.source_id].zh }}
            <span class="text-paper">{{ alias.name_zh || '—' }}</span>
            <span v-if="alias.name_en"> / {{ alias.name_en }}</span>
          </li>
        </ul>
        <div v-if="entity.status === 'pending'" class="mt-4 flex gap-2">
          <button type="button" class="rounded-md bg-gold px-3 py-2 text-sm font-semibold text-ink" @click="confirm(entity)">確認</button>
          <button type="button" class="rounded-md border border-line px-3 py-2 text-sm" @click="onReject(entity)">拒絕</button>
        </div>
      </li>
    </ul>

    <section class="mt-8 rounded-xl border border-line bg-panel-2/50 p-4 sm:p-5">
      <h2 class="font-serif text-2xl">澳彩中英對照匯入</h2>
      <p class="mt-2 text-sm text-muted">
        這是空的匯入殼。檢查通過後只會變成「待確認、來源：匯入」，不會覆寫已存在的 id。完整欄位說明在倉庫的
        <code class="text-gold">docs/mapping-import.md</code>。
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" class="rounded-md border border-line px-3 py-2 text-sm" @click="loadSample">載入 JSON 範例</button>
        <button type="button" class="rounded-md border border-line px-3 py-2 text-sm" @click="checkDraft">檢查格式</button>
        <button
          type="button"
          class="rounded-md bg-gold px-3 py-2 text-sm font-semibold text-ink disabled:opacity-40"
          :disabled="!parsed?.ok"
          @click="commitImport"
        >
          加入待確認
        </button>
      </div>
      <textarea
        v-model="draft"
        rows="8"
        spellcheck="false"
        placeholder="貼上 mapping_import_v1 JSON，或帶固定標題列的 CSV"
        class="mt-3 w-full rounded-md border border-line bg-ink p-3 font-mono text-xs leading-relaxed"
      />
      <p v-if="parsed && !parsed.ok" class="mt-2 text-sm text-miss" data-testid="import-error">{{ parsed.error }}</p>
      <p v-if="importMessage" class="mt-2 text-sm text-gold">{{ importMessage }}</p>
      <ul v-if="previewItems().length" class="mt-3 space-y-1 text-sm">
        <li v-for="(item, index) in previewItems()" :key="`${item.entity}-${item.id ?? index}`">
          {{ item.entity === 'competition' ? '賽事' : '球隊' }} · {{ item.name_zh }} / {{ item.name_en }}
          <span class="text-muted">· {{ item.aliases.length }} 個別名</span>
        </li>
      </ul>
    </section>
  </div>
</template>
