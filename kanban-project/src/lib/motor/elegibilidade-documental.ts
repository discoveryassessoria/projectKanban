// src/lib/motor/elegibilidade-documental.ts
// ============================================================================
// ELEGIBILIDADE DOCUMENTAL-ECONÔMICA — quem, qual documento, qual componente.
//
// POR QUE ESTE ARQUIVO EXISTE
// ---------------------------
// Duas coisas precisavam da MESMA resposta e a calculavam por caminhos
// diferentes: o motor, que cria os lançamentos, e a reconciliação, que relata o
// que falta. Enquanto o relatório tinha o próprio critério ("tem Matriz? tem
// componente? então é reparável"), ele conseguia prometer um reparo que o
// `--execute` não entregava — e um relatório que promete e não cumpre é pior
// que um relatório vazio.
//
// Agora existe UMA resolução, somente leitura, consumida pelos dois. "Reparável"
// passa a significar, por construção, "o motor criaria isto".
//
// IDENTIDADE ESTRUTURAL, NUNCA TEXTO
// ----------------------------------
// A versão anterior descobria de que registro se tratava lendo o CÓDIGO da regra
// com `includes('NAS')` / `includes('CAS')` / `includes('OB')`, e depois filtrava
// os documentos da pessoa pelo enum legado `Documento.tipo`. Duas fragilidades
// numa linha só: um código como `PROBATORIO` casava com `OB` por acidente, e
// documento criado a partir de um tipo mestre novo (com `documentTypeId` e
// `tipo = null`) simplesmente não gerava custo — sem erro, sem aviso, sem linha
// em `pulados`.
//
// A resolução agora é toda por VÍNCULO:
//   regra da Matriz → códigos aceitos → TipoDocumentoCadastro (por id)
//   → documentos da pessoa cujo `documentTypeId` é um deles
//   (o enum `tipo` só entra como PONTE, para o documento antigo que ainda não
//    tem o vínculo canônico preenchido)
//
// E "esta pessoa precisa deste documento?" deixou de ser um switch de palavra-
// chave: é o conjunto de CONDIÇÕES declarado na própria regra
// (`MatrizDocumental.condicoes`), avaliado pelo avaliador oficial das Regras
// Documentais. Regra sem condição aplica-se — e a existência do documento na
// pessoa é o que restringe.
// ============================================================================

import { prisma } from '@/lib/prisma'
import { avaliarConjunto } from '@/src/lib/documentos/regras-documentais/condicoes'
import type { ConjuntoCondicoes, SujeitoContexto } from '@/src/lib/documentos/regras-documentais/tipos'

/** Um lançamento que DEVE existir: pessoa × documento × componente econômico. */
export interface ItemElegivel {
  regraId: number
  criaTarefa: boolean
  criaCusto: boolean
  criaReceita: boolean
  pessoaId: number
  pessoaNome: string
  documentoId: number
  tipoDocumentoId: number | null
  componentKey: string
  componente: string
  custoConfigId: number | null
  receitaConfigId: number | null
  /** prefixo da chave idempotente; o sufixo (`::custo`/`::receita`/`::tarefa`) é de quem cria */
  chaveBase: string
}

export interface ResolucaoElegibilidade {
  itens: ItemElegivel[]
  /** por que algo NÃO entrou — sempre com motivo nomeado, nunca silêncio */
  pulados: { motivo: string; detalhe?: string }[]
}

type PessoaMin = {
  id: number; nome: string; sobrenome: string | null
  linhaReta: boolean; casado: boolean; vivo: boolean
  documentos: { id: number; tipo: string | null; documentTypeId: number | null }[]
}

/** Escopo opcional: restringe a resolução a UM documento (registro localizado). */
export interface EscopoElegibilidade {
  documentoId?: number | null
}

/** Sujeito da condição, montado a partir da pessoa da árvore. */
function sujeitoDaPessoa(p: PessoaMin): SujeitoContexto {
  return {
    id: p.id,
    nome: [p.nome, p.sobrenome].filter(Boolean).join(' ').trim(),
    ehPessoaArvore: true,
    linhaReta: p.linhaReta,
    casado: p.casado,
    vivo: p.vivo,
    falecido: !p.vivo,
  }
}

