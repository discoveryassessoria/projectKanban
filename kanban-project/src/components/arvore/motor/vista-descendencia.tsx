// src/components/arvore/motor/vista-descendencia.tsx
//
// VISUALIZAÇÃO DE DESCENDÊNCIA — lista hierárquica, não grafo.
//
// Esta é uma diferença de EXPERIÊNCIA, não de estética, e é a razão de existir
// deste arquivo: descendência desenhada como grafo é ilegível. Cada geração
// multiplica a largura, e com quatro gerações o operador já está fazendo pan
// horizontal para ler nomes. A leitura correta de descendência é a de um
// sumário indentado — uma linha por pessoa, cada linha com o seu triângulo de
// expandir, geração por geração, rolando na vertical.
//
// Ganhos que só existem neste formato:
//   · comparar irmãos lado a lado (mesma coluna, uma linha embaixo da outra);
//   · varrer 200 descendentes com o olho, sem zoom;
//   · ver imediatamente ONDE a pesquisa parou (a coluna de sinais é uma só).
//
// Virtualização: a lista renderiza só a janela visível, então uma descendência
// de milhares de pessoas rola sem custo.

"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronRight, ChevronUp, FolderOpen, Lightbulb, AlertTriangle } from "lucide-react"
import type { GrafoGenealogico } from "@/src/lib/genealogia/motor/grafo"
import type { AnaliseArvore } from "@/src/lib/genealogia/motor/tipos"
import { anoDe, nomeCompleto } from "@/src/lib/genealogia/motor/texto"
import type { PessoaArvore } from "../types"
import { corGenero, EASE, INFO, PAIS_LINHA, SEVERIDADE_COR, TREE } from "./tokens"
import type { SituacaoDocumental } from "@/src/lib/genealogia/documental/indicadores"

export interface LinhaDescendencia {
  /**
   * O cônjuge ocupa LINHA PRÓPRIA, indentada sob a pessoa, com o rótulo
   * "Cônjuge" — e os filhos descem a partir dele. Espremer o cônjuge no fim da
   * linha da pessoa (como eu fazia) esconde de quem os filhos descem quando há
   * mais de uma união, que é justamente quando a informação importa.
   */
  tipo: "pessoa" | "conjuge"
  pessoaId: number
  /** Profundidade a partir da raiz (0 = a própria raiz). */
  nivel: number
  temFilhos: boolean
  expandida: boolean
  /** Cônjuge exibido na mesma linha, como na leitura impressa. */
  conjugeId: number | null
  quantosFilhos: number
}

export interface VistaDescendenciaProps {
  grafo: GrafoGenealogico
  analise: AnaliseArvore
  pessoasPorId: Map<number, PessoaArvore>
  raizId: number | null
  selecionadaId: number | null
  paisAlvo: string | null
  /** Ids com descendência recolhida — mesmo estado do canvas. */
  recolhidos: Set<number>
  /** Gerações mostradas — na referência, até 4. */
  geracoes: number
  /** Retratos podem ser desligados para caber mais gente na tela. */
  retratos: boolean
  aoAlternarRamo: (id: number) => void
  aoExpandirTudo: () => void
  aoSelecionar: (p: PessoaArvore) => void
  aoEnraizar: (id: number) => void
  parentescoDe?: (id: number) => string | null
  documentalDe?: (id: number) => { situacao: SituacaoDocumental; progresso: number | null; pendentes: number } | null
  aoAbrirPastaDocumental?: (id: number) => void
}

const ALTURA_LINHA = 40
const RECUO = 26
const MARGEM_VIRTUAL = 8

/**
 * Achata a descendência em linhas, respeitando o que está recolhido.
 *
 * Pura e determinística: mesma entrada, mesma lista. É o que permite testar a
 * vista sem DOM e virtualizar sem susto.
 */
