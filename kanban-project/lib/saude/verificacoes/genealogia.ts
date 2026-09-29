// lib/saude/verificacoes/genealogia.ts
//
// NEC-001 — mandato "nunca mais árvore ↔ documentação" (Torre de Controle,
// 29/09/2026). Prova que NecessidadeDocumental/Documento/PhaseWorkflowStepInstance/
// Tarefa convergem com o que a árvore + a matriz + `Pessoa.documentacao` dizem que
// é exigido — a MESMA pergunta que `reconciliarNecessidades` responde ao escrever,
// feita aqui de novo, sozinha e sem escrever nada, só para comparar.
//
// Achado real (processo 675, 29/09/2026): a necessidade convergia sozinha, mas o
// Documento e o Passo ficavam presos no estado anterior — Priscila (dispensada)
// com Tarefa NAO_INICIADA órfã; Evanir (reativada) com Documento e Passo ainda
// CANCELADO. As quatro camadas (necessidade/documento/passo/tarefa) podem divergir
// independentemente, e cada achado aqui nomeia qual delas.

import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'
import { calcularExigenciasDaGenealogia } from '@/src/services/genealogia/materializar-genealogia'
import { MOTIVO_DOCUMENTO_DISPENSADO } from '@/src/services/necessidade-documental'
import { conferirCoerenciaPassoTarefa } from '@/src/services/passo-tarefa-projecao'

const ROTA = '/operacao'
const vazio = (metricas: Record<string, number>, resumo: string): ResultadoVerificacao => ({ achados: [], metricas, resumo })

const ESTADOS_TERMINAIS_PASSO = new Set(['CANCELADO', 'SUPERSEDIDO', 'DISPENSADO', 'CONCLUIDO', 'EXECUTADO'])

registrar({
  id: 'saude.genealogia.arvore-documentacao-coerente',
  codigo: 'NEC-001',
  nome: 'Árvore, necessidades, documentos e tarefas coerentes',
  descricao: 'Achado real (processo 675, 29/09/2026): ligar/desligar "precisa de documentação" numa pessoa fora da linhagem convergia a NecessidadeDocumental, mas deixava Documento e Passo (e por tabela a Tarefa) presos no estado anterior — Tarefa órfã em NAO_INICIADA quando a necessidade já tinha sido dispensada, e Documento/Passo travados em CANCELADO quando a necessidade voltou a valer. Esta verificação recalcula o esperado (árvore + matriz + `+"`Pessoa.documentacao`"+`, mesma regra do reconciliador) e compara com o que está gravado, sem escrever nada.',
  dominio: 'ARVORE',
  modulo: 'Genealogia',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.10.0',
  timeoutMs: 60_000,
  orientacao: 'Abra o processo pela evidência (processoId) e rode reconciliarNecessidades(processoId) — ela converge necessidade, documento, passo e tarefa na mesma chamada. Se o achado persistir depois, é um caso novo, não o já conhecido.',
  rotaCorrecao: ROTA,
  correcaoAutomatica: null,
  responsavel: 'Genealogia',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const processos = await prisma.processo.findMany({
      where: { arvoreId: { not: null }, dataConclusao: null, faseAtualKey: { not: 'finalizado' } },
      select: { id: true },
      take: 500,
    })
    if (!processos.length) return vazio({ processos: 0, achados: 0 }, 'Nenhum processo ativo com árvore vinculada.')

    const achados: Achado[] = []
    let processosVerificados = 0

    for (const p of processos) {
      const calculo = await calcularExigenciasDaGenealogia(p.id)
      if (!calculo || calculo.exigencias.length === 0 && calculo.pendencias.some((m) => m.includes('nenhuma Regra Documental'))) continue
      processosVerificados++

      const aplicaveisVariante = new Set(calculo.exigencias.map((e) => e.chave))

      const necessidades = await prisma.necessidadeDocumental.findMany({
        where: { processoId: p.id, origem: 'MATRIZ', varianteKey: { startsWith: 'rd:' }, supersedePorId: null },
        select: { id: true, pessoaId: true, uniaoId: true, varianteKey: true, status: true, dispensaManual: true },
      })
      if (!necessidades.length) continue

      const necIds = necessidades.map((n) => n.id)
      const documentos = await prisma.documento.findMany({
        where: { necessidadeId: { in: necIds } },
        select: { id: true, necessidadeId: true, status: true, motivoBloqueio: true },
      })
      const docsPorNec = new Map<number, typeof documentos>()
      for (const d of documentos) {
        if (d.necessidadeId == null) continue
        const lista = docsPorNec.get(d.necessidadeId) ?? []
        lista.push(d)
        docsPorNec.set(d.necessidadeId, lista)
      }

      const passos = await prisma.phaseWorkflowStepInstance.findMany({
        where: { necessidadeId: { in: necIds } },
        select: { id: true, necessidadeId: true, status: true, documentoId: true },
      })
      const passosPorNec = new Map<number, typeof passos>()
      for (const s of passos) {
        if (s.necessidadeId == null) continue
        const lista = passosPorNec.get(s.necessidadeId) ?? []
        lista.push(s)
        passosPorNec.set(s.necessidadeId, lista)
      }

      for (const n of necessidades) {
        const chave = n.pessoaId != null ? `p${n.pessoaId}::${n.varianteKey}` : `u${n.uniaoId}::${n.varianteKey}`
        const deveriaExistir = aplicaveisVariante.has(chave)
        const dispensada = n.status === 'DISPENSADA'
        const sujeito = n.pessoaId != null ? `pessoa ${n.pessoaId}` : `união ${n.uniaoId}`

        if (deveriaExistir && dispensada && !n.dispensaManual) {
          achados.push({
            chave: `nec001-nec-deveria-ativa:${n.id}`, severidade: 'ERRO',
            titulo: `Necessidade #${n.id} (${sujeito}) está DISPENSADA, mas a árvore/matriz diz que ainda se aplica`,
            descricao: `A árvore + a matriz documental (recalculadas agora) exigem esta necessidade, mas ela está gravada como DISPENSADA sem ter sido uma dispensa manual.`,
            explicacao: '`reativarNecessidade` não rodou depois que a condição voltou a valer (ex.: `Pessoa.documentacao` voltou a true) — provavelmente porque a reconciliação da árvore ficou pra depois (fila) e uma rodada posterior não convergiu certo.',
            impacto: 'A pessoa some da fila de trabalho mesmo precisando de documento.',
            entidade: 'NecessidadeDocumental', registroId: String(n.id),
            link: ROTA, recomendacao: 'Rode reconciliarNecessidades(processoId) para este processo.',
            evidencia: { processoId: p.id, pessoaId: n.pessoaId, necessidadeId: n.id, documentoId: null, tarefaId: null, campo: 'NecessidadeDocumental.status', gravado: n.status, esperado: 'PENDENTE (ou além)' },
          })
        } else if (!deveriaExistir && !dispensada) {
          achados.push({
            chave: `nec001-nec-deveria-dispensada:${n.id}`, severidade: 'ERRO',
            titulo: `Necessidade #${n.id} (${sujeito}) está ${n.status}, mas a árvore/matriz diz que não se aplica mais`,
            descricao: `A árvore + a matriz documental (recalculadas agora) não exigem mais esta necessidade, mas ela continua ${n.status}.`,
            explicacao: 'A reconciliação automática (`materializarGenealogia`/`reconciliarNecessidades`) não convergiu esta necessidade para DISPENSADA — provavelmente por uma edição da árvore que não disparou a reconciliação síncrona.',
            impacto: 'A pessoa continua na fila de trabalho e no progresso da fase por um documento que não é mais devido.',
            entidade: 'NecessidadeDocumental', registroId: String(n.id),
            link: ROTA, recomendacao: 'Rode reconciliarNecessidades(processoId) para este processo.',
            evidencia: { processoId: p.id, pessoaId: n.pessoaId, necessidadeId: n.id, documentoId: null, tarefaId: null, campo: 'NecessidadeDocumental.status', gravado: n.status, esperado: 'DISPENSADA' },
          })
        }

        const docs = docsPorNec.get(n.id) ?? []
        for (const d of docs) {
          if (dispensada && !['CANCELADO', 'ENTREGUE', 'INVALIDO'].includes(d.status)) {
            achados.push({
              chave: `nec001-doc-deveria-cancelado:${d.id}`, severidade: 'ERRO',
              titulo: `Documento #${d.id} está ${d.status}, mas a necessidade #${n.id} está DISPENSADA`,
              descricao: 'Necessidade dispensada; o Documento operacional dela deveria estar CANCELADO — outras fases leem o Documento direto, nunca o status da necessidade.',
              explicacao: 'A dispensa não alcançou o Documento (gap em `dispensarNecessidade`) ou o Documento foi reativado sem a necessidade acompanhar.',
              entidade: 'Documento', registroId: String(d.id),
              link: ROTA, recomendacao: 'Rode reconciliarNecessidades(processoId) para este processo.',
              evidencia: { processoId: p.id, pessoaId: n.pessoaId, necessidadeId: n.id, documentoId: d.id, tarefaId: null, campo: 'Documento.status', gravado: d.status, esperado: 'CANCELADO' },
            })
          } else if (!dispensada && d.status === 'CANCELADO' && d.motivoBloqueio === MOTIVO_DOCUMENTO_DISPENSADO) {
            achados.push({
              chave: `nec001-doc-deveria-reaberto:${d.id}`, severidade: 'ERRO',
              titulo: `Documento #${d.id} continua CANCELADO ("não se aplica em nenhuma fase"), mas a necessidade #${n.id} já é ${n.status}`,
              descricao: 'A necessidade voltou a valer, mas o Documento continua com o cancelamento automático da dispensa anterior.',
              explicacao: '`reativarNecessidade` não reabriu este Documento — produção real: processo 675, Documento 2315 (Evanir).',
              entidade: 'Documento', registroId: String(d.id),
              link: ROTA, recomendacao: 'Rode reconciliarNecessidades(processoId) para este processo.',
              evidencia: { processoId: p.id, pessoaId: n.pessoaId, necessidadeId: n.id, documentoId: d.id, tarefaId: null, campo: 'Documento.status', gravado: d.status, esperado: 'PENDENTE' },
            })
          }
        }

        const passosDaNec = passosPorNec.get(n.id) ?? []
        if (!dispensada && passosDaNec.length > 0 && passosDaNec.every((s) => ESTADOS_TERMINAIS_PASSO.has(s.status))) {
          const semVivo = passosDaNec.every((s) => s.status === 'CANCELADO')
          if (semVivo) {
            achados.push({
              chave: `nec001-passo-deveria-reaberto:${n.id}`, severidade: 'ERRO',
              titulo: `Necessidade #${n.id} é ${n.status}, mas todos os passos dela continuam CANCELADO`,
              descricao: 'A necessidade voltou a valer sem nenhum passo vivo por trás — não há mais nada empurrando a Tarefa.',
              explicacao: '`reativarNecessidade` não reabriu o(s) PhaseWorkflowStepInstance ligado(s) — produção real: processo 675, passos 2979/2999 (Evanir).',
              entidade: 'PhaseWorkflowStepInstance', registroId: passosDaNec.map((s) => s.id).join(','),
              link: ROTA, recomendacao: 'Rode reconciliarNecessidades(processoId) para este processo.',
              evidencia: { processoId: p.id, pessoaId: n.pessoaId, necessidadeId: n.id, documentoId: passosDaNec[0]?.documentoId ?? null, tarefaId: null, campo: 'PhaseWorkflowStepInstance.status', gravado: 'CANCELADO', esperado: 'DISPONIVEL (ou além)' },
            })
          }
        }
      }

      // COERÊNCIA PASSO↔TAREFA — mesma régua usada em toda transição do motor
      // (`assegurarCoerenciaPassoTarefa`), aplicada aqui como LEITURA sobre os
      // passos da Genealogia deste processo. Cobre a Tarefa órfã (produção:
      // #3967, Priscila) sem duplicar a lógica de `paresCoerentes`.
      const todosOsPassos = [...passosPorNec.values()].flat()
      if (todosOsPassos.length) {
        const divergencias = await conferirCoerenciaPassoTarefa(prisma as never, todosOsPassos.map((s) => s.id))
        const necPorPasso = new Map<number, number>()
        for (const [necId, lista] of passosPorNec) for (const s of lista) necPorPasso.set(s.id, necId)
        for (const div of divergencias) {
          const necId = necPorPasso.get(div.stepInstanceId) ?? null
          achados.push({
            chave: `nec001-passo-tarefa-divergem:${div.stepInstanceId}:${div.tarefaId}`, severidade: 'ERRO',
            titulo: `Passo #${div.stepInstanceId} (${div.statusPasso}) e Tarefa #${div.tarefaId} (${div.statusTarefa}) em estados contraditórios`,
            descricao: `O passo está ${div.statusPasso}; a Tarefa deveria estar ${div.esperado ?? '—'} e está ${div.statusTarefa}.`,
            explicacao: 'A transição do passo não projetou a Tarefa (`projetarTarefaDoPasso` ausente na porta que fez a transição) — produção real: Tarefa #3967 (Priscila, processo 675), NAO_INICIADA com o passo já CANCELADO.',
            impacto: 'A Tarefa fica órfã na fila do operador mostrando um trabalho que já não existe (ou some quando devia estar visível).',
            entidade: 'Tarefa', registroId: String(div.tarefaId),
            link: ROTA, recomendacao: 'Rode reconciliarNecessidades(processoId) para este processo.',
            evidencia: { processoId: p.id, pessoaId: null, necessidadeId: necId, documentoId: null, tarefaId: div.tarefaId, campo: 'Tarefa.statusTarefa', gravado: div.statusTarefa, esperado: div.esperado },
          })
        }
      }
    }

    if (!achados.length) {
      return vazio(
        { processos: processosVerificados, achados: 0 },
        `${processosVerificados} processo(s) ativo(s) com árvore verificado(s) — necessidade/documento/passo/tarefa convergem em todos.`,
      )
    }
    return { achados, metricas: { processos: processosVerificados, achados: achados.length } }
  },
})
