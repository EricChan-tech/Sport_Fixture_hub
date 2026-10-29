/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIXTURE_BASE?: string
  readonly VITE_SCHEDULE_BASE?: string
  readonly VITE_SCHEDULE_JOB_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
