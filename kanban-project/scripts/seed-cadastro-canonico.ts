// scripts/seed-cadastro-canonico.ts
// ============================================================================
// MATERIALIZA COMO DADO O QUE HOJE SÓ EXISTE COMO CÓDIGO.
//
//   npx tsx scripts/seed-cadastro-canonico.ts              SOMENTE LEITURA
//   npx tsx scripts/seed-cadastro-canonico.ts --execute
//
// ─── A ORDEM IMPORTA ────────────────────────────────────────────────────────
// Apagar o hardcode primeiro e cadastrar depois deixaria uma janela em que o
// sistema não sabe quais canais existem. Aqui a configuração equivalente é criada
// PRIMEIRO, com exatamente os mesmos valores; a comparação prova a equivalência
// (`scripts/cadastro-canonico.test.ts`); e só então o runtime passa a ler do
// cadastro. O array em código vira semente e prova, não fonte.
//
// ─── O QUE ELE CRIA ─────────────────────────────────────────────────────────
//   · os 8 canais operacionais, com os mesmos requisitos por canal;
//   · a competência de cada fase (quais efeitos ela pode usar);
//   · as ações, os campos e o checklist dos passos que hoje têm opções fixas
//     dentro do executor React.
//
// IDEMPOTENTE: `skipDuplicates` por chave. Rodar duas vezes não duplica nada e não
// sobrescreve o que o administrador já tiver editado.
// ============================================================================
import { prisma } from '../lib/prisma'
import { CANAIS_SOLICITACAO } from '../src/lib/process-stage/canais-solicitacao'
import { COMPETENCIA_PADRAO_DA_FASE, CATALOGO_DE_EFEITOS, efeitosDaFase } from '../src/lib/motor/catalogo-de-efeitos'

const EXECUTAR = process.argv.includes('--execute')
const log = (s: string) => console.log(s)

