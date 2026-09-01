// scripts/central-fase-500-docs.test.ts
// ============================================================================
// QUINHENTOS DOCUMENTOS, CONTRA O BANCO — e quantas consultas isso custa.
//
//   npx tsx scripts/central-fase-500-docs.test.ts
//
// A suíte irmã (`central-projecao-fase`) prova a REGRA sobre dados em memória.
// Esta prova o CUSTO: monta quinhentas certidões reais no banco de teste, com
// os cinco passos publicados cada uma — 2.500 instâncias de passo — e conta as
// consultas que a Central faz para desenhar a tabela.
//
// O número de consultas não pode depender do número de documentos. Se depender,
// a tela funciona no processo com uma certidão e derruba o banco no processo
// com quinhentas — e ninguém descobre isso lendo o código.
//
// LEITURA PURA sobre um palco PRÓPRIO, no banco de TESTE. Não toca produção.
// ============================================================================
import { prisma } from '../lib/prisma'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { getPhaseOperationalSummary } from '../src/lib/process-stage/estrutura-operacional'
import { passaNoRecorte, ordenarDocumentos, RECORTE_VAZIO } from '../src/components/kanban/PainelDaFase'
import type { DocumentoDoIndice } from '../src/lib/process-stage/estrutura-operacional-core'
import { PrismaClient } from '@prisma/client'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = 'ESCALA500'
const FASE = 'emissao_documental'
const PASSOS = [
  { key: 'solicitar_certidao', titulo: 'Solicitar certidão' },
  { key: 'aguardar_retorno_do_cartorio', titulo: 'Aguardar retorno do cartório' },
  { key: 'receber_certidao', titulo: 'Receber certidão' },
  { key: 'conferir_certidao', titulo: 'Conferir certidão' },
  { key: 'validar_certidao', titulo: 'Validar certidão' },
]

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { descricao: { startsWith: MARCA } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@escala500.test' } } })
}

