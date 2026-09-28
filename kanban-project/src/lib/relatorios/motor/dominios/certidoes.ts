// DOMÍNIO CERTIDÕES — 1 linha = 1 necessidade documental de registro civil.
//
// ─── O QUE SEPARA CERTIDÃO DE DOCUMENTO ─────────────────────────────────────
// A separação NÃO é pelo nome do documento. Ela vem da CATEGORIA DOCUMENTAL do
// Cadastro Mestre: o tipo documental pertence a uma categoria, e "Registro
// Civil" é a das certidões. Se amanhã o cadastro mudar a categoria de um tipo,
// ele muda de domínio sozinho — nenhuma linha aqui precisa ser tocada.
//
// Nascimento, casamento e óbito são TIPOS dentro deste domínio, não relatórios
// diferentes. "Certidões faltantes" é este domínio filtrado pela SITUAÇÃO DA
// SOLICITAÇÃO (não solicitada/pendente/solicitado) — ver
// situacao-solicitacao-certidao.ts; nunca o status bruto de
// NecessidadeDocumental (achado real: ATENDIDA não significa "recebida").
//
// A unidade é a NECESSIDADE — o que a regra documental disse que precisa
// existir. É ela que permite responder "o que falta", que é a pergunta real; o
// documento entregue é uma das colunas.

import { prisma } from "@/lib/prisma"
import { estadoTemporal, estadoTemporalSolicitacao, type EstadoTemporal } from "@/lib/operacional/tempo-operacional"
import { CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO } from "@/src/lib/process-stage/subtarefa-confirmacao-pedido"
import {
  CHAVES_SUBTAREFA_ENVIO_REQUERIMENTO, CHAVES_SUBTAREFA_RECEBIMENTO_CERTIDAO,
  ROTULO_SITUACAO_SOLICITACAO, situacaoDaSolicitacaoCertidao,
  STEP_KEY_LOCALIZAR_REGISTRO, STATUS_STEP_LOCALIZADO,
  type SituacaoSolicitacaoCertidao,
} from "@/src/lib/process-stage/situacao-solicitacao-certidao"
import { documentoTemDadosPreenchidos } from "@/src/lib/documentos/dados-preenchidos"
import { titularDaUniao } from "@/src/services/genealogia/titular-uniao"
import type { CorDeCelula, DominioDef } from "../tipos"
import { cadastro, contem, dataBR, diasEntre, emLista, emListaId, igualId, periodo, porCampo } from "./_comuns"

/** A categoria que define "certidão" — do Cadastro Mestre, não do nome. */
export const CATEGORIA_CERTIDAO = "REGISTRO_CIVIL"

const STEP_KEY_SOLICITAR_CERTIDAO = "solicitar_certidao"
const CHAVES_SITUACAO_SOLICITACAO = [
  ...CHAVES_SUBTAREFA_ENVIO_REQUERIMENTO,
  ...CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO,
  ...CHAVES_SUBTAREFA_RECEBIMENTO_CERTIDAO,
] as const

/** A BUCKETIZAÇÃO em 4 rótulos fixos, comum às duas fontes abaixo — nunca duplicada. */
function bucketizarPrazo(et: EstadoTemporal): { rotulo: string; cor: CorDeCelula } {
  if (et.semPrazo) return { rotulo: "Sem prazo", cor: "cinza" }
  if (et.atrasado) return { rotulo: "Vencido", cor: "vermelho" }
  if (et.diasParaPrazo != null && et.diasParaPrazo <= 7) return { rotulo: "Vence em até 7 dias", cor: "amarelo" }
  return { rotulo: "No prazo", cor: "verde" }
}

/**
 * A SITUAÇÃO DO PRAZO, em 4 estados (achado real, rodada "Relatório de
 * Certidões" 27/09/2026). Reaproveita `estadoTemporal` — o núcleo canônico
 * de `Tarefa.dataPrazo` ("uma régua, uma frase" — a mesma que Central
 * Operacional e Minha Fila usam — nunca uma segunda conta de dias aqui.
 *
 * MANTIDA por compatibilidade de assinatura (testada isoladamente), mas as
 * colunas "Prazo"/"Situação do prazo" deste domínio NÃO usam mais esta
 * função — ver `situacaoDoPrazoSolicitacao` abaixo (achado real, "regime de
 * prazo das certidões", 28/09/2026: `Tarefa.dataPrazo` está sempre vazio em
 * produção para o fluxo de Solicitar certidão).
 */