/** As ações e campos que hoje moram dentro do componente, por chave de passo. */
const CONFIG_DOS_PASSOS: Record<string, {
  executorKey: string
  campos: Array<{ key: string; label: string; tipo: string; obrigatorio?: boolean; opcoes?: unknown; condicao?: unknown; ajuda?: string; ordem: number }>
  acoes: Array<{ key: string; label: string; descricao: string; effectKey: string; ordem: number; requerCampos?: string[] }>
  checklist?: Array<{ key: string; label: string; descricao: string; ordem: number }>
}> = {
  solicitar_certidao: {
    executorKey: 'solicitacao_cartorio',
    campos: [
      // O CANAL VEM DO CATÁLOGO, não de uma lista repetida dentro do passo: cadastrar
      // um canal novo aparece aqui sem tocar em nada.
      { key: 'canal', label: 'Canal de solicitação', tipo: 'select', obrigatorio: true, opcoes: { catalogo: 'canais' }, ordem: 1 },
      { key: 'destinatario', label: 'Cartório / destinatário', tipo: 'texto', obrigatorio: true, ordem: 2 },
      { key: 'numero_protocolo', label: 'Número do protocolo', tipo: 'texto', ajuda: 'Obrigatório nos canais que devolvem número no ato do envio.', ordem: 3 },
      { key: 'requerimento', label: 'Requerimento enviado', tipo: 'upload', ordem: 4 },
      { key: 'codigo_rastreio', label: 'Código de rastreio', tipo: 'texto', condicao: { campo: 'canal', op: 'igual', valor: 'CORREIOS' }, ordem: 5 },
      { key: 'observacao', label: 'Observação do envio', tipo: 'textarea', ordem: 6 },
    ],
    acoes: [
      { key: 'enviado', label: 'Pedido enviado', descricao: 'O pedido saiu por este canal. A etapa fecha e a espera começa.', effectKey: 'COMPLETE_STEP', ordem: 1 },
      { key: 'aguardando', label: 'Aguardando o cartório', descricao: 'Enviado, sem retorno. A etapa fica marcada como espera externa.', effectKey: 'PAUSE_FOR_EXTERNAL_WAIT', ordem: 2 },
    ],
  },
  aguardar_retorno_do_cartorio: {
    executorKey: 'acompanhamento_retorno',
    campos: [
      { key: 'previsao_retorno', label: 'Previsão informada pelo cartório', tipo: 'data', ajuda: 'Previsão do terceiro. Não é o prazo interno da tarefa.', ordem: 1 },
      { key: 'contato', label: 'Contato realizado', tipo: 'textarea', ordem: 2 },
      { key: 'comprovante', label: 'Comprovante', tipo: 'upload', ordem: 3 },
    ],
    acoes: [
      { key: 'retorno_chegou', label: 'O retorno chegou', descricao: 'Fecha a espera e libera o recebimento.', effectKey: 'COMPLETE_STEP', ordem: 1 },
      { key: 'ainda_aguardando', label: 'Ainda aguardando', descricao: 'Registra o contato e mantém a espera externa.', effectKey: 'PAUSE_FOR_EXTERNAL_WAIT', ordem: 2 },
      { key: 'retomar', label: 'Retomar', descricao: 'Desfaz a espera externa.', effectKey: 'RESUME', ordem: 3 },
    ],
  },
  receber_certidao: {
    executorKey: 'recebimento_documento',
    campos: [
      // Os três valores são os do array MEDIUM_OPTIONS do componente, na mesma ordem.
      { key: 'midia', label: 'Como o documento chegou', tipo: 'radio', obrigatorio: true, ordem: 1,
        opcoes: [
          { value: 'fisico', label: 'Físico (papel original)' },
          { value: 'digital', label: 'Digital (PDF eletrônico)' },
          { value: 'ambos', label: 'Ambos' },
        ] },
      { key: 'localizacao_fisica', label: 'Localização física', tipo: 'texto', ordem: 2,
        condicao: { campo: 'midia', op: 'em', valor: ['fisico', 'ambos'] } },
      { key: 'arquivo', label: 'Arquivo recebido', tipo: 'upload', ordem: 3 },
      { key: 'observacao', label: 'Observação do recebimento', tipo: 'textarea', ordem: 4 },
    ],
    acoes: [
      { key: 'recebido', label: 'Registrar recebimento', descricao: 'Marca o documento como recebido e conclui a etapa.', effectKey: 'MARK_DOCUMENT_RECEIVED', ordem: 1 },
    ],
  },
  conferir_certidao: {
    executorKey: 'conferencia_documento',
    campos: [
      { key: 'observacao', label: 'Observação da conferência', tipo: 'textarea', ordem: 1 },
      { key: 'motivo', label: 'Motivo', tipo: 'textarea', ordem: 2, ajuda: 'Exigido ao pedir nova via.' },
    ],
    // A CONFERÊNCIA NÃO TEM "rejeitado · retificação". Ela aprova para a análise ou
    // pede outra via — as duas operacionais. Decidir retificação é da Análise, e o
    // efeito nem está entre os que este executor sabe disparar.
    acoes: [
      { key: 'aprovado', label: 'Conferência aprovada', descricao: 'O documento serve materialmente: legível, íntegro e com os dados mínimos. A etapa fecha.', effectKey: 'COMPLETE_STEP', ordem: 1 },
      { key: 'nova_via', label: 'Solicitar nova via', descricao: 'O documento não serve; pedir outro ao cartório. O atual continua consultável.', effectKey: 'REQUEST_NEW_COPY', ordem: 2, requerCampos: ['motivo'] },
    ],
    checklist: [
      { key: 'legivel', label: 'Legibilidade', descricao: 'Texto claro, sem rasuras, manchas ou áreas borradas.', ordem: 1 },
      { key: 'integro', label: 'Integridade do documento', descricao: 'Sem páginas faltando, sem cortes. PDF abre sem corrupção.', ordem: 2 },
      { key: 'dados_minimos', label: 'Dados mínimos presentes', descricao: 'Nome, data, cartório, livro/folha/termo visíveis.', ordem: 3 },
      { key: 'apostila_ok', label: 'Apostila de Haia (se exigida)', descricao: 'Caso o destino exija apostila, ela está presente e legível. Marque também se NÃO for exigida.', ordem: 4 },
      { key: 'traducao_ok', label: 'Tradução juramentada (se exigida)', descricao: 'Caso o destino exija tradução, ela está presente. Marque também se NÃO for exigida.', ordem: 5 },
    ],
  },
  validar_certidao: {
    executorKey: 'validacao_juridica',
    campos: [
      { key: 'parecer', label: 'Parecer', tipo: 'textarea', obrigatorio: true, ordem: 1 },
      { key: 'motivo', label: 'Motivo', tipo: 'textarea', ordem: 2, ajuda: 'Exigido ao pedir nova via.' },
    ],
    // A EMISSÃO VALIDA PARA ENTREGAR, NÃO PARA JULGAR.
    //
    // Aqui estavam "Aprovado com ressalvas" (registrar divergência) e "Rejeitado ·
    // retificação" — as duas decisões da ANÁLISE, oferecidas dentro da EMISSÃO. Era a
    // porta pela qual a decisão jurídica era tomada na fase errada, e é ela que sai.
    // O que sobra é o que a Emissão de fato pode: entregar o documento a quem decide,
    // ou pedir outra via porque o que chegou não serve materialmente.
    acoes: [
      { key: 'aprovado', label: 'Validado — enviar para a Análise', descricao: 'O documento está pronto para ser analisado. A Análise Documental decide se ele serve juridicamente.', effectKey: 'APPROVE_FOR_ANALYSIS', ordem: 1 },
      { key: 'nova_via', label: 'Solicitar nova via', descricao: 'O documento não serve; pedir outro ao cartório. O atual continua consultável.', effectKey: 'REQUEST_NEW_COPY', ordem: 2, requerCampos: ['motivo'] },
    ],
  },

  // ── ANÁLISE DOCUMENTAL — onde as decisões passam a morar ─────────────────
  // Os passos já existiam e já nomeavam exatamente estas decisões; o que faltava era
  // eles TEREM as ações. Enquanto não tinham, as decisões aconteciam na Emissão.
  preparar_pacote_de_analise: {
    executorKey: 'padrao',
    campos: [{ key: 'observacao', label: 'Observação', tipo: 'textarea', ordem: 1 }],
    acoes: [{ key: 'pronto', label: 'Pacote pronto', descricao: 'Os documentos a comparar estão reunidos.', effectKey: 'COMPLETE_STEP', ordem: 1 }],
  },
  comparar_nomes_datas_locais_e_filiacao: {
    executorKey: 'padrao',
    campos: [{ key: 'observacao', label: 'O que foi comparado', tipo: 'textarea', ordem: 1 }],
    acoes: [{ key: 'comparado', label: 'Comparação concluída', descricao: 'Nomes, datas, locais e filiação foram confrontados.', effectKey: 'COMPLETE_STEP', ordem: 1 }],
  },
  registrar_divergencias: {
    executorKey: 'padrao',
    campos: [
      { key: 'descricao', label: 'Divergência encontrada', tipo: 'textarea', obrigatorio: true, ordem: 1 },
      { key: 'criticidade', label: 'Criticidade', tipo: 'select', ordem: 2,
        opcoes: [
          { value: 'baixa', label: 'Baixa' },
          { value: 'media', label: 'Média' },
          { value: 'alta', label: 'Alta' },
        ] },
    ],
    acoes: [
      { key: 'registrar', label: 'Registrar divergência', descricao: 'Anota o que não bate. Registrar divergência não decide retificação.', effectKey: 'REGISTER_DIVERGENCE', ordem: 1, requerCampos: ['descricao'] },
      { key: 'sem_divergencia', label: 'Nenhuma divergência', descricao: 'Os documentos batem entre si.', effectKey: 'COMPLETE_STEP', ordem: 2 },
    ],
  },
  classificar_criticidade: {
    executorKey: 'padrao',
    campos: [{ key: 'parecer', label: 'Parecer da classificação', tipo: 'textarea', obrigatorio: true, ordem: 1 }],
    acoes: [{ key: 'classificado', label: 'Criticidade classificada', descricao: 'A gravidade das divergências está registrada.', effectKey: 'COMPLETE_STEP', ordem: 1 }],
  },
  concluir_necessidade_de_retificacao: {
    executorKey: 'validacao_juridica',
    campos: [
      { key: 'justificativa', label: 'Justificativa da decisão', tipo: 'textarea', obrigatorio: true, ordem: 1 },
      { key: 'motivo', label: 'Motivo', tipo: 'textarea', ordem: 2 },
    ],
    // AQUI, E SÓ AQUI, SE DECIDE RETIFICAR.
    acoes: [
      { key: 'sem_retificacao', label: 'Não precisa retificar', descricao: 'As divergências não impedem o uso do documento. Ele é dado por concluído.', effectKey: 'COMPLETE_DOCUMENT', ordem: 1 },
      { key: 'retificacao', label: 'Retificar o registro', descricao: 'O registro precisa ser corrigido. Ativa a fase de Retificação de Registros.', effectKey: 'GO_RETIFICATION', ordem: 2, requerCampos: ['justificativa'] },
      // PEDIR NOVA VIA É ATO OPERACIONAL DA EMISSÃO, não da Análise. Quando o
      // documento não serve e não é caso de retificar, a Análise INVALIDA — e é a
      // Emissão que providencia outra via. Deixar as duas fases pedirem via seria
      // recriar, do outro lado, a mistura de competências que este trabalho desfez.
      { key: 'invalido', label: 'Documento inválido', descricao: 'O documento não serve e não vai servir. Invalidado não é concluído: a obrigação continua aberta, e a Emissão providencia outra via.', effectKey: 'INVALIDATE_DOCUMENT', ordem: 3, requerCampos: ['motivo'] },
    ],
  },
}