async function main() {
  exigirBancoDeTeste('monta o palco de 500 documentos')
  console.log('QUINHENTOS DOCUMENTOS — o custo real de desenhar a tabela\n')
  await limpar()

  // ── palco ────────────────────────────────────────────────────────────────
  const dani = await prisma.usuario.create({
    data: { nome: 'Daniela Brait', email: 'dani@escala500.test', senha: 'x', tipo: 'assistente' },
    select: { id: true },
  })
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} Família`, arvoreId: arvore.id, workflowRuntime: 'v2', faseAtualKey: FASE },
    select: { id: true },
  })
  const instancia = await prisma.phaseWorkflowInstance.create({
    data: { processoId: processo.id, faseMacroKey: FASE, ciclo: 1, status: 'ATIVO', chaveIdempotencia: `${MARCA}-inst` },
    select: { id: true },
  })

  const TOTAL = 500
  const PESSOAS = 25
  const pessoas: number[] = []
  for (let i = 0; i < PESSOAS; i++) {
    const p = await prisma.pessoa.create({
      data: { arvoreId: arvore.id, nome: `Pessoa${String(i + 1).padStart(2, '0')}`, sobrenome: 'Escala', linhaReta: true },
      select: { id: true },
    })
    pessoas.push(p.id)
  }

  console.log(`  montando ${TOTAL} certidões × ${PASSOS.length} passos = ${TOTAL * PASSOS.length} instâncias…`)
  const agora = new Date()
  for (let i = 0; i < TOTAL; i++) {
    // A pessoa vem de um BLOCO contíguo, não de `i % PESSOAS`: com 500/25 e
    // faixas de 10, o módulo fazia cada pessoa receber sempre as MESMAS duas
    // faixas — ninguém tinha um documento atrasado, e a tela parecia correta
    // enquanto o palco é que era enviesado.
    const pessoaId = pessoas[Math.floor(i / (TOTAL / PESSOAS))]
    const item = await prisma.itemCatalogo.create({
      data: { code: `${MARCA}_${i}`, name: 'Certidão de Nascimento', natureza: 'DOCUMENTO' },
      select: { id: true },
    })
    const nec = await prisma.necessidadeDocumental.create({
      data: { processoId: processo.id, itemCatalogoId: item.id, pessoaId, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${i}` },
      select: { id: true },
    })
    const doc = await prisma.documento.create({
      data: { pessoaId, descricao: `${MARCA} Certidão ${i}`, necessidadeId: nec.id },
      select: { id: true },
    })
    // A distribuição espelha uma fase real: alguns nem começaram, alguns
    // esperam o cartório, alguns travaram, alguns venceram, alguns terminaram.
    const faixa = i % 10
    const feitos = faixa <= 4 ? faixa : faixa === 9 ? 5 : faixa - 4
    await prisma.phaseWorkflowStepInstance.createMany({
      data: PASSOS.map((def, j) => ({
        workflowInstanceId: instancia.id,
        processoId: processo.id,
        faseMacroKey: FASE,
        ciclo: 1,
        stepKey: def.key,
        ordem: j + 1,
        obrigatorio: true,
        status: (j < feitos ? 'CONCLUIDO'
          : j > feitos ? 'PENDENTE'
          : faixa === 5 ? 'AGUARDANDO'
          : faixa === 6 ? 'BLOQUEADO'
          : faixa === 7 ? 'EM_ANDAMENTO'
          : 'DISPONIVEL') as never,
        necessidadeId: nec.id,
        documentoId: doc.id,
        pessoaId,
        responsavelId: j === feitos && faixa % 3 !== 0 ? dani.id : null,
        prazo: j === feitos && faixa === 8 ? new Date(agora.getTime() - 2 * 86400000) : null,
        motivo: j === feitos && faixa === 6 ? 'Cartório exige procuração atualizada.' : null,
        snapshot: { titulo: def.titulo },
        chaveIdempotencia: `${MARCA}-s-${i}-${j}`,
      })),
    })

    // A TAREFA DA UNIDADE — o palco só é real com ela.
    //
    // Responsável, prazo e status da linha saem daqui: um palco sem tarefa
    // testaria uma fase que não existe (toda certidão operada tem a sua). O
    // documento CONCLUÍDO não ganha tarefa viva, como em produção — a terminal
    // sai da busca canônica e a linha se vira com o workflow.
    if (feitos < PASSOS.length) {
      await prisma.tarefa.create({
        data: {
          titulo: `${MARCA} Certidão ${i}`,
          processoId: processo.id,
          faseMacroKey: FASE,
          workflowInstanceId: instancia.id,
          necessidadeId: nec.id,
          documentoId: doc.id,
          pessoaId,
          ciclo: 1,
          equipeKey: 'equipe_documental',
          // A cada três documentos um fica na fila, sem responsável — é o
          // estado "esperando distribuição", e ele precisa aparecer.
          responsavelId: faixa % 3 !== 0 ? dani.id : null,
          dataPrazo: faixa === 8 ? new Date(agora.getTime() - 2 * 86400000) : new Date(agora.getTime() + 5 * 86400000),
          statusTarefa: (faixa === 5 ? 'AGUARDANDO_TERCEIRO'
            : faixa === 6 ? 'BLOQUEADA'
            : faixa === 7 ? 'EM_ANDAMENTO'
            : feitos > 0 ? 'EM_ANDAMENTO'
            : 'NAO_INICIADA') as never,
          chaveIdempotencia: `unidade|proc${processo.id}|nec${nec.id}|pes${pessoaId}|c1`,
        },
      })
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  secao('§33) O NÚMERO DE CONSULTAS NÃO DEPENDE DO NÚMERO DE DOCUMENTOS')
  // ══════════════════════════════════════════════════════════════════════════
  // Um cliente PRÓPRIO, instrumentado: o que interessa é quantas idas ao banco
  // a projeção faz, não quanto ela demora numa máquina específica.
  const contarConsultas = async (rodar: (db: PrismaClient) => Promise<unknown>) => {
    const espiao = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
    let n = 0
    ;(espiao as unknown as { $on: (e: string, cb: () => void) => void }).$on('query', () => { n++ })
    try {
      await rodar(espiao)
    } finally {
      await espiao.$disconnect()
    }
    return n
  }

  let resultado: Awaited<ReturnType<typeof getPhaseOperationalSummary>> | null = null
  const t0 = Date.now()
  const consultas500 = await contarConsultas(async (db) => {
    resultado = await getPhaseOperationalSummary(
      { processoId: processo.id, faseMacroKey: FASE },
      { db: db as never },
    )
  })
  const ms500 = Date.now() - t0

  const docs: DocumentoDoIndice[] = [
    ...resultado!.indice.linhaPrincipal.flatMap((p) => p.documentos),
    ...resultado!.indice.foraDaLinha.flatMap((p) => p.documentos),
    ...resultado!.indice.pendenteClassificacao.flatMap((p) => p.documentos),
    ...resultado!.indice.semDono,
  ]
  ok('§42) a fase devolve os 500 documentos', docs.length === TOTAL, `${docs.length}`)
  ok('§33) e o faz em POUCAS consultas — não uma por documento',
    consultas500 <= 20, `${consultas500} consulta(s) para ${TOTAL} documentos`)
  ok('§32) o tempo é de tela, não de relatório', ms500 < 8000, `${ms500}ms`)

  // A prova de que é O(1) em consultas: metade dos documentos, mesmo custo.
  const metade = await prisma.necessidadeDocumental.findMany({
    where: { processoId: processo.id }, select: { id: true }, orderBy: { id: 'asc' }, take: TOTAL / 2,
  })
  await prisma.phaseWorkflowStepInstance.deleteMany({
    where: { processoId: processo.id, necessidadeId: { in: metade.map((m) => m.id) } },
  })
  const consultas250 = await contarConsultas(async (db) => {
    await getPhaseOperationalSummary({ processoId: processo.id, faseMacroKey: FASE }, { db: db as never })
  })
  ok('§33) com metade dos documentos, o MESMO número de consultas',
    consultas250 === consultas500,
    `${consultas250} × ${consultas500} — se subisse com o volume, seria N+1`)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§16/§43/§44) O QUE FALTA É VISÍVEL SEM ABRIR ITEM POR ITEM')
  // ══════════════════════════════════════════════════════════════════════════
  // A MESMA RÉGUA DOS CONTADORES DO TOPO — é ela que faz cada contador virar
  // um filtro exato em vez de um número aproximado.
  const prontos = docs.filter((d) => d.statusFinal === 'PRONTO')
  const pendentes = docs.filter((d) => d.statusFinal === 'PENDENTE' || d.statusFinal === 'EM_ANDAMENTO')
  const divergentes = docs.filter((d) => d.statusFinal === 'DIVERGENTE' || d.statusFinal === 'INVALIDADO')
  ok('§36) prontos + pendentes + divergentes cobrem a fase inteira',
    prontos.length + pendentes.length + divergentes.length === TOTAL,
    `${prontos.length} + ${pendentes.length} + ${divergentes.length}`)
  ok('§43) o contador e o recorte contam a MESMA coisa',
    docs.filter((d) => passaNoRecorte(d, { ...RECORTE_VAZIO, rapido: 'pendentes' }, '')).length === pendentes.length
    && docs.filter((d) => passaNoRecorte(d, { ...RECORTE_VAZIO, rapido: 'prontos' }, '')).length === prontos.length
    && docs.filter((d) => passaNoRecorte(d, { ...RECORTE_VAZIO, rapido: 'divergentes' }, '')).length === divergentes.length,
    'clicar em "Pendentes: N" tem de devolver N')
  ok('§43) o recorte "pendentes" devolve exatamente eles',
    docs.filter((d) => passaNoRecorte(d, { ...RECORTE_VAZIO, rapido: 'pendentes' }, '')).length === pendentes.length)
  ok('§44) e "prontos", só os 100%',
    docs.filter((d) => passaNoRecorte(d, { ...RECORTE_VAZIO, rapido: 'prontos' }, ''))
      .every((d) => d.naFase.progresso.pct === 100))
  ok('§41) os atrasados são reconhecíveis',
    docs.some((d) => d.naFase.atrasado && d.naFase.estado !== 'CONCLUIDA'),
    `${docs.filter((d) => d.naFase.atrasado).length} atrasado(s)`)
  ok('§40) os bloqueados dizem por quê',
    docs.filter((d) => d.naFase.estado === 'BLOQUEADA').every((d) => d.naFase.motivoBloqueio != null))
  ok('§39) os que esperam terceiro não estão em 100%',
    docs.filter((d) => d.naFase.estado === 'AGUARDANDO_TERCEIRO').every((d) => d.naFase.progresso.pct < 100))
  ok('§10) toda etapa atual é nome humano, nunca chave',
    docs.filter((d) => d.naFase.etapaAtual != null)
      .every((d) => !/_/.test(d.naFase.etapaAtual!)),
    docs.find((d) => d.naFase.etapaAtual)?.naFase.etapaAtual ?? '—')
  ok('§45) o responsável vem resolvido em nome',
    docs.some((d) => d.naFase.responsavelNome === 'Daniela Brait'))

  const t1 = Date.now()
  ordenarDocumentos(docs, 'atencao')
  const msOrdem = Date.now() - t1
  ok('§17) ordenar os 500 é imperceptível', msOrdem < 200, `${msOrdem}ms`)

  await limpar()
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? `Quinhentos documentos, ${consultas500} consultas — a tabela escala.`
    : 'A projeção da fase não aguenta o volume real.')
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

void main()
