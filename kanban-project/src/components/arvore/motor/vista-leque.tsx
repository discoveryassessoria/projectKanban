// src/components/arvore/motor/vista-leque.tsx
//
// VISUALIZAÇÃO EM LEQUE — gerações concêntricas.
//
// Reconstrução própria (SVG + trigonometria, sem biblioteca e sem ativo de
// terceiro) da leitura em leque: o requerente no miolo e cada anel uma geração
// de ascendentes, pai sempre no mesmo lado da mãe. É a única vista em que se vê
// A LINHA INTEIRA de uma vez e se percebe, de relance, de que lado a árvore
// está vazia — a pergunta que abre todo trabalho de pesquisa.
//
// Estrutura: o ascendente na posição i da geração g tem o pai em (g+1, 2i) e a
// mãe em (g+1, 2i+1). É o mesmo endereçamento da numeração Sosa-Stradonitz que
// a genealogia usa desde sempre, então o desenho e o número batem.
//
// Setor vazio não é omitido: ele aparece apagado e clicável, porque "aqui falta
// um ascendente" é informação de trabalho, não ausência de desenho.

"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { GrafoGenealogico } from "@/src/lib/genealogia/motor/grafo"
import type { AnaliseArvore } from "@/src/lib/genealogia/motor/tipos"
import { anoDe, nomeCompleto } from "@/src/lib/genealogia/motor/texto"
import type { PessoaArvore } from "../types"
import {
  corGenero,
  EASE,
  PAIS_LINHA,
  SEVERIDADE_COR,
  TONS_COMPLETUDE,
  TONS_GERACAO,
  TREE,
} from "./tokens"
import { useViewport } from "./use-viewport"

/**
 * Como pintar os setores.
 *
 * O leque é a única vista em que a cor carrega informação de verdade, porque
 * são centenas de setores minúsculos e nenhum deles cabe texto suficiente. Cada
 * modo responde a uma pergunta diferente, e é o operador que escolhe qual:
 *   gênero      → leitura estrutural (lado paterno × materno)
 *   geração     → profundidade alcançada em cada ramo
 *   linha       → onde passa a transmissão da cidadania
 *   completude  → onde a pesquisa está fraca (o mapa de calor do trabalho)
 */
export type CorLeque = "linhas" | "nascimento" | "documental" | "pesquisa"

/**
 * Opções de exibição do leque, espelhando as da referência (lá: Family Lines,
 * Birth Place, Sources, Stories, Photos, Research Helps).
 *
 * As três primeiras têm equivalente direto. "Sources" vira DOCUMENTAL, que é a
 * fonte oficial equivalente no Discovery (o Sistema Documental); "Research
 * Helps" vira PENDÊNCIAS DE PESQUISA, que é o que o motor genealógico produz.
 * "Stories" e "Photos" não existem no domínio do Discovery e por isso não têm
 * entrada — em vez de uma opção que não muda nada na tela.
 */
export const CORES_LEQUE: Array<{ id: CorLeque; rotulo: string }> = [
  { id: "linhas", rotulo: "Linhas familiares" },
  { id: "nascimento", rotulo: "Local de nascimento" },
  { id: "documental", rotulo: "Situação documental" },
  { id: "pesquisa", rotulo: "Pendências de pesquisa" },
]

export interface VistaLequeProps {
  grafo: GrafoGenealogico
  analise: AnaliseArvore
  pessoasPorId: Map<number, PessoaArvore>
  raizId: number | null
  selecionadaId: number | null
  paisAlvo: string | null
  geracoes: number
  colorirPor: CorLeque
  aoSelecionar: (p: PessoaArvore) => void
  /** Duplo clique num setor externo re-enraíza o leque naquela pessoa. */
  aoReenraizar: (id: number) => void
  aoAdicionarPai?: (id: number) => void
  aoAdicionarMae?: (id: number) => void
}

interface Setor {
  /** Endereço Sosa: geração e índice dentro dela. */
  g: number
  i: number
  pessoaId: number | null
  /** De quem este setor é ascendente (para o "+" saber onde ancorar). */
  filhoId: number | null
  /** true = este setor é o pai; false = a mãe. */
  ehPai: boolean
  a0: number
  a1: number
  r0: number
  r1: number
}

