// src/services/genealogia/sincronizar-com-registro.ts
// ============================================================================
// SINCRONIZAÇÃO ÁRVORE ⇄ DADOS REGISTRAIS (06/10/2026) — o lado do banco. A regra e o mapeamento de campos vivem em
// `src/lib/genealogia/sincronizacao-registral.ts` (puro). Aqui: ler os registros LOCALIZADOS ("Localizar registro" concluído), calcular as
// diferenças, aplicar (com histórico antes → depois, quem e quando) e desfazer.
//
//  • Só atualiza campos de Pessoa/União que JÁ existem. NUNCA cria, remove nem religa pessoa, união ou filiação.
//  • Toda gravação passa por `aplicarMudancaNaArvore` (a árvore é a fonte da verdade documental: nascimento muda maioridade → exigências).
//  • Campo vazio na árvore preenche sozinho; diferente → vale o registro, registrado como DIVERGÊNCIA RESOLVIDA (visível na Inteligência da árvore).
//  • Desfazer devolve o valor anterior e DESTRAVA o campo para aquele valor do registro (a sincronização não o reaplica sozinha).
// ============================================================================
import type { Prisma, PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { STATUS_DOCUMENTO_INATIVOS } from "@/src/lib/documentos/status-inativos"
import { aplicarMudancaNaArvore } from "@/src/services/genealogia/propagar-arvore"
import {
  CAMPOS_SINCRONIZAVEIS, TIPOS_DE_CERTIDAO_DO_EVENTO, registroAnteriorAoEvento, separarLugarUnico, suspeitaNoValorDoRegistro, campoDaChave, camposTravados, diaDe, diferencasDoEvento, eventoDoTipoDeDocumento, mesmoTexto, mostrarValor, textoDeCampo as textoDe, textoDoHistorico,
  type CampoSincronizavel, type DiferencaDeCampo, type EventoRegistral, type TipoDeDiferenca, type ValoresDoRegistro,
} from "@/src/lib/genealogia/sincronizacao-registral"

type DB = PrismaClient | Prisma.TransactionClient

export const ACAO_SINCRONIZACAO = "SINCRONIZACAO_REGISTRAL"
export const ACAO_SINCRONIZACAO_DESFEITA = "SINCRONIZACAO_REGISTRAL_DESFEITA"

export interface RegistroLocalizado {
  documentoId: number
  evento: EventoRegistral
  pessoaId: number
  /** Só no casamento: a união a que a certidão se refere. */
  uniaoId: number | null
  arvoreId: number
  valores: ValoresDoRegistro
  /** Lugares em texto único que NÃO dá para separar com segurança: o campo não é gravado — vai para a lista de revisão manual. */
  revisaoManual?: string[]
}

export interface ItemDeSincronizacao {
  chave: string
  rotulo: string
  evento: EventoRegistral
  alvo: "PESSOA" | "UNIAO"
  alvoId: number
  pessoaId: number
  pessoaNome: string
  documentoId: number
  tipo: TipoDeDiferenca
  /** Valor da árvore / do registro, no formato interno e como a tela mostra. */
  arvore: string | null
  registro: string
  arvoreTexto: string
  registroTexto: string
  /** O log gravado ao aplicar (para o "Desfazer"). */
  logId?: number
}

const nomeDe = (p: { nome: string; sobrenome: string | null }) => `${p.nome}${p.sobrenome ? ` ${p.sobrenome}` : ""}`

/** Os registros LOCALIZADOS de uma árvore (ou de UM documento): certidão ativa de nascimento/casamento/óbito com "Localizar registro" CONCLUÍDO. */
export async function registrosLocalizados(db: DB, filtro: { arvoreId?: number; documentoId?: number }): Promise<RegistroLocalizado[]> {
  const docs = await db.documento.findMany({
    where: {
      ...(filtro.documentoId != null ? { id: filtro.documentoId } : { pessoa: { arvoreId: filtro.arvoreId } }),
      // O tipo é o do enum legado (`tipo`) OU o da ponte do cadastro (`documentType.legacyEnumKey`): documento só com um dos dois também conta.
      OR: [{ tipo: { in: TIPOS_DE_CERTIDAO_DO_EVENTO as never[] } }, { documentType: { legacyEnumKey: { in: [...TIPOS_DE_CERTIDAO_DO_EVENTO] } } }],
      status: { notIn: [...STATUS_DOCUMENTO_INATIVOS] as never[] },
      stepInstances: { some: { stepKey: "localizar_registro", status: "CONCLUIDO" } },
    },
    select: {
      id: true, tipo: true, documentType: { select: { legacyEnumKey: true } }, pessoaId: true, data_evento: true, cidade_registro: true, estado_registro: true, pais_registro: true, data_registro: true, cartorio: true, livro: true, folha: true, termo: true,
      pessoa: { select: { arvoreId: true } }, necessidade: { select: { uniaoId: true } },
    },
    orderBy: { id: "asc" },
  })
  // Por (evento, alvo) vale o registro MAIS RECENTE (maior id): duas certidões do mesmo evento (simples e inteiro teor) não disputam o campo.
  const porAlvo = new Map<string, RegistroLocalizado>()
  for (const d of docs) {
    const evento = eventoDoTipoDeDocumento(d.tipo) ?? eventoDoTipoDeDocumento(d.documentType?.legacyEnumKey)
    if (!evento || d.pessoa?.arvoreId == null) continue
    const uniaoId = evento === "CASAMENTO" ? d.necessidade?.uniaoId ?? null : null
    if (evento === "CASAMENTO" && uniaoId == null) continue // sem a união não há onde gravar
    // Cidade com o estado colado («Santo André - São Paulo»): separa quando é seguro; senão o campo fica de fora e o caso vai para revisão manual.
    const lugar = separarLugarUnico(d.cidade_registro, d.estado_registro)
    porAlvo.set(`${evento}:${evento === "CASAMENTO" ? `U${uniaoId}` : `P${d.pessoaId}`}`, {
      documentoId: d.id, evento, pessoaId: d.pessoaId, uniaoId, arvoreId: d.pessoa.arvoreId,
      revisaoManual: lugar.revisaoManual && lugar.motivo ? [lugar.motivo] : undefined,
      valores: { data_evento: d.data_evento, cidade_registro: lugar.cidade, estado_registro: lugar.estado, pais_registro: d.pais_registro, data_registro: d.data_registro, cartorio: d.cartorio, livro: d.livro, folha: d.folha, termo: d.termo },
    })
  }
  return [...porAlvo.values()]
}

/** Campos já DESFEITOS pelo usuário para um valor de registro: a sincronização não os reaplica nem os trava. `alvo:id:chave:valorDoRegistro`. */
async function destravadosPorDesfazer(db: DB, ids: { pessoas: number[]; unioes: number[] }): Promise<Set<string>> {
  const entidades = [...(ids.pessoas.length ? [{ entidade: "Pessoa", entidadeId: { in: ids.pessoas } }] : []), ...(ids.unioes.length ? [{ entidade: "Uniao", entidadeId: { in: ids.unioes } }] : [])]
  if (entidades.length === 0) return new Set()
  const logs = await db.logAuditoria.findMany({ where: { acao: ACAO_SINCRONIZACAO_DESFEITA, OR: entidades }, select: { entidade: true, entidadeId: true, detalhes: true } })
  const r = new Set<string>()
  for (const l of logs) {
    const d = (l.detalhes ?? {}) as Record<string, unknown>
    r.add(`${l.entidade === "Uniao" ? "UNIAO" : "PESSOA"}:${l.entidadeId}:${String(d.chave)}:${String(d.registro)}`)
  }
  return r
}

interface Contexto {
  registros: RegistroLocalizado[]
  pessoas: Map<number, Record<string, unknown> & { id: number; nome: string; sobrenome: string | null }>
  unioes: Map<number, Record<string, unknown> & { id: number }>
  desfeitos: Set<string>
}

async function carregarContexto(db: DB, filtro: { arvoreId?: number; documentoId?: number }): Promise<Contexto> {
  const registros = await registrosLocalizados(db, filtro)
  const pessoaIds = [...new Set(registros.map((r) => r.pessoaId))]
  const uniaoIds = [...new Set(registros.map((r) => r.uniaoId).filter((x): x is number => x != null))]
  const [pessoas, unioes] = await Promise.all([
    pessoaIds.length ? db.pessoa.findMany({ where: { id: { in: pessoaIds } }, select: { id: true, nome: true, sobrenome: true, data_nasc: true, local_nasc: true, estado_nasc: true, pais_nasc: true, data_obito: true, local_obito: true, estado_obito: true, pais_obito: true } }) : Promise.resolve([]),
    uniaoIds.length ? db.uniao.findMany({ where: { id: { in: uniaoIds } }, select: { id: true, data_inicio: true, local: true, estado: true, pais: true, data_registro: true, cartorio: true, livro: true, folha: true, termo: true } }) : Promise.resolve([]),
  ])
  return {
    registros,
    pessoas: new Map(pessoas.map((p) => [p.id, p as never])), unioes: new Map(unioes.map((u) => [u.id, u as never])),
    desfeitos: await destravadosPorDesfazer(db, { pessoas: pessoaIds, unioes: uniaoIds }),
  }
}

const itemDe = (c: Contexto, r: RegistroLocalizado, d: DiferencaDeCampo): ItemDeSincronizacao | null => {
  const alvo = d.campo.alvo
  const alvoId = alvo === "PESSOA" ? r.pessoaId : r.uniaoId!
  if (c.desfeitos.has(`${alvo}:${alvoId}:${d.campo.chave}:${d.registro}`)) return null // o usuário já desfez ESTE valor do registro
  const p = c.pessoas.get(r.pessoaId)
  return {
    chave: d.campo.chave, rotulo: d.campo.rotulo, evento: r.evento, alvo, alvoId, pessoaId: r.pessoaId, pessoaNome: p ? nomeDe(p) : `Pessoa #${r.pessoaId}`,
    documentoId: r.documentoId, tipo: d.tipo, arvore: d.arvore, registro: d.registro,
    arvoreTexto: mostrarValor(d.campo, d.arvore), registroTexto: mostrarValor(d.campo, d.registro),
  }
}

function calcularItens(c: Contexto, incluirConflitos = true): ItemDeSincronizacao[] {
  const itens: ItemDeSincronizacao[] = []
  for (const r of c.registros) {
    const atual = r.evento === "CASAMENTO" ? c.unioes.get(r.uniaoId!) : c.pessoas.get(r.pessoaId)
    if (!atual) continue
    for (const d of diferencasDoEvento(r.evento, r.valores, atual)) {
      const item = itemDe(c, r, d)
      if (item && (incluirConflitos || item.tipo === "PREENCHER")) itens.push(item)
    }
  }
  return itens
}

/** SÓ LEITURA: as diferenças entre a árvore e os registros localizados (o que o botão "Sincronizar com a Genealogia" mostra). */
export async function itensDeSincronizacao(arvoreId: number, db: DB = prisma): Promise<{ itens: ItemDeSincronizacao[]; registrosLocalizados: number }> {
  const c = await carregarContexto(db, { arvoreId })
  return { itens: calcularItens(c), registrosLocalizados: c.registros.length }
}

export interface ResultadoDaSincronizacao { aplicados: ItemDeSincronizacao[]; logs: number[] }

/**
 * Aplica as diferenças. Recalcula DENTRO da transação com o dado de agora (nunca confia na lista que a tela mostrou antes) — só aplica o que ainda é
 * diferença. `selecao` (opcional) limita a `alvo:alvoId:chave`. Cada campo gravado gera UM log (antes → depois, quem e quando).
 */
export async function sincronizarArvore(args: {
  arvoreId: number
  autorId?: number | null
  origem: "CONCLUSAO_DO_REGISTRO" | "EDICAO_DOS_DADOS_REGISTRAIS" | "ESCOLHA_NO_AVISO" | "CASOS_ANTIGOS"
  documentoId?: number
  selecao?: ReadonlySet<string> | null
}): Promise<ResultadoDaSincronizacao> {
  const { arvoreId, autorId = null, origem, documentoId, selecao = null } = args
  const previa = await carregarContexto(prisma, documentoId != null ? { documentoId } : { arvoreId })
  // A GENEALOGIA SEMPRE PREVALECE (decisão do Marco, 08/10/2026): vazio na árvore preenche e valor DIFERENTE também é gravado (conflito, texto quase igual e local do óbito
  // inclusos), com o valor antigo no histórico (reversível). Não há exceção nem lista de «ambíguos» nesta regra; o aviso com a escolha acontece ANTES, ao salvar os
  // Dados Registrais (`confirmacao-arvore.ts`), e o que sobra depois dele é conflito que a Genealogia resolve aqui.
  const incluirConflitos = true
  if (calcularItens(previa, incluirConflitos).length === 0) return { aplicados: [], logs: [] }
  const processos = await prisma.processo.findMany({ where: { arvoreId }, select: { id: true } })

  const { resultado } = await aplicarMudancaNaArvore<ResultadoDaSincronizacao>({
    arvoreId, autorId,
    fn: async (tx) => {
      const c = await carregarContexto(tx, documentoId != null ? { documentoId } : { arvoreId })
      const itens = calcularItens(c, incluirConflitos).filter((i) => !selecao || selecao.has(`${i.alvo}:${i.alvoId}:${i.chave}`))
      const logs: number[] = []
      const porAlvo = new Map<string, ItemDeSincronizacao[]>()
      for (const i of itens) { const k = `${i.alvo}:${i.alvoId}`; if (!porAlvo.has(k)) porAlvo.set(k, []); porAlvo.get(k)!.push(i) }
      for (const [, lista] of porAlvo) {
        const dados: Record<string, Date | string> = {}
        for (const i of lista) {
          const campo = campoDaChave(i.chave)!
          dados[campo.coluna] = campo.tipo === "data" ? new Date(`${i.registro}T00:00:00.000Z`) : i.registro
        }
        if (lista[0].alvo === "PESSOA") await tx.pessoa.update({ where: { id: lista[0].alvoId }, data: dados })
        else await tx.uniao.update({ where: { id: lista[0].alvoId }, data: dados })
        for (const i of lista) {
          const campo = campoDaChave(i.chave)!
          for (const p of processos.length ? processos : [{ id: null as number | null }]) {
            const log = await tx.logAuditoria.create({
              data: {
                acao: ACAO_SINCRONIZACAO, entidade: p.id != null ? "Processo" : "Pessoa", entidadeId: p.id ?? i.pessoaId,
                descricao: `Árvore sincronizada com a Genealogia — ${i.pessoaNome}, ${textoDoHistorico(campo, i.arvore, i.registro)}`,
                usuarioId: autorId,
                detalhes: {
                  arvoreId, chave: i.chave, coluna: campo.coluna, rotulo: i.rotulo, evento: i.evento, alvo: i.alvo, alvoId: i.alvoId, pessoaId: i.pessoaId, pessoaNome: i.pessoaNome,
                  documentoId: i.documentoId, tipo: i.tipo, divergenciaResolvida: i.tipo === "CONFLITO", antes: i.arvore, depois: i.registro, origem,
                  // O que o histórico precisa dizer (08/10/2026): campo, valor antigo, valor novo, quem, qual opção e a origem.
                  opcao: origem === "ESCOLHA_NO_AVISO" ? "GENEALOGIA (escolha da pessoa)" : origem === "CASOS_ANTIGOS" ? "GENEALOGIA PREVALECE (caso antigo)" : "AUTOMATICA (árvore estava vazia)",
                  quem: autorId != null ? `usuário #${autorId}` : "sistema",
                } as Prisma.InputJsonValue,
              },
              select: { id: true },
            })
            logs.push(log.id)
            if (i.logId == null) i.logId = log.id
          }
        }
      }
      return { aplicados: itens, logs }
    },
    motivo: (r) => (r.aplicados.length ? `sincronização com os dados registrais da Genealogia (${r.aplicados.map((i) => `${i.pessoaNome}: ${i.rotulo}`).join("; ")})` : ""),
  })
  return resultado
}

/** Atalho: sincroniza UMA certidão (ao concluir "Localizar registro" e a cada edição dos Dados Registrais). Sem registro localizado → nada. Nunca lança. */
export async function sincronizarDocumento(documentoId: number, autorId: number | null, origem: "CONCLUSAO_DO_REGISTRO" | "EDICAO_DOS_DADOS_REGISTRAIS"): Promise<ResultadoDaSincronizacao> {
  try {
    const doc = await prisma.documento.findUnique({ where: { id: documentoId }, select: { pessoa: { select: { arvoreId: true } } } })
    const arvoreId = doc?.pessoa?.arvoreId
    if (arvoreId == null) return { aplicados: [], logs: [] }
    return await sincronizarArvore({ arvoreId, autorId, origem, documentoId })
  } catch (e) {
    console.error("[sincronizar-com-registro] falhou (o documento já foi salvo):", e)
    return { aplicados: [], logs: [] }
  }
}

export type ResultadoDoDesfazer = { ok: true } | { ok: false; codigo: "NAO_ENCONTRADO" | "JA_DESFEITO" | "VALOR_MUDOU"; mensagem: string }

/** Desfaz UMA sincronização: devolve o valor anterior. Só se o campo ainda tem o valor que a sincronização gravou (senão perderia edição posterior). */
export async function desfazerSincronizacao(logId: number, autorId: number | null): Promise<ResultadoDoDesfazer> {
  const log = await prisma.logAuditoria.findUnique({ where: { id: logId }, select: { id: true, acao: true, detalhes: true } })
  if (!log || log.acao !== ACAO_SINCRONIZACAO) return { ok: false, codigo: "NAO_ENCONTRADO", mensagem: "Essa sincronização não existe." }
  const d = (log.detalhes ?? {}) as Record<string, unknown>
  const campo = campoDaChave(String(d.chave))
  const alvoId = Number(d.alvoId), arvoreId = Number(d.arvoreId)
  if (!campo || !Number.isInteger(alvoId)) return { ok: false, codigo: "NAO_ENCONTRADO", mensagem: "Essa sincronização não pode ser desfeita." }
  const jaDesfeito = await prisma.logAuditoria.findFirst({ where: { acao: ACAO_SINCRONIZACAO_DESFEITA, detalhes: { path: ["logId"], equals: logId } }, select: { id: true } })
  if (jaDesfeito) return { ok: false, codigo: "JA_DESFEITO", mensagem: "Essa sincronização já foi desfeita." }
  const atual = campo.alvo === "PESSOA"
    ? await prisma.pessoa.findUnique({ where: { id: alvoId }, select: { [campo.coluna]: true } as never })
    : await prisma.uniao.findUnique({ where: { id: alvoId }, select: { [campo.coluna]: true } as never })
  const valorAtual = atual ? ((atual as Record<string, unknown>)[campo.coluna] as Date | string | null) : undefined
  const hoje = campo.tipo === "data" ? (valorAtual instanceof Date ? valorAtual.toISOString().slice(0, 10) : null) : (typeof valorAtual === "string" ? valorAtual : null)
  const depois = String(d.depois)
  if (hoje == null || (campo.tipo === "data" ? hoje !== depois : hoje.trim().toLowerCase() !== depois.trim().toLowerCase())) {
    return { ok: false, codigo: "VALOR_MUDOU", mensagem: "O campo foi alterado depois da sincronização; não dá para desfazer sem perder essa alteração." }
  }
  const antes = d.antes == null ? null : String(d.antes)
  const dados = { [campo.coluna]: antes == null ? null : campo.tipo === "data" ? new Date(`${antes}T00:00:00.000Z`) : antes }
  const processos = await prisma.processo.findMany({ where: { arvoreId }, select: { id: true } })
  await aplicarMudancaNaArvore({
    arvoreId, autorId,
    fn: async (tx) => {
      if (campo.alvo === "PESSOA") await tx.pessoa.update({ where: { id: alvoId }, data: dados })
      else await tx.uniao.update({ where: { id: alvoId }, data: dados })
      for (const p of processos.length ? processos : [{ id: null as number | null }]) {
        await tx.logAuditoria.create({
          data: {
            acao: ACAO_SINCRONIZACAO_DESFEITA, entidade: p.id != null ? "Processo" : campo.alvo === "PESSOA" ? "Pessoa" : "Uniao", entidadeId: p.id ?? alvoId,
            descricao: `Sincronização desfeita — ${String(d.pessoaNome)}, ${textoDoHistorico(campo, depois, antes ?? "")}`.replace(/→ $/, "→ vazio"), usuarioId: autorId,
            detalhes: { arvoreId, logId, chave: campo.chave, alvo: campo.alvo, alvoId, pessoaId: d.pessoaId, pessoaNome: d.pessoaNome, rotulo: campo.rotulo, registro: depois, antes: depois, depois: antes } as Prisma.InputJsonValue,
          },
        })
      }
      // O registro "destravado": a entrada que a sincronização não reaplica (alvo, chave, valor do registro) fica na entidade do campo.
      await tx.logAuditoria.create({
        data: {
          acao: ACAO_SINCRONIZACAO_DESFEITA, entidade: campo.alvo === "PESSOA" ? "Pessoa" : "Uniao", entidadeId: alvoId, descricao: `Campo destravado: ${campo.rotulo}`, usuarioId: autorId,
          detalhes: { arvoreId, logId, chave: campo.chave, registro: depois } as Prisma.InputJsonValue,
        },
      })
    },
    motivo: () => `sincronização desfeita (${String(d.pessoaNome)}: ${campo.rotulo})`,
  })
  return { ok: true }
}

/** Os campos da árvore TRAVADOS por registro localizado — para a tela marcar "do registro" e a API recusar edição. `pessoas`/`unioes`: id → chaves. */
export async function camposDoRegistro(arvoreId: number, db: DB = prisma): Promise<{ pessoas: Record<number, string[]>; unioes: Record<number, string[]> }> {
  const c = await carregarContexto(db, { arvoreId })
  const porPessoa = new Map<number, RegistroLocalizado[]>(), porUniao = new Map<number, RegistroLocalizado[]>()
  for (const r of c.registros) {
    if (r.evento === "CASAMENTO") { if (!porUniao.has(r.uniaoId!)) porUniao.set(r.uniaoId!, []); porUniao.get(r.uniaoId!)!.push(r) }
    else { if (!porPessoa.has(r.pessoaId)) porPessoa.set(r.pessoaId, []); porPessoa.get(r.pessoaId)!.push(r) }
  }
  const saida = { pessoas: {} as Record<number, string[]>, unioes: {} as Record<number, string[]> }
  const travar = (alvo: "PESSOA" | "UNIAO", id: number, regs: RegistroLocalizado[]) => {
    const destravados = new Set<string>()
    for (const reg of regs) for (const campo of CAMPOS_SINCRONIZAVEIS) {
      const valor = reg.valores[campo.origem]
      if (campo.evento === reg.evento && c.desfeitos.has(`${alvo}:${id}:${campo.chave}:${campo.tipo === "data" ? valorDia(valor) : String(valor ?? "").trim()}`)) destravados.add(campo.chave)
    }
    return [...camposTravados(regs, destravados)]
  }
  for (const [id, regs] of porPessoa) { const t = travar("PESSOA", id, regs); if (t.length) saida.pessoas[id] = t }
  for (const [id, regs] of porUniao) { const t = travar("UNIAO", id, regs); if (t.length) saida.unioes[id] = t }
  return saida
}
const valorDia = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v.slice(0, 10) : "")

