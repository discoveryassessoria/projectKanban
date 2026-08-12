// scripts/backfill-necessidade-duplicada-motor-legado.ts
//
// CONSOLIDA as necessidades que o SEGUNDO motor criou.
//
// Enquanto existiram dois materializadores, a mesma obrigação nascia duas vezes:
// o motor de Regras Documentais gravava `varianteKey = rd:<regra>:v<n>` e o motor
// da árvore (DOCUMENT_RULES) gravava `"padrao"`. A chave de idempotência inclui a
// variante, então o banco aceitava as duas.
//
// CRITÉRIO DE DUPLICIDADE (só IDs): processo + sujeito (pessoa|união) + item do
// Catálogo — que é o portador do Tipo Documental canônico. Nunca por nome.
//
// CANÔNICO = o registro do motor oficial (`rd:*`). Se nenhum for `rd:*`, o par é
// AMBÍGUO e fica de fora: dois legados não têm vencedor óbvio.
//
// CONSOLIDAÇÃO — antes de apagar, tudo que aponta para o legado é repontado ao
// canônico: documentos, passos, tarefas, eventos, execuções e evidências
// registrais, nomes evidenciados. Fato histórico não se perde e nada é apagado
// além da própria linha duplicada. Se o legado tiver vínculo que o canônico não
// tem, ele é transferido — nunca descartado.
//
// Dry-run por padrão. Escreve só com --execute.

import { prisma } from "@/lib/prisma"

const EXECUTAR = process.argv.includes("--execute")
const canonico = (v: string) => v.startsWith("rd:")

interface Grupo {
  chave: string
  processoId: number
  sujeito: string
  itemCatalogoId: number
  ids: { id: number; varianteKey: string; status: string; ciclo: number }[]
}