const RAIO_MIOLO = 58
const LARGURA_ANEL = [58, 54, 50, 44, 38, 34, 30, 28]
const GRAUS = Math.PI / 180

function larguraDoAnel(g: number): number {
  return LARGURA_ANEL[Math.min(g, LARGURA_ANEL.length - 1)] ?? 28
}

function raioInterno(g: number): number {
  let r = RAIO_MIOLO
  for (let k = 1; k < g; k++) r += larguraDoAnel(k)
  return r
}

/** Caminho de um setor de anel (arco externo, arco interno, fechado). */
function caminhoSetor(cx: number, cy: number, s: Setor): string {
  const { a0, a1, r0, r1 } = s
  const grande = a1 - a0 > 180 ? 1 : 0
  const p = (raio: number, ang: number) => ({
    x: cx + raio * Math.cos(ang * GRAUS),
    y: cy + raio * Math.sin(ang * GRAUS),
  })
  const ext0 = p(r1, a0)
  const ext1 = p(r1, a1)
  const int1 = p(r0, a1)
  const int0 = p(r0, a0)
  return [
    `M ${ext0.x} ${ext0.y}`,
    `A ${r1} ${r1} 0 ${grande} 1 ${ext1.x} ${ext1.y}`,
    `L ${int1.x} ${int1.y}`,
    `A ${r0} ${r0} 0 ${grande} 0 ${int0.x} ${int0.y}`,
    "Z",
  ].join(" ")
}