/**
 * PLANO DE TRATAMENTO DO DOCUMENTO — todos os componentes econômicos que aquele
 * tipo documental produz naquela fase.
 *
 * Precedência: vínculo canônico (`tipoDocumentoId`) vence código-texto, que vence
 * a regra "qualquer documento". Dentro da precedência vencedora, TODOS os
 * componentes valem — é o que torna possível "certidão → emissão + apostilamento
 * + tradução + apostilamento da tradução" sem tabela nova.
 */
function resolverPlanoEconomico<T extends { tipoDocumentoId?: number | null; documentTypeCode: string | null }>(
  rules: T[], tipoIds: Set<number>, codigos: Set<string>,
): T[] {
  const porVinculo = rules.filter((r) => r.tipoDocumentoId != null && tipoIds.has(r.tipoDocumentoId))
  if (porVinculo.length) return porVinculo
  const porCodigo = rules.filter((r) => r.documentTypeCode != null && codigos.has(r.documentTypeCode))
  if (porCodigo.length) return porCodigo
  return rules.filter((r) => r.tipoDocumentoId == null && r.documentTypeCode == null)
}

/** Quem a regra alcança. Vem do target/generationRule declarado — não de texto livre. */
function selecionarPessoas(regra: { target: string; generationRule: string }, pessoas: PessoaMin[]): PessoaMin[] {
  if (regra.generationRule === 'all_direct_line') return pessoas.filter((p) => p.linhaReta)
  if (regra.target === 'whole_process') return pessoas
  return pessoas.filter((p) => p.linhaReta) // default conservador
}

/**
 * Resolve TUDO o que deveria existir numa (processo, fase, ciclo). Somente
 * leitura: não cria TipoServico, não resolve preço, não escreve nada.
 */