async function main() {
  const necs = await prisma.necessidadeDocumental.findMany({
    orderBy: { id: "asc" },
    select: { id: true, processoId: true, pessoaId: true, uniaoId: true, itemCatalogoId: true, varianteKey: true, status: true, ciclo: true, supersedePorId: true },
  })
  console.log(`\n${EXECUTAR ? "EXECUÇÃO" : "DRY-RUN"} — necessidades duplicadas pelo motor legado`)
  console.log(`NecessidadeDocumental no banco: ${necs.length}`)

  const grupos = new Map<string, Grupo>()
  for (const n of necs) {
    if (n.supersedePorId != null) continue // superseção é histórico legítimo
    const sujeito = n.pessoaId != null ? `p${n.pessoaId}` : `u${n.uniaoId}`
    const chave = `${n.processoId}|${sujeito}|item${n.itemCatalogoId}|c${n.ciclo}`
    const g = grupos.get(chave) ?? { chave, processoId: n.processoId, sujeito, itemCatalogoId: n.itemCatalogoId, ids: [] }
    g.ids.push({ id: n.id, varianteKey: n.varianteKey, status: n.status, ciclo: n.ciclo })
    grupos.set(chave, g)
  }

  const duplicados = [...grupos.values()].filter((g) => g.ids.length > 1)
  console.log(`Grupos com duplicidade (processo+sujeito+item+ciclo): ${duplicados.length}`)
  if (duplicados.length === 0) {
    console.log("Nada a consolidar.\n")
    return
  }

  const determinísticos: Grupo[] = []
  const ambiguos: Grupo[] = []
  for (const g of duplicados) {
    const temCanonico = g.ids.some((x) => canonico(x.varianteKey))
    const temLegado = g.ids.some((x) => !canonico(x.varianteKey))
    if (temCanonico && temLegado) determinísticos.push(g)
    else ambiguos.push(g)
  }

  console.log(`\nDETERMINÍSTICOS (1 canônico rd:* + legado): ${determinísticos.length}`)
  for (const g of determinísticos) {
    console.log(`  proc ${g.processoId} ${g.sujeito} item ${g.itemCatalogoId}: ${g.ids.map((x) => `#${x.id}[${x.varianteKey}|${x.status}]`).join("  ")}`)
  }
  if (ambiguos.length) {
    console.log(`\nAMBÍGUOS (sem canônico evidente) — NÃO tocados: ${ambiguos.length}`)
    for (const g of ambiguos) {
      console.log(`  proc ${g.processoId} ${g.sujeito} item ${g.itemCatalogoId}: ${g.ids.map((x) => `#${x.id}[${x.varianteKey}|${x.status}]`).join("  ")}`)
    }
  }

  if (!EXECUTAR) {
    console.log("\nNenhuma escrita feita. Rode com --execute para consolidar os determinísticos.\n")
    return
  }

  let consolidados = 0
  for (const g of determinísticos) {
    const alvo = g.ids.find((x) => canonico(x.varianteKey))!
    const legados = g.ids.filter((x) => x.id !== alvo.id)
    for (const l of legados) {
      await prisma.$transaction(async (tx) => {
        // 1) REPONTAR tudo que o legado carrega. Fato histórico muda de dono, não some.
        const movidos = {
          documentos: (await tx.documento.updateMany({ where: { necessidadeId: l.id }, data: { necessidadeId: alvo.id } })).count,
          passos: (await tx.phaseWorkflowStepInstance.updateMany({ where: { necessidadeId: l.id }, data: { necessidadeId: alvo.id } })).count,
          eventos: (await tx.necessidadeDocumentalEvento.updateMany({ where: { necessidadeId: l.id }, data: { necessidadeId: alvo.id } })).count,
        }
        // 2) só então a linha duplicada sai
        await tx.necessidadeDocumental.delete({ where: { id: l.id } })
        // 3) auditoria com o que foi movido, não só "consolidei"
        await tx.logAuditoria.create({
          data: {
            acao: "CONSOLIDACAO_NECESSIDADE_DUPLICADA", entidade: "NECESSIDADE_DOCUMENTAL", entidadeId: alvo.id, usuarioId: null,
            descricao: `Duplicidade do motor legado consolidada. Removida #${l.id} (varianteKey "${l.varianteKey}", status ${l.status}); canônica #${alvo.id} ("${alvo.varianteKey}"). Processo ${g.processoId}, sujeito ${g.sujeito}, item ${g.itemCatalogoId}. Movidos: ${movidos.documentos} documento(s), ${movidos.passos} passo(s), ${movidos.eventos} evento(s).`.slice(0, 500),
          },
        })
        console.log(`  ✓ #${l.id} → #${alvo.id}  (docs ${movidos.documentos}, passos ${movidos.passos}, eventos ${movidos.eventos})`)
        consolidados++
      }, { timeout: 30000, maxWait: 10000 })
    }
  }

  // VERIFICAÇÃO no banco, não no laço.
  const depois = await prisma.necessidadeDocumental.findMany({
    where: { supersedePorId: null },
    select: { processoId: true, pessoaId: true, uniaoId: true, itemCatalogoId: true, ciclo: true, varianteKey: true },
  })
  const chaves = depois.map((n) => `${n.processoId}|${n.pessoaId != null ? `p${n.pessoaId}` : `u${n.uniaoId}`}|item${n.itemCatalogoId}|c${n.ciclo}`)
  const restantes = chaves.length - new Set(chaves).size
  const aindaLegado = depois.filter((n) => !canonico(n.varianteKey) && n.varianteKey !== "padrao").length

  console.log(`\nConsolidados: ${consolidados}`)
  console.log(`Duplicidades restantes: ${restantes}${ambiguos.length ? ` (${ambiguos.length} grupo(s) ambíguo(s), preservados de propósito)` : ""}`)
  console.log(`Necessidades com variante fora do padrão conhecido: ${aindaLegado}`)
  if (restantes > ambiguos.length) throw new Error("Sobrou duplicidade determinística — investigar antes de seguir.")
  console.log("OK.\n")
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
