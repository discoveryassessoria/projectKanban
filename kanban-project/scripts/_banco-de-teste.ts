// scripts/_banco-de-teste.ts
// ============================================================================
// TRAVA DE AMBIENTE PARA SCRIPTS QUE ESCREVEM.
//
// ─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
// Um script de teste roda com o `.env` do projeto. O `.env` do projeto aponta
// para PRODUÇÃO. Logo, `npx tsx scripts/qualquer-coisa.test.ts` — sem nenhuma
// variável na frente — monta e derruba cenário no banco do cliente.
//
// Não é hipótese. A auditoria de 09/08/2026 encontrou 49 testes que escrevem em
// banco e não verificavam ambiente nenhum. E no processo 513 há a marca do
// estrago: os requerentes 134, 135 e 137 perderam `personId` em UMA escrita, às
// 14:44:26.441 de 08/08, com o `updatedAt` idêntico ao milissegundo nos três e
// SEM entrada no LogAuditoria — a assinatura de um `updateMany` de rotina de
// limpeza, não do serviço canônico (que grava linha a linha e sempre audita).
//
// A regra: TESTE AUTOMATIZADO NÃO ESCREVE EM PRODUÇÃO. Nunca. A trava é por
// construção, não por disciplina — e o guard `test:guard-cadastro-arvore`
// reprova qualquer script que escreva sem passar por aqui.
//
// ─── DUAS PORTAS, PROPOSITALMENTE DIFERENTES ────────────────────────────────
//   exigirBancoDeTeste()                      teste: só banco LOCAL de teste;
//   exigirConfirmacaoDeEscritaEmProducao()    ato administrativo deliberado.
//
// A segunda não é um atalho da primeira: ela exige uma variável digitada à mão,
// registra no console o que vai fazer, e existe só para os poucos scripts cujo
// PROPÓSITO é escrever em produção (criar a identidade técnica de smoke, por
// exemplo). Um teste que precisar dela está pedindo a coisa errada.
// ============================================================================

/** URL de banco que o processo vai realmente usar. */
function urlDoBanco(): string {
  return process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || process.env.DIRECT_DATABASE_URL || ""
}

/** Esconde a senha ao imprimir. */
function seguro(url: string): string {
  return url.replace(/:[^:@/]*@/, ":***@")
}

/**
 * O banco é LOCAL e de TESTE? Duas condições, ambas obrigatórias:
 * host em loopback E nome de database contendo "test". Uma só não basta —
 * um banco local chamado `discovery` pode ser uma restauração de produção,
 * e um banco remoto chamado `x_test` pode ser qualquer coisa.
 */
export function ehBancoDeTesteLocal(url: string = urlDoBanco()): boolean {
  if (!url) return false
  const hostLocal = /(^|[@/])(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/.test(url)
  if (!hostLocal) return false
  const semQuery = url.split("?")[0]
  const database = semQuery.slice(semQuery.lastIndexOf("/") + 1)
  return /test/i.test(database)
}

/**
 * TRAVA DE TESTE. Chame no topo de todo script que ESCREVE e existe para
 * verificar comportamento. Encerra o processo se o banco não for local de teste.
 */
export function exigirBancoDeTeste(nome = "Este script"): void {
  const url = urlDoBanco()
  if (ehBancoDeTesteLocal(url)) return

  console.error(`\n⛔ ${nome} ESCREVE no banco e o alvo não é um banco de teste local.`)
  console.error(`   alvo atual : ${url ? seguro(url) : "(nenhuma URL de banco definida)"}`)
  console.error(`   exigido    : host 127.0.0.1/localhost E database com "test" no nome`)
  console.error(`\n   Suba o banco de teste e aponte para ele:`)
  console.error(`     node scripts/mrg-banco-teste.mjs up`)
  console.error(`     PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \\`)
  console.error(`     DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" npx tsx <script>\n`)
  process.exit(1)
}

/**
 * ATO ADMINISTRATIVO EM PRODUÇÃO. Só para o punhado de scripts cujo propósito É
 * escrever no ambiente real (identidade técnica de smoke, cenário marcado de
 * validação). Exige confirmação digitada e diz em voz alta o que vai fazer.
 *
 * Não use isto para calar a trava de um teste. Um teste que escreve em produção
 * é um defeito, não uma configuração.
 */
export function exigirConfirmacaoDeEscritaEmProducao(motivo: string, nome = "Este script"): void {
  if (ehBancoDeTesteLocal()) return // banco de teste: segue sem cerimônia

  if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "1") {
    console.error(`\n⛔ ${nome} ESCREVE em produção e a confirmação não foi dada.`)
    console.error(`   alvo   : ${seguro(urlDoBanco()) || "(nenhuma URL de banco definida)"}`)
    console.error(`   motivo : ${motivo}`)
    console.error(`\n   Se é isto mesmo que você quer, repita com:`)
    console.error(`     EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx <script>\n`)
    process.exit(1)
  }
  console.warn(`\n⚠️  ESCRITA EM PRODUÇÃO AUTORIZADA — ${nome}`)
  console.warn(`   alvo   : ${seguro(urlDoBanco())}`)
  console.warn(`   motivo : ${motivo}\n`)
}
