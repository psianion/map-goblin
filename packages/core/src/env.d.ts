// Vite environment types (core doesn't depend on vite directly)
interface ImportMetaEnv {
  readonly VITE_CDN_BASE_URL?: string;
  [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Vite ?url imports for WASM files
declare module '*.wasm?url' {
  const url: string;
  export default url;
}

// clipper2-wasm specific ?url import
declare module 'clipper2-wasm/dist/es/clipper2z.wasm?url' {
  const url: string;
  export default url;
}
