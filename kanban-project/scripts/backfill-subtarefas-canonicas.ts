// scripts/backfill-subtarefas-canonicas.ts
// ============================================================================
// O QUE ESTAVA DENTRO DOS EXECUTORES VIRA SUBTAREFA CADASTRADA.
//
//   npx tsx scripts/backfill-subtarefas-canonicas.ts              SOMENTE LEITURA
//   npx tsx scripts/backfill-subtarefas-canonicas.ts --execute
//
// ─── O QUE ELE MATERIALIZA ──────────────────────────────────────────────────
// 1. CANAIS DA ORGANIZAÇÃO. Quais canais cada órgão atende era uma pergunta sem
//    tabela: o workflow listava todos e o operador descobria tentando. A resposta
//    honesta vem do que JÁ ACONTECEU — as solicitações registradas dizem, por órgão,
//    por quais canais aquele órgão foi efetivamente acionado. Isso é fato, não
//    suposição. Órgão sem solicitação nenhuma fica sem canal, e a subtarefa que
//    depender de canal vai bloquear nele dizendo exatamente isso.
//
// 2. VÍNCULO DOCUMENTO → ÓRGÃO. `Documento.cartorio` é texto livre e nunca serviu
//    para responder "por onde pedir". O vínculo é deduzido da SOLICITAÇÃO já
//    registrada daquele documento, que aponta para o órgão por ID.
//
// 3. SUBTAREFAS do passo de solicitação. O executor `solicitacao_cartorio` faz três
//    coisas numa tela só — escolher o canal e enviar, registrar o protocolo, aguardar
//    o retorno. Elas passam a ser cadastro, na ordem e com as dependências reais.
//
// ─── O QUE ELE NÃO FAZ ──────────────────────────────────────────────────────
// Não inventa canal que nunca foi usado, não inventa órgão para documento que nunca
// teve solicitação, não publica versão (a publicação é decisão do administrador) e
// não toca em execução, tarefa ou documento. IDEMPOTENTE: pula o que já existe.
// ============================================================================
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const EXECUTAR = process.argv.includes('--execute')

/**
 * AS SUBTAREFAS DA SOLICITAÇÃO DOCUMENTAL.
 *
 * Esta lista é SEMENTE, não fonte: ela existe para transformar em dado o que hoje é
 * código, e some do caminho assim que o cadastro responde. Nenhuma chave aqui é lida
 * pelo runtime — ele lê o que estiver no banco.
 */
const SUBTAREFAS_DA_SOLICITACAO = [
  {
    key: 'enviar_solicitacao',
    label: 'Enviar a solicitação',
    descricao: 'Escolher por onde pedir e enviar ao órgão.',
    ordem: 1,
    obrigatoria: true,
    // É AQUI que o canal importa — e ele vem do órgão daquele documento, não de uma
    // lista global. Era exatamente isso que o executor fazia errado.
    fonteDeCanais: 'FORNECEDOR_RELACIONADO',
    dependeDe: [] as string[],
    acoes: [
      { key: 'enviada', label: 'Solicitação enviada', effectKey: 'REGISTER_ONLY', ordem: 1 },
    ],
    campos: [
      { key: 'destinatario', label: 'Destinatário', tipo: 'texto', obrigatorio: true, ordem: 1 },
      { key: 'observacao', label: 'Observação do envio', tipo: 'textarea', ordem: 2 },
    ],
  },
  {
    key: 'registrar_protocolo',
    label: 'Registrar o protocolo',
    descricao: 'O número que o órgão devolveu.',
    ordem: 2,
    obrigatoria: false,
    // REPETÍVEL: um pedido pode receber mais de um protocolo ao longo do trâmite, e
    // sobrescrever o anterior apagaria o histórico do que foi protocolado antes.
    repetivel: true,
    fonteDeCanais: 'NENHUMA',
    dependeDe: ['enviar_solicitacao'],
    acoes: [
      { key: 'protocolado', label: 'Protocolo registrado', effectKey: 'REGISTER_ONLY', ordem: 1 },
    ],
    campos: [
      { key: 'numero_protocolo', label: 'Número do protocolo', tipo: 'texto', obrigatorio: true, ordem: 1 },
      { key: 'previsto_para', label: 'Previsão informada pelo órgão', tipo: 'data', ordem: 2 },
    ],
  },
  {
    key: 'aguardar_retorno',
    label: 'Aguardar o retorno',
    descricao: 'A espera pelo órgão, com o que já se sabe dela.',
    ordem: 3,
    obrigatoria: true,
    fonteDeCanais: 'NENHUMA',
    dependeDe: ['enviar_solicitacao'],
    acoes: [
      { key: 'retorno_recebido', label: 'Retorno recebido', effectKey: 'COMPLETE_STEP', ordem: 1 },
      { key: 'aguardando', label: 'Ainda aguardando', effectKey: 'PAUSE_FOR_EXTERNAL_WAIT', ordem: 2 },
    ],
    campos: [
      { key: 'situacao', label: 'O que se sabe até agora', tipo: 'textarea', ordem: 1 },
    ],
  },
] as const

