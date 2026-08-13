// scripts/palco-central-500.ts
// ============================================================================
// PALCO DE QUINHENTOS DOCUMENTOS — para olhar a tela, não para asserção.
//
//   npx tsx scripts/palco-central-500.ts        (monta e imprime o processoId)
//   npx tsx scripts/palco-central-500.ts --limpar
//
// O teste de escala monta e derruba o próprio cenário. Este deixa o cenário DE
// PÉ, porque a validação visual precisa de uma tela para abrir.
//
// Banco de TESTE, sempre. Não existe caminho daqui para produção.
// ============================================================================
import { prisma } from '../lib/prisma'
import { exigirBancoDeTeste } from './_banco-de-teste'

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
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { descricao: { startsWith: MARCA } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@escala500.test' } } })
}

async function main() {
  if (process.argv.includes('--limpar')) { await limpar(); console.log('palco removido'); return }
  exigirBancoDeTeste('monta o palco visual de 500 documentos')
  console.log('QUINHENTOS DOCUMENTOS — o custo real de desenhar a tabela\n')
  await limpar()

  // ── palco ────────────────────────────────────────────────────────────────
  const dani = await prisma.usuario.create({
    data: { nome: 'Daniela Brait', email: 'dani@escala500.test', senha: 'x', tipo: 'assistente' },
    select: { id: true },
  })
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} Família`, pais: 'espanha', arvoreId: arvore.id, workflowRuntime: 'v2', faseAtualKey: FASE },
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
  }


  console.log(JSON.stringify({ processoId: processo.id, documentos: TOTAL, pessoas: PESSOAS }))
}

void main().finally(() => prisma.$disconnect())
