// src/lib/genealogia/navegacao/foco.ts
//
// FOCO DA ÁRVORE — o que fica em pleno, o que recua, o que sai da tela.
//
// Este módulo é PURO: recebe grafo + linhagem + preferências e devolve um estado
// por pessoa. Ele não desenha, não mede pixel e não move card. Quem aplica é o
// canvas, e o único efeito que ele aplica é opacidade (ou remoção do nó) — cor,
// tipografia, dimensão e posição continuam sendo as do layout aprovado.
//
// Por que existem DOIS estilos (ocultar / esmaecer) em vez de um "melhor":
//
//   • ESMAECER preserva a referência espacial. O operador que passou dez minutos
//     construindo o mapa mental da árvore não o perde ao entrar no modo linhagem
//     — o ramo continua ali, apagado. É o padrão.
//   • OCULTAR é o que uma árvore de 400 pessoas exige para caber na tela. Custa
//     a referência espacial, mas devolve a leitura.
//
// A escolha é do usuário. O que NÃO é opcional: sair do modo devolve tudo, na
// mesma hora e no mesmo lugar. Por isso o foco nunca toca a topologia nem as
// posições salvas — ele é uma CAMADA sobre o layout, descartável.
//
// Recolhimento de ramo: irmandades grandes são o que mais polui. Quando um casal
// tem muitos filhos e quase nenhum deles participa de alguma linha, o foco
// recolhe os que não participam num grupo "+N irmãos". Quem participa NUNCA é
// recolhido — recolher alguém da linha seria esconder trabalho.

import type { GrafoGenealogico } from "../motor/grafo"
import type { Linhagem, MapaLinhagens } from "../motor/linhagens"

export type ModoFoco = "todos" | "linhagem"
export type EstiloFoco = "esmaecer" | "ocultar"

/** Estado visual de uma pessoa no canvas. */
export type EstadoFoco = "pleno" | "esmaecido" | "oculto"

/** Opacidade aplicada a quem recua. ~20%, como pedido. */
export const OPACIDADE_ESMAECIDA = 0.2

/**
 * A partir de quantos irmãos fora da linha o grupo vira recolhível.
 * Abaixo disso recolher custa mais atenção (um "+2" para clicar) do que devolve
 * em espaço.
 */
export const MINIMO_PARA_RECOLHER = 4

export interface GrupoRecolhivel {
  /** Chave estável: pai:mãe do grupo. Sobrevive a recarregamento. */
  chave: string
  /** Pessoa a partir de quem o grupo pendura (o pai, ou a mãe se não há pai). */
  ancoraId: number
  /** Ids que o grupo recolhe. Nunca inclui quem está em alguma linha. */
  membros: number[]
  /** "+18 irmãos" — já pronto, sem a UI reinventar plural. */
  rotulo: string
}

export interface PreferenciasFoco {
  modo: ModoFoco
  estilo: EstiloFoco
  /** Chaves de grupos que o usuário EXPANDIU (o padrão é recolhido). */
  gruposExpandidos: ReadonlySet<string>
  /** Realce de filtro/busca: quem casa fica em pleno mesmo fora da linhagem. */
  realcados?: ReadonlySet<number>
  /** Nunca recua: a pessoa aberta no painel continua legível. */
  fixados?: ReadonlySet<number>
}

export function preferenciasPadrao(): PreferenciasFoco {
  return { modo: "todos", estilo: "esmaecer", gruposExpandidos: new Set() }
}

export interface ResultadoFoco {
  estados: Map<number, EstadoFoco>
  /** Grupos que o canvas deve substituir por um nó "+N". */
  gruposAtivos: GrupoRecolhivel[]
  /** Quantas pessoas recuaram — a UI diz isso em voz alta, sem fingir cobertura. */
  totalRecuado: number
  totalPleno: number
}

/**
 * Grupos recolhíveis de uma árvore, dada a linhagem em foco.
 *
 * Agrupa por CASAL (pai+mãe), não por pai: meio-irmãos de casais diferentes são
 * ramos diferentes e recolhê-los juntos misturaria duas famílias na mesma
 * etiqueta. Quem não tem nenhum dos dois pais na árvore não forma grupo — não há
 * âncora onde pendurar o "+N".
 */