async function main() {
  console.log(EXECUTAR ? 'SUBTAREFAS CANÔNICAS — APLICANDO\n' : 'SUBTAREFAS CANÔNICAS — SOMENTE LEITURA (use --execute)\n')

  // ── 1. OS CANAIS QUE CADA ÓRGÃO REALMENTE ATENDE ─────────────────────────
  console.log('CANAIS POR ORGANIZAÇÃO (deduzidos das solicitações já registradas)')
  const usos = await prisma.solicitacaoDocumento.groupBy({
    by: ['orgaoId', 'canal'],
    where: { orgaoId: { not: null } },
    _count: { _all: true },
  })
  const tipos = await prisma.canalOperacional.findMany({ select: { id: true, key: true } })
  const idDoTipo = new Map(tipos.map((t) => [t.key, t.id]))
  let vinculosNovos = 0
  let vinculosExistentes = 0
  for (const u of usos) {
    if (!u.orgaoId) continue
    const canalId = idDoTipo.get(String(u.canal))
    if (!canalId) { console.log(`  ! canal "${u.canal}" não está no catálogo — ignorado`); continue }
    const existe = await prisma.organizacaoCanal.findUnique({
      where: { organizacaoId_canalId: { organizacaoId: u.orgaoId, canalId } }, select: { id: true },
    })
    if (existe) { vinculosExistentes++; continue }
    const org = await prisma.orgaoProtocolo.findUnique({ where: { id: u.orgaoId }, select: { name: true } })
    console.log(`  ${EXECUTAR ? '✔' : '→'} ${(org?.name ?? `#${u.orgaoId}`).slice(0, 40).padEnd(40)} ${String(u.canal).padEnd(12)} (${u._count._all} solicitação(ões))`)
    if (EXECUTAR) {
      await prisma.organizacaoCanal.create({ data: { organizacaoId: u.orgaoId, canalId, ordem: 1, ativo: true } })
      vinculosNovos++
    }
  }
  if (vinculosExistentes) console.log(`  · ${vinculosExistentes} vínculo(s) já cadastrado(s)`)
  if (usos.length === 0) console.log('  · nenhuma solicitação com órgão identificado — nada a deduzir')

  // ── 2. O DOCUMENTO PASSA A APONTAR PARA O ÓRGÃO ──────────────────────────
  console.log('\nVÍNCULO DOCUMENTO → ÓRGÃO (deduzido da solicitação daquele documento)')
  const solicitacoes = await prisma.solicitacaoDocumento.findMany({
    where: { orgaoId: { not: null } },
    select: { documentoId: true, orgaoId: true },
    orderBy: { id: 'desc' },
  })
  const orgaoDoDocumento = new Map<number, number>()
  for (const s of solicitacoes) {
    // A MAIS RECENTE MANDA: se o documento foi pedido a dois órgãos, o vínculo é com
    // o último — que é onde ele está sendo tratado agora.
    if (!orgaoDoDocumento.has(s.documentoId) && s.orgaoId) orgaoDoDocumento.set(s.documentoId, s.orgaoId)
  }
  let docsLigados = 0
  let docsJaLigados = 0
  for (const [documentoId, orgaoId] of orgaoDoDocumento) {
    const doc = await prisma.documento.findUnique({ where: { id: documentoId }, select: { orgaoId: true } })
    if (!doc) continue
    if (doc.orgaoId) { docsJaLigados++; continue }
    if (EXECUTAR) await prisma.documento.update({ where: { id: documentoId }, data: { orgaoId } })
    docsLigados++
  }
  console.log(`  ${EXECUTAR ? '✔' : '→'} ${docsLigados} documento(s) ganham órgão · ${docsJaLigados} já tinham`)

  // ── 3. AS SUBTAREFAS DO PASSO DE SOLICITAÇÃO ─────────────────────────────
  console.log('\nSUBTAREFAS (executor → cadastro)')
  const passos = await prisma.phaseInternalWorkflowStep.findMany({
    where: { executorKey: 'solicitacao_cartorio' },
    select: {
      id: true, key: true, workflow: { select: { name: true } },
      subtarefas: { select: { id: true } },
    },
    orderBy: { id: 'asc' },
  })
  let subtarefasNovas = 0
  let passosPulados = 0
  for (const p of passos) {
    if (p.subtarefas.length > 0) { passosPulados++; continue }
    console.log(`  ${EXECUTAR ? '✔' : '→'} ${(p.workflow?.name ?? '?').slice(0, 30).padEnd(30)} ${p.key.padEnd(24)} ${SUBTAREFAS_DA_SOLICITACAO.length} subtarefas`)
    if (!EXECUTAR) continue
    for (const st of SUBTAREFAS_DA_SOLICITACAO) {
      const sub = await prisma.stepSubtaskDefinition.create({
        data: {
          stepId: p.id, key: st.key, label: st.label, descricao: st.descricao,
          ordem: st.ordem, ativo: true, obrigatoria: st.obrigatoria,
          repetivel: 'repetivel' in st ? Boolean(st.repetivel) : false,
          modoExecucao: 'MANUAL', responsavelRegra: 'HERDA',
          fonteDeCanais: st.fonteDeCanais,
          dependeDe: [...st.dependeDe],
        },
        select: { id: true },
      })
      await prisma.stepAction.createMany({
        data: st.acoes.map((a) => ({ ...a, stepId: p.id, subtaskId: sub.id, ativo: true })),
      })
      await prisma.stepField.createMany({
        data: st.campos.map((c) => ({
          key: c.key, label: c.label, tipo: c.tipo, ordem: c.ordem,
          obrigatorio: 'obrigatorio' in c ? Boolean(c.obrigatorio) : false,
          stepId: p.id, subtaskId: sub.id, ativo: true,
        })),
      })
      subtarefasNovas++
    }
  }
  if (passosPulados) console.log(`  · ${passosPulados} passo(s) já com subtarefas cadastradas`)
  if (passos.length === 0) console.log('  · nenhum passo com o executor de solicitação')

  console.log(`\n${'═'.repeat(74)}`)
  console.log(`Vínculos de canal criados: ${vinculosNovos} · documentos ligados a órgão: ${docsLigados} · subtarefas criadas: ${subtarefasNovas}`)
  console.log(`Em banco → canais por organização: ${await prisma.organizacaoCanal.count()} · subtarefas: ${await prisma.stepSubtaskDefinition.count()}`)
  console.log('\nO cadastro NÃO foi publicado: publicar é decisão do administrador, com a prévia na frente.')
  if (!EXECUTAR) console.log('\nNada foi alterado. Para aplicar: --execute')
}

void main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
