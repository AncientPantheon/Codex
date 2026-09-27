/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** See .env.example — the local-dev Kadena-node override (hairpin-NAT escape hatch). */
  readonly VITE_KADENA_NODE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
