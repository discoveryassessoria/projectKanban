// lib/saude/verificacoes/ponta-a-ponta.ts
//
// OPERAÇÃO PONTA A PONTA — o fluxo principal consegue rodar?
//
// Diagnóstico NÃO DESTRUTIVO: nada é criado em produção. A prova é feita sobre a
// configuração real — se cada elo da corrente existe e está ligado ao próximo,
// o fluxo é executável. Onde a simulação exigiria escrita, usamos transação com
// rollback explícito.

import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'

interface Elo {
  ordem: number; nome: string; ok: boolean; detalhe: string; rota?: string
  /**
   * O elo não pôde ser EXERCIDO porque não existe o insumo — não porque está
   * quebrado. Sistema recém-limpo não tem histórico, e histórico ausente não
   * prova defeito. Isso não vira crítico, mas também não vira verde: fica
   * declarado como não exercido, porque "não testado nunca é saudável".
   */
  naoExercido?: boolean
}

registrar({
  id: 'saude.pontaaponta.cadeia-operacional',
  codigo: 'E2E-001',
  nome: 'Fluxo principal é executável ponta a ponta',
  descricao: 'Percorre a corrente completa — tipo de processo → workflow → fase → serviço → configuração financeira → preço → eventos → timeline — e aponta o primeiro elo partido.',
  dominio: 'PONTA_A_PONTA',
  modulo: 'Operação',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 40_000,
  orientacao: 'Corrija o primeiro elo partido — os seguintes costumam ser consequência dele.',
  rotaCorrecao: '/administrator?screen=proctypes',
  responsavel: 'Operação',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const elos: Elo[] = []

    // 1) existe tipo de processo operável
    const tipo = await prisma.tipoProcessoNacionalidade.findFirst({
      where: { ativo: true, arquivado: false },
      select: { id: true, name: true, macroWorkflow: { select: { id: true, ativo: true, fases: { select: { phaseKey: true, ordem: true, required: true } } } } },
      orderBy: { id: 'asc' },
    })
    elos.push({
      ordem: 1, nome: 'Tipo de processo ativo',
      ok: !!tipo, detalhe: tipo ? `"${tipo.name}"` : 'nenhum tipo de processo ativo cadastrado',
      rota: '/administrator?screen=proctypes',
    })

    // 2) workflow com fases
    const fases = tipo?.macroWorkflow?.fases ?? []
    elos.push({
      ordem: 2, nome: 'Workflow macro com fases',
      ok: !!tipo?.macroWorkflow && fases.length > 0,
      detalhe: tipo?.macroWorkflow ? `${fases.length} fase(s)` : 'tipo sem workflow macro',
      rota: '/administrator?screen=macrokanban',
    })

    // 3) fase inicial e final identificáveis
    const ordenadas = [...fases].sort((a, b) => a.ordem - b.ordem)
    elos.push({
      ordem: 3, nome: 'Fase inicial e final definidas',
      ok: ordenadas.length >= 2 && ordenadas.some((f) => f.required),
      detalhe: ordenadas.length >= 2
        ? `entra em "${ordenadas[0].phaseKey}" e termina em "${ordenadas[ordenadas.length - 1].phaseKey}"`
        : 'workflow precisa de ao menos duas fases para ter início e fim',
      rota: '/administrator?screen=macrokanban',
    })

    // 4) fases existem no catálogo (senão a Central não sabe o que exibir)
    const chaves = ordenadas.map((f) => f.phaseKey)
    const noCatalogo = chaves.length
      ? await prisma.catalogoFase.count({ where: { phaseKey: { in: chaves }, ativo: true } })
      : 0
    elos.push({
      ordem: 4, nome: 'Fases registradas no catálogo',
      ok: chaves.length > 0 && noCatalogo === chaves.length,
      detalhe: `${noCatalogo}/${chaves.length} fase(s) no catálogo`,
      rota: '/administrator?screen=fases',
    })

    // 5) existe serviço/item comercializável elegível
    const item = await prisma.itemCatalogo.findFirst({
      where: { ativo: true, produtos: { some: { ativo: true } } },
      select: { id: true, name: true, produtos: { where: { ativo: true }, select: { id: true, naturezaFin: true, possuiReceita: true } } },
    })
    elos.push({
      ordem: 5, nome: 'Item comercializável com configuração financeira',
      ok: !!item, detalhe: item ? `"${item.name}"` : 'nenhum item ativo com configuração financeira',
      rota: '/administrator?screen=catalog',
    })

    // 6) o item tem preço vigente de venda
    const configId = item?.produtos?.[0]?.id
    const preco = configId
      ? await prisma.tabelaValor.findFirst({
          where: { configuracaoFinanceiraItemId: configId, arquivado: false, legadoPendente: false },
          select: { id: true, valor: true, moeda: true, natureza: true },
        })
      : null
    elos.push({
      ordem: 6, nome: 'Preço vigente na Tabela de Valores',
      ok: !!preco, detalhe: preco ? `${preco.moeda} ${Number(preco.valor).toFixed(2)} (${preco.natureza ?? 'sem natureza'})` : 'item sem preço vigente',
      rota: '/administrator?screen=pricingtable',
    })

    // 7) a criação de processo é transacionalmente possível (rollback garantido)
    let criacaoOk = false
    let detalheCriacao = 'não testada'
    if (tipo) {
      try {
        const paisDiagnostico = await prisma.catalogoPais.findFirst({
          where: { countryKey: 'italia' }, select: { id: true, countryKey: true },
        })
        await prisma.$transaction(async (tx) => {
          const p = await tx.processo.create({
            data: {
              nome: '[diagnóstico] simulação — rollback automático',
              // Identidade + espelho. O valor era 'ITALIA' em maiúsculas, que
              // não corresponde a nenhuma chave do cadastro — o diagnóstico
              // criava um processo de um país que não existe.
              paisId: paisDiagnostico?.id ?? null,
              tipoProcessoMotorId: tipo.id,
              faseAtualKey: ordenadas[0]?.phaseKey ?? null,
            },
            select: { id: true, codigo: true },
          })
          criacaoOk = !!p.id
          detalheCriacao = `criação simulada com sucesso (código ${p.codigo ?? '—'})`
          // ROLLBACK EXPLÍCITO: a simulação não deixa resíduo em produção.
          throw new Error('__rollback_diagnostico__')
        })
      } catch (e) {
        if (!/__rollback_diagnostico__/.test(String((e as Error)?.message))) {
          criacaoOk = false
          detalheCriacao = `criação falhou: ${String((e as Error)?.message ?? e).slice(0, 160)}`
        }
      }
    }
    elos.push({ ordem: 7, nome: 'Processo pode ser criado (simulado com rollback)', ok: criacaoOk, detalhe: detalheCriacao })

    // 8) o motor de efeitos está consumindo (senão nada acontece após criar)
    const pendentes = await prisma.domainOutbox.count({ where: { status: 'PENDENTE' } })
    const ultimoEnviado = await prisma.domainOutbox.findFirst({ where: { status: 'ENVIADO' }, orderBy: { processadoEm: 'desc' }, select: { processadoEm: true } })
    const dispatcherAtivo = !!ultimoEnviado?.processadoEm && (Date.now() - ultimoEnviado.processadoEm.getTime()) < 6 * 3_600_000
    elos.push({
      ordem: 8, nome: 'Eventos são despachados',
      ok: pendentes === 0 || dispatcherAtivo,
      detalhe: dispatcherAtivo ? 'dispatcher ativo nas últimas 6h' : `${pendentes} evento(s) pendente(s) e dispatcher sem atividade recente`,
      rota: '/administrator?screen=execmotor',
    })

    // 9) a timeline registra movimentação
    //
    // Este elo era o ÚNICO da corrente que media HISTÓRICO e não CAPACIDADE:
    // contava `WorkflowEvento` acumulado. Num sistema sem nenhum processo — o
    // estado legítimo de quem acabou de limpar a base — ele falhava sempre, e o
    // painel anunciava "o Discovery não consegue executar o fluxo principal",
    // o que era falso. A pergunta certa não é "já houve movimentação?", é
    // "quando houve movimentação, ela foi registrada?".
    const eventosTimeline = await prisma.workflowEvento.count()
    const processosComAvanco = await prisma.processo.count({ where: { faseAtualKey: { not: null } } })

    if (processosComAvanco === 0) {
      elos.push({
        ordem: 9, nome: 'Timeline registra movimentação',
        ok: false, naoExercido: true,
        detalhe: 'nenhum processo em fase — não houve movimentação para registrar',
      })
    } else {
      elos.push({
        ordem: 9, nome: 'Timeline registra movimentação',
        ok: eventosTimeline > 0,
        detalhe: eventosTimeline > 0
          ? `${eventosTimeline} evento(s) para ${processosComAvanco} processo(s) em fase`
          : `${processosComAvanco} processo(s) em fase e NENHUM evento registrado`,
      })
    }

    // 10) o financeiro consegue emitir cobrança (existe conta e condição)
    const contas = await prisma.contaBancaria.count({ where: { ativo: true } })
    elos.push({
      ordem: 10, nome: 'Financeiro pronto para receber',
      ok: contas > 0, detalhe: `${contas} conta(s) bancária(s) ativa(s)`,
      rota: '/administrator?screen=accounts',
    })

    // PARTIDO ≠ NÃO EXERCIDO. Um elo que não pôde ser exercido por falta de
    // insumo não interrompe corrente nenhuma, e chamá-lo de crítico faz o painel
    // mentir. Ele aparece — porque silenciar seria pior — mas como alerta.
    const partidos = elos.filter((e) => !e.ok && !e.naoExercido)
    const naoExercidos = elos.filter((e) => e.naoExercido)

    const cadeia = elos.map((x) => ({
      ordem: x.ordem, nome: x.nome,
      estado: x.naoExercido ? 'NAO_EXERCIDO' : x.ok ? 'OK' : 'PARTIDO',
    }))

    const achados: Achado[] = partidos.map((e): Achado => ({
      chave: `e2e-elo-${e.ordem}`,
      // O primeiro elo partido é o que trava o fluxo; os seguintes são consequência.
      severidade: e.ordem === partidos[0].ordem ? 'CRITICO' : 'ERRO',
      titulo: `Fluxo principal interrompido no elo ${e.ordem}: ${e.nome}`,
      descricao: `${e.nome} — ${e.detalhe}.`,
      explicacao: 'A operação ponta a ponta é uma corrente: criar processo, avançar fase, gerar efeito, cobrar e concluir. Um elo partido interrompe tudo que vem depois.',
      impacto: 'O Discovery não consegue executar o fluxo principal de um processo de cidadania.',
      entidade: 'Operação',
      quantidade: 1,
      link: e.rota ?? null,
      recomendacao: `Resolva "${e.nome}" antes dos demais — os elos seguintes costumam ser consequência.`,
      evidencia: { elo: e.ordem, nome: e.nome, detalhe: e.detalhe, cadeia },
    }))

    for (const e of naoExercidos) {
      achados.push({
        chave: `e2e-elo-${e.ordem}-nao-exercido`,
        severidade: 'ALERTA',
        titulo: `Elo ${e.ordem} não pôde ser exercido: ${e.nome}`,
        descricao: `${e.nome} — ${e.detalhe}.`,
        explicacao:
          'Este elo só se prova em movimento. Sem o insumo, ele não foi exercido — o que não é o mesmo ' +
          'que estar quebrado, e também não é o mesmo que estar provado.',
        impacto: 'A corrente não pode ser declarada íntegra até que este elo rode com dado real.',
        entidade: 'Operação',
        quantidade: 1,
        link: e.rota ?? null,
        recomendacao: 'Crie um processo e avance uma fase — o elo se prova sozinho no primeiro movimento real.',
        evidencia: { elo: e.ordem, nome: e.nome, detalhe: e.detalhe, cadeia },
      })
    }

    return {
      achados,
      metricas: {
        elos: elos.length,
        elosOk: elos.filter((e) => e.ok).length,
        elosPartidos: partidos.length,
        elosNaoExercidos: naoExercidos.length,
      },
      resumo: naoExercidos.length
        ? `${elos.length - naoExercidos.length} elo(s) íntegros; ${naoExercidos.length} não exercido(s) por falta de movimento real.`
        : `Corrente operacional íntegra nos ${elos.length} elos verificados.`,
    }
  },
})
