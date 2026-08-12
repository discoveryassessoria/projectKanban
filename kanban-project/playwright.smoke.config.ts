// playwright.smoke.config.ts
//
// CONFIG SEPARADA DO SMOKE QUE ESCREVE.
//
// `playwright.config.ts` é somente-leitura por regra: os testes de lá navegam e
// conferem, nunca clicam em ação que grava — porque apontam para o banco do
// `.env`, que é produção. Este smoke PRECISA clicar em "Excluir", então não
// pode entrar naquele `testMatch`. Ele roda por invocação explícita e só toca
// dados marcados (`SMOKE-UI-CICLO-VIDA`), criados e removidos por
// `scripts/smoke-ui-setup.ts`.
import base from './playwright.config'

const config = { ...base, testMatch: /.*\.smoke\.ts$/ }
export default config
