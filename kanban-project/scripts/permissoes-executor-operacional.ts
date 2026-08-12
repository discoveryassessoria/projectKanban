// scripts/permissoes-executor-operacional.ts
// ============================================================================
// CONCEDE A QUEM EXECUTA O QUE FALTA PARA EXECUTAR.
//
//   npx tsx scripts/permissoes-executor-operacional.ts            (dry-run)
//   npx tsx scripts/permissoes-executor-operacional.ts --execute
//
// O perfil "Assistente" já declara a matriz operacional certa (executa a
// etapa, não conduz o processo). O problema é de DADO: os usuários operacionais
// de produção não têm perfil — têm um mapa de permissões nominais montado à
// mão, e nele faltam as duas permissões de execução do workflow.
//
// Este script concede EXATAMENTE essas duas, a quem já tem
// `tarefas.iniciar_concluir` — ou seja, a quem o cadastro já reconhece como
// executor. Não concede poder gerencial: avançar fase, forçar avanço, reabrir
// ciclo, aprovar, dispensar, cancelar e transferir continuam de fora.
//
// Idempotente: rodar de novo não muda nada.
// ============================================================================
import { PrismaClient } from "@prisma/client"
import { calcularPermissoes, temPermissao, type MapaPermissoes } from "@/src/lib/permissoes"

const EXECUTAR = process.argv.includes("--execute")
/** O mínimo para executar a etapa — e nada além disso. */
const EXECUCAO = ["workflow.iniciarPasso", "workflow.concluirPasso"] as const
/** O que NÃO pode ser concedido por este caminho, em hipótese alguma. */
const GERENCIAIS = [
  "workflow.avancar", "workflow.forcarAvanco", "workflow.reabrirFase", "workflow.retornarFase",
  "workflow.ativarV2", "workflow.aprovarPasso", "workflow.dispensarPasso", "workflow.cancelarPasso",
  "workflow.supersederPasso", "workflow.gerarTarefa", "tarefas.editar", "usuarios.gerenciar",
]

async function main() {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL || process.env.PRISMA_DATABASE_URL } } })
  const usuarios = await p.usuario.findMany({
    select: { id: true, nome: true, tipo: true, permissoesCustom: true, perfil: { select: { nome: true, permissoes: true } } },
    orderBy: { id: "asc" },
  })

  console.log(`${EXECUTAR ? "EXECUÇÃO" : "DRY-RUN"} · ${usuarios.length} usuário(s)\n`)
  let alterados = 0

  for (const u of usuarios) {
    const efetivas = calcularPermissoes(u.tipo, u.perfil?.permissoes as MapaPermissoes | null, u.permissoesCustom as MapaPermissoes | null)
    // Só quem o cadastro já reconhece como EXECUTOR.
    if (!temPermissao(efetivas, "tarefas.iniciar_concluir")) {
      console.log(`  — ${u.nome}: não é executor (sem tarefas.iniciar_concluir)`)
      continue
    }
    const faltando = EXECUCAO.filter((k) => !temPermissao(efetivas, k))
    if (faltando.length === 0) {
      console.log(`  ✓ ${u.nome}: já pode executar`)
      continue
    }
    console.log(`  → ${u.nome} (${u.tipo}${u.perfil ? `, perfil ${u.perfil.nome}` : ", sem perfil"}): conceder ${faltando.join(", ")}`)
    alterados++

    if (EXECUTAR) {
      const custom = { ...((u.permissoesCustom as MapaPermissoes | null) ?? {}) }
      for (const k of faltando) custom[k] = true
      // TRAVA: este caminho nunca concede poder de gestão, nem por engano.
      for (const g of GERENCIAIS) if (custom[g] === true && !((u.permissoesCustom as MapaPermissoes | null)?.[g])) delete custom[g]
      await p.usuario.update({ where: { id: u.id }, data: { permissoesCustom: custom } })
      await p.logAuditoria.create({
        data: {
          acao: "PERMISSOES_EXECUCAO_CONCEDIDAS",
          entidade: "Usuario",
          entidadeId: u.id,
          descricao: `Concedidas ${faltando.join(", ")} a ${u.nome} — sem elas, quem executa abre a tarefa e não consegue concluir a etapa.`,
          detalhes: { concedidas: faltando, tipo: u.tipo, perfil: u.perfil?.nome ?? null },
        },
      })
    }
  }

  console.log(`\n${alterados} usuário(s) a ajustar`)
  if (!EXECUTAR && alterados > 0) console.log("Rode com --execute para aplicar.")
  await p.$disconnect()
}

main().catch(async (e) => { console.error(e); process.exit(1) })
