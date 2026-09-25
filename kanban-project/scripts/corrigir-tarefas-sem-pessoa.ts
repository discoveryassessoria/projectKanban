// scripts/corrigir-tarefas-sem-pessoa.ts
// ============================================================================
// CORREÇÃO DE DADO LEGADO — Tarefas nascidas via `garantirTarefaDePasso`
// (src/services/passo-tarefa.ts) antes do fix de 24/09/2026 tinham
// `pessoaId` resolvido só para o TÍTULO ("Certidão de Nascimento · Ignacio
// Cibils") mas nunca escrito na coluna `Tarefa.pessoaId` — o `tx.tarefa.create`
// simplesmente esquecia o campo. O código já foi corrigido; este script
// reconcilia as Tarefas que já existiam antes da correção (achado real:
// Minha Operação/Distribuição mostrando "—" na coluna Pessoa pra tarefas cujo
// título já dizia o nome certo).
//
// Escopo: Tarefa com `pessoaId: null`, ainda não concluída/cancelada, cuja
// pessoa É resolvível via `necessidade.pessoaId` → `titularDaUniao` (união) →
// `documento.pessoaId` — a MESMA cadeia canônica que `passo-tarefa.ts` já usa.
// Nenhuma lógica nova aqui.
//
// Dry-run por padrão. `--aplicar --prod` + confirmação escrevem de verdade.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { titularDaUniao, SELECT_UNIAO_PARA_TITULAR } from "@/src/services/genealogia/titular-uniao"

const APLICAR = process.argv.includes("--aplicar")
const PROD = process.argv.includes("--prod")
const STATUS_ENCERRADOS = ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"]

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
    where: {
      pessoaId: null,
      statusTarefa: { notIn: STATUS_ENCERRADOS as never[] },
      OR: [{ necessidadeId: { not: null } }, { documentoId: { not: null } }],
    },
    select: {
      id: true, titulo: true, processoId: true, necessidadeId: true, documentoId: true,
      necessidade: { select: { pessoaId: true, uniao: { select: SELECT_UNIAO_PARA_TITULAR } } },
      documento: { select: { pessoaId: true } },
    },
  })

  console.log(`Tarefas com pessoaId nulo e resolvível: candidatas a verificar: ${tarefas.length}`)

  let corrigidas = 0
  let semResolucao = 0
  for (const t of tarefas) {
    const pessoaId = t.necessidade?.pessoaId ?? titularDaUniao(t.necessidade?.uniao) ?? t.documento?.pessoaId ?? null
    if (pessoaId == null) {
      semResolucao++
      continue
    }
    console.log(`${APLICAR ? "[APLICANDO]" : "[dry-run]"} Tarefa ${t.id} (processo ${t.processoId}) — "${t.titulo}" → pessoaId ${pessoaId}`)
    if (APLICAR) {
      await prisma.tarefa.update({ where: { id: t.id }, data: { pessoaId } })
    }
    corrigidas++
  }

  console.log(`\n${corrigidas} tarefa(s) ${APLICAR ? "corrigida(s)" : "seriam corrigidas"}. ${semResolucao} sem pessoa resolvível (documento/necessidade também sem pessoaId — ficam como estão).`)
  if (!APLICAR) console.log("Rode com --aplicar (e --prod, se for o caso) para escrever de verdade.")
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
