<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import aliasesFile from '../config/aliases.json'
import DateNav from '../components/DateNav.vue'
import MatchTable from '../components/MatchTable.vue'
import UpdateControl from '../components/UpdateControl.vue'
import WhitelistModal from '../components/WhitelistModal.vue'
import { useMapping } from '../composables/useMapping'
import { useSchedule } from '../composables/useSchedule'
import { useWhitelist } from '../composables/useWhitelist'
import { SPORT_LABEL } from '../lib/labels'
import { macauLockedCompetitionIds, sortByCompetition, sortByTime } from '../lib/productRules.mjs'
import { readSortMode, writeSortMode } from '../lib/storage'
import { NAME_ORIGIN } from '../lib/sources.mjs'
import { todayInMacau } from '../lib/time'
import type { SortMode, Sport } from '../types/schema'

const route = useRoute()
const router = useRouter()
const today = todayInMacau()
const { manifest, days, loadState, errorMessage, scheduleNotice, load } = useSchedule()
const { store } = useMapping()

function parseSport(value: unknown): Sport {
  return value === 'basketball' ? 'basketball' : 'football'
}

const sport = computed({
  get: (): Sport => parseSport(route.query.sport),
  set: (value) => {
    void router.replace({ query: { ...route.query, sport: value, date: date.value } })
  },
})

const date = computed({
  get: (): string => {
    const value = route.query.date
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today
  },
  set: (value) => {
    void router.replace({ query: { ...route.query, sport: sport.value, date: value } })
  },
})

const sortMode = ref<SortMode>(readSortMode())
const whitelistOpen = ref(false)

const sportMatches = computed(() =>
  days.value.filter((day) => day.sport === sport.value).flatMap((day) => day.matches),
)
const macauLocked = computed(() => macauLockedCompetitionIds(sportMatches.value))
const lockedRef = computed(() => macauLocked.value)
const { ids, notice, toggle, selectAll, selectNone, resetDefault, clearPrefs } = useWhitelist(sport, lockedRef)

const dayFile = computed(() => days.value.find((day) => day.sport === sport.value && day.date === date.value) ?? null)
const visible = computed(() => (dayFile.value?.matches ?? []).filter((match) => ids.value.includes(match.competition_id)))
const markedDates = computed(() => {
  const block = manifest.value?.sports.find((item) => item.sport === sport.value)
  return block?.days.map((day) => day.date) ?? []
})
const hiddenCount = computed(() => (dayFile.value?.matches.length ?? 0) - visible.value.length)

const aliasMap = aliasesFile.competitions as Record<string, string[] | undefined>
const options = computed(() => {
  const counts = new Map<string, number>()
  for (const match of sportMatches.value) counts.set(match.competition_id, (counts.get(match.competition_id) ?? 0) + 1)
  const known = new Set<string>([
    ...store.value.competitions.filter((item) => item.sport === sport.value).map((item) => item.competition_id),
    ...macauLocked.value,
    ...sportMatches.value.map((match) => match.competition_id),
  ])
  return [...known]
    .map((id) => {
      const mapped = store.value.competitions.find((item) => item.competition_id === id)
      const aliasNames = (mapped?.aliases ?? []).flatMap((alias) => [alias.name_zh, alias.name_en].filter((name): name is string => Boolean(name)))
      return {
        competition_id: id,
        name_zh: mapped?.name_zh ?? id,
        name_en: mapped?.name_en ?? '',
        short_zh: mapped?.short_zh ?? '',
        aliases: [...aliasNames, ...(aliasMap[id] ?? [])],
        pending: mapped?.status === 'pending',
        locked: macauLocked.value.includes(id),
        fixtureCount: counts.get(id) ?? 0,
      }
    })
    .sort((a, b) => Number(b.locked) - Number(a.locked) || a.name_zh.localeCompare(b.name_zh, 'zh-Hant'))
})

const catalogNames = computed(() =>
  Object.fromEntries(store.value.competitions.map((item) => [item.competition_id, item.name_zh])),
)
const pendingCompetitionIds = computed(() =>
  store.value.competitions.filter((item) => item.status === 'pending').map((item) => item.competition_id),
)
const pendingTeamIds = computed(() => store.value.teams.filter((item) => item.status === 'pending').map((item) => item.team_id))

const orderedIds = computed(() =>
  (sortMode.value === 'time' ? sortByTime(visible.value) : sortByCompetition(visible.value)).map((match) => match.match_id),
)

function setSort(mode: SortMode): void {
  sortMode.value = mode
  writeSortMode(mode)
}

onMounted(() => {
  if (!route.query.date || !route.query.sport) {
    void router.replace({ query: { sport: sport.value, date: date.value } })
  }
  void load()
})
</script>

