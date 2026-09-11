// scripts/home-total-acoes-deduplicado.test.ts
// ============================================================================
// UNIDADE 2 do plano de consolidação (10/09/2026) — achado real da auditoria:
// `totalAcoes`/"N ações pendentes" (`src/app/api/home/route.ts`) era
// `Σ fila.quantidade` sobre 17 filas NÃO mutuamente exclusivas. Um Step
// executável com prazo definido cai em DUAS filas ao mesmo tempo (a do verbo,
// ex. "localizar", e "prazos-vencendo") — a soma antiga contava o MESMO Step
// duas vezes.
//
// Prova, com dado real (não mock):
//   1. Um Step executável com prazo aparece em 2 filas — cada fila,
//      individualmente, continua contando certo (não mudou nada na exibição
//      por fila).
//   2. `contarTrabalhoPendenteDistinto` (a correção) conta esse Step 1 vez,
//      não 2 — mesmo aparecendo nas duas filas.
//   3. A fórmula ANTIGA (soma das quantidades das filas) teria dado 2 para o
//      mesmo cenário — prova concreta do bug, não hipótese.
//   4. Itens de grãos DIFERENTES (Step + Tarefa) continuam sendo contados
//      separadamente — a deduplicação é por IDENTIDADE, não por grain.
//
//   npx tsx scripts/home-total-acoes-deduplicado.test.ts
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { carregarBase, montarFilas, contarTrabalhoPendenteDistinto, type ContextoHome } from "@/src/lib/home/coleta"

const MARCA = "HOMEDEDUP"

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
  if (ids.length) {
    await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  }
  const arvIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
  if (arvIds.length) await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@homededup.test" } } })
}

async function main() {
  exigirBancoDeTeste("prova que o total de 'ações pendentes' da Home não conta o mesmo item duas vezes")
  await limpar()

  console.log("HOME — TOTAL DE AÇÕES PENDENTES NÃO DUPLICA ITEM ENTRE FILAS\n")

  const admin = await prisma.usuario.create({ data: { nome: "Admin", email: "admin@homededup.test", senha: "x", tipo: "admin" }, select: { id: true } })

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arvore` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo`, arvoreId: arv.id, faseAtualKey: "genealogia" }, select: { id: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-${proc.id}` },
    select: { id: true },
  })
  const amanha = new Date(Date.now() + 24 * 3600_000)

  // ══════════════════════════════════════════════════════════════════════════
  secao("1) UM Step executável, com prazo — cai em 'localizar' E em 'prazos-vencendo' ao mesmo tempo")
  // ══════════════════════════════════════════════════════════════════════════
  await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia", stepKey: "localizar_registro",
      ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL", prazo: amanha,
      // responsavelId setado de propósito: sem isso, o PRÓPRIO processo entra
      // também na fila "sem-responsavel" — um item de identidade DIFERENTE
      // (`processo:{id}`, não `passo:{id}`) que confundiria esta prova, cujo
      // objetivo é isolar SÓ a sobreposição step↔prazo. "Sem responsável" tem
      // teste próprio de sobra no restante da suíte.
      papel: "equipe_documental", slaDays: 5, chaveIdempotencia: `${MARCA}-s-${proc.id}-0`, responsavelId: admin.id,
    },
  })

  const ctx: ContextoHome = {
    userId: admin.id, isAdmin: true,
    permissoes: { verProcessos: true, verTarefas: true, verEventos: true, verFinanceiro: true, isAdmin: true },
    agora: new Date(),
  }
  const base = await carregarBase(ctx)
  const filas = montarFilas(base, ctx)
  const filaLocalizar = filas.find((f) => f.key === "localizar")
  const filaPrazos = filas.find((f) => f.key === "prazos-vencendo")
  ok("1a) fila 'localizar' contém o step (exibição por fila continua correta)", filaLocalizar?.quantidade === 1, String(filaLocalizar?.quantidade))
  ok("1b) fila 'prazos-vencendo' TAMBÉM contém o MESMO step", filaPrazos?.quantidade === 1, String(filaPrazos?.quantidade))

  // ══════════════════════════════════════════════════════════════════════════
  secao("2) A fórmula ANTIGA (soma das filas) contava esse único step DUAS vezes — prova do bug")
  // ══════════════════════════════════════════════════════════════════════════
  const somaAntiga = filas.reduce((acc, f) => acc + f.quantidade, 0)
  ok("2a) Σ fila.quantidade = 2 para UM único step — este era o bug real ('35 ações' da auditoria)", somaAntiga === 2, String(somaAntiga))

  // ══════════════════════════════════════════════════════════════════════════
  secao("3) A CORREÇÃO — contarTrabalhoPendenteDistinto conta esse mesmo step só 1 vez")
  // ══════════════════════════════════════════════════════════════════════════
  const totalCorrigido = contarTrabalhoPendenteDistinto(base, ctx)
  ok("3a) total corrigido = 1 (identidade do step, não pertencimento a fila)", totalCorrigido === 1, String(totalCorrigido))

  // ══════════════════════════════════════════════════════════════════════════
  secao("4) Grãos DIFERENTES continuam contados separadamente — dedup é por IDENTIDADE, não por grain")
  // ══════════════════════════════════════════════════════════════════════════
  const t = await prisma.tarefa.create({
    data: {
      processoId: proc.id, titulo: `${MARCA} tarefa`, statusTarefa: "AGUARDANDO_CLIENTE", concluida: false,
      dataPrazo: amanha, origem: "MANUAL", motivo: "teste",
      // responsavelId setado pelo mesmo motivo do Step acima: sem isso, o
      // PRÓPRIO processo entraria também em "sem-responsavel" — um terceiro
      // item de identidade (`processo:{id}`) estranho ao que esta seção quer
      // provar (dedup entre grains Step/Tarefa via prazo).
      responsavelId: admin.id,
    },
    select: { id: true },
  })
  const base2 = await carregarBase(ctx)
  const total2 = contarTrabalhoPendenteDistinto(base2, ctx)
  // O step (1) + a tarefa (aparece em "aguardando-cliente" E "prazos-vencendo",
  // mas é 1 item só) = 2 itens distintos no total, nunca 4.
  ok("4a) step + tarefa (cada um em 2 filas) = 2 itens distintos, não 4", total2 === 2, String(total2))
  const filas2 = montarFilas(base2, ctx)
  const filaAguardando = filas2.find((f) => f.key === "aguardando-cliente")
  ok("4b) fila 'aguardando-cliente' continua vendo a tarefa normalmente", filaAguardando?.quantidade === 1)
  void t

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) console.log("Falhas:", falhas.join(", "))
  await limpar()
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