export function situacaoDoPrazo(t: { dataPrazo: Date | null; dataConclusao: Date | null; statusTarefa: string | null } | null):
  { rotulo: string; cor: CorDeCelula } {
  if (!t) return { rotulo: "Sem prazo", cor: "cinza" }
  return bucketizarPrazo(estadoTemporal({ dataPrazo: t.dataPrazo, dataConclusao: t.dataConclusao, statusTarefa: t.statusTarefa }))
}

/**
 * A SITUAÇÃO DO PRAZO a partir de `SolicitacaoDocumento` — a fonte que
 * realmente nasce preenchida hoje (`previsaoRetorno = dataEnvio +
 * prazoEsperadoDias`, ancorada no ENVIO do requerimento ao cartório, não na
 * confirmação). `Tarefa.dataPrazo`/`Documento.dataPrazoOperacao` continuam
 * existindo no schema mas estão vazios em produção para este fluxo — usar
 * qualquer um dos dois aqui mostraria "Sem prazo" para tudo.
 */
export function situacaoDoPrazoSolicitacao(s: { previsaoRetorno: Date | null; status: string | null } | null):
  { rotulo: string; cor: CorDeCelula } {
  if (!s) return { rotulo: "Sem prazo", cor: "cinza" }
  return bucketizarPrazo(estadoTemporalSolicitacao({ dataPrazo: s.previsaoRetorno, status: s.status }))
}

const SITUACOES_SOLICITACAO: readonly SituacaoSolicitacaoCertidao[] =
  ["NAO_LOCALIZADA", "NAO_SOLICITADA", "PENDENTE", "SOLICITADO", "RECEBIDA", "DISPENSADA"]

/**
 * O WHERE Prisma de cada bucket de `situacaoDaSolicitacaoCertidao` — espelha
 * EXATAMENTE a mesma precedência da função pura (DISPENSADA/NAO_LOCALIZADA
 * primeiro, depois recebimento → confirmação → envio), pra filtro e coluna
 * nunca divergirem. `concluiu`/`naoConcluiu` casam pelo PAPEL semântico da
 * subtarefa dentro do Step "Solicitar certidão" — nunca string solta.
 */
function whereSituacaoSolicitacao(bucket: SituacaoSolicitacaoCertidao): Record<string, unknown> {
  // MESMA exclusão de ciclo SUPERSEDIDO/CANCELADO do INCLUDE (abaixo) — sem
  // isso, um envio concluído num ciclo antigo já reaberto faria o filtro
  // divergir da coluna, que só olha o ciclo vigente.
  const concluiu = (chaves: readonly string[]) => ({
    documentos: { some: { stepInstances: { some: {
      stepKey: STEP_KEY_SOLICITAR_CERTIDAO,
      status: { notIn: ["SUPERSEDIDO", "CANCELADO"] },
      execucoesDeSubtarefa: { some: { subtaskKey: { in: [...chaves] }, status: "CONCLUIDO" } },
    } } } },
  })
  const naoConcluiu = (chaves: readonly string[]) => ({ NOT: concluiu(chaves) })
  const naoDispensada = { status: { not: "DISPENSADA" } }
  // Registro já localizado na Genealogia — decisão do usuário (28/09/2026):
  // "essas tarefas ainda não foram fechadas na fase de Genealogia, então como
  // que elas seriam solicitadas?" — NAO_LOCALIZADA vira o estado padrão até a
  // Genealogia concluir "Localizar registro", não um status manual à parte.
  const registroLocalizado = {
    stepInstances: { some: { stepKey: STEP_KEY_LOCALIZAR_REGISTRO, status: { in: [...STATUS_STEP_LOCALIZADO] } } },
  }
  const registroNaoLocalizado = { NOT: registroLocalizado }

  switch (bucket) {
    case "DISPENSADA": return { status: "DISPENSADA" }
    case "NAO_LOCALIZADA": return { AND: [naoDispensada, registroNaoLocalizado] }
    case "RECEBIDA":
      return { AND: [naoDispensada, registroLocalizado, concluiu(CHAVES_SUBTAREFA_RECEBIMENTO_CERTIDAO)] }
    case "SOLICITADO":
      return { AND: [naoDispensada, registroLocalizado, concluiu(CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO), naoConcluiu(CHAVES_SUBTAREFA_RECEBIMENTO_CERTIDAO)] }
    case "PENDENTE":
      return { AND: [naoDispensada, registroLocalizado, concluiu(CHAVES_SUBTAREFA_ENVIO_REQUERIMENTO), naoConcluiu(CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO), naoConcluiu(CHAVES_SUBTAREFA_RECEBIMENTO_CERTIDAO)] }
    case "NAO_SOLICITADA":
      return { AND: [naoDispensada, registroLocalizado, naoConcluiu(CHAVES_SUBTAREFA_ENVIO_REQUERIMENTO)] }
  }
}

