// src/components/arvore/motor/cartao-pessoa.tsx
//
// O CARD DE PESSOA.
//
// Gramática de referência (árvore do FamilySearch), reconstruída em código
// próprio: papel branco, borda fina, retrato circular à esquerda, NOME em
// destaque, período de vida abaixo, lugar quando couber. Nada mais compete com
// o nome — é ele que o operador varre com o olho ao percorrer uma geração.
//
// O que este card deliberadamente NÃO tem (e tinha na versão reprovada):
//   · fundo escuro e borda acesa;
//   · fileira de ícones no rodapé;
//   · badge de papel, badge de parentesco, badge de país, anel de completude;
//   · qualquer coisa que transforme leitura de família em painel de engenharia.
//
// Sobrou o mínimo com função real, no canto superior direito, em no máximo dois
// sinais por vez, na mesma lógica de "record hint" e "data problem" da árvore de
// referência:
//   · sugestão da árvore (há pesquisa/vínculo provável aqui);
//   · problema no dado (conflito de datas, duplicidade).
// Mais o selo documental, que é OFICIAL e vem do Sistema Documental — a árvore
// exibe e leva até lá, nunca gere documento.

"use client"

import { memo } from "react"
import { AlertTriangle, Baby, Heart, Lightbulb, UserPlus, Users } from "lucide-react"
import type { AnalisePessoa } from "@/src/lib/genealogia/motor/tipos"
import type { PessoaArvore } from "../types"
import {
  corGenero,
  EASE,
  GENERO,
  INFO,
  PAIS_LINHA,
  SEVERIDADE_COR,
  SUCESSO,
  TREE,
  type ConteudoCartao,
} from "./tokens"
import { ROTULO_SITUACAO, type SituacaoDocumental } from "@/src/lib/genealogia/documental/indicadores"
import { anoDe } from "@/src/lib/genealogia/motor/texto"

export interface CartaoPessoaProps {
  pessoa: PessoaArvore
  analise: AnalisePessoa | undefined
  x: number
  y: number
  largura: number
  altura: number
  exibicao: ConteudoCartao
  selecionada: boolean
  focada: boolean
  /** Fora do conjunto em destaque — recua sem sumir. */
  esmaecida: boolean
  ascendente: boolean
  descendente: boolean
  paisAlvo: string | null
  temSugestao: boolean
  temDuplicidade: boolean
  /** Grau de parentesco com o requerente — vai para o title, não para a tela. */
  parentesco?: string | null
  documental?: { situacao: SituacaoDocumental; progresso: number | null; pendentes: number } | null
  aoAbrirPasta?: (id: number) => void
  aoClicar: (pessoa: PessoaArvore) => void
  aoEntrarHover: (id: number | null) => void
  aoAbrirFoco: (id: number) => void
  acoes?: {
    adicionarPai?: (id: number) => void
    adicionarMae?: (id: number) => void
    adicionarConjuge?: (id: number) => void
    adicionarFilho?: (id: number) => void
  }
  faltaPai?: boolean
  faltaMae?: boolean
  /**
   * Sinais estruturais que a referência mostra no próprio card:
   * mais de um cônjuge e mais de um conjunto de pais possível. São avisos de
   * que a leitura ali tem uma ramificação — sem eles o operador conclui que a
   * família é a que está desenhada, e ela pode não ser.
   */
  multiplosConjuges?: number
  paisAlternativos?: boolean
  ramo?: {
    podeAscendentes: boolean
    podeDescendentes: boolean
    ascendentesRecolhidos: boolean
    descendentesRecolhidos: boolean
    escondidosAscendentes: number
    escondidosDescendentes: number
    aoAlternar: (id: number, direcao: "ascendentes" | "descendentes") => void
  }
  vertical?: boolean
}

