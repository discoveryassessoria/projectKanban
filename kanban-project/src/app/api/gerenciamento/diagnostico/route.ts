// src/app/api/gerenciamento/diagnostico/route.ts
//
// READ-MODEL de diagnóstico do Gerenciamento. SOMENTE LEITURA — conta e verifica
// o que já existe; não corrige, não escreve, não dispara nada.
//
// Alimenta quatro lentes distintas (nenhuma duplica a outra):
//   • Relatórios › Relatórios  › Diagnóstico do Sistema   → bloco `sistema`
//   • Relatórios › Indicadores › Diagnóstico Executivo    → bloco `executivo`
//   • Relatórios › Indicadores › Saúde do Sistema         → bloco `integridade`
//   • Automações › Configurações › Histórico de Execuções → bloco `execucoes`

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const [
      tiposProcesso, processos, usuarios, perfis, fasesCatalogo, macros, internos,
      automacoes, matriz, configsFin, precos, servicos, tiposDoc, orgaos, fornecedores,
      outboxPendente, outboxErro, instanciasAtivas, advanceLogs, artefatos,
      semTipoMotor, precosSemConfig, configsSemPreco,
    ] = await Promise.all([
      prisma.tipoProcessoNacionalidade.count({ where: { arquivado: false } }),
      prisma.processo.count(),
      prisma.usuario.count(),
      prisma.perfil.count(),
      prisma.catalogoFase.count({ where: { ativo: true } }),
      prisma.macroWorkflow.count(),
      prisma.phaseInternalWorkflow.count({ where: { arquivado: false } }),
      prisma.phaseAutomationRule.groupBy({ by: ['kind'], where: { arquivado: false, active: true }, _count: { _all: true } }),
      prisma.matrizDocumental.count(),
      prisma.produtoFinanceiro.count({ where: { ativo: true } }),
      prisma.tabelaValor.count(),
      prisma.servicoProduto.count({ where: { ativo: true } }),
      prisma.tipoDocumentoCadastro.count({ where: { ativo: true } }),
      prisma.orgaoProtocolo.count({ where: { ativo: true } }),
      prisma.fornecedor.count(),
      prisma.domainOutbox.count({ where: { status: 'PENDENTE' } }).catch(() => 0),
      prisma.domainOutbox.count({ where: { status: 'ERRO' } }).catch(() => 0),
      prisma.phaseWorkflowInstance.count({ where: { status: 'ATIVO' } }).catch(() => 0),
      prisma.phaseAdvanceLog.findMany({
        orderBy: { criadoEm: 'desc' }, take: 60,
        select: { id: true, processoId: true, faseAtual: true, fasePretendida: true, resultado: true, motivoCodigo: true, forcado: true, criadoEm: true },
      }).catch(() => []),
      prisma.motorArtefato.findMany({
        orderBy: { criadoEm: 'desc' }, take: 60,
        select: { id: true, processoId: true, phaseKey: true, event: true, ruleKind: true, targetTable: true, status: true, descricao: true, criadoEm: true },
      }).catch(() => []),
      prisma.processo.count({ where: { tipoProcessoMotorId: null } }),
      prisma.tabelaValor.count({ where: { configuracaoFinanceiraItemId: null } }).catch(() => 0),
      prisma.produtoFinanceiro.count({ where: { ativo: true, precosConfig: { none: {} } } }).catch(() => 0),
    ])

    // configuração por tipo (para o score executivo)
    const tipos = await prisma.tipoProcessoNacionalidade.findMany({
      where: { arquivado: false },
      select: {
        id: true, name: true, ativo: true,
        pais: { select: { countryLabel: true } },
        macroWorkflow: { select: { id: true, versao: true, fases: { select: { phaseKey: true, showInKanban: true } } } },
      },
      orderBy: [{ pais: { countryLabel: 'asc' } }, { name: 'asc' }],
    })
    const autoPorTipo = await prisma.phaseAutomationRule.groupBy({
      by: ['tipoProcessoId'], where: { arquivado: false, active: true }, _count: { _all: true },
    })
    const matrizPorTipo = await prisma.matrizDocumental.groupBy({ by: ['tipoProcessoId'], _count: { _all: true } })
    const internosPorFase = await prisma.phaseInternalWorkflow.findMany({
      where: { arquivado: false }, select: { tipoProcessoId: true, phaseKey: true },
    })
    const autoMap = new Map(autoPorTipo.map((a) => [a.tipoProcessoId, a._count._all]))
    const matrizMap = new Map(matrizPorTipo.map((m) => [m.tipoProcessoId, m._count._all]))

    const porTipo = tipos.map((t) => {
      const fases = t.macroWorkflow?.fases ?? []
      const chaves = new Set(
        internosPorFase.filter((w) => w.tipoProcessoId === t.id || w.tipoProcessoId == null).map((w) => w.phaseKey),
      )
      const comInterno = fases.filter((f) => chaves.has(f.phaseKey)).length
      const itens = [
        !!t.macroWorkflow,
        fases.length > 0,
        fases.some((f) => f.showInKanban),
        comInterno === fases.length && fases.length > 0,
        (matrizMap.get(t.id) ?? 0) > 0,
        (autoMap.get(t.id) ?? 0) > 0,
      ]
      const score = Math.round((itens.filter(Boolean).length / itens.length) * 100)
      return {
        id: t.id, nome: t.name, pais: t.pais.countryLabel, ativo: t.ativo,
        temWorkflow: !!t.macroWorkflow, fases: fases.length, fasesNoKanban: fases.filter((f) => f.showInKanban).length,
        fasesComInterno: comInterno, automacoes: autoMap.get(t.id) ?? 0, regrasDocumentais: matrizMap.get(t.id) ?? 0,
        score, bloqueante: !t.macroWorkflow || fases.length === 0,
      }
    })

    const auto = Object.fromEntries(automacoes.map((a) => [a.kind, a._count._all]))
    const scoreGeral = porTipo.length ? Math.round(porTipo.reduce((s, t) => s + t.score, 0) / porTipo.length) : 0

    return NextResponse.json({
      geradoEm: new Date().toISOString(),
      sistema: {
        contagens: {
          tiposProcesso, processos, usuarios, perfis, fasesCatalogo, macros, internos,
          matrizDocumental: matriz, configsFinanceiras: configsFin, precos, servicos,
          tiposDocumento: tiposDoc, orgaos, fornecedores,
          automacoesFinanceiras: auto.financial ?? 0, automacoesEvento: auto.event ?? 0, automacoesProtocolo: auto.protocol ?? 0,
        },
        runtime: { outboxPendente, outboxErro, instanciasAtivas },
      },
      integridade: {
        achados: [
          { chave: 'processos_sem_tipo', nome: 'Processos sem tipo do motor', valor: semTipoMotor, sev: semTipoMotor > 0 ? 'alerta' : 'ok', detalhe: 'Processos que não apontam para um Tipo de Processo — não têm fluxo próprio.' },
          { chave: 'outbox_erro', nome: 'Eventos de domínio com erro', valor: outboxErro, sev: outboxErro > 0 ? 'erro' : 'ok', detalhe: 'Efeitos que falharam ao ser despachados pelo motor.' },
          { chave: 'outbox_pendente', nome: 'Eventos aguardando despacho', valor: outboxPendente, sev: outboxPendente > 50 ? 'alerta' : 'ok', detalhe: 'Fila normal de trabalho; volume alto pode indicar dispatcher parado.' },
          { chave: 'precos_sem_config', nome: 'Preços sem configuração financeira', valor: precosSemConfig, sev: precosSemConfig > 0 ? 'alerta' : 'ok', detalhe: 'Linha de preço sem vínculo com a Configuração Financeira — não é resolvida pelo motor.' },
          { chave: 'config_sem_preco', nome: 'Configurações financeiras sem preço', valor: configsSemPreco, sev: configsSemPreco > 0 ? 'alerta' : 'ok', detalhe: 'Configuração ativa sem valor na Tabela de Valores — a automação não consegue lançar.' },
          { chave: 'tipos_sem_workflow', nome: 'Tipos de processo sem workflow', valor: porTipo.filter((t) => !t.temWorkflow).length, sev: porTipo.some((t) => !t.temWorkflow) ? 'erro' : 'ok', detalhe: 'Sem sequência de fases o processo não avança.' },
        ],
      },
      executivo: { scoreGeral, porTipo },
      execucoes: { advanceLogs, artefatos },
    })
  } catch (e) {
    console.error('GET diagnostico', e)
    return NextResponse.json({ error: 'Erro ao gerar o diagnóstico.' }, { status: 500 })
  }
}
