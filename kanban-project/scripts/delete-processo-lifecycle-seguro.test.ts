// scripts/delete-processo-lifecycle-seguro.test.ts
// ============================================================================
// DELETE DE PROCESSO — lifecycle seguro (docs/architecture/26).
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/delete-processo-lifecycle-seguro.test.ts
//
// A pergunta de cada caso: excluir um Processo nunca destrói fato financeiro
// materializado (mesmo o que só existe direto no processoId, sem pessoa nem
// documento) e nunca cascateia sobre Árvore/Pessoa sem passar pelo mecanismo
// canônico que já existe para eles.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { analisarExclusaoProcesso, excluirProcesso } from "@/src/services/processo-ciclo-vida"
import { PERMISSOES_EXCLUSIVAS, calcularPermissoes } from "@/src/lib/permissoes"

const MARCA = "DELPROC-TEST"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacao: { processoId: { in: ids } } } })
  await prisma.obrigacaoEconomica.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.anexoProcesso.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  const arvoreIds = procs.map((p) => p.arvoreId).filter((id): id is number => id != null)
  if (arvoreIds.length) {
    await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvoreIds } } })
    await prisma.arvore.deleteMany({ where: { id: { in: arvoreIds } } })
  }
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Processo", descricao: { contains: MARCA } } })
}

let seq = 0
async function processoDeTeste(opts: { comArvore?: boolean; arvoreId?: number } = {}) {
  seq++
  let arvoreId = opts.arvoreId ?? null
  if (opts.comArvore && arvoreId == null) {
    const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore ${seq}` }, select: { id: true } })
    arvoreId = arv.id
  }
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} processo ${seq}`, arvoreId },
    select: { id: true, arvoreId: true },
  })
  return proc
}