export function gruposRecolhiveis(
  g: GrafoGenealogico,
  protegidos: ReadonlySet<number>,
): GrupoRecolhivel[] {
  const porCasal = new Map<string, { pai: number | null; mae: number | null; filhos: number[] }>()

  for (const p of g.pessoas) {
    const pai = p.paiId != null && g.existe(p.paiId) ? p.paiId : null
    const mae = p.maeId != null && g.existe(p.maeId) ? p.maeId : null
    if (pai == null && mae == null) continue
    const chave = `${pai ?? "-"}:${mae ?? "-"}`
    const grupo = porCasal.get(chave)
    if (grupo) grupo.filhos.push(p.id)
    else porCasal.set(chave, { pai, mae, filhos: [p.id] })
  }

  const grupos: GrupoRecolhivel[] = []
  // Ordem estável por chave: dois carregamentos da mesma árvore dão a mesma lista.
  for (const chave of [...porCasal.keys()].sort()) {
    const { pai, mae, filhos } = porCasal.get(chave)!
    const ancoraId = pai ?? mae
    if (ancoraId == null) continue

    // Quem está protegido (linha, cônjuge da linha, realçado, fixado) fica fora.
    // Recolher junto com o resto esconderia trabalho pendente.
    const membros = g
      .filhosOrdenados(filhos.filter((id) => !protegidos.has(id)))
      // Um filho que ancora descendência protegida também não pode sumir: sumir
      // com ele desconecta o neto que está na linha.
      .filter((id) => !temDescendenteProtegido(g, id, protegidos))

    if (membros.length < MINIMO_PARA_RECOLHER) continue

    grupos.push({
      chave,
      ancoraId,
      membros,
      rotulo: `+${membros.length} ${membros.length === 1 ? "irmão" : "irmãos"}`,
    })
  }

  return grupos
}

/**
 * Estado de foco de cada pessoa.
 *
 * Ordem de decisão (a primeira que casa vence):
 *   1. fixado ou realçado → pleno, sempre. Foi o usuário que pediu para ver.
 *   2. modo "todos" e sem grupo recolhido → pleno.
 *   3. membro de grupo recolhido → oculto.
 *   4. modo "linhagem" e fora da linha visível → esmaecido ou oculto, por estilo.
 */
export function calcularFoco(
  g: GrafoGenealogico,
  linhagem: Linhagem | null,
  prefs: PreferenciasFoco,
): ResultadoFoco {
  const realcados = prefs.realcados ?? new Set<number>()
  const fixados = prefs.fixados ?? new Set<number>()

  const protegidos = new Set<number>([...realcados, ...fixados])
  if (linhagem) for (const id of linhagem.visivel) protegidos.add(id)

  // RECOLHIMENTO SÓ NO MODO LINHAGEM.
  //
  // Recolher por padrão na vista normal mudaria o que o usuário vê ao abrir a
  // árvore — dezoito irmãos virariam um "+18" sem ele ter pedido nada. A vista
  // "todos" continua sendo, pessoa por pessoa, a árvore de sempre. O recolhimento
  // é resposta a um pedido explícito: "quero ver só esta linha".
  const grupos = prefs.modo === "linhagem" ? gruposRecolhiveis(g, protegidos) : []
  const gruposAtivos = grupos.filter((grupo) => !prefs.gruposExpandidos.has(grupo.chave))

  const recolhidos = new Set<number>()
  for (const grupo of gruposAtivos) for (const id of grupo.membros) recolhidos.add(id)

  const estados = new Map<number, EstadoFoco>()
  let totalPleno = 0
  let totalRecuado = 0

  for (const p of g.pessoas) {
    let estado: EstadoFoco = "pleno"

    if (fixados.has(p.id) || realcados.has(p.id)) {
      estado = "pleno"
    } else if (recolhidos.has(p.id)) {
      estado = "oculto"
    } else if (prefs.modo === "linhagem" && linhagem && !linhagem.visivel.has(p.id)) {
      estado = prefs.estilo === "ocultar" ? "oculto" : "esmaecido"
    }

    estados.set(p.id, estado)
    if (estado === "pleno") totalPleno++
    else totalRecuado++
  }

  return { estados, gruposAtivos, totalRecuado, totalPleno }
}

/** Opacidade correspondente a um estado. `oculto` não é desenhado. */
export function opacidadeDe(estado: EstadoFoco): number {
  return estado === "esmaecido" ? OPACIDADE_ESMAECIDA : 1
}

function temDescendenteProtegido(
  g: GrafoGenealogico,
  id: number,
  protegidos: ReadonlySet<number>,
): boolean {
  if (protegidos.size === 0) return false
  for (const d of g.descendentes(id)) if (protegidos.has(d)) return true
  return false
}

/**
 * Ids que devem entrar no enquadramento ao trocar de linhagem: a cadeia e os
 * cônjuges dela. Enquadrar a árvore inteira depois de filtrar seria devolver ao
 * usuário exatamente a poluição que ele acabou de tirar.
 */
export function idsParaEnquadrar(linhagem: Linhagem | null, mapa: MapaLinhagens): number[] {
  if (linhagem) return [...linhagem.visivel]
  return [...mapa.emAlgumaLinha]
}
