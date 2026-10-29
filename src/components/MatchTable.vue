<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { NAME_ORIGIN, SOURCE_IDS, SOURCE_META } from '../lib/sources.mjs'
import { HEALTH_LABEL, STATUS_LABEL } from '../lib/labels'
import { resolveDisplayName, sortByCompetition, sortByTime } from '../lib/productRules.mjs'
import { kickoffClock } from '../lib/time'
import type { Manifest, Match, SortMode, SourceCell, SourceId } from '../types/schema'

const props = defineProps<{
  matches: Match[]
  mode: SortMode
  lockedIds: string[]
  pendingCompetitionIds: string[]
  pendingTeamIds: string[]
  catalogNames: Record<string, string>
  health: Manifest['source_health']
}>()

const ordered = computed(() =>
  props.mode === 'time' ? sortByTime(props.matches) : sortByCompetition(props.matches),
)

function groupStart(index: number): boolean {
  if (props.mode !== 'competition') return false
  const current = ordered.value[index]
  const previous = ordered.value[index - 1]
  if (!current) return false
  return !previous || previous.competition_id !== current.competition_id
}

function groupCount(competitionId: string): number {
  return ordered.value.filter((match) => match.competition_id === competitionId).length
}

function originTitle(match: Match, field: 'league_name' | 'home_name' | 'away_name'): string {
  const sourceId = resolveDisplayName(match.sources, field).source_id
  return sourceId ? NAME_ORIGIN[sourceId] : '尚無來源名稱'
}

function swappedSources(match: Match): SourceCell[] {
  return match.sources.filter((cell) => cell.sides_swapped === true && cell.cell !== 'missing')
}

function swapTitle(match: Match): string {
  const names = swappedSources(match).map((cell) => SOURCE_META[cell.source_id].zh)
  if (names.length === 0) return ''
  return `主客對調：${names.join('、')} 的主客與綜合方向相反`
}

function formatDelta(minutes: number): string {
  const abs = Math.abs(minutes)
  if (minutes > 0) return `遲 ${abs} 分`
  if (minutes < 0) return `早 ${abs} 分`
  return '差 0 分'
}

function healthTitle(sourceId: SourceId): string {
  const item = props.health[sourceId]
  const status = item.status === 'down' ? '無法取得資料' : HEALTH_LABEL[item.status]
  const rate = item.success_rate == null ? '未統計' : `${Math.round(item.success_rate * 100)}%`
  const detail = item.message ? item.message : ''
  return [status, `成功率 ${rate}`, detail].filter(Boolean).join('。')
}

function pendingFocus(match: Match): string | null {
  if (props.pendingCompetitionIds.includes(match.competition_id)) return `competition:${match.competition_id}`
  if (props.pendingTeamIds.includes(match.home_team_id)) return `team:${match.home_team_id}`
  if (props.pendingTeamIds.includes(match.away_team_id)) return `team:${match.away_team_id}`
  return null
}
</script>

