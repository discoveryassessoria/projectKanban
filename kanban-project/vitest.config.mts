// vitest.config.mts
// ============================================================================
// TESTE DE COMPONENTE — infraestrutura oficial.
//
// Por que existe: até aqui a base só tinha testes ESTRUTURAIS (scripts tsx que
// leem o código e afirmam contratos). Eles provam arquitetura, mas não provam
// COMPORTAMENTO: se um modal preserva o que foi digitado, se o foco fica onde
// deve, se a lista revalida depois de excluir. Isso só se prova renderizando.
//
// Escolhas:
//  • Vitest — ESM nativo, entende o TS do projeto sem build separado, e roda os
//    testes de componente em paralelo. Não substitui os scripts tsx existentes;
//    convive com eles (`npm run test:*` continua igual).
//  • jsdom — DOM suficiente para render, eventos, foco e acessibilidade.
//  • Só `*.test.tsx` entra aqui. Os `*.test.ts` de scripts/ seguem no tsx, para
//    não misturar dois mundos nem reescrever o que já funciona.
// ============================================================================
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // O React REMOVE `act` do bundle de produção. O build da Vercel roda com
    // NODE_ENV=production, então sem forçar `test` aqui os testes de componente
    // quebram apenas no CI com "React.act is not a function" — passando local.
    env: { NODE_ENV: 'test' },
    setupFiles: ['./testes/setup.ts'],
    // Escopo deliberado: componentes. Os guards estruturais continuam em
    // scripts/*.test.ts rodando via tsx.
    include: ['testes/**/*.test.tsx'],
    restoreMocks: true,
    clearMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
  resolve: {
    alias: {
      // Mesmo mapeamento do tsconfig (`@/*` → raiz do projeto).
      '@': path.resolve(__dirname, '.'),
    },
  },
})
