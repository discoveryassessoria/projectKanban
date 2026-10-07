// src/services/genealogia/confirmacao-arvore.ts
// ============================================================================
// REGRA GERAL (Marco, 07/10/2026): na Genealogia, toda vez que alguém cadastra ou ALTERA um dado registral de uma certidão e esse dado é DIFERENTE do que a
// árvore tem para a mesma pessoa/união, a gravação só acontece depois de uma escolha EXPLÍCITA, campo a campo:
//   • «ARVORE»   — o correto é o da árvore: a Genealogia assume o valor da árvore; o digitado NÃO é salvo.
//   • «CADASTRO» — o correto é o cadastrado: salva e CORRIGE a árvore para esse valor.
//   • (cancelar = a tela não reenvia; nada é salvo.)
// Não há escolha padrão nem confirmação automática: sem decisão para uma divergência, o servidor RECUSA (HTTP 409, `CONFIRMACAO_ARVORE`).
// Árvore vazia no campo → sem pergunta: salva e preenche a árvore. Só grafia diferente (acento, caixa, «SP» × «São Paulo», distrito entre parênteses) → igual.
//
// Cada campo só é comparado com o campo de MESMO significado (`CAMPOS_SINCRONIZAVEIS`): cidade com cidade, estado com estado, país com país, cartório com
// cartório (nunca com a cidade), livro/folha/termo cada um com o seu, data do evento só com o evento, data do registro só com o registro. Campo sem
// equivalente na árvore (cartório/livro/folha/termo de nascimento e óbito, local do óbito) não é comparado e não abre modal.
//
// Histórico nos DOIS lados (Documento = Genealogia; Pessoa/União = árvore): campo, valor antigo, valor novo, quem escolheu e a opção.
// Usado pelas portas que gravam dado registral: PUT /api/documentos/:id, POST /api/documentos e PATCH /api/documentos/:id/dados-registrais.
// ============================================================================
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { aplicarMudancaNaArvore } from "@/src/services/genealogia/propagar-arvore"
import {
  CAMPOS_SINCRONIZAVEIS, diaDe, diferencasDoEvento, eventoDoTipoDeDocumento, mesmoTexto, mostrarValor, semParenteses, textoDeCampo, valorDoRegistro,
  type CampoSincronizavel, type EventoRegistral, type ValoresDoRegistro,
} from "@/src/lib/genealogia/sincronizacao-registral"

export const ACAO_CONFIRMACAO_ARVORE = "CONFIRMACAO_ARVORE_CADASTRO"
export type OpcaoDeConfirmacao = "ARVORE" | "CADASTRO"
export const OPCOES_DE_CONFIRMACAO: readonly OpcaoDeConfirmacao[] = ["ARVORE", "CADASTRO"]

/** Colunas do Documento que têm equivalente na árvore (as chaves que o corpo da gravação pode trazer). */
export const COLUNAS_DO_DOCUMENTO_COM_ARVORE: readonly string[] = [...new Set(CAMPOS_SINCRONIZAVEIS.map((c) => c.origem))]

export interface DivergenciaPendente {
  chave: string
  rotulo: string
  alvo: "PESSOA" | "UNIAO"
  alvoId: number
  pessoaNome: string
  arvore: string
  arvoreTexto: string
  digitado: string
  digitadoTexto: string
}

export interface ItemDoPlano {
  campo: CampoSincronizavel
  alvoId: number
  pessoaId: number
  pessoaNome: string
  arvoreId: number
  /** `null` = árvore vazia (preenche sem perguntar). */
  arvore: string | null
  digitado: string
  /** O que o cadastro tinha antes da gravação. */
  anteriorNoCadastro: string | null
  /** `ARVORE_VAZIA` quando a árvore estava vazia e foi preenchida. */
  opcao: OpcaoDeConfirmacao | "ARVORE_VAZIA"
}

export interface PlanoDeConfirmacao {
  /** Divergências SEM escolha: a gravação deve ser recusada com elas. */
  pendentes: DivergenciaPendente[]
  /** Valores a gravar no Documento no lugar do digitado (opção «ARVORE»): coluna → valor. */
  substituicoes: Record<string, Date | string>
  /** O que vai para a árvore e/ou para o histórico depois que o Documento é gravado. */
  itens: ItemDoPlano[]
}

