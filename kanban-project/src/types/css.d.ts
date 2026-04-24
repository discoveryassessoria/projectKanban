// src/types/css.d.ts
//
// Declaração de módulo pra arquivos .css importados como side-effect.
// Sem isso, o TypeScript reclama:
//   "Cannot find module or type declarations for side-effect import of
//    '@/src/styles/financeiro.css'"  (ts2882)
//
// O Next.js já faz o bundling correto em runtime — essa declaração é só
// pro TypeScript não barrar o build.

declare module '*.css'
declare module '*.scss'
declare module '*.sass'