export interface DivergenciaResolvida {
  logId: number
  quando: string
  quem: string | null
  pessoaId: number | null
  pessoaNome: string | null
  rotulo: string
  antes: string | null
  depois: string
  desfeita: boolean
}

/** As divergências RESOLVIDAS pela Genealogia (a árvore divergia do registro e o registro venceu) — para a Inteligência da árvore. */
export async function divergenciasResolvidas(arvoreId: number, db: DB = prisma): Promise<DivergenciaResolvida[]> {
  const [logs, desfeitos] = await Promise.all([
    db.logAuditoria.findMany({
      where: { acao: ACAO_SINCRONIZACAO, detalhes: { path: ["arvoreId"], equals: arvoreId } }, orderBy: { criadoEm: "desc" }, take: 200,
      select: { id: true, criadoEm: true, detalhes: true, usuario: { select: { nome: true } } },
    }),
    db.logAuditoria.findMany({ where: { acao: ACAO_SINCRONIZACAO_DESFEITA, detalhes: { path: ["arvoreId"], equals: arvoreId } }, select: { detalhes: true } }),
  ])
  const desfeitaIds = new Set(desfeitos.map((l) => Number(((l.detalhes ?? {}) as Record<string, unknown>).logId)))
  const vistos = new Set<string>()
  const r: DivergenciaResolvida[] = []
  for (const l of logs) {
    const d = (l.detalhes ?? {}) as Record<string, unknown>
    if (d.divergenciaResolvida !== true) continue
    const chave = `${d.alvo}:${d.alvoId}:${d.chave}:${d.depois}:${d.antes}` // o mesmo fato escrito uma vez por processo da árvore: uma linha só
    if (vistos.has(chave)) continue
    vistos.add(chave)
    const campo = campoDaChave(String(d.chave)) as CampoSincronizavel | null
    r.push({
      logId: l.id, quando: l.criadoEm.toISOString(), quem: l.usuario?.nome ?? null, pessoaId: typeof d.pessoaId === "number" ? d.pessoaId : null,
      pessoaNome: typeof d.pessoaNome === "string" ? d.pessoaNome : null, rotulo: String(d.rotulo ?? campo?.rotulo ?? d.chave),
      antes: d.antes == null ? null : campo ? mostrarValor(campo, String(d.antes)) : String(d.antes), depois: campo ? mostrarValor(campo, String(d.depois)) : String(d.depois),
      desfeita: desfeitaIds.has(l.id),
    })
  }
  return r
}

