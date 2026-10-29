import { createRouter, createWebHistory } from 'vue-router'
import SchedulePage from './views/SchedulePage.vue'
import MappingPage from './views/MappingPage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'schedule', component: SchedulePage },
    { path: '/mapping', name: 'mapping', component: MappingPage },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})