const INCLUDE = {
  // REGISTRO LOCALIZADO NA GENEALOGIA — direto na NecessidadeDocumental (não
  // no Documento): é o passo "Localizar registro" que decide se dá pra
  // perguntar "já solicitei a certidão?" — ver situacao-solicitacao-certidao.ts.
  // Só o vigente: SUPERSEDIDO/CANCELADO nunca entram em CONCLUIDO/DISPENSADO,
  // então nem precisa de where.status extra pra excluir ciclo antigo.
  stepInstances: {
    where: { stepKey: STEP_KEY_LOCALIZAR_REGISTRO, status: { in: [...STATUS_STEP_LOCALIZADO] as ("CONCLUIDO" | "DISPENSADO")[] } },
    select: { id: true },
    take: 1,
  },
  itemCatalogo: {
    select: {
      id: true, code: true, name: true,
      tiposDocumento: { select: { name: true, categoriaDocumental: { select: { code: true, name: true } } } },
    },
  },
  pessoa: { select: { id: true, nome: true, sobrenome: true, arvoreId: true, numeroLinhagem: true } },
  // TITULAR DA UNIÃO — necessidade de casamento tem UNIÃO como sujeito
  // (pessoaId sempre null por desenho), mas a coluna "Pessoa" nunca pode
  // ficar vazia: regra do usuário (28/09/2026, mesma régua de
  // titular-uniao.ts): sempre mostra o cônjuge da LINHA DE TRANSMISSÃO,
  // nunca pessoa1/pessoa2 cru (que não tem significado de negócio).
  uniao: {
    select: {
      pessoa1Id: true, pessoa2Id: true,
      pessoa1: { select: { id: true, nome: true, sobrenome: true, arvoreId: true, numeroLinhagem: true, linhaReta: true } },
      pessoa2: { select: { id: true, nome: true, sobrenome: true, arvoreId: true, numeroLinhagem: true, linhaReta: true } },
    },
  },
  processo: {
    select: {
      id: true, codigo: true, nome: true, faseAtualKey: true,
      paisCanonico: { select: { countryKey: true, countryLabel: true } },
      familia: { select: { id: true, nome: true } },
    },
  },
  documentos: {
    select: {
      id: true, status: true, cartorio: true, livro: true, folha: true, data_emissao: true, traduzido: true, apostilado: true,
      orgao: { select: { id: true, name: true, city: true, state: true, pais: { select: { countryLabel: true } } } },
      solicitacoes: {
        select: {
          id: true, status: true, dataEnvio: true, previsaoRetorno: true, custoPago: true,
          canal: true, orgao: { select: { name: true } }, criadoPor: { select: { nome: true } },
        },
        orderBy: { id: "desc" as const }, take: 1,
      },
      // RESPONSÁVEL E PRAZO — da TAREFA vinculada (fonte única de
      // responsável/prazo, ver ownership-canonico-tarefa), não do Documento.
      tarefasVinculadas: {
        select: { id: true, dataPrazo: true, dataConclusao: true, statusTarefa: true, responsavel: { select: { nome: true } } },
        take: 1,
      },
      // SITUAÇÃO DA SOLICITAÇÃO — as 3 subtarefas do Step único "Solicitar
      // certidão" (4 subtarefas, 1 Step desde a consolidação de 15/09/2026)
      // que marcam o fluxo real do pedido ao cartório: enviar_requerimento_
      // cartorio / receber_confirmacao_pedido / receber_certidao. Casa pelo
      // PAPEL SEMÂNTICO de cada uma (CHAVES_SUBTAREFA_*), nunca string solta —
      // ver src/lib/process-stage/situacao-solicitacao-certidao.ts. Sem
      // `take` no array: precisa da mais recente de CADA uma das 3 chaves,
      // não só da última execução do passo inteiro.
      // SEM `where.status`/`orderBy` aqui, `take: 1` podia pegar um CICLO
      // SUPERSEDIDO (reabertura/reconciliação) em vez do vigente — achado real
      // (28/09/2026): a coluna "Situação" mostrava "Não solicitada" pra
      // Documentos que JÁ tinham envio concluído no ciclo VIVO, porque o
      // `take:1` sem ordem trazia a instância antiga (sem execução nenhuma).
      stepInstances: {
        where: { stepKey: STEP_KEY_SOLICITAR_CERTIDAO, status: { notIn: [...["SUPERSEDIDO", "CANCELADO"]] as ("SUPERSEDIDO" | "CANCELADO")[] } },
        // `id desc` basta: ciclo novo sempre cria PhaseWorkflowStepInstance com
        // id maior que o antigo (autoincrement) — não precisa de 2 critérios.
        orderBy: { id: "desc" as const },
        select: {
          execucoesDeSubtarefa: {
            where: {
              subtaskKey: { in: [...CHAVES_SITUACAO_SOLICITACAO] as string[] },
              status: "CONCLUIDO",
            },
            orderBy: { sequencia: "desc" as const },
            select: { subtaskKey: true, completedAt: true, protocolo: true, protocoloRef: { select: { numeroProtocolo: true } } },
          },
        },
        take: 1,
      },
    },
    take: 1,
  },
} as const