async function main() {
  log(EXECUTAR ? 'SEED DO CADASTRO CANÔNICO — APLICANDO\n' : 'SEED DO CADASTRO CANÔNICO — SOMENTE LEITURA (use --execute)\n')

  // ── 1. CANAIS ───────────────────────────────────────────────────────────
  log('CANAIS')
  let canaisNovos = 0
  for (const [i, c] of CANAIS_SOLICITACAO.entries()) {
    const existe = await prisma.canalOperacional.findUnique({ where: { key: c.canal }, select: { id: true } })
    log(`  ${existe ? '·' : EXECUTAR ? '✔' : '→'} ${c.canal.padEnd(12)} ${c.label}${existe ? ' (já cadastrado)' : ''}`)
    if (!existe && EXECUTAR) {
      await prisma.canalOperacional.create({
        data: {
          key: c.canal, label: c.label, descricao: c.descricao, ordem: i + 1, ativo: true,
          protocoloObrigatorio: c.protocoloObrigatorio,
          anexoObrigatorioLabel: c.anexoObrigatorioLabel,
          rastreioObrigatorio: c.rastreioObrigatorio,
          observacaoObrigatoria: c.observacaoObrigatoria,
        },
      })
      canaisNovos++
    }
  }

  // ── 2. COMPETÊNCIA DAS FASES ────────────────────────────────────────────
  log('\nCOMPETÊNCIA DAS FASES')
  let fasesTocadas = 0
  for (const phaseKey of Object.keys(COMPETENCIA_PADRAO_DA_FASE)) {
    const fase = await prisma.catalogoFase.findUnique({ where: { phaseKey }, select: { id: true, efeitosPermitidos: true } })
    if (!fase) { log(`  ! ${phaseKey} — fase não existe no catálogo`); continue }
    if (fase.efeitosPermitidos != null) { log(`  · ${phaseKey} (já declarada)`); continue }
    const efeitos = efeitosDaFase(phaseKey, null)
    log(`  ${EXECUTAR ? '✔' : '→'} ${phaseKey.padEnd(26)} ${efeitos.length}/${CATALOGO_DE_EFEITOS.length} efeitos`)
    if (EXECUTAR) {
      await prisma.catalogoFase.update({ where: { id: fase.id }, data: { efeitosPermitidos: efeitos } })
      fasesTocadas++
    }
  }

  // ── 3. AÇÕES / CAMPOS / CHECKLIST DOS PASSOS ────────────────────────────
  log('\nCONFIGURAÇÃO DOS PASSOS')
  let passosTocados = 0
  for (const [stepKey, cfg] of Object.entries(CONFIG_DOS_PASSOS)) {
    const passos = await prisma.phaseInternalWorkflowStep.findMany({
      where: { key: stepKey },
      select: { id: true, workflowId: true, label: true, executorKey: true, _count: { select: { acoes: true, campos: true, checkItens: true } } },
    })
    if (passos.length === 0) { log(`  ! ${stepKey} — nenhum passo publicado com esta chave`); continue }
    for (const p of passos) {
      const jaTem = p._count.acoes > 0 || p._count.campos > 0
      log(`  ${jaTem ? '·' : EXECUTAR ? '✔' : '→'} ${stepKey.padEnd(30)} wf#${p.workflowId} · ${cfg.acoes.length} ações · ${cfg.campos.length} campos · ${cfg.checklist?.length ?? 0} itens${jaTem ? ' (já configurado)' : ''}`)
      if (jaTem || !EXECUTAR) continue
      await prisma.$transaction(async (tx) => {
        await tx.phaseInternalWorkflowStep.update({ where: { id: p.id }, data: { executorKey: cfg.executorKey } })
        await tx.stepField.createMany({
          data: cfg.campos.map((c) => ({
            stepId: p.id, key: c.key, label: c.label, tipo: c.tipo,
            obrigatorio: !!c.obrigatorio, opcoes: (c.opcoes ?? undefined) as never,
            condicao: (c.condicao ?? undefined) as never, ajuda: c.ajuda ?? null, ordem: c.ordem,
          })),
          skipDuplicates: true,
        })
        await tx.stepAction.createMany({
          data: cfg.acoes.map((a) => ({
            stepId: p.id, key: a.key, label: a.label, descricao: a.descricao,
            effectKey: a.effectKey, ordem: a.ordem,
            requerCampos: (a.requerCampos ?? undefined) as never,
          })),
          skipDuplicates: true,
        })
        if (cfg.checklist?.length) {
          await tx.stepChecklistItem.createMany({
            data: cfg.checklist.map((k) => ({
              stepId: p.id, key: k.key, label: k.label, descricao: k.descricao, ordem: k.ordem,
            })),
            skipDuplicates: true,
          })
        }
      })
      passosTocados++
    }
  }

  log(`\n${'═'.repeat(74)}`)
  log(`Canais criados: ${canaisNovos} · fases com competência declarada: ${fasesTocadas} · passos configurados: ${passosTocados}`)
  log(`Total em banco → canais: ${await prisma.canalOperacional.count()} · ações: ${await prisma.stepAction.count()} · campos: ${await prisma.stepField.count()} · checklist: ${await prisma.stepChecklistItem.count()}`)
  if (!EXECUTAR) log('\nNada foi alterado. Para aplicar: --execute')
}

void main().finally(() => prisma.$disconnect())