<template>
  <div class="match-scroll max-h-[calc(100vh-11rem)] overflow-auto rounded-xl border border-line">
    <table data-testid="match-table" class="w-full min-w-[1080px] border-separate border-spacing-0 text-[13px] leading-tight">
      <caption class="sr-only">
        賽程表。紅格「缺」代表來源沒有該場，黃格代表開賽時間不一致，主客隊名紅框代表主客對調。
      </caption>
      <thead class="text-left text-[11px] uppercase tracking-wider text-muted">
        <tr>
          <th class="px-2 py-1.5 font-medium">開賽</th>
          <th class="px-2 py-1.5 font-medium">賽事</th>
          <th class="px-2 py-1.5 font-medium">主隊</th>
          <th class="px-2 py-1.5 font-medium">客隊</th>
          <th
            v-for="sourceId in SOURCE_IDS"
            :key="sourceId"
            class="px-1.5 py-1.5 text-center font-medium"
            :title="healthTitle(sourceId)"
            :data-testid="`source-head-${sourceId}`"
          >
            <span class="inline-flex items-center justify-center gap-1 text-paper">
              {{ SOURCE_META[sourceId].zh }}
              <span
                class="inline-block h-2 w-2 shrink-0 rounded-full"
                :class="{
                  'bg-ok': health[sourceId].status === 'ok',
                  'bg-warn': health[sourceId].status === 'degraded',
                  'bg-miss': health[sourceId].status === 'down',
                }"
                :data-testid="`source-dot-${sourceId}`"
                :data-status="health[sourceId].status"
              />
            </span>
          </th>
          <th class="px-2 py-1.5 font-medium">狀態</th>
          <th class="px-2 py-1.5 font-medium">信心</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(match, index) in ordered" :key="match.match_id">
          <tr v-if="groupStart(index)" data-testid="group-header">
            <th colspan="11" class="border-t border-line bg-ink px-2 py-1 text-left font-serif text-sm font-medium text-paper">
              {{ resolveDisplayName(match.sources, 'league_name').text }}
              <span class="ml-2 text-xs font-sans text-muted">{{ groupCount(match.competition_id) }} 場</span>
              <span
                v-if="lockedIds.includes(match.competition_id)"
                class="ml-2 rounded-full border border-gold/50 px-2 py-0.5 text-[11px] font-sans text-gold"
              >
                澳彩鎖定
              </span>
              <span
                v-if="catalogNames[match.competition_id] && catalogNames[match.competition_id] !== resolveDisplayName(match.sources, 'league_name').text"
                class="ml-2 text-xs font-sans text-muted"
              >
                目錄 {{ catalogNames[match.competition_id] }}
              </span>
            </th>
          </tr>
          <tr class="align-middle hover:bg-panel-2/70" :data-match-id="match.match_id">
            <td class="border-t border-line px-2 py-1 font-mono text-sm text-paper">
              {{ kickoffClock(match.kickoff_at) }}
              <span v-if="lockedIds.includes(match.competition_id)" class="block text-[10px] leading-none tracking-widest text-gold">澳彩</span>
            </td>
            <td class="border-t border-line px-2 py-1">
              <p :title="originTitle(match, 'league_name')">
                {{ resolveDisplayName(match.sources, 'league_name').text }}
              </p>
              <RouterLink
                v-if="pendingFocus(match)"
                :to="{ path: '/mapping', query: { focus: pendingFocus(match) ?? '' } }"
                class="inline-block text-[11px] leading-none text-gold underline-offset-2 hover:underline"
              >
                待對照
              </RouterLink>
            </td>
            <td class="border-t border-line px-2 py-1">
              <div
                class="inline-block rounded px-1 py-0.5"
                :class="swappedSources(match).length ? 'name-swap' : ''"
                :title="swappedSources(match).length ? swapTitle(match) : originTitle(match, 'home_name')"
                :data-sides-swapped="swappedSources(match).length ? 'home' : undefined"
              >
                {{ resolveDisplayName(match.sources, 'home_name').text }}
                <span v-if="swappedSources(match).length" class="mt-0.5 block text-[10px] leading-none tracking-widest text-miss">主客對調</span>
              </div>
            </td>
            <td class="border-t border-line px-2 py-1">
              <div
                class="inline-block rounded px-1 py-0.5"
                :class="swappedSources(match).length ? 'name-swap' : ''"
                :title="swappedSources(match).length ? swapTitle(match) : originTitle(match, 'away_name')"
                :data-sides-swapped="swappedSources(match).length ? 'away' : undefined"
              >
                {{ resolveDisplayName(match.sources, 'away_name').text }}
                <span v-if="swappedSources(match).length" class="mt-0.5 block text-[10px] leading-none tracking-widest text-miss">主客對調</span>
              </div>
            </td>
            <td v-for="cell in match.sources" :key="cell.source_id" class="border-t border-line px-1 py-1">
              <span v-if="cell.cell === 'missing'" class="cell-miss" data-cell="missing">缺</span>
              <span v-else-if="cell.cell === 'mismatch'" class="cell-warn" data-cell="mismatch">
                <span class="font-mono">{{ kickoffClock(cell.kickoff_at ?? match.kickoff_at) }}</span>
                <span class="text-[10px] leading-tight tracking-wide">
                  偏差<template v-if="typeof cell.delta_minutes === 'number'"> · {{ formatDelta(cell.delta_minutes) }}</template>
                </span>
              </span>
              <span v-else class="cell-ok" data-cell="ok">
                <span class="font-mono">{{ kickoffClock(cell.kickoff_at ?? match.kickoff_at) }}</span>
              </span>
            </td>
            <td class="border-t border-line px-2 py-1">
              <span
                class="rounded-full px-1.5 py-0.5 text-[11px]"
                :class="{
                  'bg-panel-2 text-paper': match.status === 'scheduled',
                  'bg-gold text-ink': match.status === 'live',
                  'text-muted': match.status === 'finished',
                  'bg-warn-bg text-warn': match.status === 'postponed' || match.status === 'cancelled',
                }"
              >
                {{ STATUS_LABEL[match.status] }}
              </span>
            </td>
            <td class="border-t border-line px-2 py-1 font-mono text-[11px] text-muted">
              {{ Math.round(match.confidence * 100) }}%
              <span class="mt-0.5 block h-1 w-12 overflow-hidden rounded bg-line">
                <span class="block h-full bg-gold" :style="{ width: `${Math.round(match.confidence * 100)}%` }" />
              </span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