const doc = (l: any) => l.documentos?.[0] ?? null
const sol = (l: any) => doc(l)?.solicitacoes?.[0] ?? null
// PESSOA DA LINHA — sempre resolve pra uma Pessoa, mesmo quando o sujeito da
// necessidade é uma União (casamento): a própria pessoa quando a necessidade
// já é grão-pessoa, senão o titular da união (cônjuge da linha de
// transmissão, nunca pessoa1/pessoa2 cru — regra permanente do usuário,
// 28/09/2026, mesma régua de titular-uniao.ts). Nunca fica vazia por
// desenho — casamento SEMPRE tem uma pessoa da linha reta por trás.
const pessoaDaLinha = (l: any): { id: number; nome: string; sobrenome: string | null; arvoreId: number | null; numeroLinhagem: number | null } | null => {
  if (l.pessoa) return l.pessoa
  if (!l.uniao) return null
  const titularId = titularDaUniao(l.uniao)
  if (titularId === l.uniao.pessoa1Id) return l.uniao.pessoa1 ?? null
  if (titularId === l.uniao.pessoa2Id) return l.uniao.pessoa2 ?? null
  return null
}
const tarefaDoDoc = (l: any) => doc(l)?.tarefasVinculadas?.[0] ?? null
// As execuções concluídas das 3 subtarefas de "Solicitar certidão" (envio,
// confirmação, recebimento) que o INCLUDE busca juntas — nunca mais de uma
// por chave (é a mais recente de cada, orderBy sequencia desc já garante).
const execucoesSituacao = (l: any): Array<{ subtaskKey: string; completedAt: Date | null; protocolo: string | null; protocoloRef: { numeroProtocolo: string | null } | null }> =>
  doc(l)?.stepInstances?.[0]?.execucoesDeSubtarefa ?? []
const execucaoDoPapel = (l: any, chaves: readonly string[]) =>
  execucoesSituacao(l).find((e) => (chaves as readonly string[]).includes(e.subtaskKey)) ?? null
const confirmacao = (l: any) => execucaoDoPapel(l, CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO)
const situacaoSolicitacao = (l: any): SituacaoSolicitacaoCertidao =>
  situacaoDaSolicitacaoCertidao({
    necessidadeStatus: l.status,
    registroLocalizado: (l.stepInstances?.length ?? 0) > 0,
    chavesConcluidas: execucoesSituacao(l).map((e) => e.subtaskKey),
  })

/** Só necessidades cujo item pertence à categoria de registro civil. */
const SO_CERTIDAO = {
  itemCatalogo: { tiposDocumento: { some: { categoriaDocumental: { code: CATEGORIA_CERTIDAO } } } },
}