/**
 * Linha de vida — a mesma frase da referência ("1840–Falecido", "1903–Falecida").
 *
 * Falecimento SEM data não vira "1840–?": a interrogação sugere dúvida sobre o
 * fato, e o fato é conhecido — o que falta é a data. Escrever "Falecido" diz
 * exatamente o que se sabe, e é o que a referência escreve.
 */
export function periodoDeVida(p: PessoaArvore): string {
  const n = anoDe(p.data_nasc)
  const o = anoDe(p.data_obito)
  const falecida = p.vivo === false || !!p.data_obito
  const rotuloObito = (p.sexo || "").trim().toLowerCase().startsWith("f") ? "Falecida" : "Falecido"
  if (n && o) return `${n}–${o}`
  if (n) return falecida ? `${n}–${rotuloObito}` : `${n}–`
  if (o) return `?–${o}`
  return falecida ? rotuloObito : ""
}

function local(p: PessoaArvore): string {
  return [p.local_nasc, p.estado_nasc || p.pais_nasc].filter(Boolean).join(", ")
}

export const CartaoPessoa = memo(function CartaoPessoa({
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
  ascendente,
  descendente,
  paisAlvo,
  temSugestao,
  temDuplicidade,
  parentesco,
  documental,
  aoAbrirPasta,
  aoClicar,
  aoEntrarHover,
  aoAbrirFoco,
  acoes,
  faltaPai,
  faltaMae,
  ramo,
  vertical = true,
  multiplosConjuges = 0,
  paisAlternativos = false,
}: CartaoPessoaProps) {
  const genero = corGenero(pessoa.sexo)
  const nome = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  const severidade = analise?.severidadeMax ?? null
  const naLinha = analise?.naLinhaCidadania ?? false
  const linhaPais = paisAlvo ? PAIS_LINHA[paisAlvo] : null
  const periodo = periodoDeVida(pessoa)
  const codigo = (pessoa as { publicCode?: string | null }).publicCode || null
  const lugar = local(pessoa)

  // Só problema que muda decisão vira sinal na tela. "médio/baixo" continua
  // existindo no painel e no motor, mas não polui a leitura da geração.
  const problema = severidade === "critico" || severidade === "alto" || temDuplicidade

  const descricao = [
    nome,
    periodo,
    lugar,
    parentesco ? `Parentesco com o requerente: ${parentesco}` : null,
    analise?.resumo || null,
  ]
    .filter(Boolean)
    .join(" · ")

  const corBorda = selecionada ? TREE.acento : focada ? TREE.cartaoBordaForte : TREE.cartaoBorda
  const avatar = 30

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
      className="group absolute select-none"
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
        className="relative flex h-full w-full items-center gap-2 overflow-hidden rounded-[8px]"
        style={{
          background: TREE.cartao,
          border: `1px solid ${corBorda}`,
          // Seleção = anel do acento institucional, no lugar de borda neon.
          boxShadow: selecionada
            ? `0 0 0 2px ${TREE.acento}, ${TREE.sombraElevada}`
            : focada
              ? TREE.sombraElevada
              : TREE.sombra,
          padding: "0 8px 0 12px",
          transition: `box-shadow 180ms ${EASE.rapido}, border-color 180ms ${EASE.rapido}`,
        }}
      >
        {/* FILETE DE GÊNERO — a marca estrutural da referência, na borda
            esquerda do card. Ela é o que permite ler a composição do casal de
            relance, agora que marido e mulher são dois cards separados: sem a
            faixa, dois retângulos brancos empilhados não dizem quem é quem. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ background: genero.linha }}
        />

        {/* Linha de cidadania: segundo filete, colado no de gênero. É sinal do
            PROCESSO (não da pessoa) e por isso não pode ocupar o lugar do
            gênero — some junto com ele seria perder a leitura estrutural. */}
        {naLinha && linhaPais && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-[3px] w-[2px]"
            style={{ background: linhaPais.cor }}
            title={linhaPais.rotulo}
          />
        )}

        {/* Trilha de ascendência/descendência do selecionado — lavagem suave,
            sem gradiente chamativo. */}
        {(ascendente || descendente) && !selecionada && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: ascendente ? TREE.trilhaAscendente : TREE.trilhaDescendente, opacity: 0.85 }}
          />
        )}

        {/* Retrato circular — cor de gênero, sem foto (o Discovery não guarda). */}
        {exibicao.retratos && (
        <span
          aria-hidden
          className="relative z-[1] flex shrink-0 items-center justify-center rounded-full"
          style={{
            width: avatar,
            height: avatar,
            background: genero.suave,
            border: `1px solid ${genero.linha}`,
            color: genero.tinta,
          }}
        >
          <SilhuetaPessoa tamanho={Math.round(avatar * 0.62)} />
        </span>
        )}

        <span className="relative z-[1] flex min-w-0 flex-1 flex-col justify-center">
          <span
            className="truncate text-[13px] font-semibold leading-[17px]"
            style={{ color: TREE.texto }}
          >
            {nome}
          </span>
          {/* Período e CÓDIGO na mesma linha — é a linha de identidade da
              pessoa na referência ("1871–Falecido • G7D9-BCR"), e o código é o
              que distingue homônimos sem abrir a ficha. */}
          {(exibicao.datas || exibicao.codigos) && (periodo || codigo) && (
            <span
              className="truncate text-[11px] leading-[15px] tabular-nums"
              style={{ color: TREE.textoFraco }}
            >
              {exibicao.datas && periodo}
              {exibicao.datas && periodo && exibicao.codigos && codigo ? " • " : ""}
              {exibicao.codigos && codigo}
            </span>
          )}
          {exibicao.lugares && lugar && (
            <span className="truncate text-[10px] leading-[13px]" style={{ color: TREE.textoSuave }}>
              {lugar}
            </span>
          )}
        </span>

        {/* SINAIS — coluna à direita, centrada na altura, como na referência.
            Ficavam soltos nos cantos superiores; com o card mais baixo isso os
            punha sobre o avatar e sobre o nome. Aqui eles são um ITEM DO FLEX:
            têm largura própria, e o nome trunca antes de encostar neles em vez
            de passar por baixo. */}
        {(problema ||
          temSugestao ||
          multiplosConjuges > 1 ||
          paisAlternativos ||
          (documental && documental.situacao !== "sem_exigencia")) && (
          <span className="relative z-[1] flex shrink-0 items-center gap-[3px]">
            {multiplosConjuges > 1 && (
              <span
                className="inline-flex items-center gap-[1px] rounded px-[3px] text-[8.5px] font-semibold leading-[13px]"
                style={{ background: TREE.hover, color: TREE.textoFraco }}
                aria-label={`${multiplosConjuges} cônjuges`}
                title={`${multiplosConjuges} cônjuges — a família continua pelos dois lados`}
              >
                <Heart className="h-[9px] w-[9px]" />
                {multiplosConjuges}
              </span>
            )}
            {paisAlternativos && (
              <span
                className="inline-flex items-center rounded px-[3px] leading-[13px]"
                style={{ background: TREE.hover, color: TREE.textoFraco }}
                aria-label="Há mais de um conjunto de pais possível"
                title="Há mais de um conjunto de pais possível para esta pessoa"
              >
                <Users className="h-[9px] w-[9px]" />
              </span>
            )}
            {problema && (
              <AlertTriangle
                className="h-[12px] w-[12px]"
                style={{ color: temDuplicidade ? SEVERIDADE_COR.alto : SEVERIDADE_COR[severidade || "alto"] }}
                aria-label={temDuplicidade ? "Possível duplicidade" : "Inconsistência no dado"}
              />
            )}
            {temSugestao && !problema && (
              <Lightbulb
                className="h-[12px] w-[12px]"
                style={{ color: SEVERIDADE_COR.medio }}
                aria-label="Há sugestão da árvore para esta pessoa"
              />
            )}
            {documental && documental.situacao !== "sem_exigencia" && (
              <PontoDocumental
                situacao={documental.situacao}
                progresso={documental.progresso}
                pendentes={documental.pendentes}
                onClick={aoAbrirPasta ? () => aoAbrirPasta(pessoa.id) : undefined}
              />
            )}
          </span>
        )}
      </div>

      {/* Ações contextuais — só no hover/seleção, fora do card */}
      {acoes && (focada || selecionada) && (
        <div
          data-no-pan
          className="absolute -top-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-full px-1 py-0.5"
          style={{
            background: TREE.popover,
            border: `1px solid ${TREE.cartaoBorda}`,
            boxShadow: TREE.sombraElevada,
            animation: `acoesEntrada 140ms ${EASE.rapido}`,
          }}
        >
          <style>{`
            @keyframes acoesEntrada {
              from { opacity: 0; transform: translateX(-50%) translateY(3px); }
              to   { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
          `}</style>
          {faltaPai && acoes.adicionarPai && (
            <BotaoAcao titulo="Adicionar pai" onClick={() => acoes.adicionarPai!(pessoa.id)} cor={GENERO.masculino.tinta}>
              <UserPlus className="h-3 w-3" />
            </BotaoAcao>
          )}
          {faltaMae && acoes.adicionarMae && (
            <BotaoAcao titulo="Adicionar mãe" onClick={() => acoes.adicionarMae!(pessoa.id)} cor={GENERO.feminino.tinta}>
              <UserPlus className="h-3 w-3" />
            </BotaoAcao>
          )}
          {acoes.adicionarConjuge && (
            <BotaoAcao titulo="Adicionar cônjuge" onClick={() => acoes.adicionarConjuge!(pessoa.id)} cor={GENERO.feminino.tinta}>
              <Heart className="h-3 w-3" />
            </BotaoAcao>
          )}
          {acoes.adicionarFilho && (
            <BotaoAcao titulo="Adicionar filho(a)" onClick={() => acoes.adicionarFilho!(pessoa.id)} cor={SUCESSO}>
              <Baby className="h-3 w-3" />
            </BotaoAcao>
          )}
        </div>
      )}

      {/* Controles de ramo — na borda por onde o ramo sai do card */}
      {ramo?.podeAscendentes && (
        <ControleRamo
          rotulo={
            ramo.ascendentesRecolhidos
              ? `Expandir ascendentes de ${nome}${ramo.escondidosAscendentes ? ` (${ramo.escondidosAscendentes})` : ""}`
              : `Recolher ascendentes de ${nome}`
          }
          recolhido={ramo.ascendentesRecolhidos}
          quantidade={ramo.escondidosAscendentes}
          posicao={vertical ? "topo" : "direita"}
          visivel={focada || selecionada}
          onClick={() => ramo.aoAlternar(pessoa.id, "ascendentes")}
        />
      )}
      {ramo?.podeDescendentes && (
        <ControleRamo
          rotulo={
            ramo.descendentesRecolhidos
              ? `Expandir descendentes de ${nome}${ramo.escondidosDescendentes ? ` (${ramo.escondidosDescendentes})` : ""}`
              : `Recolher descendentes de ${nome}`
          }
          recolhido={ramo.descendentesRecolhidos}
          quantidade={ramo.escondidosDescendentes}
          posicao={vertical ? "base" : "esquerda"}
          visivel={focada || selecionada}
          onClick={() => ramo.aoAlternar(pessoa.id, "descendentes")}
        />
      )}
    </div>
  )
})