export const VistaLeque = memo(function VistaLeque({
  grafo,
  analise,
  pessoasPorId,
  raizId,
  selecionadaId,
  paisAlvo,
  geracoes,
  colorirPor,
  aoSelecionar,
  aoReenraizar,
  aoAdicionarPai,
  aoAdicionarMae,
}: VistaLequeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mundoRef = useRef<HTMLDivElement>(null)
  const [hoverId, setHoverId] = useState<number | null>(null)

  const { api } = useViewport({ alvoRef: mundoRef, containerRef })

  // ---------- setores ----------
  const setores = useMemo(() => {
    if (raizId == null) return []
    const lista: Setor[] = []
    // Endereço → pessoa. A geração 0 é o miolo e não vira setor de anel.
    const porEndereco = new Map<string, number>()
    porEndereco.set("0:0", raizId)

    for (let g = 1; g <= geracoes; g++) {
      const total = 2 ** g
      const passo = 360 / total
      const r0 = raioInterno(g)
      const r1 = r0 + larguraDoAnel(g)

      for (let i = 0; i < total; i++) {
        const chaveFilho = `${g - 1}:${Math.floor(i / 2)}`
        const filhoId = porEndereco.get(chaveFilho) ?? null
        const ehPai = i % 2 === 0
        const pessoaId =
          filhoId != null
            ? ehPai
              ? (grafo.pessoa(filhoId)?.paiId ?? null)
              : (grafo.pessoa(filhoId)?.maeId ?? null)
            : null
        const valido = pessoaId != null && grafo.existe(pessoaId) ? pessoaId : null
        if (valido != null) porEndereco.set(`${g}:${i}`, valido)

        // -90° põe a primeira geração no topo, pai à esquerda do eixo — a
        // convenção de leitura de leque impressa.
        const a0 = -90 + i * passo
        lista.push({ g, i, pessoaId: valido, filhoId, ehPai, a0, a1: a0 + passo, r0, r1 })
      }
    }
    return lista
  }, [grafo, raizId, geracoes])

  const raioMaximo = useMemo(() => raioInterno(geracoes) + larguraDoAnel(geracoes), [geracoes])
  const lado = raioMaximo * 2 + 40
  const centro = lado / 2

  // ---------- enquadramento ----------
  useEffect(() => {
    const t = requestAnimationFrame(() =>
      api.enquadrar({ x: 0, y: 0, largura: lado, altura: lado }, 0.06, { imediato: true }),
    )
    return () => cancelAnimationFrame(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lado])

  const destacados = useMemo(() => {
    const alvo = hoverId ?? selecionadaId
    if (alvo == null) return null
    const s = new Set<number>([alvo])
    grafo.ancestrais(alvo).forEach((id) => s.add(id))
    return s
  }, [grafo, hoverId, selecionadaId])

  const linha = useMemo(() => new Set(analise.linhaCidadania), [analise.linhaCidadania])
  const corLinha = paisAlvo ? PAIS_LINHA[paisAlvo]?.cor : null

  const clicar = useCallback(
    (id: number) => {
      const p = pessoasPorId.get(id)
      if (p) aoSelecionar(p)
    },
    [pessoasPorId, aoSelecionar],
  )

  const raiz = raizId != null ? pessoasPorId.get(raizId) : null

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden outline-none"
      style={{ background: TREE.fundo, cursor: "grab", touchAction: "none" }}
      tabIndex={0}
      role="application"
      aria-label="Leque de gerações — cada anel é uma geração de ascendentes"
    >
      {/* data-leque-mundo: âncora usada pela exportação em PDF. Sem ela o botão
          de exportar ficaria morto justamente nesta vista. */}
      <div
        ref={mundoRef}
        data-leque-mundo
        data-largura={lado}
        data-altura={lado}
        className="absolute left-0 top-0"
        style={{ transformOrigin: "0 0", willChange: "transform" }}
      >
        <svg width={lado} height={lado} viewBox={`0 0 ${lado} ${lado}`} style={{ display: "block" }}>
          <g>
            {setores.map((s) => (
              <SetorLeque
                key={`${s.g}:${s.i}`}
                setor={s}
                cx={centro}
                cy={centro}
                grafo={grafo}
                analise={analise}
                selecionada={s.pessoaId != null && s.pessoaId === selecionadaId}
                destacado={destacados != null && s.pessoaId != null && destacados.has(s.pessoaId)}
                temDestaque={destacados != null}
                naLinha={s.pessoaId != null && linha.has(s.pessoaId)}
                corLinha={corLinha}
                colorirPor={colorirPor}
                aoEntrar={setHoverId}
                aoClicar={clicar}
                aoReenraizar={aoReenraizar}
                aoAdicionarPai={aoAdicionarPai}
                aoAdicionarMae={aoAdicionarMae}
              />
            ))}
          </g>

          {/* miolo — a pessoa raiz */}
          <g
            onClick={() => raizId != null && clicar(raizId)}
            style={{ cursor: raizId != null ? "pointer" : "default" }}
          >
            <circle
              cx={centro}
              cy={centro}
              r={RAIO_MIOLO}
              fill={TREE.cartao}
              stroke={selecionadaId != null && selecionadaId === raizId ? TREE.acento : TREE.cartaoBordaForte}
              strokeWidth={selecionadaId != null && selecionadaId === raizId ? 2.5 : 1.2}
            />
            {raiz && (
              <>
                <text
                  x={centro}
                  y={centro - 4}
                  textAnchor="middle"
                  style={{ fontSize: 12, fontWeight: 600, fill: TREE.texto }}
                >
                  {cortar(raiz.nome, 14)}
                </text>
                <text
                  x={centro}
                  y={centro + 10}
                  textAnchor="middle"
                  style={{ fontSize: 11, fontWeight: 600, fill: TREE.texto }}
                >
                  {cortar(raiz.sobrenome || "", 14)}
                </text>
                <text
                  x={centro}
                  y={centro + 25}
                  textAnchor="middle"
                  style={{ fontSize: 10, fill: TREE.textoFraco }}
                >
                  {periodo(raiz)}
                </text>
              </>
            )}
          </g>
        </svg>
      </div>
    </div>
  )
})