/** Os valores que a árvore tem HOJE para os campos da certidão (a tela da certidão compara com o que o usuário digita). */
export async function valoresDaArvoreParaDocumento(documentoId: number, db: DB = prisma): Promise<{ evento: EventoRegistral | null; pessoaNome: string | null; campos: Array<{ chave: string; rotulo: string; origem: string; tipo: "data" | "texto"; arvore: string | null }> }> {
  const doc = await db.documento.findUnique({ where: { id: documentoId }, select: { tipo: true, documentType: { select: { legacyEnumKey: true } }, pessoaId: true, necessidade: { select: { uniaoId: true } }, pessoa: { select: { nome: true, sobrenome: true } } } })
  const evento = eventoDoTipoDeDocumento(doc?.tipo) ?? eventoDoTipoDeDocumento(doc?.documentType?.legacyEnumKey)
  if (!doc || !evento) return { evento: null, pessoaNome: null, campos: [] }
  const atual = evento === "CASAMENTO"
    ? (doc.necessidade?.uniaoId != null ? await db.uniao.findUnique({ where: { id: doc.necessidade.uniaoId } }) : null)
    : await db.pessoa.findUnique({ where: { id: doc.pessoaId } })
  const campos = CAMPOS_SINCRONIZAVEIS.filter((c) => c.evento === evento).map((c) => {
    const v = atual ? ((atual as unknown as Record<string, unknown>)[c.coluna] as Date | string | null | undefined) : null
    const arvore = v == null ? null : c.tipo === "data" ? (v instanceof Date ? v.toISOString().slice(0, 10) : null) : (String(v).trim() || null)
    return { chave: c.chave, rotulo: c.rotulo, origem: c.origem, tipo: c.tipo, arvore }
  })
  return { evento, pessoaNome: doc.pessoa ? nomeDe(doc.pessoa) : null, campos }
}

