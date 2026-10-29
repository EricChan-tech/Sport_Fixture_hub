<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import { useMapping } from './composables/useMapping'

const { pendingCount } = useMapping()
</script>

<template>
  <div class="relative min-h-screen">
    <a href="#content" class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-gold focus:px-3 focus:py-2 focus:text-ink">
      跳到主要內容
    </a>
    <header class="sticky top-0 z-40 border-b border-line/80 bg-ink/90 backdrop-blur-md">
      <div class="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-3 sm:px-6">
        <div class="flex min-w-0 items-center gap-5">
          <RouterLink to="/" class="flex items-center gap-2.5">
            <svg viewBox="0 0 32 32" class="h-8 w-8" aria-hidden="true">
              <rect width="32" height="32" rx="6" fill="#241c12" />
              <rect x="5" y="7" width="22" height="18" rx="2" fill="none" stroke="#e0b15c" stroke-width="1.4" />
              <path d="M16 7v18M5 16h22" stroke="#e0b15c" stroke-width="1" />
            </svg>
            <span class="min-w-0">
              <span class="block font-serif text-lg leading-none tracking-wide text-paper">賽程匯</span>
              <span class="mt-1 hidden text-[10px] uppercase tracking-[0.22em] text-gold sm:block">Fixture Hub</span>
            </span>
          </RouterLink>
          <nav class="flex items-center gap-1 text-sm">
            <RouterLink to="/" class="rounded-md px-3 py-2 text-muted hover:text-paper" active-class="nav-active">
              賽程
            </RouterLink>
            <RouterLink
              to="/mapping"
              class="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-muted hover:text-paper"
              active-class="nav-active"
            >
              對照
              <span
                v-if="pendingCount > 0"
                data-testid="pending-badge"
                class="min-w-5 rounded-full bg-gold px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-ink"
              >
                {{ pendingCount }}
              </span>
            </RouterLink>
          </nav>
        </div>
        <p class="hidden text-right text-[11px] leading-tight text-muted md:block">
          亞洲／澳門
          <span class="mt-0.5 block text-gold">示範資料 · 非即時賠率</span>
        </p>
      </div>
    </header>
    <main id="content">
      <RouterView />
    </main>
  </div>
</template>