const SetorLeque = memo(function SetorLeque({
  setor,
  cx,
  cy,
  grafo,
  analise,
  selecionada,
  destacado,
  temDestaque,
  naLinha,
  corLinha,
  colorirPor,
  aoEntrar,
  aoClicar,
  aoReenraizar,
  aoAdicionarPai,
  aoAdicionarMae,
}: {
  setor: Setor
  cx: number
  cy: number
  grafo: GrafoGenealogico
  analise: AnaliseArvore
  selecionada: boolean
  destacado: boolean
  temDestaque: boolean
  naLinha: boolean
  corLinha: string | null | undefined
  colorirPor: CorLeque
  aoEntrar: (id: number | null) => void
  aoClicar: (id: number) => void
  aoReenraizar: (id: number) => void
  aoAdicionarPai?: (id: number) => void
  aoAdicionarMae?: (id: number) => void
}) {
  const pessoa = setor.pessoaId != null ? grafo.pessoa(setor.pessoaId) : null
  const vazio = pessoa == null
  const genero = corGenero(pessoa?.sexo ?? (setor.ehPai ? "M" : "F"))
  const a = analise.porPessoa.get(setor.pessoaId ?? -1)
  const severidade = a?.severidadeMax

  const meio = (setor.a0 + setor.a1) / 2
  const rMedio = (setor.r0 + setor.r1) / 2

  // Preenchimento conforme o modo escolhido. Em todos eles o tom é claro: o
  // nome tem de continuar legível por cima, e leque saturado vira vitral.
  const preenchimento = vazio
    ? TREE.vazio
    : colorirPor === "linhas"
      ? // Linhas familiares: um tom por quadrante (avô paterno, avó paterna,
        // avô materno, avó materna) — é assim que se lê "de que linha vem".
        TONS_GERACAO[quadrante(setor) % TONS_GERACAO.length]
      : colorirPor === "nascimento"
        ? pessoa?.local_nasc
          ? TONS_GERACAO[hashTom(pessoa.local_nasc) % TONS_GERACAO.length]
          : TREE.branco
        : colorirPor === "documental"
          ? naLinha && corLinha
            ? `color-mix(in srgb, ${corLinha} 18%, ${TREE.branco})`
            : TREE.branco
          : tomCompletude(a?.completude ?? null)
  const contorno = selecionada ? TREE.acento : naLinha && corLinha ? corLinha : TREE.cartaoBorda
  const espessura = selecionada ? 2.2 : naLinha ? 1.6 : 0.9

  const rotulo = pessoa
    ? `${nomeCompleto(pessoa)} · ${periodo(pessoa)}${naLinha ? " · na linha de cidadania" : ""}`
    : `${setor.ehPai ? "Pai" : "Mãe"} não cadastrado(a) — geração ${setor.g}`

  const podeAdicionar =
    vazio && setor.filhoId != null && (setor.ehPai ? !!aoAdicionarPai : !!aoAdicionarMae)

  const aoAtivar = () => {
    if (pessoa) aoClicar(pessoa.id)
    else if (podeAdicionar && setor.filhoId != null) {
      if (setor.ehPai) aoAdicionarPai?.(setor.filhoId)
      else aoAdicionarMae?.(setor.filhoId)
    }
  }

  return (
    <g
      role="button"
      tabIndex={-1}
      aria-label={rotulo}
      onClick={aoAtivar}
      onDoubleClick={() => pessoa && aoReenraizar(pessoa.id)}
      onPointerEnter={() => aoEntrar(setor.pessoaId)}
      onPointerLeave={() => aoEntrar(null)}
      style={{
        cursor: pessoa || podeAdicionar ? "pointer" : "default",
        opacity: temDestaque && !destacado && !vazio ? 0.38 : 1,
        transition: `opacity 200ms ${EASE.suave}`,
      }}
    >
      <title>{rotulo}</title>
      <path
        d={caminhoSetor(cx, cy, setor)}
        fill={preenchimento}
        stroke={contorno}
        strokeWidth={espessura}
        style={{ transition: `fill 180ms ${EASE.rapido}, stroke 180ms ${EASE.rapido}` }}
      />

      {/* Marca discreta de problema — um ponto, nunca um ícone dentro do setor */}
      {severidade === "critico" || severidade === "alto" ? (
        <circle
          cx={cx + (setor.r1 - 6) * Math.cos(meio * GRAUS)}
          cy={cy + (setor.r1 - 6) * Math.sin(meio * GRAUS)}
          r={2.4}
          fill={SEVERIDADE_COR[severidade]}
        />
      ) : null}

      {pessoa ? (
        <TextoSetor
          cx={cx}
          cy={cy}
          angulo={meio}
          raio={rMedio}
          geracao={setor.g}
          largura={setor.r1 - setor.r0}
          nome={nomeCompleto(pessoa)}
          anos={periodo(pessoa)}
        />
      ) : podeAdicionar ? (
        <text
          x={cx + rMedio * Math.cos(meio * GRAUS)}
          y={cy + rMedio * Math.sin(meio * GRAUS)}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: 13, fill: TREE.textoSuave, fontWeight: 600 }}
        >
          +
        </text>
      ) : null}
    </g>
  )
})