/**
 * A árvore NÃO edita campo que veio do registro (sentido único). Devolve os rótulos dos campos TRAVADOS que o corpo da edição tenta MUDAR
 * (valor igual ao de hoje passa: a tela reenvia o formulário inteiro). `null` = pode gravar. Corrige-se nos Dados Registrais da certidão.
 */
export async function edicaoRecusadaPorRegistro(alvo: "PESSOA" | "UNIAO", alvoId: number, corpo: Record<string, unknown>, db: DB = prisma): Promise<string[] | null> {
  const colunas = CAMPOS_SINCRONIZAVEIS.filter((c) => c.alvo === alvo && corpo[c.coluna] !== undefined)
  if (colunas.length === 0) return null
  const atual = alvo === "PESSOA"
    ? await db.pessoa.findUnique({ where: { id: alvoId } })
    : await db.uniao.findUnique({ where: { id: alvoId }, include: { pessoa1: { select: { arvoreId: true } } } })
  if (!atual) return null
  const arvoreId = alvo === "PESSOA" ? (atual as { arvoreId: number | null }).arvoreId : (atual as { pessoa1: { arvoreId: number | null } }).pessoa1.arvoreId
  if (arvoreId == null) return null
  const travados = await camposDoRegistro(arvoreId, db)
  const chaves = new Set((alvo === "PESSOA" ? travados.pessoas[alvoId] : travados.unioes[alvoId]) ?? [])
  const recusados: string[] = []
  for (const c of colunas) {
    if (!chaves.has(c.chave)) continue
    const novo = c.tipo === "data" ? diaDe(corpo[c.coluna] as string | Date | null) : textoDe(corpo[c.coluna] as string | null)
    const hoje = c.tipo === "data" ? diaDe((atual as unknown as Record<string, Date | null>)[c.coluna]) : textoDe((atual as unknown as Record<string, string | null>)[c.coluna])
    const igual = c.tipo === "data" ? novo === hoje : mesmoTexto(novo, hoje)
    if (!igual) recusados.push(c.rotulo)
  }
  return recusados.length ? recusados : null
}