export type DecisoesDeConfirmacao = Record<string, OpcaoDeConfirmacao>

/** Lê `decisoes` do corpo da requisição (só aceita as duas opções válidas; qualquer outra coisa é ignorada = sem decisão). */
export function decisoesDoCorpo(corpo: unknown): DecisoesDeConfirmacao {
  const bruto = corpo && typeof corpo === "object" ? (corpo as Record<string, unknown>).decisoes : null
  const r: DecisoesDeConfirmacao = {}
  if (bruto && typeof bruto === "object") for (const [k, v] of Object.entries(bruto)) if (v === "ARVORE" || v === "CADASTRO") r[k] = v
  return r
}

export function mensagemDaConfirmacao(pendentes: readonly DivergenciaPendente[]): string {
  return pendentes.length === 1
    ? `Na árvore está: ${pendentes[0].arvoreTexto}. Você está cadastrando: ${pendentes[0].digitadoTexto}. Escolha qual é o correto (${pendentes[0].rotulo}) antes de salvar.`
    : `${pendentes.length} dados diferem da árvore (${pendentes.map((p) => p.rotulo).join(", ")}). Escolha qual é o correto em cada um antes de salvar.`
}

/** Corpo padrão da recusa (HTTP 409). */
export const respostaDeConfirmacao = (pendentes: readonly DivergenciaPendente[]) => ({
  ok: false as const, codigo: "CONFIRMACAO_ARVORE" as const, error: mensagemDaConfirmacao(pendentes), divergencias: pendentes,
})

interface AlvoDoDocumento {
  evento: EventoRegistral
  pessoaId: number
  pessoaNome: string
  arvoreId: number
  alvo: "PESSOA" | "UNIAO"
  alvoId: number
  atual: Record<string, unknown>
}

async function alvoDoDocumento(documentoId: number | null, criacao?: { pessoaId: number; tipo: string | null; uniaoId?: number | null }): Promise<AlvoDoDocumento | null> {
  let tipo: string | null, legacy: string | null = null, pessoaId: number, uniaoId: number | null
  if (documentoId != null) {
    const doc = await prisma.documento.findUnique({ where: { id: documentoId }, select: { tipo: true, documentType: { select: { legacyEnumKey: true } }, pessoaId: true, necessidade: { select: { uniaoId: true } } } })
    if (!doc) return null
    tipo = doc.tipo; legacy = doc.documentType?.legacyEnumKey ?? null; pessoaId = doc.pessoaId; uniaoId = doc.necessidade?.uniaoId ?? null
  } else if (criacao) {
    tipo = criacao.tipo; pessoaId = criacao.pessoaId; uniaoId = criacao.uniaoId ?? null
  } else return null
  const evento = eventoDoTipoDeDocumento(tipo) ?? eventoDoTipoDeDocumento(legacy)
  if (!evento) return null
  const pessoa = await prisma.pessoa.findUnique({ where: { id: pessoaId }, select: { id: true, nome: true, sobrenome: true, arvoreId: true, data_nasc: true, local_nasc: true, estado_nasc: true, pais_nasc: true, data_obito: true, local_obito: true, estado_obito: true, pais_obito: true } })
  if (!pessoa || pessoa.arvoreId == null) return null
  const pessoaNome = `${pessoa.nome}${pessoa.sobrenome ? ` ${pessoa.sobrenome}` : ""}`
  if (evento === "CASAMENTO") {
    if (uniaoId == null) return null // sem a união não há onde comparar nem gravar
    const uniao = await prisma.uniao.findUnique({ where: { id: uniaoId }, select: { id: true, data_inicio: true, local: true, estado: true, pais: true, data_registro: true, cartorio: true, livro: true, folha: true, termo: true } })
    return uniao ? { evento, pessoaId, pessoaNome, arvoreId: pessoa.arvoreId, alvo: "UNIAO", alvoId: uniao.id, atual: uniao as never } : null
  }
  return { evento, pessoaId, pessoaNome, arvoreId: pessoa.arvoreId, alvo: "PESSOA", alvoId: pessoa.id, atual: pessoa as never }
}

const igualAoCadastro = (campo: CampoSincronizavel, a: string | null, b: string | null): boolean => (campo.tipo === "data" ? a === b : mesmoTexto(a, b))

