// scripts/reconciliar-derivados-requerente.ts
// ============================================================================
// DRY-RUN e REPARO do estado derivado que perdeu a sua última causa válida.
//
//   npm run reconcile:requerente -- --processo 513            (dry-run, não escreve)
//   npm run reconcile:requerente -- --processo 513 --execute  (aplica)
//   npm run reconcile:requerente -- --todos                   (dry-run de toda a base)
//
// NÃO é script de conserto pontual: chama o MESMO reconciliador que roda em
// produção depois de cada remoção de pessoa da árvore
// (`reconciliarAutomacaoPorRequerente`, chamado por `reconciliarAposRemocao`).
// Rodar aqui e rodar por lá produzem o mesmo estado final — é a única forma de o
// reparo do passado ser prova de que o motor do futuro está certo.
//
// SEM IDs mágicos, SEM DELETE direto, SEM SQL de exceção.
// ============================================================================
import { prisma } from "@/lib/prisma"
import {
  reconciliarAutomacaoPorRequerente,
  type RelatorioReconciliacaoRequerente,
} from "@/src/lib/motor/reconciliar-requerente-economico"

const argv = process.argv.slice(2)
const flag = (nome: string) => argv.includes(`--${nome}`)
const valor = (nome: string): string | null => {
  const i = argv.indexOf(`--${nome}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null
}

const EXECUTAR = flag("execute")
const dinheiro = (v: number | null, m: string | null) =>
  v == null ? "—" : `${m ?? ""} ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`.trim()

function imprimir(r: RelatorioReconciliacaoRequerente) {
  console.log(`\n${"═".repeat(78)}`)
  console.log(`PROCESSO ${r.processoId}  ·  árvore ${r.arvoreId ?? "—"}  ·  ${r.dryRun ? "DRY-RUN (nada foi escrito)" : "EXECUÇÃO"}`)
  console.log(`causas válidas (requerentes ativos da árvore): ${r.causasValidas.length ? r.causasValidas.join(", ") : "nenhuma"}`)
  console.log("═".repeat(78))

  if (r.efeitos.length === 0) {
    console.log("  nenhum efeito econômico por requerente neste processo.")
    return
  }

  for (const e of r.efeitos) {
    const marca = e.erro ? "✖" : e.aplicado ? "✔" : e.acao.startsWith("PRESERVAR") ? "•" : "→"
    console.log(`\n  ${marca} ${e.acao}   ${e.entidade}#${e.entidadeId}`)
    console.log(`      descrição      : ${e.descricao}`)
    console.log(`      valor          : ${dinheiro(e.valor, e.moeda)}`)
    console.log(`      causa (pessoa) : ${e.causaPessoaId ?? "não atribuível"}`)
    console.log(`      causas restantes: ${e.causasRestantes}`)
    console.log(`      estado atual   : ${e.estadoAtual}`)
    console.log(`      estado desejado: ${e.estadoDesejado}`)
    if (e.fatos.length) console.log(`      fatos          : ${e.fatos.join(" | ")}`)
    if (e.erro) console.log(`      ERRO           : ${e.erro}`)
  }

  const s = r.resumo
  console.log(`\n  ── resumo ──`)
  console.log(`     avaliados ${s.avaliados} · preservados ${s.preservados} · receitas retiradas ${s.retirados} · espelhos arquivados ${s.arquivados} · artefatos encerrados ${s.artefatosEncerrados} · bloqueados por fato ${s.bloqueadosPorFato} · erros ${s.erros}`)
}

async function main() {
  const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`select current_database() as db`
  console.log(`\nbanco: ${db}   modo: ${EXECUTAR ? "EXECUTE (escreve)" : "DRY-RUN (só lê)"}`)

  let processoIds: number[]
  const alvo = valor("processo")
  if (alvo) {
    processoIds = [Number(alvo)]
  } else if (flag("todos")) {
    // Processos que POSSUEM efeito econômico por requerente — não a base inteira.
    const arts = await prisma.motorArtefato.findMany({
      where: { ruleKind: "financial", ruleSource: "automation" },
      select: { processoId: true }, distinct: ["processoId"],
    })
    processoIds = arts.map((a) => a.processoId).sort((a, b) => a - b)
    console.log(`processos com efeito por requerente: ${processoIds.length}`)
  } else {
    console.error("uso: --processo <id> [--execute]   |   --todos [--execute]")
    process.exit(2)
  }

  let totalRetirados = 0, totalArquivados = 0, totalBloqueados = 0, totalErros = 0
  for (const pid of processoIds) {
    const r = await reconciliarAutomacaoPorRequerente(pid, { dryRun: !EXECUTAR })
    imprimir(r)
    totalRetirados += r.resumo.retirados
    totalArquivados += r.resumo.arquivados
    totalBloqueados += r.resumo.bloqueadosPorFato
    totalErros += r.resumo.erros
  }

  console.log(`\n${"═".repeat(78)}`)
  console.log(`TOTAL — receitas retiradas ${totalRetirados} · espelhos arquivados ${totalArquivados} · bloqueados por fato ${totalBloqueados} · erros ${totalErros}`)
  if (!EXECUTAR) console.log("DRY-RUN: nada foi escrito. Repita com --execute para aplicar.")
  console.log("")
  if (totalErros > 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error("falhou:", e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
