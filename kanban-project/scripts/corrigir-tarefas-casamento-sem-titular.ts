// scripts/corrigir-tarefas-casamento-sem-titular.ts
// ============================================================================
// CORREÇÃO DE DADO LEGADO — Tarefas de "Certidão de Casamento" criadas antes do
// fix de titular-uniao.ts (24/09/2026) nasceram com pessoaId nulo e sem o nome
// do cônjuge no título ("Certidão de Casamento - Inteiro Teor", sem "· Fulano"),
// porque `passo-tarefa.ts` não sabia resolver o titular de uma necessidade cujo
// sujeito é a UNIÃO. O código já foi corrigido; este script reconcilia as
// Tarefas que já existiam antes da correção — sem isso elas ficam erradas pra
// sempre (achado real: fila "Distribuir tarefas" com 5 linhas "Certidão de
// Casamento" sem dizer de quem era).
//
// Escopo: só Tarefa com necessidade.uniaoId setado, pessoaId nulo, ainda não
// concluída. Usa a MESMA regra canônica (titularDaUniao) do código já
// corrigido — nenhuma lógica nova aqui.
//
// Dry-run por padrão. `--aplicar --prod` + confirmação escrevem de verdade.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { titularDaUniao, SELECT_UNIAO_PARA_TITULAR } from "@/src/services/genealogia/titular-uniao"
import { nomeDaTarefa } from "../lib/operacional/nome-da-tarefa"

const APLICAR = process.argv.includes("--aplicar")
const PROD = process.argv.includes("--prod")

function nomeCompleto(p: { nome: string; sobrenome: string | null }): string {
  return p.sobrenome ? `${p.nome} ${p.sobrenome}` : p.nome
}

async function main() {
  const url = process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? ""
  const id = identificador(url)
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`Banco: ${id} — classificado como ${classe}`)

  if (APLICAR && PROD) {
    if (classe !== CLASSE.PRODUCAO) {
      console.error("--prod pedido mas o banco não classifica como PRODUÇÃO. Abortando.")
      process.exit(1)
    }
    if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") {
      console.error("Falta EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'. Abortando.")
      process.exit(1)
    }
  }

  const tarefas = await prisma.tarefa.findMany({
    where: { pessoaId: null, concluida: false, necessidade: { uniaoId: { not: null } } },
    select: {
      id: true, titulo: true, processoId: true,
      necessidade: {
        select: {
          id: true, itemCatalogo: { select: { name: true } },
          uniao: { select: SELECT_UNIAO_PARA_TITULAR } ,
        },
      },
    },
  })

  console.log(`\nTarefas afetadas: ${tarefas.length}`)
  let corrigidas = 0, semTitular = 0
  for (const t of tarefas) {
    const titularId = titularDaUniao(t.necessidade?.uniao)
    if (titularId == null) {
      console.log(`  ⚠ tarefa ${t.id} (processo ${t.processoId}) — união sem titular na linha reta, pulando`)
      semTitular++
      continue
    }
    const pessoa = await prisma.pessoa.findUnique({ where: { id: titularId }, select: { nome: true, sobrenome: true } })
    if (!pessoa) { console.log(`  ⚠ tarefa ${t.id} — pessoa ${titularId} não encontrada, pulando`); continue }
    const novoTitulo = nomeDaTarefa({
      itemDaNecessidade: t.necessidade?.itemCatalogo?.name ?? null,
      pessoa: nomeCompleto(pessoa),
      etapasDaUnidade: 1,
    })
    console.log(`  tarefa ${t.id} (processo ${t.processoId}): "${t.titulo}" → pessoaId=${titularId}, título="${novoTitulo}"`)
    if (APLICAR) {
      await prisma.tarefa.update({ where: { id: t.id }, data: { pessoaId: titularId, titulo: novoTitulo } })
    }
    corrigidas++
  }

  console.log(`\n${APLICAR ? "Aplicado" : "Simulado (dry-run)"}: ${corrigidas} corrigida(s), ${semTitular} sem titular.`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