/**
 * Compara o que está sendo GRAVADO com a árvore, campo a campo, e monta o plano. `novos` = as colunas do Documento que o corpo traz; `atuais` = o que o
 * Documento tem hoje (vazio na criação). Só entra o campo que MUDOU em relação ao cadastro atual e tem valor (vazio nunca compara nem apaga).
 */
export async function planejarConfirmacao(args: {
  documentoId: number | null
  criacao?: { pessoaId: number; tipo: string | null; uniaoId?: number | null }
  novos: ValoresDoRegistro
  atuais: ValoresDoRegistro
  decisoes: DecisoesDeConfirmacao
}): Promise<PlanoDeConfirmacao> {
  const plano: PlanoDeConfirmacao = { pendentes: [], substituicoes: {}, itens: [] }
  const alvo = await alvoDoDocumento(args.documentoId, args.criacao)
  if (!alvo) return plano
  // Só o que mudou: o formulário reenvia tudo, e campo que ninguém tocou não reclama.
  const mudados: ValoresDoRegistro = {}
  for (const campo of CAMPOS_SINCRONIZAVEIS) {
    if (campo.evento !== alvo.evento) continue
    const coluna = campo.origem
    if (!(coluna in args.novos) || (args.novos as Record<string, unknown>)[coluna] === undefined) continue
    const novo = valorDoRegistro(campo, args.novos)
    if (novo == null) continue
    if (igualAoCadastro(campo, novo, valorDoRegistro(campo, args.atuais))) continue
    ;(mudados as Record<string, unknown>)[coluna] = (args.novos as Record<string, unknown>)[coluna]
  }
  for (const d of diferencasDoEvento(alvo.evento, mudados, alvo.atual)) {
    const anterior = valorDoRegistro(d.campo, args.atuais)
    const base = { campo: d.campo, alvoId: alvo.alvoId, pessoaId: alvo.pessoaId, pessoaNome: alvo.pessoaNome, arvoreId: alvo.arvoreId, arvore: d.arvore, digitado: d.registro, anteriorNoCadastro: anterior }
    if (d.tipo === "PREENCHER") { plano.itens.push({ ...base, opcao: "ARVORE_VAZIA" }); continue }
    const escolha = args.decisoes[d.campo.chave]
    if (escolha !== "ARVORE" && escolha !== "CADASTRO") {
      plano.pendentes.push({
        chave: d.campo.chave, rotulo: d.campo.rotulo, alvo: alvo.alvo, alvoId: alvo.alvoId, pessoaNome: alvo.pessoaNome,
        arvore: d.arvore!, arvoreTexto: mostrarValor(d.campo, d.arvore), digitado: d.registro, digitadoTexto: mostrarValor(d.campo, d.registro),
      })
      continue
    }
    if (escolha === "ARVORE") {
      // A Genealogia assume o valor da árvore (sem o complemento entre parênteses: «SP (2º Subd.)» → «SP»); o digitado não é salvo.
      const daArvore = d.campo.tipo === "data" ? new Date(`${d.arvore}T00:00:00.000Z`) : semParenteses(d.arvore!)
      plano.substituicoes[d.campo.origem] = daArvore
    }
    plano.itens.push({ ...base, opcao: escolha })
  }
  return plano
}

/** Aplica a escolha «ARVORE» sobre os dados que vão para o Documento (substitui o digitado pelo valor da árvore). */
export function aplicarSubstituicoes<T extends Record<string, unknown>>(dados: T, plano: PlanoDeConfirmacao): T {
  const r: Record<string, unknown> = { ...dados }
  for (const [coluna, valor] of Object.entries(plano.substituicoes)) r[coluna] = valor
  return r as T
}

const textoDoValor = (campo: CampoSincronizavel, v: string | null) => (v == null ? null : campo.tipo === "data" ? v : v)

/**
 * Depois que o Documento foi gravado: escreve na árvore o que a decisão manda (opção «CADASTRO» e árvore vazia) e registra o histórico dos dois lados —
 * Genealogia (entidade Documento) e árvore (Pessoa/União): campo, valor antigo, valor novo, quem escolheu e a opção. Tudo em UMA transação da árvore.
 */
