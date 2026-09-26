interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /**
   * Optional override for the Liveblocks auth endpoint. Defaults to the
   * `liveblocks-auth` Supabase Edge Function. The Liveblocks secret key is
   * never a VITE_ variable: it lives only in that function.
   */
  readonly VITE_LIVEBLOCKS_AUTH_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