export async function resolverElegibilidadeDocumental(
  processoId: number, tipoProcessoId: number, phaseKey: string, phaseCycle: number,
  escopo: EscopoElegibilidade = {},
): Promise<ResolucaoElegibilidade> {
  const itens: ItemElegivel[] = []
  const pulados: { motivo: string; detalhe?: string }[] = []

  // SÓ REGRA PUBLICADA EXECUTA. Uma regra em RASCUNHO existe para ser trabalhada,
  // não para gerar dinheiro: sem esta trava, cadastrar a estrutura antes de ter
  // preço faria o motor tentar lançar na hora em que a regra fosse salva. A
  // diferença entre "não existe regra" e "existe, mas não publicada" é dita em
  // voz alta — é a pendência que o operador precisa ver.
  const todas = await prisma.matrizDocumental.findMany({ where: { tipoProcessoId, phaseKey, arquivado: false } })
  const regras = todas.filter((r) => r.status === 'PUBLICADA')
  if (regras.length === 0) {
    const naoPublicadas = todas.length
    pulados.push({
      motivo: naoPublicadas > 0
        ? `regra documental ainda não publicada`
        : `sem regra na Matriz para tipoProcesso ${tipoProcessoId} + fase "${phaseKey}"`,
      detalhe: naoPublicadas > 0
        ? `${naoPublicadas} regra(s) em rascunho/inativa para a fase "${phaseKey}" — publique em Gerenciamento › Regras Documentais`
        : undefined,
    })
    return { itens, pulados }
  }

  const economicRules = await prisma.phaseEconomicRule.findMany({
    where: { phaseKey, ativo: true, OR: [{ tipoProcessoId }, { tipoProcessoId: null }] },
    orderBy: { ordem: 'asc' },
  })

  const proc = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { arvore: { select: { pessoas: { select: {
      id: true, nome: true, sobrenome: true, linhaReta: true, casado: true, vivo: true,
      documentos: {
        where: { status: { notIn: ['CANCELADO', 'INVALIDO'] } },
        select: { id: true, tipo: true, documentTypeId: true },
      },
    } } } } },
  })
  const pessoas = (proc?.arvore?.pessoas ?? []) as PessoaMin[]
  if (pessoas.length === 0) { pulados.push({ motivo: 'processo sem pessoas na árvore' }); return { itens, pulados } }

  for (const regra of regras) {
    // ── 1. QUAIS tipos documentais a regra aceita (por cadastro, por ID) ─────
    // `documentosAceitos` é a coleção canônica; `documentTypeCode` é o legado de
    // um código só. Os dois são CÓDIGOS do Cadastro Mestre — resolvidos a ID aqui.
    const codigosAceitos = Array.isArray(regra.documentosAceitos) && regra.documentosAceitos.length > 0
      ? (regra.documentosAceitos as unknown[]).map(String)
      : [regra.documentTypeCode]
    const tipos = await prisma.tipoDocumentoCadastro.findMany({
      where: { code: { in: codigosAceitos } },
      select: { id: true, code: true, name: true, legacyEnumKey: true },
    })
    if (tipos.length === 0) {
      pulados.push({
        motivo: 'regra aponta para tipo documental inexistente no Cadastro Mestre',
        detalhe: `código(s) "${codigosAceitos.join(', ')}" — cadastre o Tipo de Documento ou corrija a regra`,
      })
      continue
    }
    const idsTipo = new Set(tipos.map((t) => t.id))
    const codigos = new Set(tipos.map((t) => t.code).filter((c): c is string => !!c))
    const enumsPonte = new Set(tipos.map((t) => t.legacyEnumKey).filter((k): k is string => !!k))

    // ── 2. QUAIS componentes econômicos aquele tipo produz ──────────────────
    const plano = resolverPlanoEconomico(economicRules, idsTipo, codigos)
    if (plano.length === 0) {
      pulados.push({
        motivo: `fase "${phaseKey}" sem regra econômica configurada`,
        detalhe: `cadastre em PhaseEconomicRule para "${tipos.map((t) => t.name).join(', ')}"`,
      })
      continue
    }

    // ── 3. QUEM a regra alcança, com QUAIS documentos, sob QUAIS condições ──
    for (const pessoa of selecionarPessoas(regra, pessoas)) {
      // Os DOCUMENTOS primeiro: vínculo canônico, com o enum só como ponte para
      // o documento antigo que ainda não tem `documentTypeId` preenchido.
      // Filtrar antes da condição não é otimização — é o que impede o relatório
      // de listar "condição não satisfeita" para gente que nem documento tem no
      // escopo consultado.
      const documentos = pessoa.documentos.filter((d) => {
        const casa = d.documentTypeId != null
          ? idsTipo.has(d.documentTypeId)
          : (d.tipo != null && enumsPonte.has(String(d.tipo)))
        if (!casa) return false
        return escopo.documentoId == null ? true : d.id === escopo.documentoId
      })
      if (documentos.length === 0) continue

      // A condição é declarada na regra e avaliada pelo avaliador OFICIAL das
      // Regras Documentais — a mesma engine do simulador administrativo.
      const cond = avaliarConjunto((regra.condicoes as ConjuntoCondicoes | null) ?? null, sujeitoDaPessoa(pessoa))
      if (!cond.satisfeito) {
        pulados.push({
          motivo: 'condição da regra não satisfeita',
          detalhe: `${[pessoa.nome, pessoa.sobrenome].filter(Boolean).join(' ')} — ${cond.naoSatisfeitas.join('; ')}`,
        })
        continue
      }

      for (const doc of documentos) {
        for (const econ of plano) {
          itens.push({
            regraId: regra.id,
            criaTarefa: regra.createsTask, criaCusto: regra.createsCost, criaReceita: regra.createsRevenue,
            pessoaId: pessoa.id,
            pessoaNome: [pessoa.nome, pessoa.sobrenome].filter(Boolean).join(' ').trim(),
            documentoId: doc.id,
            tipoDocumentoId: doc.documentTypeId,
            componentKey: econ.componentKey,
            componente: econ.componentName,
            custoConfigId: econ.custoConfigId ?? null,
            receitaConfigId: econ.receitaConfigId ?? null,
            // Chave idempotente: processo + fase + CICLO + regra + documento + COMPONENTE.
            chaveBase: `${processoId}::${phaseKey}::c${phaseCycle}::matriz:${regra.id}::doc:${doc.id}::comp:${econ.componentKey}`,
          })
        }
      }
    }
  }

  return { itens, pulados }
}