export async function aplicarPlanoNaArvore(plano: PlanoDeConfirmacao, ctx: { documentoId: number; autorId: number | null }): Promise<void> {
  if (plano.itens.length === 0) return
  const porArvore = new Map<number, ItemDoPlano[]>()
  for (const i of plano.itens) { if (!porArvore.has(i.arvoreId)) porArvore.set(i.arvoreId, []); porArvore.get(i.arvoreId)!.push(i) }
  for (const [arvoreId, itens] of porArvore) {
    await aplicarMudancaNaArvore({
      arvoreId, autorId: ctx.autorId,
      fn: async (tx) => {
        const grava = new Map<string, { alvo: "PESSOA" | "UNIAO"; alvoId: number; dados: Record<string, Date | string> }>()
        for (const i of itens) {
          if (i.opcao === "ARVORE") continue // a árvore já está certa: só o histórico
          const k = `${i.campo.alvo}:${i.alvoId}`
          if (!grava.has(k)) grava.set(k, { alvo: i.campo.alvo, alvoId: i.alvoId, dados: {} })
          grava.get(k)!.dados[i.campo.coluna] = i.campo.tipo === "data" ? new Date(`${i.digitado}T00:00:00.000Z`) : i.digitado
        }
        for (const g of grava.values()) {
          if (g.alvo === "PESSOA") await tx.pessoa.update({ where: { id: g.alvoId }, data: g.dados })
          else await tx.uniao.update({ where: { id: g.alvoId }, data: g.dados })
        }
        for (const i of itens) {
          const final = i.opcao === "ARVORE" ? i.arvore : i.digitado
          const detalhes = {
            arvoreId, documentoId: ctx.documentoId, chave: i.campo.chave, campo: i.campo.rotulo, alvo: i.campo.alvo, alvoId: i.alvoId, pessoaId: i.pessoaId, pessoaNome: i.pessoaNome,
            opcao: i.opcao, escolhidoPorUsuarioId: ctx.autorId, valorNaArvore: i.arvore, valorDigitado: i.digitado, valorAnteriorNoCadastro: i.anteriorNoCadastro, valorFinal: final,
          }
          const frase = (de: string | null, para: string | null) => `${i.campo.rotulo}: ${de == null ? "vazio" : mostrarValor(i.campo, textoDoValor(i.campo, de))} → ${para == null ? "vazio" : mostrarValor(i.campo, textoDoValor(i.campo, para))}`
          const opcaoTxt = i.opcao === "ARVORE" ? "o correto é o da árvore" : i.opcao === "CADASTRO" ? "o correto é o cadastrado" : "árvore vazia, preenchida com o cadastro"
          // Lado da Genealogia: o Documento (cadastro) — antes = o que ele tinha, depois = o que ficou.
          await tx.logAuditoria.create({
            data: {
              acao: ACAO_CONFIRMACAO_ARVORE, entidade: "Documento", entidadeId: ctx.documentoId, usuarioId: ctx.autorId,
              descricao: `Genealogia — ${i.pessoaNome}, ${frase(i.anteriorNoCadastro, final)} (${opcaoTxt})`,
              detalhes: { ...detalhes, lado: "GENEALOGIA", antes: i.anteriorNoCadastro, depois: final } as Prisma.InputJsonValue,
            },
          })
          // Lado da árvore: a Pessoa/União — antes = o que a árvore tinha, depois = o que ficou.
          await tx.logAuditoria.create({
            data: {
              acao: ACAO_CONFIRMACAO_ARVORE, entidade: i.campo.alvo === "UNIAO" ? "Uniao" : "Pessoa", entidadeId: i.alvoId, usuarioId: ctx.autorId,
              descricao: `Árvore — ${i.pessoaNome}, ${frase(i.arvore, final)} (${opcaoTxt})`,
              detalhes: { ...detalhes, lado: "ARVORE", antes: i.arvore, depois: final } as Prisma.InputJsonValue,
            },
          })
        }
        return itens
      },
      motivo: (r) => (r.some((i) => i.opcao !== "ARVORE") ? `confirmação árvore × cadastro (${r.filter((i) => i.opcao !== "ARVORE").map((i) => `${i.pessoaNome}: ${i.campo.rotulo}`).join("; ")})` : ""),
    })
  }
}

// Reexporta para quem só precisa comparar.
export { diaDe, textoDeCampo }
