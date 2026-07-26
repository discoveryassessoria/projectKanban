// eslint.config.mjs — ESLint (flat config) do projeto, Next 16.
// Escopo deliberado: regras de CORRETUDE úteis para código novo, sem transformar
// uma base grande e legada num mar de avisos. O gate forte continua sendo o
// TypeScript (`npx tsc --noEmit`) + os guards em scripts/.
//
//   npm run lint                 → repositório inteiro
//   npm run lint:gerenciamento   → só o Gerenciamento (o que esta entrega tocou)
import coreWebVitals from 'eslint-config-next/core-web-vitals'

export default [
  {
    ignores: [
      '.next/**', 'node_modules/**', 'public/**',
      'src/generated/**', 'prisma/migrations/**', 'next-env.d.ts',
    ],
  },
  ...(Array.isArray(coreWebVitals) ? coreWebVitals : [coreWebVitals]),
  {
    rules: {
      // ruído em base legada — o TypeScript já cobre o essencial aqui
      '@next/next/no-img-element': 'off',
      'react/no-unescaped-entities': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      // Regra nova do React 19 que sinaliza o padrão `useEffect(() => { carregar() }, [])`
      // usado em TODA a base para buscar dados na montagem. Não é defeito: é o
      // carregamento inicial da tela. Rebaixado a AVISO em vez de reescrever ~50
      // telas que funcionam — corrigir isso é refactor de data-fetching, não lint.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
]