/** Silhueta genérica — sem foto e sem ícone de biblioteca no meio do card. */
function SilhuetaPessoa({ tamanho }: { tamanho: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="8.2" r="4" />
      <path d="M3.8 21c0-4.3 3.7-7 8.2-7s8.2 2.7 8.2 7z" />
    </svg>
  )
}

/**
 * Selo documental — um ponto, não um badge.
 *
 * Forma além de cor (o símbolo muda por situação), porque estado não pode
 * depender de matiz. Clicar abre a Pasta Documental: a árvore aponta para o
 * módulo dono do documento e não resolve nada aqui.
 */
function PontoDocumental({
  situacao,
  progresso,
  pendentes,
  onClick,
}: {
  situacao: SituacaoDocumental
  progresso: number | null
  pendentes: number
  onClick?: () => void
}) {
  const mapa: Record<SituacaoDocumental, { simbolo: string; cor: string }> = {
    sem_exigencia: { simbolo: "", cor: TREE.textoSuave },
    completo: { simbolo: "✓", cor: SUCESSO },
    em_andamento: { simbolo: "◐", cor: INFO },
    pendente: { simbolo: "•", cor: SEVERIDADE_COR.medio },
    bloqueado: { simbolo: "!", cor: SEVERIDADE_COR.critico },
  }
  const { simbolo, cor } = mapa[situacao]
  const titulo = `${ROTULO_SITUACAO[situacao]}${progresso != null ? ` — ${progresso}%` : ""}${
    pendentes > 0 ? ` · ${pendentes} pendente(s)` : ""
  }${onClick ? " · abrir Pasta Documental" : ""}`

  const conteudo = (
    <span
      className="inline-flex h-[13px] min-w-[13px] items-center justify-center rounded-full text-[8px] font-bold leading-none"
      style={{ background: TREE.branco, border: `1px solid ${cor}`, color: cor }}
      aria-label={titulo}
    >
      {simbolo}
    </span>
  )

  if (!onClick) return <span title={titulo}>{conteudo}</span>
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="transition-transform hover:scale-110"
    >
      {conteudo}
    </button>
  )
}