export function montarLinhas(
  g: GrafoGenealogico,
  raizId: number | null,
  recolhidos: Set<number>,
  /** Gerações mostradas a partir da raiz. Na referência, até 4. */
  geracoes = 4,
  /** Rede contra filiação circular, que o motor de conflitos acusa à parte. */
  tetoProfundidade = 25,
): LinhaDescendencia[] {
  if (raizId == null || !g.existe(raizId)) return []

  const linhas: LinhaDescendencia[] = []
  // Ciclo de filiação é dado inconsistente que o motor de conflitos acusa; aqui
  // ele não pode virar laço infinito, então cada pessoa entra uma vez só.
  const visitados = new Set<number>()

  const limite = Math.max(1, Math.min(geracoes, tetoProfundidade))

  const caminhar = (id: number, nivel: number) => {
    if (visitados.has(id) || nivel > tetoProfundidade) return
    visitados.add(id)

    const filhos = g.filhosOrdenados(g.filhosIds(id))
    const conjuges = g.conjugesOrdenados(id)
    // No último nível a linha se declara RECOLHIDA (e não "sem filhos"): é o
    // que faz o triângulo continuar disponível para descer mais um degrau em
    // vez de mentir dizendo que a descendência acabou ali.
    const noLimite = nivel >= limite
    const expandida = !recolhidos.has(id) && !noLimite

    linhas.push({
      tipo: "pessoa",
      pessoaId: id,
      nivel,
      temFilhos: filhos.length > 0,
      expandida,
      conjugeId: conjuges[0] ?? null,
      quantosFilhos: filhos.length,
    })

    if (!expandida) return

    const conjuge = conjuges[0] ?? null
    if (conjuge != null && g.existe(conjuge)) {
      linhas.push({
        tipo: "conjuge",
        pessoaId: conjuge,
        nivel: nivel + 1,
        temFilhos: false,
        expandida: true,
        conjugeId: id,
        quantosFilhos: filhos.length,
      })
    }

    // Filhos descem do CASAL: um degrau abaixo do cônjuge quando ele existe.
    const nivelFilhos = conjuge != null ? nivel + 2 : nivel + 1
    for (const f of filhos) caminhar(f, nivelFilhos)
  }

  caminhar(raizId, 0)
  return linhas
}