export const DOMINIO_CERTIDOES: DominioDef = {
  key: "certidoes",
  rotulo: "Certidões",
  descricao: "Nascimento, casamento e óbito: o que precisa existir, o que foi solicitado e o que chegou.",
  grain: "1 linha = 1 certidão necessária (a necessidade, não o pedido)",
  permissao: "processos.ver",
  ordem: 5,
  grupo: "Documentação",
  aceitaNacionalidade: true,
  ondeNacionalidade: (countryKey) => ({ processo: { paisCanonico: { countryKey } } }),

  filtros: [
    { key: "tipo", rotulo: "Tipo de certidão",
      descricao: "Só registro civil — a mesma categoria do Cadastro Mestre que define este domínio.",
      tipo: "multi_selecao", opcoes: cadastro("itens_certidao"), paraWhere: emListaId("itemCatalogoId") },
    // Achado real (processo 651, 28/09/2026): o status BRUTO da Necessidade
    // (ATENDIDA) confundia "localizei o registro" com "recebi a certidão" —
    // ver situacao-solicitacao-certidao.ts. Filtro e coluna usam a MESMA
    // fonte derivada, nunca o enum cru de NecessidadeDocumental.
    { key: "status", rotulo: "Situação", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: SITUACOES_SOLICITACAO.map((s) => ({ valor: s, rotulo: ROTULO_SITUACAO_SOLICITACAO[s] })) },
      paraWhere: (v) => {
        if (v.tipo !== "multi_selecao" || !v.valores.length) return null
        const ou = v.valores
          .filter((s): s is SituacaoSolicitacaoCertidao => (SITUACOES_SOLICITACAO as readonly string[]).includes(s))
          .map(whereSituacaoSolicitacao)
        return ou.length ? { OR: ou } : null
      } },
    { key: "obrigatoriedade", rotulo: "Obrigatoriedade", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: [
        { valor: "OBRIGATORIA", rotulo: "Obrigatória" }, { valor: "OPCIONAL", rotulo: "Opcional" } ] },
      paraWhere: emLista("obrigatoriedade") },
    { key: "processo", rotulo: "Processo", tipo: "entidade", opcoes: cadastro("processos"), paraWhere: igualId("processoId") },
    { key: "familia", rotulo: "Família", tipo: "entidade", opcoes: cadastro("familias"),
      paraWhere: (v) => (v.tipo === "entidade" ? { processo: { familiaId: v.id } } : null) },
    { key: "orgao_emissor", rotulo: "Órgão emissor (cartório/comune)", tipo: "entidade", opcoes: cadastro("orgaos"),
      paraWhere: (v) => (v.tipo === "entidade" ? { documentos: { some: { orgaoId: v.id } } } : null) },
    { key: "orgao_pais", rotulo: "País do emissor", tipo: "multi_selecao", opcoes: cadastro("paises_geograficos"),
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length
        ? { documentos: { some: { orgao: { paisId: { in: v.valores.map(Number).filter(Number.isInteger) } } } } } : null) },
    { key: "solicitada", rotulo: "Já solicitada", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { documentos: { some: { solicitacoes: { some: {} } } } }
        : { documentos: { none: { solicitacoes: { some: {} } } } }) },
    { key: "periodo_solicitacao", rotulo: "Período da solicitação", tipo: "intervalo_data",
      paraWhere: (v) => {
        const p = periodo("dataEnvio", v)
        return p ? { documentos: { some: { solicitacoes: { some: p } } } } : null
      } },
    { key: "atrasada", rotulo: "Solicitação com retorno vencido", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" || !v.valor ? null
        : { documentos: { some: { solicitacoes: { some: { previsaoRetorno: { lt: new Date() }, status: { not: "RESPONDIDA" } } } } } }) },
    { key: "canal", rotulo: "Canal da solicitação", tipo: "multi_selecao", opcoes: cadastro("canais"),
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length
        ? { documentos: { some: { solicitacoes: { some: { canal: { in: v.valores as never } } } } } } : null) },
    { key: "pessoa", rotulo: "Pessoa (nome contém)", tipo: "texto",
      paraWhere: (v) => (v.tipo === "texto" && v.texto.trim() ? { pessoa: { nome: { contains: v.texto.trim(), mode: "insensitive" } } } : null) },
    { key: "confirmado_em", rotulo: "Confirmado em", tipo: "intervalo_data",
      descricao: "Quando a subtarefa \"Receber confirmação do pedido\" concluiu — não a data do envio.",
      paraWhere: (v) => {
        const p = periodo("completedAt", v)
        if (!p) return null
        return {
          documentos: { some: { stepInstances: { some: {
            stepKey: STEP_KEY_SOLICITAR_CERTIDAO,
            execucoesDeSubtarefa: { some: { subtaskKey: { in: [...CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO] as string[] }, status: "CONCLUIDO", ...p } },
          } } } },
        }
      } },
    { key: "responsavel", rotulo: "Responsável", tipo: "entidade", opcoes: cadastro("usuarios"),
      paraWhere: (v) => (v.tipo === "entidade"
        ? { documentos: { some: { tarefasVinculadas: { some: { responsavelId: v.id } } } } } : null) },
    { key: "situacao_prazo", rotulo: "Situação do prazo", tipo: "multi_selecao",
      descricao: "Calendário simples (hoje ± N dias) — não os dias úteis da régua operacional completa.",
      opcoes: { tipo: "catalogo", valores: [
        { valor: "VENCIDO", rotulo: "Vencido" },
        { valor: "VENCE_7", rotulo: "Vence em até 7 dias" },
        { valor: "NO_PRAZO", rotulo: "No prazo" },
        { valor: "SEM_PRAZO", rotulo: "Sem prazo" },
      ] },
      paraWhere: (v) => {
        if (v.tipo !== "multi_selecao" || !v.valores.length) return null
        const hoje = new Date()
        const em7 = new Date(); em7.setDate(em7.getDate() + 7)
        const clausulaPorBucket: Record<string, Record<string, unknown>> = {
          VENCIDO: { dataPrazo: { lt: hoje }, dataConclusao: null },
          VENCE_7: { dataPrazo: { gte: hoje, lte: em7 }, dataConclusao: null },
          NO_PRAZO: { dataPrazo: { gt: em7 }, dataConclusao: null },
          SEM_PRAZO: { dataPrazo: null },
        }
        const ou = v.valores.map((b) => clausulaPorBucket[b]).filter(Boolean)
        return ou.length ? { documentos: { some: { tarefasVinculadas: { some: { OR: ou } } } } } : null
      } },
  ],

  agrupamentos: [
    porCampo("tipo", "Tipo de certidão", (l) => l.itemCatalogo?.name),
    porCampo("status", "Situação", (l) => ROTULO_SITUACAO_SOLICITACAO[situacaoSolicitacao(l)]),
    porCampo("familia", "Família", (l) => l.processo?.familia?.nome),
    porCampo("nacionalidade", "Nacionalidade", (l) => l.processo?.paisCanonico?.countryLabel),
    porCampo("orgao", "Órgão emissor", (l) => doc(l)?.orgao?.name),
    porCampo("orgao_pais", "País do emissor", (l) => doc(l)?.orgao?.pais?.countryLabel),
    porCampo("pessoa", "Pessoa", (l) => { const p = pessoaDaLinha(l); return p ? `${p.nome} ${p.sobrenome ?? ""}`.trim() : null }),
  ],

  colunas: [
    { key: "tipo", rotulo: "Certidão", valor: (l) => l.itemCatalogo?.name ?? null },
    { key: "status", rotulo: "Situação", valor: (l) => ROTULO_SITUACAO_SOLICITACAO[situacaoSolicitacao(l)] },
    // Documento nasce automaticamente junto com a necessidade (unificação
    // 28/09/2026) — vazio, sem cartório/livro/folha. "Tem Documento" não é mais
    // sinal de "tem dado real"; esta coluna é quem responde isso. Achado real que
    // motivou: a Tarefa #3827 (necessidade 607) aparecia "em andamento" sem
    // nenhum dado real por trás do Documento.
    { key: "dados_preenchidos", rotulo: "Dados preenchidos",
      valor: (l) => (doc(l) ? (documentoTemDadosPreenchidos(doc(l)) ? "Sim" : "Não") : null),
      corDoValor: (l) => (!doc(l) ? null : documentoTemDadosPreenchidos(doc(l)) ? "verde" : "cinza") },
    { key: "obrigatoriedade", rotulo: "Obrigatoriedade", valor: (l) => l.obrigatoriedade },
    { key: "pessoa", rotulo: "Pessoa", valor: (l) => { const p = pessoaDaLinha(l); return p ? `${p.nome} ${p.sobrenome ?? ""}`.trim() : null },
      link: (l) => { const p = pessoaDaLinha(l); return p?.arvoreId ? `/genealogy?arvoreId=${p.arvoreId}&pessoaId=${p.id}` : null } },
    { key: "familia", rotulo: "Família", valor: (l) => l.processo?.familia?.nome ?? null },
    { key: "processo", rotulo: "Processo",
      valor: (l) => (l.processo ? `${l.processo.codigo ?? l.processo.id} — ${l.processo.nome}` : null),
      link: (l) => (l.processo ? `/processos/${l.processo.id}` : null) },
    { key: "nacionalidade", rotulo: "Nacionalidade", valor: (l) => l.processo?.paisCanonico?.countryLabel ?? null },
    { key: "orgao", rotulo: "Órgão emissor", valor: (l) => doc(l)?.orgao?.name ?? doc(l)?.cartorio ?? null },
    { key: "orgao_pais", rotulo: "País do emissor", valor: (l) => doc(l)?.orgao?.pais?.countryLabel ?? null },
    { key: "canal", rotulo: "Canal", valor: (l) => sol(l)?.canal ?? null },
    { key: "solicitada_em", rotulo: "Solicitada em", valor: (l) => dataBR(sol(l)?.dataEnvio) },
    { key: "previsao", rotulo: "Previsão de retorno", valor: (l) => dataBR(sol(l)?.previsaoRetorno) },
    { key: "atraso_dias", rotulo: "Atraso (dias)",
      valor: (l) => { const s = sol(l); if (!s?.previsaoRetorno || s.status === "RESPONDIDA") return null
        const d = diasEntre(s.previsaoRetorno); return d != null && d > 0 ? d : null }, alinhamento: "direita" },
    { key: "situacao_solicitacao", rotulo: "Situação da solicitação", valor: (l) => sol(l)?.status ?? null },
    // Dinheiro é assunto do Financeiro, mesmo aparecendo num relatório de
    // certidões: este domínio abre com `processos.ver`, e sem esta linha quem
    // só pode ver processo lia custo por aqui.
    { key: "custo", rotulo: "Custo pago", permissao: "financeiro.ver",
      valor: (l) => (sol(l)?.custoPago != null ? Number(sol(l).custoPago) : null),
      alinhamento: "direita", somavel: true },
    { key: "responsavel", rotulo: "Solicitada por", valor: (l) => sol(l)?.criadoPor?.nome ?? null },
    { key: "emissao", rotulo: "Data de emissão", valor: (l) => dataBR(doc(l)?.data_emissao) },
    { key: "traduzida", rotulo: "Traduzida", valor: (l) => (doc(l) ? (doc(l).traduzido ? "sim" : "não") : null) },
    { key: "apostilada", rotulo: "Apostilada", valor: (l) => (doc(l) ? (doc(l).apostilado ? "sim" : "não") : null) },
    { key: "motivo", rotulo: "Por que é exigida", valor: (l) => l.motivoAplicabilidade ?? null },
    { key: "fase", rotulo: "Fase do processo", valor: (l) => l.processo?.faseAtualKey ?? null },
    { key: "protocolo", rotulo: "Nº protocolo",
      valor: (l) => { const c = confirmacao(l); return c?.protocoloRef?.numeroProtocolo ?? c?.protocolo ?? null } },
    { key: "confirmado_em", rotulo: "Confirmado em", valor: (l) => dataBR(confirmacao(l)?.completedAt) },
    // Mesma fonte da coluna "Previsão de retorno" (achado real, "regime de prazo
    // das certidões", 28/09/2026): Tarefa.dataPrazo está vazio em produção para
    // este fluxo — SolicitacaoDocumento.previsaoRetorno é quem já nasce
    // preenchido, a partir do ENVIO do requerimento (não da confirmação).
    { key: "prazo", rotulo: "Prazo", valor: (l) => dataBR(sol(l)?.previsaoRetorno ?? null) },
    { key: "situacao_prazo", rotulo: "Situação do prazo",
      valor: (l) => situacaoDoPrazoSolicitacao(sol(l)).rotulo,
      corDoValor: (l) => situacaoDoPrazoSolicitacao(sol(l)).cor },
    // Chave DIFERENTE de "responsavel" (linha acima, "Solicitada por" — quem
    // CRIOU o registro de solicitação): este é quem tem a Tarefa AGORA, a
    // fonte única de responsável (ownership-canonico-tarefa).
    { key: "responsavel_tarefa", rotulo: "Responsável", valor: (l) => tarefaDoDoc(l)?.responsavel?.nome ?? null },
    { key: "geracao", rotulo: "Geração", valor: (l) => { const p = pessoaDaLinha(l); return p?.numeroLinhagem != null ? `G${p.numeroLinhagem}` : null } },
    { key: "orgao_municipio_uf", rotulo: "Município/UF do órgão",
      valor: (l) => { const o = doc(l)?.orgao; const t = [o?.city, o?.state].filter(Boolean).join("/"); return t || null } },
  ],

  ordenacoes: [
    { key: "criacao", rotulo: "Criação da necessidade", orderBy: (d) => [{ createdAt: d }, { id: d }] },
    // LIMITAÇÃO CONHECIDA (mesma família da de "confirmado_em" logo abaixo):
    // ordena pelo status BRUTO de NecessidadeDocumental, não pelo bucket
    // derivado que a coluna "Situação" exibe — a ordem alfabética do enum não
    // bate com Não localizada→Não solicitada→Pendente→Solicitado→Recebida→
    // Dispensada. Ordenar pelo bucket certo exigiria SQL bruto (CASE WHEN
    // sobre 2 relações aninhadas); registrado como limitação, não escondido.
    { key: "status", rotulo: "Situação", orderBy: (d) => [{ status: d }, { id: "desc" as const }] },
    // FAMÍLIA → GERAÇÃO: os dois primeiros níveis pedidos pela visão "Certidões
    // solicitadas no período". "Confirmado em" como 3º critério NÃO é possível
    // aqui: vive 2 relações "muitos" abaixo (Documento → StepInstance →
    // SubtaskExecution) e o Prisma não ordena `findMany` por campo de relação
    // to-many aninhada duas vezes — só por `_count`. Com a confirmação ainda
    // zerada em toda a produção (verificado 27/09/2026), o impacto prático
    // hoje é nulo; registrado como limitação, não escondido.
    { key: "familia_geracao", rotulo: "Família e geração",
      orderBy: (d) => [{ processo: { familia: { nome: d } } }, { pessoa: { numeroLinhagem: d } }, { id: "asc" as const }] },
  ],

  filtrosPrincipais: ["status", "tipo", "periodo_solicitacao", "confirmado_em", "orgao_emissor"],
  colunasIniciais: ["tipo", "status", "pessoa", "familia", "processo", "orgao", "solicitada_em", "atraso_dias"],
  ordenacaoPadrao: { key: "criacao", direcao: "desc" },

  contar: (where) => prisma.necessidadeDocumental.count({ where: { AND: [where, SO_CERTIDAO, { supersedePorId: null }] } }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.necessidadeDocumental.findMany({
      where: { AND: [where, SO_CERTIDAO, { supersedePorId: null }] },
      orderBy, skip: pular, take: levar, include: INCLUDE,
    }),

  // GETTER (não array estático): "Certidões solicitadas no período" precisa do
  // mês ATUAL, recalculado a cada consulta a /api/relatorios/meta — um array
  // fixo congelaria a data de quando o servidor subiu. As demais visões não
  // dependem de data e continuam idênticas a cada leitura.
  get visoesDoSistema() {
    const hoje = new Date()
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
    const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10)
    return [
      // Redefinidas pra "Situação" derivada (achado real, 28/09/2026 — ver
      // situacao-solicitacao-certidao.ts). "Certidões faltantes" = ainda não
      // tenho a certidão em mãos, qualquer estágio antes de RECEBIDA.
      { key: "faltantes", nome: "Certidões faltantes",
        spec: { filtros: [{ key: "status", valor: { tipo: "multi_selecao" as const, valores: ["NAO_SOLICITADA", "PENDENTE", "SOLICITADO"] } }] } },
      { key: "em-atendimento", nome: "Em atendimento",
        spec: { filtros: [{ key: "status", valor: { tipo: "multi_selecao" as const, valores: ["SOLICITADO"] } }] } },
      { key: "nao-localizadas", nome: "Não localizadas",
        spec: { filtros: [{ key: "status", valor: { tipo: "multi_selecao" as const, valores: ["NAO_LOCALIZADA"] } }] } },
      { key: "atrasadas", nome: "Com retorno vencido",
        spec: { filtros: [{ key: "atrasada", valor: { tipo: "booleano" as const, valor: true } }] } },
      // Antes precisava combinar 2 filtros (status=PENDENTE + solicitada=false)
      // porque não existia um bucket próprio pra "nada foi enviado ainda" — a
      // situação NAO_SOLICITADA agora é exatamente isso, sozinha.
      { key: "nao-solicitadas", nome: "Pendentes ainda não solicitadas",
        spec: { filtros: [{ key: "status", valor: { tipo: "multi_selecao" as const, valores: ["NAO_SOLICITADA"] } }] } },
      { key: "por-orgao", nome: "Por órgão emissor", spec: { filtros: [], agruparPor: "orgao" } },
      { key: "por-familia", nome: "Por família", spec: { filtros: [], agruparPor: "familia" } },
      // VISÃO PADRÃO pedida (rodada "Relatório de Certidões", 27/09/2026):
      // Confirmado em = mês atual (ajustável depois de abrir), agrupada por
      // Família, colunas na ordem pedida, ordenada por família → geração (o
      // 3º critério — confirmado em — não é possível via Prisma orderBy
      // aninhado; ver comentário na ordenação "familia_geracao").
      { key: "certidoes-solicitadas-periodo", nome: "Certidões solicitadas no período",
        spec: {
          filtros: [{ key: "confirmado_em", valor: { tipo: "intervalo_data" as const, de: inicioMes, ate: fimMes } }],
          agruparPor: "familia",
          colunas: ["confirmado_em", "pessoa", "geracao", "tipo", "protocolo", "orgao", "orgao_municipio_uf", "prazo", "responsavel_tarefa"],
          ordenarPor: "familia_geracao",
          direcao: "asc" as const,
        } },
    ]
  },
}