/**
 * Texto do setor.
 *
 * Gerações internas têm arco largo e pouca profundidade: o texto corre TANGENTE
 * ao anel. Gerações externas invertem a proporção: o texto corre RADIAL, saindo
 * do centro. Sem essa troca, ou o nome não cabe, ou fica de cabeça para baixo —
 * os dois defeitos clássicos de leque mal desenhado.
 */
function TextoSetor({
  cx,
  cy,
  angulo,
  raio,
  geracao,
  largura,
  nome,
  anos,
}: {
  cx: number
  cy: number
  angulo: number
  raio: number
  geracao: number
  largura: number
  nome: string
  anos: string
}) {
  const x = cx + raio * Math.cos(angulo * GRAUS)
  const y = cy + raio * Math.sin(angulo * GRAUS)
  const radial = geracao >= 3

  if (radial) {
    // Lado esquerdo do círculo: gira 180° para o nome nunca ficar invertido.
    const inverter = angulo > 90 || angulo < -90
    const rot = inverter ? angulo + 180 : angulo
    const tamanho = geracao >= 6 ? 7.5 : geracao >= 5 ? 8.5 : 9.5
    const maximo = Math.max(6, Math.floor(largura / (tamanho * 0.52)))
    return (
      <text
        transform={`translate(${x} ${y}) rotate(${rot})`}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fontSize: tamanho, fill: TREE.texto, pointerEvents: "none" }}
      >
        {cortar(nome, maximo)}
      </text>
    )
  }

  // Texto TANGENTE ao anel. No hemisfério de baixo (0° < ângulo < 180°, com y
  // crescendo para baixo no SVG) a rotação natural deixa o nome DE CABEÇA PARA
  // BAIXO — foi o que aconteceu com os setores inferiores. Girar meia volta ali
  // devolve a leitura, e a ordem das duas linhas (nome em cima, anos embaixo)
  // acompanha o giro.
  const invertido = angulo > 0 && angulo < 180
  const rot = invertido ? angulo - 90 : angulo + 90
  const tamanho = geracao === 1 ? 11 : 10
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} style={{ pointerEvents: "none" }}>
      <text
        textAnchor="middle"
        dy={anos ? (invertido ? 9 : -4) : 3}
        style={{ fontSize: tamanho, fontWeight: 600, fill: TREE.texto }}
      >
        {cortar(nome, geracao === 1 ? 22 : 16)}
      </text>
      {anos && (
        <text
          textAnchor="middle"
          dy={invertido ? -4 : 9}
          style={{ fontSize: tamanho - 2, fill: TREE.textoFraco }}
        >
          {anos}
        </text>
      )}
    </g>
  )
}

/**
 * Tom por completude. Escala de UM matiz (nunca verde→vermelho): a diferença
 * tem de ser legível também por quem não distingue matiz, então o que varia é a
 * saturação, e o número exato continua disponível no cartão rápido.
 */
function tomCompletude(valor: number | null): string {
  if (valor == null) return TREE.vazio
  if (valor >= 90) return TONS_COMPLETUDE.alta
  if (valor >= 70) return TONS_COMPLETUDE.boa
  if (valor >= 50) return TONS_COMPLETUDE.media
  if (valor >= 30) return TONS_COMPLETUDE.baixa
  return TONS_COMPLETUDE.critica
}

/**
 * Quadrante da linha familiar: 0..3 conforme o ramo de bisavós a que o setor
 * pertence. Deriva do índice Sosa — não precisa de dado extra nenhum.
 */
function quadrante(s: Setor): number {
  if (s.g <= 1) return s.i
  const total = 2 ** s.g
  return Math.floor((s.i * 4) / total)
}

/** Tom estável por texto — mesmo lugar, mesma cor, sempre. */
function hashTom(v: string): number {
  let h = 0
  for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) >>> 0
  return h
}

function periodo(p: { data_nasc?: Date | string | null; data_obito?: Date | string | null }): string {
  const n = anoDe(p.data_nasc)
  const o = anoDe(p.data_obito)
  if (n && o) return `${n}–${o}`
  if (n) return String(n)
  if (o) return `–${o}`
  return ""
}

function cortar(v: string, maximo: number): string {
  if (v.length <= maximo) return v
  return `${v.slice(0, Math.max(1, maximo - 1))}…`
}