function BotaoAcao({
  children,
  titulo,
  onClick,
  cor,
}: {
  children: React.ReactNode
  titulo: string
  onClick: () => void
  cor: string
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="rounded-full p-1 transition-colors arv-hover"
      style={{ color: cor }}
    >
      {children}
    </button>
  )
}

/**
 * Dobrar/desdobrar ramo — o mesmo gesto da árvore de referência: um botão
 * redondo pequeno na borda do card, com seta para o lado em que o ramo cresce.
 *
 * Aberto: aparece no hover (senão a tela vira um campo de botões).
 * Recolhido: fica permanente e mostra a contagem — é a única marca de que
 * existe família ali; sem ela o operador conclui que a linha acabou.
 */
function ControleRamo({
  rotulo,
  recolhido,
  quantidade,
  posicao,
  visivel,
  onClick,
}: {
  rotulo: string
  recolhido: boolean
  quantidade: number
  posicao: "topo" | "base" | "esquerda" | "direita"
  visivel: boolean
  onClick: () => void
}) {
  const mostrar = recolhido || visivel
  const ancora: React.CSSProperties =
    posicao === "topo"
      ? { top: -10, left: "50%", transform: "translateX(-50%)" }
      : posicao === "base"
        ? { bottom: -10, left: "50%", transform: "translateX(-50%)" }
        : posicao === "esquerda"
          ? { left: -10, top: "50%", transform: "translateY(-50%)" }
          : { right: -10, top: "50%", transform: "translateY(-50%)" }

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
      className="absolute z-20 inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-[3px] text-[10px] font-semibold leading-none tabular-nums"
      style={{
        ...ancora,
        background: TREE.cartao,
        border: `1px solid ${recolhido ? TREE.acento : TREE.cartaoBordaForte}`,
        color: recolhido ? TREE.acentoTexto : TREE.textoFraco,
        boxShadow: TREE.sombra,
        opacity: mostrar ? 1 : 0,
        pointerEvents: mostrar ? "auto" : "none",
        transition: `opacity 160ms ${EASE.rapido}`,
      }}
    >
      {recolhido ? (quantidade > 0 ? quantidade : "+") : "−"}
    </button>
  )
}