// ─── CASOS ANTIGOS (08/10/2026): a Genealogia prevalece ─────────────────────────────────────────────────────────────────────────
export interface LinhaDoRelatorio {
  processoId: number
  familia: string
  certidao: string
  pessoa: string
  documentoId: number
  alvo: "PESSOA" | "UNIAO"
  alvoId: number
  chave: string
  campo: string
  tipo: TipoDeDiferenca
  arvore: string | null
  genealogia: string
  arvoreTexto: string
  genealogiaTexto: string
  /** Preenchido nas listas que NÃO são gravadas. */
  motivo?: string
}
export interface RelatorioDeCasosAntigos {
  geradoEm: string
  aplicar: LinhaDoRelatorio[]
  ambiguos: LinhaDoRelatorio[]
  revisaoManual: LinhaDoRelatorio[]
}

/** SÓ LEITURA. Todo campo em que a árvore difere da Genealogia (e a Genealogia tem valor) nos processos ativos, separado em: aplicar · inválidos (data impossível, lixo) · revisão manual (texto único que não separa). A GENEALOGIA SEMPRE PREVALECE (decisão do Marco, 08/10/2026): conflito, texto quase igual e local do óbito entram em «aplicar» como qualquer outro campo. */
export async function relatorioDeCasosAntigos(db: DB = prisma): Promise<RelatorioDeCasosAntigos> {
  const processos = await db.processo.findMany({ where: { dataConclusao: null, arvoreId: { not: null }, NOT: { faseAtualKey: "finalizado" } }, select: { id: true, nome: true, arvoreId: true } })
  const r: RelatorioDeCasosAntigos = { geradoEm: new Date().toISOString(), aplicar: [], ambiguos: [], revisaoManual: [] }
  for (const pr of processos) {
    const c = await carregarContexto(db, { arvoreId: pr.arvoreId! })
    const tipos = new Map((await db.documento.findMany({ where: { id: { in: c.registros.map((x) => x.documentoId) } }, select: { id: true, documentType: { select: { name: true } } } })).map((d) => [d.id, d.documentType?.name ?? "Certidão"]))
    const base = (i: ItemDeSincronizacao): LinhaDoRelatorio => ({
      processoId: pr.id, familia: pr.nome, certidao: tipos.get(i.documentoId) ?? "Certidão", pessoa: i.pessoaNome, documentoId: i.documentoId, alvo: i.alvo, alvoId: i.alvoId, chave: i.chave, campo: i.rotulo, tipo: i.tipo,
      arvore: i.arvore, genealogia: i.registro, arvoreTexto: i.arvoreTexto, genealogiaTexto: i.registroTexto,
    })
    for (const reg of c.registros) for (const motivo of reg.revisaoManual ?? []) {
      const p = c.pessoas.get(reg.pessoaId)
      r.revisaoManual.push({ processoId: pr.id, familia: pr.nome, certidao: tipos.get(reg.documentoId) ?? "Certidão", pessoa: p ? nomeDe(p) : `Pessoa #${reg.pessoaId}`, documentoId: reg.documentoId, alvo: reg.evento === "CASAMENTO" ? "UNIAO" : "PESSOA", alvoId: reg.uniaoId ?? reg.pessoaId, chave: "cidade_registro", campo: "cidade do registro (texto único)", tipo: "CONFLITO", arvore: null, genealogia: "", arvoreTexto: "—", genealogiaTexto: "", motivo })
    }
    for (const i of calcularItens(c, true)) {
      const linha = base(i)
      const campo = campoDaChave(i.chave)!
      const reg = c.registros.find((x) => x.documentoId === i.documentoId)
      let suspeita = suspeitaNoValorDoRegistro(campo, i.registro)
      if (!suspeita && i.chave === "UNIAO.data_registro" && reg && registroAnteriorAoEvento(diaDe(reg.valores.data_evento), i.registro)) suspeita = "data do registro anterior à data do evento"
      if (suspeita) { r.ambiguos.push({ ...linha, motivo: suspeita }); continue }
      r.aplicar.push(linha)
    }
  }
  return r
}

/** Aplica UM lote do relatório (uma árvore por vez, limitado às linhas dadas) e devolve quantos campos gravou. Histórico com o valor antigo (reversível pelo «Desfazer»). */
export async function aplicarLoteDeCasosAntigos(arvoreId: number, linhas: ReadonlyArray<Pick<LinhaDoRelatorio, "alvo" | "alvoId" | "chave">>, autorId: number | null = null): Promise<number> {
  const selecao = new Set(linhas.map((l) => `${l.alvo}:${l.alvoId}:${l.chave}`))
  const r = await sincronizarArvore({ arvoreId, autorId, origem: "CASOS_ANTIGOS", selecao })
  return r.aplicados.length
}
