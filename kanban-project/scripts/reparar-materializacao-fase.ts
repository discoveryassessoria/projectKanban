// scripts/reparar-materializacao-fase.ts
// ============================================================================
// REPARO IDEMPOTENTE de fases ATIVAS que ficaram sem materialização.
//
// O QUE ELE CONSERTA
//   Fase ATIVA cuja instância existe mas não tem passo nenhum. Acontece quando a
//   fase foi materializada num instante em que as entidades-alvo ainda não existiam
//   (o caso normal: o processo nasce antes da árvore). Nada re-materializava depois,
//   e a fase ficava viva e vazia para sempre.
//
// COMO ELE CONSERTA
//   Chamando o materializador OFICIAL (`materializarExecucaoDaFase`). Não há lógica
//   de reparo própria: se o reparo precisasse de código diferente do runtime, o
//   runtime é que estaria errado.
//
// O QUE ELE NUNCA FAZ
//   • apagar ou recriar ciclo (completa o ciclo existente);
//   • tocar em ciclo anterior, em passo concluído ou em tarefa existente;
//   • concluir, cancelar ou dispensar obrigação nenhuma;
//   • duplicar pessoa, necessidade, passo ou tarefa (tudo por chave idempotente).
//
// USO
//   npx tsx scripts/reparar-materializacao-fase.ts                   # diagnóstico
//   npx tsx scripts/reparar-materializacao-fase.ts --execute
//   npx tsx scripts/reparar-materializacao-fase.ts --processo 505 --execute
// ============================================================================

import { prisma } from "@/lib/prisma"
import { materializarExecucaoDaFase, validarMaterializacaoDaFase } from "@/src/services/materializar-fase"

const EXECUTE = process.argv.includes("--execute")
const idx = process.argv.indexOf("--processo")
const PROCESSO_ALVO = idx >= 0 ? parseInt(process.argv[idx + 1] ?? "", 10) : null

interface Linha {
  processoId: number
  codigo: string | null
  nome: string
  faseAtualKey: string | null
  instanciaId: number | null
  ciclo: number | null
  passosAntes: number
  tarefasAntes: number
  passosDepois: number
  tarefasDepois: number
  estado: string
  motivos: string[]
}

async function contarTarefasDaInstancia(instanciaId: number | null): Promise<number> {
  if (instanciaId == null) return 0
  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: instanciaId }, select: { id: true },
  })
  if (passos.length === 0) return 0
  return prisma.tarefa.count({ where: { workflowStepInstanceId: { in: passos.map((p) => p.id) } } })
}

async function main() {
  console.log(`\nReparo de materialização — modo ${EXECUTE ? "EXECUTAR" : "SOMENTE LEITURA"}`)
  if (PROCESSO_ALVO) console.log(`Processo alvo: ${PROCESSO_ALVO}`)

  const processos = await prisma.processo.findMany({
    where: {
      workflowRuntime: "v2",
      faseAtualKey: { not: null },
      ...(PROCESSO_ALVO ? { id: PROCESSO_ALVO } : {}),
    },
    select: { id: true, codigo: true, nome: true, faseAtualKey: true },
    orderBy: { id: "asc" },
  })
  console.log(`Processos v2 com fase de referência: ${processos.length}\n`)

  const afetados: Linha[] = []

  for (const p of processos) {
    const instancia = await prisma.phaseWorkflowInstance.findFirst({
      where: { processoId: p.id, faseMacroKey: p.faseAtualKey!, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
      orderBy: { ciclo: "desc" },
      select: { id: true, ciclo: true },
    })
    const passosAntes = instancia
      ? await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: instancia.id } })
      : 0
    // Fase ativa COM passos está saudável — o reparo não a toca.
    if (instancia && passosAntes > 0) continue

    const tarefasAntes = await contarTarefasDaInstancia(instancia?.id ?? null)
    const linha: Linha = {
      processoId: p.id, codigo: p.codigo, nome: p.nome, faseAtualKey: p.faseAtualKey,
      instanciaId: instancia?.id ?? null, ciclo: instancia?.ciclo ?? null,
      passosAntes, tarefasAntes, passosDepois: passosAntes, tarefasDepois: tarefasAntes,
      estado: "NAO_EXECUTADO", motivos: [],
    }

    if (EXECUTE) {
      const r = await materializarExecucaoDaFase({
        processoId: p.id,
        faseMacroKey: p.faseAtualKey,
        fonte: "REPARO_ADMINISTRATIVO",
      })
      linha.estado = r.estado
      linha.motivos = r.motivos.map((m) => `${m.code}: ${m.message}`)
      linha.instanciaId = r.workflowInstanceId ?? linha.instanciaId
      linha.ciclo = r.ciclo ?? linha.ciclo
      linha.passosDepois = r.passosTotais
      linha.tarefasDepois = await contarTarefasDaInstancia(linha.instanciaId)
    } else {
      linha.estado = "PENDENTE_DE_REPARO"
    }

    afetados.push(linha)
  }

  if (afetados.length === 0) {
    console.log("✔ Nenhuma fase ativa sem materialização. Nada a reparar.")
    await prisma.$disconnect()
    return
  }

  console.log(`Fases ativas SEM materialização: ${afetados.length}\n`)
  for (const l of afetados) {
    console.log(`  #${l.processoId} ${l.codigo ?? "—"} "${l.nome}" · fase ${l.faseAtualKey} · instância ${l.instanciaId ?? "—"} (ciclo ${l.ciclo ?? "—"})`)
    console.log(`      passos ${l.passosAntes} → ${l.passosDepois} · tarefas ${l.tarefasAntes} → ${l.tarefasDepois} · ${l.estado}`)
    for (const m of l.motivos) console.log(`      · ${m}`)
    if (EXECUTE && l.instanciaId != null) {
      const v = await validarMaterializacaoDaFase(l.instanciaId)
      console.log(`      validação: pessoas ${v.pessoasOficiais} · alvos ${v.alvosResolvidos} · passos ${v.passos} · tarefas ${v.tarefas} · vazamento de ciclo ${v.vazamentoDeCiclo}${v.problemas.length ? ` · PROBLEMAS: ${v.problemas.join("; ")}` : ""}`)
    }
  }

  if (!EXECUTE) console.log("\n(diagnóstico — rode com --execute para reparar)")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
