// scripts/cadastrar-executores-solicitar-certidao.ts
// ============================================================================
// CADASTRO do executor especializado nas 4 subtarefas do Modelo da Biblioteca
// "solicitar_certidao" (mandato 23/09/2026: religar os 4 editores
// especializados em vez do modal genérico).
//
// Hoje, em produção, as 4 `StepSubtaskDefinition` deste Modelo têm
// `executorKey: null` — por isso `EditorDoKind` (StepEditors.tsx) cai sempre
// no editor genérico (`FormPadrao`), mesmo com `EditorSolicitarCertidao`/
// `EditorAguardarRetorno`/`EditorReceberCertidao`/`EditorConferirEValidarCertidao`
// já registrados em `REGISTRO_DE_EXECUTORES`. Este script só faz o cadastro
// que falta (edição de rascunho — mesmo campo que `ConfiguracaoDoPassoModal`
// grava) e então PUBLICA pela porta real (`publicarModelo`), que já propaga
// para toda fase real vinculada via `republicarVinculosReais` (mandato
// "regra crucial" 23/09/2026) — nenhuma lógica nova, só o dado que faltava.
//
// USO:
//   npx tsx scripts/cadastrar-executores-solicitar-certidao.ts                 → dry-run (só relatório)
//   npx tsx scripts/cadastrar-executores-solicitar-certidao.ts --aplicar        → aplica no banco do PRISMA_DATABASE_URL atual
//   npx tsx scripts/cadastrar-executores-solicitar-certidao.ts --aplicar --prod → exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'
// ============================================================================
import { prisma } from "../lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { publicarModelo } from "../src/services/biblioteca-tarefas/modelo"

const APLICAR = process.argv.includes("--aplicar")
const ALVO_PROD = process.argv.includes("--prod")

const MAPA_EXECUTOR: Record<string, string> = {
  enviar_requerimento_cartorio: "solicitacao_cartorio",
  receber_confirmacao_pedido: "acompanhamento_retorno",
  receber_certidao: "recebimento_documento",
  conferir_validar_certidao: "conferencia_e_validacao",
}

async function verificarAlvoSeguro() {
  const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`[cadastrar-executores] alvo ${identificador(url)} classificado como ${classe} (tabelas=${retrato.tabelas}, requerentes=${retrato.requerentes})`)
  if (APLICAR && ALVO_PROD) {
    if (classe !== CLASSE.PRODUCAO) { console.error(`[cadastrar-executores] RECUSADO: --prod passado mas alvo não é PRODUCAO (classe=${classe}).`); process.exit(1) }
    if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") { console.error(`[cadastrar-executores] RECUSADO: --prod exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'.`); process.exit(1) }
  }
  if (APLICAR && !ALVO_PROD && classe === CLASSE.PRODUCAO) { console.error(`[cadastrar-executores] RECUSADO: alvo é PRODUCAO mas --prod não foi passado.`); process.exit(1) }
}

async function main() {
  await verificarAlvoSeguro()

  const modelo = await prisma.bibliotecaModeloTarefa.findFirst({
    where: { chave: "solicitar_certidao" },
    include: { workflow: { include: { passos: { include: { subtarefas: true } } } } },
  })
  if (!modelo) { console.error("[cadastrar-executores] Modelo 'solicitar_certidao' não encontrado."); process.exit(1) }

  const passo = modelo.workflow.passos[0]
  if (!passo) { console.error("[cadastrar-executores] Modelo sem passo."); process.exit(1) }

  console.log(`[cadastrar-executores] Modelo id=${modelo.id} status=${modelo.status} versaoPublicada=${modelo.versaoPublicada} workflowId=${modelo.workflowId} passoId=${passo.id}`)

  const pendentes = passo.subtarefas.filter((s) => MAPA_EXECUTOR[s.key] && s.executorKey !== MAPA_EXECUTOR[s.key])
  if (pendentes.length === 0) {
    console.log("[cadastrar-executores] nada a fazer — todas as subtarefas já têm o executorKey correto.")
    return
  }

  for (const s of passo.subtarefas) {
    const alvo = MAPA_EXECUTOR[s.key]
    console.log(`  subtarefa id=${s.id} key=${s.key} executorKey atual=${JSON.stringify(s.executorKey)} → alvo=${JSON.stringify(alvo ?? null)}`)
  }

  if (!APLICAR) {
    console.log(`\n[cadastrar-executores] DRY-RUN — ${pendentes.length} subtarefa(s) seriam atualizadas e o Modelo seria republicado. Rode com --aplicar para executar.`)
    return
  }

  await prisma.$transaction(async (tx) => {
    for (const s of pendentes) {
      await tx.stepSubtaskDefinition.update({ where: { id: s.id }, data: { executorKey: MAPA_EXECUTOR[s.key] } })
    }
  })
  console.log(`[cadastrar-executores] ${pendentes.length} subtarefa(s) atualizada(s). Publicando o Modelo...`)

  const r = await publicarModelo(modelo.id, null)
  if (!r.ok) { console.error("[cadastrar-executores] FALHA ao publicar:", r); process.exit(1) }
  console.log(`[cadastrar-executores] Modelo publicado: v${r.versaoAnterior} → v${r.versaoNova}. Fases reais atualizadas: ${r.fasesAtualizadas}. Erros: ${JSON.stringify(r.fasesComErro)}`)
}

main().finally(() => prisma.$disconnect())