export const VistaDescendencia = memo(function VistaDescendencia({
  grafo,
  analise,
  pessoasPorId,
  raizId,
  selecionadaId,
  paisAlvo,
  recolhidos,
  geracoes,
  retratos,
  aoAlternarRamo,
  aoExpandirTudo,
  aoSelecionar,
  aoEnraizar,
  parentescoDe,
  documentalDe,
  aoAbrirPastaDocumental,
}: VistaDescendenciaProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [altura, setAltura] = useState(0)

  const linhas = useMemo(
    () => montarLinhas(grafo, raizId, recolhidos, geracoes),
    [grafo, raizId, recolhidos, geracoes],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const medir = () => setAltura(el.clientHeight)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const inicio = Math.max(0, Math.floor(scroll / ALTURA_LINHA) - MARGEM_VIRTUAL)
  const fim = Math.min(
    linhas.length,
    Math.ceil((scroll + (altura || 800)) / ALTURA_LINHA) + MARGEM_VIRTUAL,
  )
  const janela = linhas.slice(inicio, fim)

  // Navegação por teclado equivalente à do canvas: setas percorrem a lista,
  // ←/→ recolhem e expandem — a gramática de qualquer árvore de arquivos.
  const indiceSelecionado = useMemo(
    () => linhas.findIndex((l) => l.pessoaId === selecionadaId),
    [linhas, selecionadaId],
  )

  const irPara = useCallback(
    (indice: number) => {
      const alvo = linhas[Math.max(0, Math.min(linhas.length - 1, indice))]
      if (!alvo) return
      const p = pessoasPorId.get(alvo.pessoaId)
      if (p) aoSelecionar(p)
      const el = containerRef.current
      if (el) {
        const topo = Math.max(0, Math.min(linhas.length - 1, indice)) * ALTURA_LINHA
        if (topo < el.scrollTop) el.scrollTo({ top: topo, behavior: "smooth" })
        else if (topo + ALTURA_LINHA > el.scrollTop + el.clientHeight) {
          el.scrollTo({ top: topo - el.clientHeight + ALTURA_LINHA, behavior: "smooth" })
        }
      }
    },
    [linhas, pessoasPorId, aoSelecionar],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable)) return
      if (indiceSelecionado < 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault()
        irPara(0)
        return
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          irPara(indiceSelecionado + 1)
          break
        case "ArrowUp":
          e.preventDefault()
          irPara(indiceSelecionado - 1)
          break
        case "ArrowRight": {
          const l = linhas[indiceSelecionado]
          if (l?.temFilhos && !l.expandida) {
            e.preventDefault()
            aoAlternarRamo(l.pessoaId)
          }
          break
        }
        case "ArrowLeft": {
          const l = linhas[indiceSelecionado]
          if (l?.temFilhos && l.expandida) {
            e.preventDefault()
            aoAlternarRamo(l.pessoaId)
          }
          break
        }
        default:
          break
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [indiceSelecionado, linhas, irPara, aoAlternarRamo])

  const linhaPais = paisAlvo ? PAIS_LINHA[paisAlvo] : null

  if (!linhas.length) {
    return (
      <div className="flex h-full w-full items-center justify-center" style={{ background: TREE.fundo }}>
        <p className="text-[12.5px]" style={{ color: TREE.textoFraco }}>
          Nenhuma descendência a partir desta pessoa.
        </p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-y-auto"
      style={{ background: TREE.fundo }}
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      role="tree"
      aria-label="Descendência — use as setas para percorrer, ← e → para recolher e expandir"
    >
      {/* EXPANDIR: abre tudo de uma vez. Numa descendência larga, abrir ramo a
          ramo para conferir se falta alguém é trabalho que a lista pode poupar. */}
      <div className="sticky top-0 z-10 px-3 py-2" style={{ background: TREE.fundo }}>
        <button
          type="button"
          onClick={aoExpandirTudo}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide arv-hover"
          style={{ color: INFO }}
        >
          <ChevronUp className="h-3.5 w-3.5" />
          Expandir
        </button>
      </div>
      {/* A lista tem largura de LEITURA, não de tela: linha de 1.600px com o
          nome no canto esquerdo obriga o olho a atravessar o vazio para
          alcançar a contagem de filhos do outro lado. */}
      <div
        style={{
          height: linhas.length * ALTURA_LINHA,
          position: "relative",
          maxWidth: 900,
        }}
      >
        {janela.map((l, i) => {
          const indice = inicio + i
          const pessoa = pessoasPorId.get(l.pessoaId)
          if (!pessoa) return null
          return (
            <Linha
              key={l.pessoaId}
              linha={l}
              topo={indice * ALTURA_LINHA}
              pessoa={pessoa}
              conjuge={l.conjugeId != null ? (pessoasPorId.get(l.conjugeId) ?? null) : null}
              analise={analise}
              selecionada={selecionadaId === l.pessoaId}
              corLinhaPais={linhaPais?.cor ?? null}
              retratos={retratos}
              parentesco={parentescoDe?.(l.pessoaId) ?? null}
              documental={documentalDe?.(l.pessoaId) ?? null}
              aoAlternar={() => aoAlternarRamo(l.pessoaId)}
              aoSelecionar={() => aoSelecionar(pessoa)}
              aoEnraizar={() => aoEnraizar(l.pessoaId)}
              aoAbrirPasta={aoAbrirPastaDocumental}
            />
          )
        })}
      </div>
    </div>
  )
})

const Linha = memo(function Linha({
  linha,
  topo,
  pessoa,
  conjuge,
  analise,
  selecionada,
  corLinhaPais,
  retratos,
  parentesco,
  documental,
  aoAlternar,
  aoSelecionar,
  aoEnraizar,
  aoAbrirPasta,
}: {
  linha: LinhaDescendencia
  topo: number
  pessoa: PessoaArvore
  conjuge: PessoaArvore | null
  analise: AnaliseArvore
  selecionada: boolean
  corLinhaPais: string | null
  retratos: boolean
  parentesco: string | null
  documental: { situacao: SituacaoDocumental; progresso: number | null; pendentes: number } | null
  aoAlternar: () => void
  aoSelecionar: () => void
  aoEnraizar: () => void
  aoAbrirPasta?: (id: number) => void
}) {
  const a = analise.porPessoa.get(pessoa.id)
  const genero = corGenero(pessoa.sexo)
  const nome = nomeCompleto(pessoa)
  const nasc = anoDe(pessoa.data_nasc)
  const obito = anoDe(pessoa.data_obito)
  const periodo = nasc || obito ? `${nasc ?? "?"}–${obito ?? (pessoa.vivo === false ? "?" : "")}` : ""
  const problema = a?.severidadeMax === "critico" || a?.severidadeMax === "alto"
  const naLinha = a?.naLinhaCidadania ?? false

  return (
    <div
      className="absolute left-0 right-0 flex items-center gap-1.5 pr-3 arv-hover"
      style={{
        top: topo,
        height: ALTURA_LINHA,
        paddingLeft: 8 + linha.nivel * RECUO,
        background: selecionada ? TREE.acentoSuave : "transparent",
        borderBottom: `1px solid ${TREE.cartaoBorda}`,
        transition: `background-color 140ms ${EASE.rapido}`,
      }}
      role="treeitem"
      aria-level={linha.nivel + 1}
      aria-expanded={linha.temFilhos ? linha.expandida : undefined}
      aria-selected={selecionada}
    >
      {/* Triângulo de expandir — o gesto padrão de qualquer sumário */}
      {linha.temFilhos ? (
        <button
          type="button"
          onClick={aoAlternar}
          title={
            linha.expandida
              ? `Recolher os ${linha.quantosFilhos} filho(s) de ${nome}`
              : `Expandir os ${linha.quantosFilhos} filho(s) de ${nome}`
          }
          aria-label={linha.expandida ? `Recolher ${nome}` : `Expandir ${nome}`}
          className="shrink-0 rounded p-0.5 arv-hover"
          style={{ color: TREE.textoFraco }}
        >
          {linha.expandida ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      ) : (
        <span className="h-[18px] w-[18px] shrink-0" aria-hidden />
      )}

      {/* Marca de linha de cidadania — filete vertical, mesma gramática do card */}
      <span
        aria-hidden
        className="h-5 w-[3px] shrink-0 rounded-full"
        style={{ background: naLinha && corLinhaPais ? corLinhaPais : "transparent" }}
      />

      {retratos && (
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
          style={{ background: genero.suave, border: `1px solid ${genero.linha}`, color: genero.tinta }}
        >
          {(pessoa.sexo || "?").charAt(0).toUpperCase()}
        </span>
      )}

      <button
        type="button"
        onClick={aoSelecionar}
        onDoubleClick={aoEnraizar}
        className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
        title={`${nome}${parentesco ? ` — ${parentesco} do requerente` : ""} · duplo clique: ver a árvore a partir daqui`}
      >
        <span className="truncate text-[12.5px] font-medium" style={{ color: TREE.texto }}>
          {nome}
        </span>
        {periodo && (
          <span className="shrink-0 text-[11px] tabular-nums" style={{ color: TREE.textoFraco }}>
            {periodo}
          </span>
        )}
        {linha.tipo === "conjuge" && (
          <span
            className="shrink-0 rounded px-1.5 py-[1px] text-[10px] font-medium"
            style={{ background: TREE.hover, color: TREE.textoFraco }}
          >
            Cônjuge
          </span>
        )}
      </button>

      <span className="flex shrink-0 items-center gap-1.5">
        {linha.quantosFilhos > 0 && (
          <span className="text-[10.5px] tabular-nums" style={{ color: TREE.textoSuave }}>
            {linha.quantosFilhos} filho(s)
          </span>
        )}
        {problema && (
          <AlertTriangle
            className="h-3 w-3"
            style={{ color: SEVERIDADE_COR[a!.severidadeMax!] }}
            aria-label="Inconsistência no dado"
          />
        )}
        {a && a.completude < 60 && !problema && (
          <Lightbulb
            className="h-3 w-3"
            style={{ color: SEVERIDADE_COR.medio }}
            aria-label="Ficha incompleta — há o que pesquisar"
          />
        )}
        {documental && documental.situacao !== "sem_exigencia" && aoAbrirPasta && (
          <button
            type="button"
            onClick={() => aoAbrirPasta(pessoa.id)}
            title={`Abrir a Pasta Documental de ${nome}`}
            aria-label={`Abrir a Pasta Documental de ${nome}`}
            className="rounded p-0.5 arv-hover"
            style={{ color: TREE.textoFraco }}
          >
            <FolderOpen className="h-3 w-3" />
          </button>
        )}
      </span>
    </div>
  )
})
