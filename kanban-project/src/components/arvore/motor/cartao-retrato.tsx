// src/components/arvore/motor/cartao-retrato.tsx
//
// CARD DA VISTA RETRATO — em pé, não o card deitado reaproveitado.
//
// Reaproveitar o card horizontal na leitura em pé era erro estrutural, não
// detalhe: numa árvore vertical as gerações se empilham e a largura é o recurso
// escasso: card de 244px de largura empurra irmãos para fora da tela e obriga
// pan horizontal numa leitura que deveria ser só vertical. O card em pé inverte
// a proporção — estreito e alto — e cabe o dobro de gente na mesma faixa.
//
// Composição, de cima para baixo:
//   faixa de gênero (o topo colorido é o que dá leitura estrutural instantânea)
//   retrato circular
//   nome (duas linhas)
//   período de vida
//   código
//
// As setas de expansão ficam nas bordas: ⌃ acima (pais), ⌄ abaixo (filhos),
// ‹ › nas laterais (irmãos) — a gramática da vista em pé.

"use client"

import { memo } from "react"
import { AlertTriangle, ChevronDown, ChevronUp, Lightbulb } from "lucide-react"
import type { AnalisePessoa } from "@/src/lib/genealogia/motor/tipos"
import type { PessoaArvore } from "../types"
import { corGenero, EASE, PAIS_LINHA, SEVERIDADE_COR, TREE, type ConteudoCartao } from "./tokens"
import { anoDe } from "@/src/lib/genealogia/motor/texto"

export interface CartaoRetratoProps {
  pessoa: PessoaArvore
  analise: AnalisePessoa | undefined
  x: number
  y: number
  largura: number
  altura: number
  exibicao: ConteudoCartao
  selecionada: boolean
  focada: boolean
  esmaecida: boolean
  paisAlvo: string | null
  temSugestao: boolean
  temDuplicidade: boolean
  parentesco?: string | null
  aoClicar: (p: PessoaArvore) => void
  aoEntrarHover: (id: number | null) => void
  aoAbrirFoco: (id: number) => void
  ramo?: {
    podeAscendentes: boolean
    podeDescendentes: boolean
    ascendentesRecolhidos: boolean
    descendentesRecolhidos: boolean
    escondidosAscendentes: number
    escondidosDescendentes: number
    aoAlternar: (id: number, direcao: "ascendentes" | "descendentes") => void
  }
}

function periodoDeVida(p: PessoaArvore): string {
  const n = anoDe(p.data_nasc)
  const o = anoDe(p.data_obito)
  const falecida = p.vivo === false || !!p.data_obito
  if (n && o) return `${n}–${o}`
  if (n) return falecida ? `${n}–?` : `${n}–`
  if (o) return `?–${o}`
  return falecida ? "—" : ""
}

