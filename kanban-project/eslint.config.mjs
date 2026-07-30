// eslint.config.mjs — ESLint (flat config) do projeto, Next 16.
//
// SEM rebaixamento e SEM desligamento de regra: o preset do Next vale integralmente.
// O que o lint aponta é corrigido no CÓDIGO, nunca na configuração. `ignores` cobre
// apenas o que não é código-fonte nosso (build, dependências, artefatos gerados).
//
//   npm run lint                 → repositório inteiro (0 erros, 0 avisos)
//   npm run lint:gerenciamento   → recorte do Gerenciamento
import coreWebVitals from 'eslint-config-next/core-web-vitals'

const configuracao = [
  {
    ignores: [
      '.next/**', 'node_modules/**', 'public/**',
      'src/generated/**', 'prisma/migrations/**', 'next-env.d.ts',
    ],
  },
  ...(Array.isArray(coreWebVitals) ? coreWebVitals : [coreWebVitals]),
]

export default configuracao
