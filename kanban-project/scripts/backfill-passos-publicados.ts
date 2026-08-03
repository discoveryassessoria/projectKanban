// scripts/backfill-passos-publicados.ts
//
// BACKFILL IDEMPOTENTE — processos ativos cuja fase está sem as instâncias dos passos
// publicados. Consequência da regressão a2dd7ee3 (18/07/2026), que parou de instanciar
// o template do Workflow Interno em fases operadas por entidade.
//
// Faz DUAS coisas, ambas reversíveis e auditadas:
//
//  A) CADASTRO — corrige workflows publicados cuja phaseKey não existe no catálogo
//     oficial de fases (esses workflows nunca são encontrados, logo a fase nunca
//     materializa nada). A correspondência é EXPLÍCITA e declarada abaixo; nada é
//     adivinhado. Um phaseKey fora do catálogo e fora do mapa é REPORTADO, não tocado.
//
//  B) PROCESSOS — reconcilia a fase ATIVA de cada processo pelo serviço canônico
//     (reconciliarFaseAtiva): cria o que falta, recupera o que existe, não duplica,
//     não conclui passo, não avança fase, não apaga histórico.
//
// Uso:
//   npx tsx --env-file=.env scripts/backfill-passos-publicados.ts             # relatório
//   npx tsx --env-file=.env scripts/backfill-passos-publicados.ts --execute   # aplica

import { PrismaClient } from "@prisma/client"
import { reconciliarFaseAtiva } from "../src/services/reconciliar-fase"
import { phaseKeyToFaseCode } from "../src/lib/process-stage/fases-catalog"

const prisma = new PrismaClient()
const EXECUTAR = process.argv.includes("--execute")

// Correspondência EXPLÍCITA phaseKey publicado → phaseKey do catálogo oficial.
// Só entra aqui o que é inequívoco (o nome do workflow nomeia a mesma fase).
const RENOMEAR_PHASEKEY: Record<string, string> = {
  retificacao: "retificacao_registros",
  traducao: "traducao_juramentada",
}

async function main() {
  console.log(EXECUTAR ? "MODO: EXECUÇÃO\n" : "MODO: RELATÓRIO (use --execute para aplicar)\n")

  // ── A) cadastro: phaseKey fora do catálogo ────────────────────────────────
  console.log("A) Workflows publicados com phaseKey fora do catálogo oficial")
  const wfs = await prisma.phaseInternalWorkflow.findMany({
    where: { arquivado: false },
    select: { id: true, name: true, phaseKey: true, wfUid: true, tipoProcessoId: true },
    orderBy: { id: "asc" },
  })
  const fora = wfs.filter((w) => phaseKeyToFaseCode(w.phaseKey) == null)
  if (fora.length === 0) console.log("   nenhum — cadastro alinhado ao catálogo.")
  for (const w of fora) {
    const destino = RENOMEAR_PHASEKEY[w.phaseKey]
    if (!destino) {
      console.log(`   ⚠ wf#${w.id} "${w.name}" phaseKey="${w.phaseKey}" — SEM correspondência declarada. NÃO alterado; corrija no Gerenciamento.`)
      continue
    }
    // Colisão: já existe workflow para a fase de destino com o mesmo tipoProcesso?
    const colide = await prisma.phaseInternalWorkflow.findFirst({
      where: { phaseKey: destino, tipoProcessoId: w.tipoProcessoId, arquivado: false, id: { not: w.id } },
      select: { id: true },
    })
    if (colide) {
      console.log(`   ⚠ wf#${w.id} "${w.name}": destino "${destino}" já tem o wf#${colide.id}. NÃO alterado (evita duplicidade).`)
      continue
    }
    const novoUid = `${w.tipoProcessoId ?? "all"}::${destino}`
    console.log(`   ${EXECUTAR ? "✔ corrigindo" : "→ corrigiria"} wf#${w.id} "${w.name}": phaseKey "${w.phaseKey}" → "${destino}", wfUid "${w.wfUid}" → "${novoUid}"`)
    if (EXECUTAR) {
      await prisma.phaseInternalWorkflow.update({
        where: { id: w.id },
        data: { phaseKey: destino, wfUid: novoUid },
      })
      await prisma.logAuditoria.create({
        data: {
          acao: "BACKFILL_PHASEKEY_CATALOGO",
          entidade: "PhaseInternalWorkflow",
          entidadeId: w.id,
          descricao: `phaseKey corrigido de "${w.phaseKey}" para "${destino}" (alinhamento ao catálogo oficial de fases)`,
          detalhes: { de: w.phaseKey, para: destino, wfUidDe: w.wfUid, wfUidPara: novoUid },
        },
      }).catch((e) => console.log(`     (auditoria não registrada: ${(e as Error).message})`))
    }
  }

  // ── B) processos: fase ativa sem os passos publicados ─────────────────────
  console.log("\nB) Processos com fase ativa")
  const processos = await prisma.processo.findMany({
    where: { faseAtualKey: { not: null } },
    select: { id: true, codigo: true, nome: true, faseAtualKey: true },
    orderBy: { id: "asc" },
  })
  let comFalta = 0
  let criados = 0
  let tarefas = 0
  for (const p of processos) {
    const inst = await prisma.phaseWorkflowInstance.findFirst({
      where: { processoId: p.id, faseMacroKey: p.faseAtualKey!, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
      orderBy: { ciclo: "desc" },
      select: { id: true, ciclo: true },
    })
    const antes = inst
      ? await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: inst.id } })
      : 0

    if (!EXECUTAR) {
      console.log(`   proc${p.id} (${p.codigo}) · ${p.faseAtualKey} · instância=${inst?.id ?? "nenhuma"} · passos atuais=${antes}`)
      continue
    }

    const r = await reconciliarFaseAtiva(p.id)
    if (r.erro) {
      comFalta++
      console.log(`   ⚠ proc${p.id} (${p.codigo}) · ${p.faseAtualKey}: ${r.erro}`)
      continue
    }
    criados += r.passosCriados
    tarefas += r.tarefasCriadas
    console.log(`   ✔ proc${p.id} (${p.codigo}) · ${r.faseMacroKey} c${r.ciclo} · passos ${antes} → ${r.passosTotais} (+${r.passosCriados}) · tarefas +${r.tarefasCriadas}${r.avisos.length ? ` · avisos: ${r.avisos.map((a) => a.code).join(",")}` : ""}`)
    if (r.passosCriados > 0) {
      await prisma.logAuditoria.create({
        data: {
          acao: "BACKFILL_PASSOS_PUBLICADOS",
          entidade: "PROCESSO",
          entidadeId: p.id,
          descricao: `Fase "${r.faseMacroKey}" ciclo ${r.ciclo}: ${r.passosCriados} passo(s) publicado(s) instanciado(s), ${r.tarefasCriadas} tarefa(s) criada(s)`,
          detalhes: { workflowInstanceId: r.workflowInstanceId, passosAntes: antes, passosDepois: r.passosTotais, tarefasCriadas: r.tarefasCriadas },
        },
      }).catch((e) => console.log(`     (auditoria não registrada: ${(e as Error).message})`))
    }
  }

  console.log(`\nRESUMO: ${processos.length} processo(s) com fase ativa · ${criados} passo(s) criado(s) · ${tarefas} tarefa(s) criada(s) · ${comFalta} com erro`)
  if (!EXECUTAR) console.log("Nada foi escrito. Rode com --execute para aplicar.")
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