export const CartaoRetrato = memo(function CartaoRetrato({
  pessoa,
  analise,
  x,
  y,
  largura,
  altura,
  exibicao,
  selecionada,
  focada,
  esmaecida,
  paisAlvo,
  temSugestao,
  temDuplicidade,
  parentesco,
  aoClicar,
  aoEntrarHover,
  aoAbrirFoco,
  ramo,
}: CartaoRetratoProps) {
  const genero = corGenero(pessoa.sexo)
  const nome = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  const severidade = analise?.severidadeMax ?? null
  const naLinha = analise?.naLinhaCidadania ?? false
  const linhaPais = paisAlvo ? PAIS_LINHA[paisAlvo] : null
  const periodo = periodoDeVida(pessoa)
  const codigo = (pessoa as { publicCode?: string | null }).publicCode || null
  const problema = severidade === "critico" || severidade === "alto" || temDuplicidade

  const descricao = [nome, periodo, parentesco ? `${parentesco} do requerente` : null]
    .filter(Boolean)
    .join(" · ")

  return (
    <div
      data-no-pan
      data-cartao-pessoa="1"
      data-pessoa-id={pessoa.id}
      role="button"
      tabIndex={-1}
      aria-label={descricao}
      aria-current={selecionada ? "true" : undefined}
      title={descricao}
      onClick={(e) => {
        e.stopPropagation()
        aoClicar(pessoa)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        aoAbrirFoco(pessoa.id)
      }}
      onPointerEnter={() => aoEntrarHover(pessoa.id)}
      onPointerLeave={() => aoEntrarHover(null)}
      className="absolute select-none"
      style={{
        left: x,
        top: y,
        width: largura,
        height: altura,
        opacity: esmaecida ? 0.34 : 1,
        transition: `opacity 240ms ${EASE.suave}`,
        cursor: "pointer",
      }}
    >
      <div
        className="relative flex h-full w-full flex-col items-center overflow-hidden rounded-[6px] px-1.5 pb-1.5"
        style={{
          background: TREE.cartao,
          border: `1px solid ${selecionada ? TREE.acento : focada ? TREE.cartaoBordaForte : TREE.cartaoBorda}`,
          boxShadow: selecionada
            ? `0 0 0 2px ${TREE.acento}, ${TREE.sombraElevada}`
            : focada
              ? TREE.sombraElevada
              : TREE.sombra,
          transition: `box-shadow 180ms ${EASE.rapido}, border-color 180ms ${EASE.rapido}`,
        }}
      >
        {/* Faixa de gênero NO TOPO — é o que dá a leitura estrutural na vista
            em pé, onde não há espaço lateral para filete. */}
        <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: genero.linha }} />

        {/* Linha de cidadania: segunda faixa, logo abaixo da de gênero. */}
        {naLinha && linhaPais && (
          <span aria-hidden className="absolute inset-x-0 top-[3px] h-[2px]" style={{ background: linhaPais.cor }} />
        )}

        {(problema || temSugestao) && (
          <span className="absolute right-1 top-[6px] z-[1]">
            {problema ? (
              <AlertTriangle
                className="h-[11px] w-[11px]"
                style={{ color: SEVERIDADE_COR[severidade || "alto"] }}
                aria-label="Inconsistência no dado"
              />
            ) : (
              <Lightbulb
                className="h-[11px] w-[11px]"
                style={{ color: SEVERIDADE_COR.medio }}
                aria-label="Há sugestão para esta pessoa"
              />
            )}
          </span>
        )}

        {exibicao.retratos && (
          <span
            aria-hidden
            className="mt-[9px] flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full"
            style={{ background: genero.suave, border: `1px solid ${genero.linha}`, color: genero.tinta }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="8.2" r="4" />
              <path d="M3.8 21c0-4.3 3.7-7 8.2-7s8.2 2.7 8.2 7z" />
            </svg>
          </span>
        )}

        <span
          className="mt-1 line-clamp-2 text-center text-[10.5px] font-semibold leading-[13px]"
          style={{ color: TREE.texto }}
        >
          {nome}
        </span>

        {exibicao.datas && periodo && (
          <span className="text-[9.5px] leading-[13px] tabular-nums" style={{ color: TREE.textoFraco }}>
            {periodo}
          </span>
        )}
        {exibicao.codigos && codigo && (
          <span
            className="w-full truncate text-center text-[9px] leading-[12px] tabular-nums"
            style={{ color: TREE.textoSuave }}
          >
            {codigo}
          </span>
        )}
      </div>

      {/* Setas de expansão: ⌃ pais acima, ⌄ filhos abaixo. */}
      {ramo?.podeAscendentes && (
        <SetaRamo
          posicao="topo"
          recolhido={ramo.ascendentesRecolhidos}
          quantidade={ramo.escondidosAscendentes}
          rotulo={`${ramo.ascendentesRecolhidos ? "Expandir" : "Recolher"} ascendentes de ${nome}`}
          visivel={focada || selecionada}
          onClick={() => ramo.aoAlternar(pessoa.id, "ascendentes")}
        />
      )}
      {ramo?.podeDescendentes && (
        <SetaRamo
          posicao="base"
          recolhido={ramo.descendentesRecolhidos}
          quantidade={ramo.escondidosDescendentes}
          rotulo={`${ramo.descendentesRecolhidos ? "Expandir" : "Recolher"} descendentes de ${nome}`}
          visivel={focada || selecionada}
          onClick={() => ramo.aoAlternar(pessoa.id, "descendentes")}
        />
      )}
    </div>
  )
})

function SetaRamo({
  posicao,
  recolhido,
  quantidade,
  rotulo,
  visivel,
  onClick,
}: {
  posicao: "topo" | "base"
  recolhido: boolean
  quantidade: number
  rotulo: string
  visivel: boolean
  onClick: () => void
}) {
  const mostrar = recolhido || visivel
  const Icone = posicao === "topo" ? ChevronUp : ChevronDown
  return (
    <button
      data-no-pan
      type="button"
      title={rotulo}
      aria-label={rotulo}
      aria-expanded={!recolhido}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="absolute left-1/2 z-20 inline-flex h-[19px] min-w-[19px] -translate-x-1/2 items-center justify-center rounded-full px-[3px] text-[10px] font-semibold tabular-nums"
      style={{
        [posicao === "topo" ? "top" : "bottom"]: -10,
        background: TREE.cartao,
        border: `1px solid ${recolhido ? TREE.acento : TREE.cartaoBordaForte}`,
        color: recolhido ? TREE.acentoTexto : TREE.textoFraco,
        boxShadow: TREE.sombra,
        opacity: mostrar ? 1 : 0,
        pointerEvents: mostrar ? "auto" : "none",
        transition: `opacity 160ms ${EASE.rapido}`,
      } as React.CSSProperties}
    >
      {recolhido && quantidade > 0 ? quantidade : <Icone className="h-3 w-3" />}
    </button>
  )
}
