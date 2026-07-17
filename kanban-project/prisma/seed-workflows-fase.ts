// ============================================================
// SEED — Fase 3B: Workflows Internos das Fases (padrão GLOBAL)
// Cria 1 workflow global (tipoProcessoId null) por fase, com os
// passos padrão do mockup (_IWF_TEMPLATES). Idempotente por wfUid.
// Rodar:  npx tsx prisma/seed-workflows-fase.ts
// ============================================================
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

function slug(s: string) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// phaseKey -> nome legível (para o "name" do workflow)
const PHASE_LABELS: Record<string, string> = {
  genealogia: 'Genealogia',
  emissao_documental: 'Emissão Documental',
  analise_documental: 'Análise Documental',
  retificacao: 'Retificação de Registros',
  emissao_documental_retificada: 'Emissão Documental Retificada',
  traducao: 'Tradução Juramentada',
  apostilamento: 'Apostilamento',
  aguardando_protocolo: 'Aguardando Protocolo',
  protocolado: 'Protocolado',
  finalizado: 'Finalizado',
}

// passos padrão (idêntico ao _IWF_TEMPLATES do mockup)
// stepKey explícito quando o slug do label NÃO é a chave canônica desejada.
const STEP_KEY_OVERRIDE: Record<string, Record<string, string>> = {
  // Genealogia: passo único canônico "localizar_registro" (o registro civil é
  // LOCALIZADO aqui; a certidão física é solicitada só na Emissão Documental).
  genealogia: { 'Localizar registro da certidão': 'localizar_registro' },
}

const IWF_TEMPLATES: Record<string, string[]> = {
  // Genealogia UNIFICADA: passo único canônico "Localizar registro da certidão"
  // (stepKey localizar_registro) — mesma chave usada por runtime, editor e execução.
  genealogia: ['Localizar registro da certidão'],
  emissao_documental: ['Solicitar certidão', 'Aguardar retorno do cartório', 'Receber certidão', 'Conferir certidão', 'Validar certidão'],
  analise_documental: ['Preparar pacote de análise', 'Comparar nomes, datas, locais e filiação', 'Registrar divergências', 'Classificar criticidade', 'Concluir necessidade de retificação'],
  retificacao: ['Definir modo de retificação', 'Preparar requerimento/petição', 'Protocolar retificação', 'Acompanhar decisão', 'Registrar averbação', 'Validar retificação'],
  emissao_documental_retificada: ['Solicitar averbação', 'Solicitar certidão retificada', 'Aguardar retorno', 'Receber certidão', 'Conferir certidão', 'Validar certidão retificada'],
  traducao: ['Preparar pacote completo', 'Enviar ao tradutor', 'Aguardar tradução', 'Receber tradução', 'Conferir tradução', 'Validar tradução'],
  apostilamento: ['Preparar pacote', 'Enviar para apostilamento', 'Aguardar retorno', 'Receber apostilas', 'Conferir apostilas', 'Validar apostilamento'],
  aguardando_protocolo: ['Preparar dossiê', 'Revisar requisitos', 'Aguardar janela/agendamento', 'Confirmar disponibilidade de protocolo'],
  protocolado: ['Registrar protocolo', 'Acompanhar andamento', 'Registrar exigência', 'Responder exigência', 'Aguardar decisão'],
  finalizado: ['Conferir conclusão', 'Registrar resultado', 'Arquivar processo', 'Encerrar financeiro'],
}

async function main() {
  let criados = 0, jaExistiam = 0, passosCriados = 0
  for (const phaseKey of Object.keys(IWF_TEMPLATES)) {
    const wfUid = `all::${phaseKey}`
    const name = 'Workflow Interno · ' + (PHASE_LABELS[phaseKey] || phaseKey)

    const existente = await prisma.phaseInternalWorkflow.findUnique({
      where: { wfUid },
      include: { passos: true },
    })

    if (existente) {
      jaExistiam++
      // se por algum motivo ficou sem passos, preenche
      if (existente.passos.length === 0) {
        const labels = IWF_TEMPLATES[phaseKey]
        await prisma.phaseInternalWorkflowStep.createMany({
          data: labels.map((label, i) => ({
            workflowId: existente.id,
            key: STEP_KEY_OVERRIDE[phaseKey]?.[label] ?? slug(label),
            label,
            ordem: i + 1,
            createsTask: true,
            required: true,
          })),
        })
        passosCriados += labels.length
      }
      continue
    }

    const labels = IWF_TEMPLATES[phaseKey]
    await prisma.phaseInternalWorkflow.create({
      data: {
        wfUid,
        tipoProcessoId: null, // GLOBAL — vale para todos os processos
        phaseKey,
        name,
        passos: {
          create: labels.map((label, i) => ({
            key: STEP_KEY_OVERRIDE[phaseKey]?.[label] ?? slug(label),
            label,
            ordem: i + 1,
            createsTask: true,
            required: true,
          })),
        },
      },
    })
    criados++
    passosCriados += labels.length
  }

  console.log(`✅ Workflows Internos (3B): ${criados} criados, ${jaExistiam} já existiam. Passos criados: ${passosCriados}.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })