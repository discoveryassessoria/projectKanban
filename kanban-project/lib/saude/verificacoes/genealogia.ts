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
import { STATUS_DOCUMENTO_INATIVOS } from '@/src/lib/documentos/status-inativos'
import { resolverTiposDocumentais, recebeWorkflowOperacional } from '@/src/lib/documentos/politica-natureza-fase'
import { SELECT_UNIAO_PARA_TITULAR, titularDaUniao } from '@/src/services/genealogia/titular-uniao'
import { calcularExigenciasDaGenealogia } from '@/src/services/genealogia/materializar-genealogia'
import { PHASEKEY_A_INICIAR } from '@/src/lib/process-stage/fase-pre-contrato'
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
      // "Aguardando fechamento" fora: nada é materializado nessa fase por desenho (ver materializarGenealogia).
      where: { arvoreId: { not: null }, dataConclusao: null, faseAtualKey: { notIn: ['finalizado', PHASEKEY_A_INICIAR] } },
      select: { id: true },
      take: 500,
    })
    if (!processos.length) return vazio({ processos: 0, achados: 0 }, 'Nenhum processo ativo com árvore vinculada.')

    const achados: Achado[] = []
    let processosVerificados = 0

    for (const p of processos) {
      const calculo = await calcularExigenciasDaGenealogia(p.id)
      // SEM REGRA PUBLICADA TAMBÉM É VERIFICADO: o reconciliador dispensa as necessidades
      // órfãs (regra inativada/arquivada) em vez de retornar cedo — exigência zero é esperado.
      if (!calculo) continue
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
        } else if (!deveriaExistir && n.status === 'PENDENTE') {
          // Só PENDENTE é dispensada automaticamente. O que já andou (EM_ATENDIMENTO/ATENDIDA/
          // NAO_LOCALIZADA) é fato acontecido — decisão conservadora: quem aponta é ARV-002 (ALERTA).
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
          if (dispensada && !['NAO_EXIGIDO', 'CANCELADO', 'ENTREGUE', 'INVALIDO'].includes(d.status)) {
            achados.push({
              chave: `nec001-doc-deveria-cancelado:${d.id}`, severidade: 'ERRO',
              titulo: `Documento #${d.id} está ${d.status}, mas a necessidade #${n.id} está DISPENSADA`,
              descricao: 'Necessidade dispensada; o Documento operacional dela deveria estar NAO_EXIGIDO — outras fases leem o Documento direto, nunca o status da necessidade.',
              explicacao: 'A dispensa não alcançou o Documento (gap em `dispensarNecessidade`) ou o Documento foi reativado sem a necessidade acompanhar.',
              entidade: 'Documento', registroId: String(d.id),
              link: ROTA, recomendacao: 'Rode reconciliarNecessidades(processoId) para este processo.',
              evidencia: { processoId: p.id, pessoaId: n.pessoaId, necessidadeId: n.id, documentoId: d.id, tarefaId: null, campo: 'Documento.status', gravado: d.status, esperado: 'NAO_EXIGIDO' },
            })
          } else if (!dispensada && (d.status === 'NAO_EXIGIDO' || (d.status === 'CANCELADO' && d.motivoBloqueio === MOTIVO_DOCUMENTO_DISPENSADO))) {
            achados.push({
              chave: `nec001-doc-deveria-reaberto:${d.id}`, severidade: 'ERRO',
              titulo: `Documento #${d.id} continua ${d.status === 'NAO_EXIGIDO' ? 'NAO_EXIGIDO' : 'CANCELADO'} ("não se aplica em nenhuma fase"), mas a necessidade #${n.id} já é ${n.status}`,
              descricao: 'A necessidade voltou a valer, mas o Documento continua fora de jogo (NAO_EXIGIDO, ou o CANCELADO legado da dispensa) da dispensa anterior.',
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

// ============================================================================
// ARV-002 — "A árvore e seus derivados concordam" (CLAUDE.md §37).
// A árvore genealógica é a única fonte de verdade documental: necessidade,
// Documento, tarefa e contagem DERIVAM dela. Esta verificação acusa, sem escrever,
// cada ponto em que um derivado não tem mais a árvore por trás (ou não nasceu).
// Complementa NEC-001 (que compara estado esperado × gravado por necessidade) sem
// duplicá-la: chaves próprias `ARV-002:*`; o que já ANDOU e perdeu a causa é
// ALERTA aqui (NEC-001 só cobra o PENDENTE).
// ============================================================================
const STATUS_TAREFA_TERMINAL = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA'] as const
const nomePessoa = (p: { nome: string; sobrenome: string | null } | null | undefined) => (p ? [p.nome, p.sobrenome].filter(Boolean).join(' ') : 'pessoa não identificada')

registrar({
  id: 'saude.genealogia.arvore-e-derivados-concordam',
  codigo: 'ARV-002',
  nome: 'A árvore e seus derivados concordam',
  descricao: 'A árvore genealógica é a única fonte de verdade documental. Acusa, sem escrever: Documento automático sem necessidade; certidão exigida sem Documento; tarefa aberta cujo Documento não tem necessidade ativa; necessidade de união cujo casal não existe mais; e necessidade já atendida/em atendimento/não localizada cuja causa sumiu da árvore (mantida por ter andado — requer decisão humana).',
  dominio: 'ARVORE',
  modulo: 'Genealogia',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.11.0',
  timeoutMs: 60_000,
  orientacao: 'Abra o processo pelo link e rode reconciliarNecessidades(processoId) — ela converge necessidade, documento, passo e tarefa. Para necessidade já atendida que perdeu a causa, a decisão é humana (dispensar ou manter).',
  rotaCorrecao: ROTA,
  correcaoAutomatica: null,
  responsavel: 'Genealogia',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const processos = await prisma.processo.findMany({
      where: { arvoreId: { not: null }, dataConclusao: null, faseAtualKey: { not: 'finalizado' } },
      select: { id: true, nome: true, arvoreId: true, arvore: { select: { nome: true } } },
      take: 500,
    })
    if (!processos.length) return vazio({ processos: 0, achados: 0 }, 'Nenhum processo ativo com árvore vinculada.')
    const procPorId = new Map(processos.map((p) => [p.id, p]))
    const procIds = processos.map((p) => p.id)
    const arvoreIds = [...new Set(processos.map((p) => p.arvoreId as number))]
    const familia = (processoId: number) => {
      const p = procPorId.get(processoId)
      return p ? `família ${p.arvore?.nome ?? p.nome} · processo #${p.id}` : `processo #${processoId}`
    }
    const link = (processoId: number) => `/processos/${processoId}`
    const achados: Achado[] = []

    // (i) Documento automático ativo SEM necessidade.
    const orfaos = await prisma.documento.findMany({
      where: { origem: 'automatica', necessidadeId: null, status: { notIn: [...STATUS_DOCUMENTO_INATIVOS] }, pessoa: { arvoreId: { in: arvoreIds } } },
      select: { id: true, status: true, pessoa: { select: { nome: true, sobrenome: true, arvoreId: true } }, documentType: { select: { name: true } } },
    })
    for (const d of orfaos) {
      const proc = processos.find((p) => p.arvoreId === d.pessoa.arvoreId)
      const nome = `${d.documentType?.name ?? 'Documento'} · ${nomePessoa(d.pessoa)}`
      achados.push({
        chave: `ARV-002:doc:${d.id}`, severidade: 'ERRO',
        titulo: `Documento "${nome}" (#${d.id}) não tem necessidade por trás (${proc ? familia(proc.id) : 'árvore ' + d.pessoa.arvoreId})`,
        descricao: 'Documento criado automaticamente pela árvore que perdeu a necessidade de origem — a árvore não exige mais este documento (ou a necessidade foi apagada junto com a união/pessoa).',
        explicacao: 'Sem necessidade ativa, nenhum passo ou tarefa deveria nascer do Documento; se a fase de Emissão abrir, ele vira tarefa fantasma.',
        impacto: 'Conta como documento pendente e pode virar tarefa sem causa.',
        entidade: 'Documento', registroId: String(d.id), registroNome: nome,
        link: proc ? link(proc.id) : ROTA, recomendacao: 'Rode reconciliarNecessidades(processoId): o Documento passa a NAO_EXIGIDO (anexos e histórico ficam).',
        evidencia: { processoId: proc?.id ?? null, documentoId: d.id, necessidadeId: null, tarefaId: null, campo: 'Documento.necessidadeId', gravado: null, esperado: 'necessidade ativa ou status NAO_EXIGIDO' },
      })
    }

    // Necessidades vivas do recorte (ii, iv, v).
    const necs = await prisma.necessidadeDocumental.findMany({
      where: { processoId: { in: procIds }, supersedePorId: null, status: { not: 'DISPENSADA' } },
      select: {
        id: true, processoId: true, status: true, origem: true, varianteKey: true, pessoaId: true, uniaoId: true, itemCatalogoId: true,
        itemCatalogo: { select: { name: true } },
        pessoa: { select: { nome: true, sobrenome: true } },
        uniao: { select: { id: true, ...SELECT_UNIAO_PARA_TITULAR } },
        documentos: { select: { id: true }, take: 1 },
      },
    })
    const tipos = await resolverTiposDocumentais(prisma)
    const itensComDocumento = new Set<number>()
    for (const t of tipos.values()) if (t.itemCatalogoId != null && recebeWorkflowOperacional(t)) itensComDocumento.add(t.itemCatalogoId)

    const titularNome = new Map<number, string>()
    const rotuloNec = async (n: (typeof necs)[number]) => {
      let quem = n.pessoa ? nomePessoa(n.pessoa) : null
      if (!quem && n.uniao) {
        const tid = titularDaUniao(n.uniao)
        if (tid != null) {
          if (!titularNome.has(tid)) {
            const pp = await prisma.pessoa.findUnique({ where: { id: tid }, select: { nome: true, sobrenome: true } })
            titularNome.set(tid, nomePessoa(pp))
          }
          quem = titularNome.get(tid) ?? null
        }
      }
      return `${n.itemCatalogo?.name ?? 'Documento'}${quem ? ` · ${quem}` : ''}`
    }

    // (ii) certidão exigida (necessidade ativa) SEM Documento — só item que gera Documento.
    for (const n of necs) {
      if (n.documentos.length > 0 || !itensComDocumento.has(n.itemCatalogoId)) continue
      const nome = await rotuloNec(n)
      achados.push({
        chave: `ARV-002:nec-sem-doc:${n.id}`, severidade: 'ALERTA',
        titulo: `Necessidade "${nome}" (#${n.id}) está ativa e não tem Documento (${familia(n.processoId)})`,
        descricao: 'A árvore exige esta certidão e o Documento operacional que deveria existir junto com a necessidade não foi criado.',
        explicacao: 'O Documento nasce com a necessidade (materializarGenealogia → garantirDocumentoDaNecessidade); a reconciliação não rodou ou falhou depois de criar a necessidade.',
        impacto: 'A certidão não aparece na lista da pessoa nem na Emissão.',
        entidade: 'NecessidadeDocumental', registroId: String(n.id), registroNome: nome,
        link: link(n.processoId), recomendacao: 'Rode reconciliarNecessidades(processoId) para este processo.',
        evidencia: { processoId: n.processoId, necessidadeId: n.id, documentoId: null, tarefaId: null, campo: 'Documento', gravado: null, esperado: 'Documento da necessidade' },
      })
    }

    // (iii) tarefa aberta cujo Documento não tem necessidade ativa.
    const tarefas = await prisma.tarefa.findMany({
      where: {
        processoId: { in: procIds }, origem: { not: 'MANUAL' }, documentoId: { not: null },
        statusTarefa: { notIn: [...STATUS_TAREFA_TERMINAL] },
        documento: { OR: [{ necessidadeId: null }, { necessidade: { status: 'DISPENSADA' } }, { status: { in: [...STATUS_DOCUMENTO_INATIVOS] } }] },
      },
      select: { id: true, processoId: true, titulo: true, documentoId: true, causaRemovidaEm: true, statusTarefa: true },
    })
    for (const t of tarefas) {
      if (t.processoId == null) continue
      achados.push({
        chave: `ARV-002:tarefa:${t.id}`, severidade: t.causaRemovidaEm ? 'ALERTA' : 'ERRO',
        titulo: `Tarefa "${t.titulo}" (#${t.id}) está aberta, mas o Documento dela não tem necessidade ativa (${familia(t.processoId)})`,
        descricao: t.causaRemovidaEm
          ? 'O trabalho já tinha começado quando a árvore deixou de exigir o documento: a tarefa foi marcada e aguarda decisão humana (manter ou encerrar).'
          : 'Tarefa aberta cujo Documento não tem necessidade ativa (sem necessidade, necessidade dispensada ou Documento fora de jogo) — trabalho sem causa.',
        explicacao: 'Documento sem necessidade nunca é causa de tarefa (achado real: processo 675, tarefa 3984 / documento 2303).',
        impacto: 'Fila e contagens mostram um trabalho que a árvore não exige.',
        entidade: 'Tarefa', registroId: String(t.id), registroNome: t.titulo,
        link: link(t.processoId), recomendacao: 'Rode reconciliarNecessidades(processoId): tarefa não iniciada é cancelada; iniciada é marcada para decisão.',
        evidencia: { processoId: t.processoId, necessidadeId: null, documentoId: t.documentoId, tarefaId: t.id, campo: 'Tarefa.statusTarefa', gravado: t.statusTarefa, esperado: 'CANCELADA (não iniciada) ou decisão humana' },
      })
    }

    // (iv) necessidade de UNIÃO cujo casal não existe mais (nenhum cônjuge casado, ou cônjuge fora da árvore ativa).
    const necsUniao = necs.filter((n) => n.uniaoId != null)
    if (necsUniao.length) {
      const unioes = await prisma.uniao.findMany({
        where: { id: { in: necsUniao.map((n) => n.uniaoId as number) } },
        select: { id: true, pessoa1: { select: { id: true, casado: true, removidaEm: true, arvoreId: true } }, pessoa2: { select: { id: true, casado: true, removidaEm: true, arvoreId: true } } },
      })
      const uPorId = new Map(unioes.map((u) => [u.id, u]))
      for (const n of necsUniao) {
        const u = uPorId.get(n.uniaoId as number)
        const arvoreDoProc = procPorId.get(n.processoId)?.arvoreId
        let motivo: string | null = null
        if (!u) motivo = 'a união não existe mais'
        else if ([u.pessoa1, u.pessoa2].some((p) => !p || p.removidaEm != null || p.arvoreId !== arvoreDoProc)) motivo = 'um dos cônjuges saiu da árvore ativa'
        else if (!u.pessoa1.casado && !u.pessoa2.casado) motivo = 'nenhum dos dois consta como casado'
        if (!motivo) continue
        const nome = await rotuloNec(n)
        achados.push({
          chave: `ARV-002:uniao:${n.id}`, severidade: 'ERRO',
          titulo: `Necessidade "${nome}" (#${n.id}) é de uma união que não vale mais: ${motivo} (${familia(n.processoId)})`,
          descricao: `A certidão de casamento continua exigida, mas ${motivo}.`,
          explicacao: 'Desfazer o casal na árvore deve dispensar a necessidade da união (Documento → NAO_EXIGIDO, tarefa e passos cancelados) na mesma transação.',
          impacto: 'Certidão de casamento exigida e cobrada de um casal que não existe na árvore.',
          entidade: 'NecessidadeDocumental', registroId: String(n.id), registroNome: nome,
          link: link(n.processoId), recomendacao: 'Rode reconciliarNecessidades(processoId) para este processo.',
          evidencia: { processoId: n.processoId, uniaoId: n.uniaoId, necessidadeId: n.id, documentoId: null, tarefaId: null, campo: 'Uniao', gravado: n.status, esperado: 'DISPENSADA' },
        })
      }
    }

    // (v) necessidade que JÁ ANDOU e cuja causa sumiu da árvore — ALERTA (decisão humana).
    const andadas = necs.filter((n) => n.origem === 'MATRIZ' && n.varianteKey.startsWith('rd:') && ['EM_ATENDIMENTO', 'ATENDIDA', 'NAO_LOCALIZADA'].includes(n.status))
    const porProcesso = new Map<number, typeof andadas>()
    for (const n of andadas) porProcesso.set(n.processoId, [...(porProcesso.get(n.processoId) ?? []), n])
    for (const [processoId, lista] of porProcesso) {
      const calculo = await calcularExigenciasDaGenealogia(processoId)
      if (!calculo) continue
      const aplicaveis = new Set(calculo.exigencias.map((e) => e.chave))
      for (const n of lista) {
        const chave = n.pessoaId != null ? `p${n.pessoaId}::${n.varianteKey}` : `u${n.uniaoId}::${n.varianteKey}`
        if (aplicaveis.has(chave)) continue
        const nome = await rotuloNec(n)
        achados.push({
          chave: `ARV-002:nec:${n.id}`, severidade: 'ALERTA',
          titulo: `Necessidade "${nome}" (#${n.id}) está ${n.status}, mas a árvore não a exige mais (${familia(processoId)})`,
          descricao: 'A árvore (ou a regra documental) deixou de exigir esta certidão depois que ela já tinha andado. O sistema a MANTEVE por ser fato acontecido — não dispensa sozinho.',
          explicacao: 'Decisão conservadora: necessidade atendida/em atendimento/não localizada nunca é dispensada automaticamente; só PENDENTE é.',
          impacto: 'A certidão segue contando no progresso mesmo sem ser mais exigida.',
          entidade: 'NecessidadeDocumental', registroId: String(n.id), registroNome: nome,
          link: link(processoId), recomendacao: 'Decisão humana: dispensar a necessidade (se não é mais devida) ou confirmar que deve ser mantida.',
          evidencia: { processoId, necessidadeId: n.id, documentoId: null, tarefaId: null, campo: 'NecessidadeDocumental.status', gravado: n.status, esperado: 'decisão humana' },
        })
      }
    }

    const metricas = { processos: processos.length, documentosOrfaos: orfaos.length, necessidadesSemDocumento: achados.filter((a) => a.chave.startsWith('ARV-002:nec-sem-doc')).length, tarefasSemCausa: tarefas.length, achados: achados.length }
    if (!achados.length) return vazio(metricas, `${processos.length} processo(s) — a árvore e seus derivados concordam.`)
    return { achados, metricas }
  },
})