/**
 * Card de ACRESCENTAR PARENTE.
 *
 * Na referência não é uma caixa tracejada de "slot vazio": é um card de papel
 * igual aos outros, com a silhueta cinza e o convite em link. A diferença
 * importa porque o lugar vago é uma PESSOA que falta, não um buraco no desenho
 * — e o card já ocupa exatamente o espaço que ela ocupará.
 */
export const CartaoAdicionar = memo(function CartaoAdicionar({
  x,
  y,
  largura,
  altura,
  rotulo,
  papel,
  formato = "deitado",
  aoClicar,
}: {
  x: number
  y: number
  largura: number
  altura: number
  rotulo: string
  /** Define a faixa de gênero do lugar vago — pai é azul, mãe é rosa. */
  papel: "pai" | "mae" | "conjuge" | "filho"
  /** Segue o formato do card real da vista: senão o vago não ocupa o lugar. */
  formato?: "deitado" | "retrato"
  aoClicar: () => void
}) {
  const faixa =
    papel === "pai" ? GENERO.masculino : papel === "mae" ? GENERO.feminino : GENERO.indefinido

  const base: React.CSSProperties = {
    left: x,
    top: y,
    width: largura,
    height: altura,
    background: TREE.cartao,
    border: `1px solid ${TREE.cartaoBorda}`,
    boxShadow: TREE.sombra,
  }

  // NA VISTA EM PÉ O VAGO TAMBÉM É EM PÉ.
  //
  // Reaproveitar o vago deitado num card de 78px de largura produzia o defeito
  // que a captura mostrou: retrato e rótulo lado a lado, com o texto cortado em
  // "A…" — um card em branco que não diz o que faz. Em pé, o convite quebra em
  // duas linhas e cabe.
  if (formato === "retrato") {
    return (
      <button
        data-no-pan
        data-cartao-vago={papel}
        type="button"
        title={rotulo}
        aria-label={rotulo}
        onClick={(e) => {
          e.stopPropagation()
          aoClicar()
        }}
        className="absolute flex flex-col items-center overflow-hidden rounded-[6px] px-1 pb-1.5"
        style={base}
      >
        <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: faixa.linha }} />
        <span
          aria-hidden
          className="mt-[9px] flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full"
          style={{ background: GENERO.indefinido.suave, color: GENERO.indefinido.linha }}
        >
          <SilhuetaPessoa tamanho={20} />
        </span>
        <span
          className="mt-1 line-clamp-3 text-center text-[9.5px] font-semibold uppercase leading-[12px] tracking-wide"
          style={{ color: INFO }}
        >
          {rotulo}
        </span>
      </button>
    )
  }

  return (
    <button
      data-no-pan
      data-cartao-vago={papel}
      type="button"
      title={rotulo}
      aria-label={rotulo}
      onClick={(e) => {
        e.stopPropagation()
        aoClicar()
      }}
      className="absolute flex items-center gap-2 overflow-hidden rounded-[8px] pl-3 pr-2.5 text-left"
      style={base}
    >
      {/* Filete de gênero — o lugar vago já ocupa a posição estrutural que a
          pessoa ocupará, e a cor diz qual papel está faltando. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: faixa.linha }} />
      <span
        aria-hidden
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full"
        style={{ background: GENERO.indefinido.suave, color: GENERO.indefinido.linha }}
      >
        <SilhuetaPessoa tamanho={19} />
      </span>
      <span
        className="truncate text-[11.5px] font-semibold uppercase tracking-wide"
        style={{ color: INFO }}
      >
        {rotulo}
      </span>
    </button>
  )
})

/** Rótulo do lugar vago — a mesma frase que a referência usa para cada papel. */
export const ROTULO_VAGO: Record<"pai" | "mae" | "conjuge" | "filho", string> = {
  pai: "Acrescentar o pai",
  mae: "Acrescentar a mãe",
  conjuge: "Acrescentar o cônjuge",
  filho: "Acrescentar filho(a)",
}