<template>
  <div class="mx-auto max-w-[1440px] px-3 pb-16 sm:px-6">
    <section class="sticky top-14 z-30 -mx-3 border-b border-line/70 bg-ink/85 px-3 py-1.5 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div class="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div class="flex flex-col gap-2 lg:flex-row lg:items-center">
          <label class="text-sm text-muted">
            運動
            <select
              data-testid="sport-select"
              class="ml-2 rounded-md border border-line bg-panel px-2 py-1 text-paper"
              :value="sport"
              @change="sport = ($event.target as HTMLSelectElement).value === 'basketball' ? 'basketball' : 'football'"
            >
              <option value="football">{{ SPORT_LABEL.football }}</option>
              <option value="basketball">{{ SPORT_LABEL.basketball }}</option>
            </select>
          </label>
          <DateNav :date="date" :today="today" :marked-dates="markedDates" @update:date="date = $event" />
        </div>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div class="flex items-center gap-2 text-sm" role="group" aria-label="排序">
            <span class="text-muted">排序</span>
            <div class="flex rounded-md border border-line p-0.5">
            <button
              type="button"
              data-testid="sort-time"
              class="rounded px-2.5 py-1"
              :class="sortMode === 'time' ? 'bg-gold text-ink' : 'text-muted'"
              :aria-pressed="sortMode === 'time'"
              @click="setSort('time')"
            >
              開賽時間
            </button>
            <button
              type="button"
              data-testid="sort-competition"
              class="rounded px-2.5 py-1"
              :class="sortMode === 'competition' ? 'bg-gold text-ink' : 'text-muted'"
              :aria-pressed="sortMode === 'competition'"
              @click="setSort('competition')"
            >
              賽事
            </button>
            </div>
          </div>
          <button
            type="button"
            data-testid="whitelist-open"
            class="rounded-md border border-line px-2.5 py-1 text-sm hover:border-gold"
            @click="whitelistOpen = true"
          >
            白名單 {{ ids.length }}
          </button>
          <UpdateControl
            :date="date"
            :today="today"
            :window-days="manifest?.manual_update_window_days ?? 3"
            :stored-success="manifest?.last_success_at ?? null"
            @finished="load()"
          />
        </div>
      </div>
    </section>

    <p v-if="scheduleNotice" data-testid="schedule-notice" class="mt-2 rounded-lg border border-line px-3 py-1.5 text-sm leading-snug text-muted">
      {{ scheduleNotice }}
    </p>

    <div class="mt-2 flex items-end justify-between gap-3">
      <div>
        <h1 class="font-serif text-2xl leading-none">{{ SPORT_LABEL[sport] }}賽程</h1>
        <p class="mt-1 text-sm leading-snug text-muted">
          顯示 {{ visible.length }} 場
          <template v-if="hiddenCount > 0">，白名單藏起 {{ hiddenCount }} 場</template>
          。名稱順序：澳彩中文，其次雷速／AiScore 中文，最後 BetExplorer／Scoresway 英文。
        </p>
      </div>
      <p class="hidden text-xs text-muted sm:block">每日正式排程預定澳門時間 06:00</p>
    </div>

    <div v-if="loadState === 'loading'" class="mt-6 space-y-2" data-testid="schedule-loading">
      <div v-for="row in 6" :key="row" class="h-12 animate-pulse rounded-md bg-panel" />
    </div>
    <div v-else-if="loadState === 'error'" class="mt-6 rounded-xl border border-miss/50 bg-miss-bg/30 p-6" data-testid="schedule-error">
      <p class="font-serif text-xl">賽程暫時讀不到</p>
      <p class="mt-2 text-sm text-muted">{{ errorMessage }}</p>
      <button type="button" class="mt-4 rounded-md bg-gold px-3 py-2 text-sm font-semibold text-ink" @click="load()">再試一次</button>
    </div>
    <div v-else-if="visible.length === 0" class="mt-6 rounded-xl border border-dashed border-line px-4 py-10 text-center" data-testid="schedule-empty">
      <p class="font-serif text-2xl">這一日沒有可顯示的賽事</p>
      <p class="mx-auto mt-2 max-w-lg text-sm text-muted">
        {{ dayFile ? '白名單把這一日的賽事都濾掉了。' : '示範樣本集中在 2026-10-28 至 2026-11-02。' }}
      </p>
      <div class="mt-4 flex justify-center gap-2">
        <button v-if="dayFile" type="button" class="rounded-md border border-line px-3 py-2 text-sm" @click="whitelistOpen = true">調整白名單</button>
        <button v-else type="button" class="rounded-md bg-gold px-3 py-2 text-sm font-semibold text-ink" @click="date = '2026-10-30'">
          打開 10 月 30 日
        </button>
      </div>
    </div>
    <div v-else class="mt-2" :data-order="orderedIds.join(',')" :data-sort-mode="sortMode" data-testid="sort-mode">
      <p v-if="sortMode === 'competition'" class="mb-2 text-sm text-gold">同一賽事已排在一起，組別按最早開賽時間。</p>
      <MatchTable
        v-if="manifest"
        :matches="visible"
        :mode="sortMode"
        :locked-ids="macauLocked"
        :pending-competition-ids="pendingCompetitionIds"
        :pending-team-ids="pendingTeamIds"
        :catalog-names="catalogNames"
        :health="manifest.source_health"
      />
      <ul class="mt-2 grid gap-1.5 text-xs text-muted sm:grid-cols-4">
        <li class="rounded-md border border-line px-2 py-1"><span class="text-ok">時間</span> 與綜合開賽時間一致</li>
        <li class="rounded-md border border-line px-2 py-1"><span class="text-warn">黃格</span> 時間偏差，並標相差分鐘</li>
        <li class="rounded-md border border-line px-2 py-1"><span class="text-miss">紅底缺</span> 該來源沒有這場</li>
        <li class="rounded-md border border-line px-2 py-1"><span class="text-miss">紅框</span> 主客對調，不是缺格</li>
      </ul>
      <p class="mt-3 text-xs text-muted">
        名稱出處例：{{ NAME_ORIGIN.macau_lottery }}；沒有中文來源時改用英文。時區固定為 Asia/Macau。
      </p>
    </div>

    <WhitelistModal
      :open="whitelistOpen"
      :options="options"
      :selected-ids="ids"
      :notice="notice"
      @close="whitelistOpen = false"
      @toggle="toggle"
      @select-all="selectAll(options.map((option) => option.competition_id))"
      @select-none="selectNone"
      @reset-default="resetDefault"
      @clear-prefs="clearPrefs"
    />
  </div>
</template>