async function main() {
  exigirBancoDeTeste("delete-processo-lifecycle-seguro.test.ts")
  await limpar()

  // ── PERMISSÃO: EXCLUSIVA, ninguém ganha por tipo=admin sozinho ───────────
  secao("RBAC — processos.excluirDefinitivo é EXCLUSIVA")
  ok("está na lista de permissões exclusivas", PERMISSOES_EXCLUSIVAS.has("processos.excluirDefinitivo"))
  const permsAdminSemPerfil = calcularPermissoes("admin", null, null)
  ok("tipo=admin sozinho (sem perfil) NÃO concede a permissão",
    permsAdminSemPerfil["processos.excluirDefinitivo"] === false)
  const permsAdminComPerfilPadrao = calcularPermissoes("admin", { "processos.excluirDefinitivo": false }, null)
  ok("perfil Administrador padrão (herda TODAS_PERMISSOES=false para exclusiva) também não concede",
    permsAdminComPerfilPadrao["processos.excluirDefinitivo"] === false)
  const permsComConcessaoNominal = calcularPermissoes("assistente", null, { "processos.excluirDefinitivo": true })
  ok("concessão NOMINAL explícita (custom) concede, mesmo para tipo não-admin",
    permsComConcessaoNominal["processos.excluirDefinitivo"] === true)

  // ── TESTE 1: Processo sem dependências relevantes ────────────────────────
  secao("Caso 1 — Processo limpo pode ser excluído")
  const p1 = await processoDeTeste()
  const plano1 = await analisarExclusaoProcesso(p1.id)
  ok("plano não encontra fato protegido", plano1?.podeExcluir === true)
  const r1 = await excluirProcesso({ processoId: p1.id, actorUserId: null })
  ok("exclusão sucede", r1.ok === true)
  ok("processo realmente sai do banco", (await prisma.processo.count({ where: { id: p1.id } })) === 0)
  const log1 = await prisma.logAuditoria.findFirst({ where: { entidade: "Processo", entidadeId: p1.id, acao: "processo_excluido_definitivo" } })
  ok("histórico/auditoria da exclusão foi gravado", log1 !== null)

  // ── TESTE 4/5: obrigação aberta (não paga) x obrigação PAGA ──────────────
  secao("Caso 2 — obrigação econômica ABERTA (sem movimento) não bloqueia")
  const p2 = await processoDeTeste()
  const obrigAberta = await prisma.obrigacaoEconomica.create({
    data: {
      processoId: p2.id, natureza: "RECEITA", direcao: "ENTRADA",
      codigoOperacional: `${MARCA}-OBR-ABERTA-${seq}`, moedaContratual: "BRL", moedaContabil: "BRL",
      valorContratado: "1000.00",
    },
    select: { id: true },
  })
  const plano2 = await analisarExclusaoProcesso(p2.id)
  ok("obrigação sem movimento NÃO é fato protegido", plano2?.podeExcluir === true)
  const r2 = await excluirProcesso({ processoId: p2.id, actorUserId: null })
  ok("exclusão sucede", r2.ok === true)
  ok("a obrigação (nunca paga) sai junto",
    (await prisma.obrigacaoEconomica.count({ where: { id: obrigAberta.id } })) === 0)

  secao("Caso 3 — obrigação econômica PAGA bloqueia a exclusão (CRÍTICO — o achado da auditoria)")
  const p3 = await processoDeTeste()
  const obrigPaga = await prisma.obrigacaoEconomica.create({
    data: {
      // SEM personId, SEM documentoId — exatamente o caso que pessoa-ciclo-vida.ts
      // não enxerga (G3 da auditoria): obrigação lançada direto no processo.
      processoId: p3.id, natureza: "RECEITA", direcao: "ENTRADA",
      codigoOperacional: `${MARCA}-OBR-PAGA-${seq}`, moedaContratual: "BRL", moedaContabil: "BRL",
      valorContratado: "1000.00",
    },
    select: { id: true },
  })
  await prisma.ocorrenciaFinanceira.create({
    data: { obrigacaoId: obrigPaga.id, tipo: "PAGAMENTO", status: "PROCESSADA", valor: "1000.00", data: new Date() },
  })
  const plano3 = await analisarExclusaoProcesso(p3.id)
  ok("o pagamento é reconhecido como fato protegido",
    plano3?.fatosProtegidos.some((f) => f.tipo === "PAGAMENTO_OU_MOVIMENTO") === true)
  ok("plano recusa a exclusão", plano3?.podeExcluir === false)
  const r3 = await excluirProcesso({ processoId: p3.id, actorUserId: null })
  ok("exclusão é RECUSADA", !r3.ok && r3.code === "FATO_FINANCEIRO_PROTEGIDO", r3.code ?? "")
  ok("o Processo continua existindo — nada foi apagado", (await prisma.processo.count({ where: { id: p3.id } })) === 1)
  ok("a obrigação paga continua íntegra", (await prisma.obrigacaoEconomica.count({ where: { id: obrigPaga.id } })) === 1)
  ok("o pagamento continua íntegro", (await prisma.ocorrenciaFinanceira.count({ where: { obrigacaoId: obrigPaga.id } })) === 1)
  const logBloqueado = await prisma.logAuditoria.findFirst({ where: { entidade: "Processo", entidadeId: p3.id, acao: "processo_excluido_definitivo" } })
  ok("nenhuma auditoria de 'excluído' foi gravada para uma exclusão recusada", logBloqueado === null)

  // ── TESTE 7: Árvore compartilhada por 2 processos — excluir um não afeta o outro ──
  secao("Caso 4 — Árvore/Pessoa compartilhada sobrevivem à exclusão de UM processo")
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore compartilhada` }, select: { id: true } })
  const pessoaCompartilhada = await prisma.pessoa.create({
    data: { arvoreId: arv.id, nome: "Fulano", sobrenome: `Compartilhado${seq}` }, select: { id: true },
  })
  const pA = await processoDeTeste({ arvoreId: arv.id })
  const pB = await processoDeTeste({ arvoreId: arv.id })
  const r4 = await excluirProcesso({ processoId: pA.id, actorUserId: null })
  ok("processo A é excluído", r4.ok === true)
  ok("processo B (mesma árvore) continua existindo", (await prisma.processo.count({ where: { id: pB.id } })) === 1)
  ok("a Árvore continua existindo — NÃO foi tocada", (await prisma.arvore.count({ where: { id: arv.id } })) === 1)
  ok("a Pessoa compartilhada continua existindo", (await prisma.pessoa.count({ where: { id: pessoaCompartilhada.id } })) === 1)
  await prisma.processo.delete({ where: { id: pB.id } }) // limpeza direta, fora do escopo desta correção

  // ── TESTE — Processo único da Árvore: árvore fica órfã, mas NÃO é apagada ──
  secao("Caso 5 — Processo único da Árvore: exclusão NÃO cascateia para Árvore/Pessoa")
  const arvSolo = await prisma.arvore.create({ data: { nome: `${MARCA} árvore solo` }, select: { id: true } })
  const pessoaSolo = await prisma.pessoa.create({
    data: { arvoreId: arvSolo.id, nome: "Fulano", sobrenome: `Solo${seq}` }, select: { id: true },
  })
  const pSolo = await processoDeTeste({ arvoreId: arvSolo.id })
  const r5 = await excluirProcesso({ processoId: pSolo.id, actorUserId: null })
  ok("processo (último da árvore) é excluído", r5.ok === true)
  ok("a Árvore (agora órfã) NÃO foi apagada por este DELETE — fica para o mecanismo canônico dela",
    (await prisma.arvore.count({ where: { id: arvSolo.id } })) === 1)
  ok("a Pessoa continua existindo", (await prisma.pessoa.count({ where: { id: pessoaSolo.id } })) === 1)

  // ── TESTE 12: idempotência — repetir o DELETE não gera novo dano ─────────
  secao("Caso 6 — DELETE repetido é idempotente")
  const p6 = await processoDeTeste()
  const r6a = await excluirProcesso({ processoId: p6.id, actorUserId: null })
  const r6b = await excluirProcesso({ processoId: p6.id, actorUserId: null })
  ok("primeira chamada sucede", r6a.ok === true)
  ok("segunda chamada (já excluído) retorna NÃO ENCONTRADO, sem erro novo",
    !r6b.ok && r6b.code === "PROCESSO_NAO_ENCONTRADO")
  const logs6 = await prisma.logAuditoria.count({ where: { entidade: "Processo", entidadeId: p6.id, acao: "processo_excluido_definitivo" } })
  ok("auditoria não duplicou", logs6 === 1, `${logs6}`)

  // ── TESTE 14: concorrência — no máximo uma efetiva a mutação ─────────────
  secao("Caso 7 — duas exclusões concorrentes: só uma efetiva")
  const p7 = await processoDeTeste()
  const [ra, rb] = await Promise.all([
    excluirProcesso({ processoId: p7.id, actorUserId: null }),
    excluirProcesso({ processoId: p7.id, actorUserId: null }),
  ])
  const sucessos = [ra, rb].filter((r) => r.ok).length
  ok("exatamente uma das duas concorrentes efetiva a exclusão", sucessos === 1, `${sucessos}`)
  ok("a outra recebe NÃO ENCONTRADO (serializada pelo lock), não um erro genérico",
    [ra, rb].some((r) => !r.ok && r.code === "PROCESSO_NAO_ENCONTRADO"))

  // ── TESTE: contagens do preview batem com o que realmente sai ────────────
  secao("Caso 8 — preview (GET impacto-exclusao) é honesto sobre o que sai")
  const p8 = await processoDeTeste()
  await prisma.anexoProcesso.create({
    data: {
      processoId: p8.id, nome: `${MARCA}.pdf`, tipo: "documento",
      nomeArquivo: `${MARCA}.pdf`, urlArquivo: "https://example.test/x.pdf",
    },
  })
  const plano8 = await analisarExclusaoProcesso(p8.id)
  ok("preview conta o anexo exclusivo do processo", plano8?.anexos === 1)
  const r8 = await excluirProcesso({ processoId: p8.id, actorUserId: null })
  ok("exclusão sucede", r8.ok === true)
  ok("o anexo realmente saiu (cascade do banco, coerente com o preview)",
    (await prisma.anexoProcesso.count({ where: { processoId: p8.id } })) === 0)

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) {
    console.log("\nFalhas:", falhas.join(", "))
    process.exit(1)
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
