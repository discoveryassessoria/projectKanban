// src/components/arvore/motor/painel-pessoa.tsx
//
// PAINEL LATERAL OPERACIONAL (B2) + LINHA DO TEMPO PROJETADA (B4).
//
// Regra que define o componente: ele abre SOBRE a árvore, nunca no lugar dela.
// A árvore continua visível, com a posição e o zoom intactos — o painel é uma
// coluna à direita, não uma troca de tela. Perder o enquadramento a cada clique
// é o que faz o operador parar de clicar.
//
// Fontes, sem exceção:
//   identidade e dados ....... Pessoa (Cadastro Mestre) — leitura, sem cópia
//   relações ................. grafo (paiId/maeId/União)
//   eventos .................. projeção das colunas canônicas (não persiste)
//   indicador documental ..... Sistema Documental (NecessidadeDocumental)
//   inconsistências .......... motor genealógico
//
// O que NÃO existe aqui: upload, versão, aprovação, exclusão de documento,
// pesquisa persistida e histórico de auditoria de relação — os dois últimos
// dependem de modelos que o domínio ainda não tem, e o painel diz isso em vez
// de fingir uma aba vazia.

"use client"

import { memo, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  CalendarClock,
  ExternalLink,
  FileText,
  GitBranch,
  Info,
  Link2,
  Pencil,
  UserRound,
  Users,
  X,
} from "lucide-react"
import {
  ROTULO_IRMANDADE,
  type GrafoGenealogico,
  type TipoIrmandade,
} from "@/src/lib/genealogia/motor/grafo"
import type { AnaliseArvore, Insight } from "@/src/lib/genealogia/motor/tipos"
import { formatarData, nomeCompleto } from "@/src/lib/genealogia/motor/texto"
import {
  detectarLacunas,
  eventosDaPessoa,
  filtrarEventos,
  marcarConflitos,
  ROTULO_EVENTO,
  type EventoProjetado,
  type TipoEvento,
} from "@/src/lib/genealogia/motor/eventos"
import {
  ROTULO_SITUACAO,
  type IndicadorDocumental,
} from "@/src/lib/genealogia/documental/indicadores"
import type { PessoaArvore } from "../types"
import { corGenero, EASE, INFO, SEVERIDADE_COR, SUCESSO, SUCESSO_SUAVE, TREE } from "./tokens"

/**
 * Seção com que a gaveta abre.
 *
 * O tipo continua sendo o mesmo conjunto (o cartão e a paleta pedem "abre em
 * Relações"), mas ele deixou de selecionar uma ABA e passou a escolher para
 * onde a rolagem vai. É a mesma intenção — "leve-me à parte que interessa" —
 * numa gramática que cabe em 400px.
 */
export type AbaPessoa = "resumo" | "relacoes" | "dados" | "eventos" | "documental" | "alertas"

const ANCORA_SECAO: Record<AbaPessoa, string | null> = {
  resumo: null,
  relacoes: "sec-relacoes",
  dados: "sec-dados",
  eventos: "sec-eventos",
  documental: "sec-documental",
  alertas: "sec-alertas",
}

export interface PainelPessoaProps {
  pessoa: PessoaArvore | null
  grafo: GrafoGenealogico
  analise: AnaliseArvore
  indicador: IndicadorDocumental
  parentesco: string | null
  insights: Insight[]
  aoFechar: () => void
  aoIrParaPessoa: (id: number) => void
  aoAbrirPastaDocumental?: (id: number) => void
  aoEditar?: (p: PessoaArvore) => void
  aoAdicionarPai?: (id: number) => void
  aoAdicionarMae?: (id: number) => void
  aoAdicionarConjuge?: (id: number) => void
  aoAdicionarFilho?: (id: number) => void
  /** Seção para a qual a gaveta rola ao abrir. */
  abaInicial?: AbaPessoa
  /** Reposiciona a árvore nesta pessoa — a ação primária da gaveta. */
  aoVerArvore?: (id: number) => void
  /** Abre a PÁGINA COMPLETA da pessoa (o "Pessoa" da referência). */
  aoAbrirPessoa?: (p: PessoaArvore) => void
}

export const PainelPessoa = memo(function PainelPessoa(props: PainelPessoaProps) {
  const { pessoa, grafo, analise, indicador, parentesco, insights, aoFechar, abaInicial, aoVerArvore } = props

  const a = pessoa ? analise.porPessoa.get(pessoa.id) : undefined

  const eventos = useMemo(() => {
    if (!pessoa) return []
    const comConflito = new Set(
      analise.insights.filter((i) => i.categoria === "conflito").flatMap((i) => i.pessoaIds),
    )
    return marcarConflitos(eventosDaPessoa(grafo, pessoa.id), comConflito)
  }, [pessoa, grafo, analise.insights])

  // Rolar até a seção pedida. Só quando a pessoa OU a seção mudam — rolar a
  // cada render tiraria o painel do lugar enquanto o operador lê.
  const pedido = `${pessoa?.id ?? 0}:${abaInicial ?? "resumo"}`
  useEffect(() => {
    const ancora = ANCORA_SECAO[abaInicial ?? "resumo"]
    if (!ancora) return
    const alvo = document.getElementById(ancora)
    alvo?.scrollIntoView({ block: "start", behavior: "smooth" })
    // pedido concentra pessoa + seção: é exatamente quando a rolagem deve mudar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido])

  if (!pessoa) return null

  const nome = nomeCompleto(pessoa)
  const codigo = (pessoa as { publicCode?: string | null }).publicCode || null
  const alertas = insights.filter(
    (i) => i.categoria === "conflito" || i.categoria === "duplicidade" || i.categoria === "risco",
  )
  const totalParentescos =
    grafo.paisDe(pessoa.id).length +
    grafo.filhosIds(pessoa.id).length +
    grafo.conjugesIds(pessoa.id).length +
    grafo.irmaosIds(pessoa.id).length

  return (
    <aside
      data-no-pan
      role="complementary"
      aria-label={`Detalhes de ${nome}`}
      className="absolute right-0 top-0 z-40 flex h-full w-[400px] max-w-[94vw] flex-col"
      style={{
        background: TREE.painel,
        borderLeft: `1px solid ${TREE.cartaoBorda}`,
        boxShadow: TREE.sombraPainel,
        animation: `painelPessoaEntrada 260ms ${EASE.suave}`,
      }}
    >
      <style>{`
        @keyframes painelPessoaEntrada {
          from { opacity: 0; transform: translateX(28px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* CABEÇALHO — a composição da referência: retrato, nome, identificador,
          índice, contadores navegáveis, dados vitais em uma linha cada, e o par
          de ações [PESSOA] [ÁRVORE]. */}
      <header className="px-4 pb-3 pt-3" style={{ borderBottom: `1px solid ${TREE.cartaoBorda}` }}>
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full"
            style={{
              background: corGenero(pessoa.sexo).suave,
              border: `1px solid ${corGenero(pessoa.sexo).linha}`,
              color: corGenero(pessoa.sexo).tinta,
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="8.2" r="4" />
              <path d="M3.8 21c0-4.3 3.7-7 8.2-7s8.2 2.7 8.2 7z" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-semibold leading-tight" style={{ color: TREE.texto }} title={nome}>
              {nome}
            </h2>
            <p className="mt-0.5 text-[11px] tabular-nums" style={{ color: TREE.textoSuave }}>
              {codigo ?? `#${pessoa.id}`}
              {parentesco ? ` · ${parentesco} do requerente` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar detalhes"
            title="Fechar detalhes (Esc)"
            className="rounded p-1 transition-colors arv-hover"
          >
            <X className="h-5 w-5" style={{ color: TREE.textoFraco }} />
          </button>
        </div>

        {/* Índice de completude da FICHA — o equivalente Discovery do "índice de
            qualidade" da referência. Não é métrica inventada: é a mesma
            completude que o motor genealógico já calcula por pessoa. */}
        <p className="mt-2.5 flex items-center gap-2 text-[12.5px]" style={{ color: TREE.texto }}>
          Completude da ficha:
          <span
            className="rounded px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums"
            style={{ background: TREE.hover, color: TREE.textoFraco }}
          >
            {a?.completude ?? 0}%
          </span>
        </p>

        {/* Contadores navegáveis — cada um leva à seção correspondente, e o
            número é real. Contador que não leva a lugar nenhum é enfeite. */}
        <nav className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Seções desta pessoa">
          <LinkSecao
            alvo="sec-documental"
            rotulo={`Documental (${indicador.necessarias + indicador.opcionais})`}
          />
          <LinkSecao alvo="sec-eventos" rotulo={`Eventos (${eventos.length})`} />
          <LinkSecao alvo="sec-relacoes" rotulo={`Parentescos (${totalParentescos})`} />
          <LinkSecao alvo="sec-alertas" rotulo={`Alertas (${alertas.length})`} />
        </nav>

        <dl className="mt-2 space-y-0.5 text-[12.5px]" style={{ color: TREE.texto }}>
          <LinhaVital rotulo="Nascimento" valor={resumoNascimento(pessoa)} />
          <LinhaVital rotulo="Falecimento" valor={resumoFalecimento(pessoa)} />
        </dl>

        {/* PESSOA | ÁRVORE — o par de ações da referência. "Pessoa" abre a
            página completa; "Árvore" reposiciona o desenho nesta pessoa. */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => props.aoAbrirPessoa?.(pessoa)}
            disabled={!props.aoAbrirPessoa}
            title={props.aoAbrirPessoa ? "Abrir a página completa da pessoa" : "Página da pessoa indisponível neste contexto"}
            className="flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium arv-hover disabled:cursor-not-allowed disabled:opacity-40"
            style={{ border: `1px solid ${TREE.cartaoBordaForte}`, color: TREE.texto }}
          >
            <UserRound className="h-4 w-4" />
            Pessoa
          </button>
          <button
            type="button"
            onClick={() => aoVerArvore?.(pessoa.id)}
            disabled={!aoVerArvore}
            title={aoVerArvore ? "Ver a árvore a partir desta pessoa" : "Reposicionar a árvore indisponível neste contexto"}
            className="flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium arv-hover disabled:cursor-not-allowed disabled:opacity-40"
            style={{ border: `1px solid ${TREE.cartaoBordaForte}`, color: TREE.acentoTexto }}
          >
            <GitBranch className="h-4 w-4" />
            Árvore
          </button>
        </div>
      </header>

      {/* CORPO — uma rolagem só, na ordem da referência. As abas saíram: com
          seis delas os rótulos não cabiam nos 400px e o operador tinha de rolar
          a NAVEGAÇÃO para achar a navegação. A referência empilha as seções e
          rola o conteúdo, que é o gesto natural num painel estreito. */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-5">
          <Resumo {...props} indicador={indicador} alertas={alertas} />
          <section id="sec-relacoes" aria-label="Parentescos">
            <TituloSecao>Parentescos</TituloSecao>
            <Relacoes {...props} />
          </section>
          <section id="sec-dados" aria-label="Dados vitais">
            <TituloSecao>Dados vitais</TituloSecao>
            <Dados pessoa={pessoa} faltando={a?.faltando ?? []} aoEditar={props.aoEditar} />
          </section>
          <section id="sec-eventos" aria-label="Eventos">
            <TituloSecao>Eventos ({eventos.length})</TituloSecao>
            <Eventos eventos={eventos} />
          </section>
          <section id="sec-documental" aria-label="Situação documental">
            <TituloSecao>Situação documental</TituloSecao>
            <Documental {...props} indicador={indicador} />
          </section>
          <section id="sec-alertas" aria-label="Alertas">
            <TituloSecao>Alertas ({alertas.length})</TituloSecao>
            <Alertas insights={insights} aoIrParaPessoa={props.aoIrParaPessoa} />
          </section>
        </div>
      </div>
    </aside>
  )
})

/** Contador navegável do cabeçalho — leva à seção correspondente. */
function LinkSecao({ alvo, rotulo }: { alvo: string; rotulo: string }) {
  return (
    <button
      type="button"
      onClick={() => document.getElementById(alvo)?.scrollIntoView({ block: "start", behavior: "smooth" })}
      className="text-[12px] underline underline-offset-2 transition-colors"
      style={{ color: INFO }}
      title={`Ir para ${rotulo}`}
    >
      {rotulo}
    </button>
  )
}

function LinhaVital({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 font-semibold">{rotulo}:</dt>
      <dd className="min-w-0 truncate" style={{ color: TREE.textoFraco }} title={valor}>
        {valor}
      </dd>
    </div>
  )
}

function TituloSecao({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{ color: TREE.textoSuave }}
    >
      {children}
    </h3>
  )
}

/**
 * Dados vitais em uma linha.
 *
 * Sem data cadastrada o painel escreve "Não informado", nunca uma data
 * aproximada deduzida de outra coisa — a árvore mostra o que existe.
 */
function resumoNascimento(p: PessoaArvore): string {
  const partes = [
    formatarData(p.data_nasc) || null,
    [p.local_nasc, p.estado_nasc || p.pais_nasc].filter(Boolean).join(", ") || null,
  ].filter(Boolean)
  return partes.length ? partes.join(" · ") : "Não informado"
}

function resumoFalecimento(p: PessoaArvore): string {
  if (p.vivo !== false && !p.data_obito) return "Pessoa viva ou sem registro de óbito"
  const partes = [formatarData(p.data_obito) || null, p.local_obito || null].filter(Boolean)
  return partes.length ? partes.join(" · ") : "Falecido(a) — data não localizada"
}

// ---------------------------------------------------------------- Resumo
function Resumo({
  pessoa,
  indicador,
  alertas,
  analise,
  aoIrParaPessoa,
  aoAbrirPastaDocumental,
  aoEditar,
  aoAdicionarPai,
  aoAdicionarMae,
  aoAdicionarConjuge,
  aoAdicionarFilho,
}: PainelPessoaProps & { alertas: Insight[] }) {
  if (!pessoa) return null
  const a = analise.porPessoa.get(pessoa.id)
  const acoes: Array<{ rotulo: string; executar: () => void }> = []
  if (aoEditar) acoes.push({ rotulo: "Editar cadastro", executar: () => aoEditar(pessoa) })
  if (aoAdicionarPai && pessoa.paiId == null) acoes.push({ rotulo: "Adicionar pai", executar: () => aoAdicionarPai(pessoa.id) })
  if (aoAdicionarMae && pessoa.maeId == null) acoes.push({ rotulo: "Adicionar mãe", executar: () => aoAdicionarMae(pessoa.id) })
  if (aoAdicionarConjuge) acoes.push({ rotulo: "Adicionar cônjuge", executar: () => aoAdicionarConjuge(pessoa.id) })
  if (aoAdicionarFilho) acoes.push({ rotulo: "Adicionar filho(a)", executar: () => aoAdicionarFilho(pessoa.id) })
  if (aoAbrirPastaDocumental) {
    acoes.push({ rotulo: "Abrir Pasta Documental", executar: () => aoAbrirPastaDocumental(pessoa.id) })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Metrica rotulo="Ficha" valor={`${a?.completude ?? 0}%`} />
        <Metrica
          rotulo="Documental"
          valor={indicador.progresso != null ? `${indicador.progresso}%` : "—"}
          detalhe={ROTULO_SITUACAO[indicador.situacao]}
        />
      </div>

      {alertas.length > 0 && (
        <Secao titulo={`Principais alertas (${alertas.length})`}>
          <ul className="space-y-1">
            {alertas.slice(0, 3).map((i) => (
              <li key={i.id} className="flex items-start gap-1.5">
                <span
                  className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: SEVERIDADE_COR[i.severidade] }}
                />
                <span className="text-[11.5px] leading-snug" style={{ color: TREE.textoFraco }}>
                  {i.titulo}
                </span>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {a?.faltando?.length ? (
        <Secao titulo="Falta preencher">
          <p className="text-[11.5px] leading-snug" style={{ color: TREE.textoFraco }}>
            {a.faltando.join(" · ")}
          </p>
        </Secao>
      ) : null}

      <Secao titulo="Ações">
        <div className="flex flex-wrap gap-1.5">
          {acoes.map((ac) => (
            <button
              key={ac.rotulo}
              type="button"
              onClick={ac.executar}
              className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors arv-hover"
              style={{ border: `1px solid ${TREE.cartaoBorda}`, color: TREE.texto }}
            >
              {ac.rotulo}
            </button>
          ))}
          {acoes.length === 0 && (
            <p className="text-[11.5px]" style={{ color: TREE.textoSuave }}>
              Seu perfil não tem permissão para alterar esta árvore.
            </p>
          )}
        </div>
      </Secao>

      <Secao titulo="Pesquisa genealógica">
        <p className="text-[11.5px] leading-snug" style={{ color: TREE.textoSuave }}>
          Registrar hipótese, responsável e status de pesquisa depende de um modelo de Pesquisa
          Genealógica que o Discovery ainda não tem. As sugestões de onde procurar estão no painel
          “O que a árvore encontrou”.
        </p>
      </Secao>
    </div>
  )
}

// ---------------------------------------------------------------- Relações
function Relacoes({ pessoa, grafo, aoIrParaPessoa }: PainelPessoaProps) {
  if (!pessoa) return null
  const pais = grafo.paisDe(pessoa.id)
  const filhos = grafo.filhosOrdenados(grafo.filhosIds(pessoa.id)).map((i) => grafo.pessoa(i)!).filter(Boolean)

  // Cônjuges em ordem cronológica de união, com o período — num processo de
  // cidadania saber QUAL casamento veio primeiro decide de onde vem a linha.
  const conjuges = grafo.conjugesOrdenados(pessoa.id)

  // Irmandade CLASSIFICADA: inteiro, meio por parte de pai, meio por parte de
  // mãe, ou a confirmar quando o segundo genitor é desconhecido. Listar tudo
  // como "Irmãos" apagava a diferença que muda o escopo de certidão.
  const irmandade = grafo.irmandade(pessoa.id)
  const porTipo = new Map<TipoIrmandade, typeof irmandade>()
  for (const i of irmandade) {
    const arr = porTipo.get(i.tipo)
    if (arr) arr.push(i)
    else porTipo.set(i.tipo, [i])
  }
  const ordemIrmandade: TipoIrmandade[] = ["inteiro", "meio_paterno", "meio_materno", "indeterminado"]

  return (
    <div className="space-y-3">
      <Secao titulo={`Pais (${pais.length})`}>
        <ListaPessoas pessoas={pais} grafo={grafo} aoIrParaPessoa={aoIrParaPessoa} />
      </Secao>

      <Secao titulo={`Cônjuges (${conjuges.length})`}>
        {conjuges.length === 0 ? (
          <Vazio />
        ) : (
          <ul className="space-y-0.5">
            {conjuges.map((id, indice) => {
              const c = grafo.pessoa(id)
              if (!c) return null
              const uniao = grafo.unioesDe(pessoa.id).find((u) => u.pessoa1Id === id || u.pessoa2Id === id)
              const inicio = uniao?.data_inicio ? formatarData(uniao.data_inicio) : null
              const fim = uniao?.data_fim ? formatarData(uniao.data_fim) : null
              const filhosEmComum = grafo.casal(pessoa.id, id)?.filhos.length ?? 0
              const detalhe = [
                conjuges.length > 1 ? `${indice + 1}ª união` : null,
                inicio ? `casamento em ${inicio}` : null,
                fim ? `término em ${fim}` : null,
                filhosEmComum > 0 ? `${filhosEmComum} filho(s) em comum` : null,
              ]
                .filter(Boolean)
                .join(" · ")
              return (
                <li key={id}>
                  <ItemPessoa
                    nome={nomeCompleto(c)}
                    detalhe={detalhe || null}
                    onClick={() => aoIrParaPessoa(id)}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </Secao>

      <Secao titulo={`Filhos (${filhos.length})`}>
        <ListaPessoas pessoas={filhos} grafo={grafo} aoIrParaPessoa={aoIrParaPessoa} />
      </Secao>

      <Secao titulo={`Irmãos (${irmandade.length})`}>
        {irmandade.length === 0 ? (
          <Vazio />
        ) : (
          <div className="space-y-1.5">
            {ordemIrmandade
              .filter((t) => porTipo.has(t))
              .map((t) => (
                <div key={t}>
                  <p className="px-1.5 text-[10.5px] font-medium uppercase tracking-wide" style={{ color: TREE.textoSuave }}>
                    {ROTULO_IRMANDADE[t]}
                  </p>
                  <ul className="space-y-0.5">
                    {porTipo.get(t)!.map((i) => {
                      const p = grafo.pessoa(i.id)
                      if (!p) return null
                      const via = [
                        i.viaPaiId != null ? "mesmo pai" : null,
                        i.viaMaeId != null ? "mesma mãe" : null,
                      ]
                        .filter(Boolean)
                        .join(" e ")
                      return (
                        <li key={i.id}>
                          <ItemPessoa
                            nome={nomeCompleto(p)}
                            detalhe={via || null}
                            onClick={() => aoIrParaPessoa(i.id)}
                          />
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
          </div>
        )}
      </Secao>

      <p className="text-[11px] leading-snug" style={{ color: TREE.textoSuave }}>
        Irmandade é derivada da filiação, não é um vínculo próprio. Quando o segundo genitor é
        desconhecido em um dos dois, a árvore diz “a confirmar” em vez de afirmar meio-irmão.
        Vínculo não biológico (adoção, socioafetivo) e período de relação dependem de um modelo de
        Relação Familiar que o domínio ainda não tem — e a árvore não inventa esse dado.
      </p>
    </div>
  )
}

function Vazio() {
  return (
    <p className="text-[11.5px]" style={{ color: TREE.textoSuave }}>
      Nenhum registrado.
    </p>
  )
}

function ListaPessoas({
  pessoas,
  grafo,
  aoIrParaPessoa,
}: {
  pessoas: Array<{ id: number; nome: string; sobrenome?: string | null }>
  grafo: GrafoGenealogico
  aoIrParaPessoa: (id: number) => void
}) {
  if (pessoas.length === 0) return <Vazio />
  return (
    <ul className="space-y-0.5">
      {pessoas.map((p) => {
        const completo = grafo.pessoa(p.id)
        const anos = completo
          ? [completo.data_nasc ? formatarData(completo.data_nasc) : null].filter(Boolean).join("")
          : ""
        return (
          <li key={p.id}>
            <ItemPessoa
              nome={nomeCompleto(p)}
              detalhe={anos || null}
              onClick={() => aoIrParaPessoa(p.id)}
            />
          </li>
        )
      })}
    </ul>
  )
}

function ItemPessoa({
  nome,
  detalhe,
  onClick,
}: {
  nome: string
  detalhe: string | null
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left transition-colors arv-hover"
    >
      <Link2 className="h-3 w-3 shrink-0" style={{ color: TREE.textoSuave }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px]" style={{ color: TREE.texto }}>
          {nome}
        </span>
        {detalhe && (
          <span className="block truncate text-[10.5px]" style={{ color: TREE.textoSuave }}>
            {detalhe}
          </span>
        )}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------- Dados
function Dados({
  pessoa,
  faltando,
  aoEditar,
}: {
  pessoa: PessoaArvore
  faltando: string[]
  aoEditar?: (p: PessoaArvore) => void
}) {
  const campos: Array<[string, string | null | undefined]> = [
    ["Nome", pessoa.nome],
    ["Sobrenome", pessoa.sobrenome],
    ["Sexo", pessoa.sexo],
    ["Nascimento", pessoa.data_nasc ? formatarData(pessoa.data_nasc) : null],
    ["Cidade de nascimento", pessoa.local_nasc],
    ["País de nascimento", pessoa.pais_nasc],
    ["Nacionalidade", pessoa.nacionalidade],
    ["Profissão", pessoa.profissao],
    ["Falecimento", pessoa.data_obito ? formatarData(pessoa.data_obito) : null],
    ["Naturalização", pessoa.data_naturalizacao ? formatarData(pessoa.data_naturalizacao) : null],
    ["Navio", pessoa.navio],
    ["Porto de chegada", pessoa.porto_chegada],
    ["Observações", pessoa.comentario],
  ]

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-snug" style={{ color: TREE.textoSuave }}>
        Dados do Cadastro Mestre. A árvore lê — não guarda cópia e não edita direto: alterar abre o
        formulário oficial.
      </p>
      <dl className="space-y-1.5">
        {campos.map(([rotulo, valor]) => (
          <div key={rotulo} className="flex items-baseline gap-2">
            <dt className="w-[46%] shrink-0 text-[11px]" style={{ color: TREE.textoFraco }}>
              {rotulo}
            </dt>
            <dd className="min-w-0 flex-1 text-[12px]" style={{ color: valor ? TREE.texto : TREE.textoSuave }}>
              {valor || "não informado"}
            </dd>
          </div>
        ))}
      </dl>
      {faltando.length > 0 && (
        <p className="text-[11px] leading-snug" style={{ color: SEVERIDADE_COR.medio }}>
          Essencial ausente: {faltando.join(", ")}.
        </p>
      )}
      {aoEditar && (
        <button
          type="button"
          onClick={() => aoEditar(pessoa)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors arv-hover"
          style={{ border: `1px solid ${TREE.cartaoBorda}`, color: TREE.texto }}
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar no cadastro
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Eventos
function Eventos({ eventos }: { eventos: EventoProjetado[] }) {
  const [tipos, setTipos] = useState<Set<TipoEvento>>(new Set())
  const [semData, setSemData] = useState(true)

  const filtrados = useMemo(
    () => filtrarEventos(eventos, { tipos: tipos.size ? tipos : null, incluirSemData: semData }),
    [eventos, tipos, semData],
  )
  const lacunas = useMemo(() => detectarLacunas(eventos), [eventos])
  const disponiveis = useMemo(() => [...new Set(eventos.map((e) => e.tipo))], [eventos])

  if (eventos.length === 0) {
    return (
      <p className="text-[12px]" style={{ color: TREE.textoSuave }}>
        Nenhum evento registrado no cadastro desta pessoa.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {disponiveis.map((t) => {
          const ativo = tipos.has(t)
          return (
            <button
              key={t}
              type="button"
              aria-pressed={ativo}
              onClick={() =>
                setTipos((s) => {
                  const n = new Set(s)
                  if (n.has(t)) n.delete(t)
                  else n.add(t)
                  return n
                })
              }
              className="rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors"
              style={{
                border: `1px solid ${ativo ? TREE.acento : TREE.cartaoBorda}`,
                color: ativo ? TREE.acentoTexto : TREE.textoFraco,
                background: ativo ? TREE.acentoSuave : "transparent",
              }}
            >
              {ROTULO_EVENTO[t]}
            </button>
          )
        })}
        <button
          type="button"
          aria-pressed={!semData}
          onClick={() => setSemData((v) => !v)}
          className="rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors"
          style={{
            border: `1px solid ${TREE.cartaoBorda}`,
            color: semData ? TREE.textoFraco : TREE.acentoTexto,
          }}
          title="Esconder eventos cuja data ainda não foi localizada"
        >
          {semData ? "Ocultar sem data" : "Mostrar sem data"}
        </button>
      </div>

      <ol className="relative space-y-2 pl-4">
        <span
          aria-hidden
          className="absolute bottom-1 left-[5px] top-1 w-px"
          style={{ background: TREE.cartaoBorda }}
        />
        {filtrados.map((e) => {
          const cor =
            e.precisao === "conflito"
              ? SEVERIDADE_COR.critico
              : e.precisao === "ausente"
                ? SEVERIDADE_COR.medio
                : TREE.acento
          return (
            <li key={e.id} className="relative">
              <span
                aria-hidden
                className="absolute -left-4 top-[5px] h-2 w-2 rounded-full"
                style={{ background: cor, boxShadow: `0 0 0 2px ${TREE.cartao}` }}
              />
              <div className="flex items-baseline gap-2">
                <span className="w-10 shrink-0 text-[11px] tabular-nums" style={{ color: TREE.textoFraco }}>
                  {e.ano ?? "—"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium" style={{ color: TREE.texto }}>
                    {ROTULO_EVENTO[e.tipo]}
                    {e.precisao === "ausente" && (
                      <span className="ml-1 text-[10px]" style={{ color: SEVERIDADE_COR.medio }}>
                        data não localizada
                      </span>
                    )}
                    {e.precisao === "conflito" && (
                      <span className="ml-1 text-[10px]" style={{ color: SEVERIDADE_COR.critico }}>
                        data em conflito
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px]" style={{ color: TREE.textoFraco }}>
                    {[e.data ? formatarData(e.data) : null, e.local, e.detalhe].filter(Boolean).join(" · ") ||
                      "sem detalhes"}
                  </span>
                </span>
              </div>
            </li>
          )
        })}
      </ol>

      {lacunas.length > 0 && (
        <Secao titulo="Lacunas cronológicas">
          <ul className="space-y-0.5">
            {lacunas.map((l) => (
              <li key={`${l.de}-${l.ate}`} className="text-[11.5px]" style={{ color: TREE.textoFraco }}>
                {l.anos} anos sem registro entre {l.de} e {l.ate}
              </li>
            ))}
          </ul>
        </Secao>
      )}

      <p className="text-[10.5px] leading-snug" style={{ color: TREE.textoSuave }}>
        Linha do tempo projetada das colunas do cadastro. Nada aqui é armazenado: corrigir uma data
        se faz no cadastro da pessoa ou da união.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- Documental
function Documental({ pessoa, indicador, aoAbrirPastaDocumental }: PainelPessoaProps) {
  if (!pessoa) return null
  const linhas: Array<[string, number]> = [
    ["Atendidas", indicador.atendidas],
    ["Em atendimento", indicador.emAtendimento],
    ["Pendentes", indicador.pendentes],
    ["Não localizadas", indicador.naoLocalizadas],
    ["Dispensadas", indicador.dispensadas],
    ["Opcionais", indicador.opcionais],
  ]

  return (
    <div className="space-y-3">
      <div
        className="rounded-lg px-3 py-2"
        style={{ border: `1px solid ${TREE.cartaoBorda}`, background: TREE.hover }}
      >
        <p className="text-[12px] font-medium" style={{ color: TREE.texto }}>
          {ROTULO_SITUACAO[indicador.situacao]}
        </p>
        {indicador.progresso != null && (
          <p className="text-[11px]" style={{ color: TREE.textoFraco }}>
            {indicador.progresso}% de {indicador.necessarias} exigência(s) obrigatória(s)
          </p>
        )}
      </div>

      {indicador.necessarias === 0 && indicador.opcionais === 0 ? (
        <p className="text-[11.5px]" style={{ color: TREE.textoSuave }}>
          O Sistema Documental não registrou exigência para esta pessoa.
        </p>
      ) : (
        <dl className="space-y-1">
          {linhas
            .filter(([, v]) => v > 0)
            .map(([rotulo, valor]) => (
              <div key={rotulo} className="flex items-baseline justify-between">
                <dt className="text-[11.5px]" style={{ color: TREE.textoFraco }}>
                  {rotulo}
                </dt>
                <dd className="text-[12px] font-medium tabular-nums" style={{ color: TREE.texto }}>
                  {valor}
                </dd>
              </div>
            ))}
        </dl>
      )}

      {aoAbrirPastaDocumental && (
        <button
          type="button"
          onClick={() => aoAbrirPastaDocumental(pessoa.id)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors"
          style={{ background: SUCESSO_SUAVE, color: SUCESSO }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Abrir Pasta Documental
        </button>
      )}

      <p className="text-[10.5px] leading-snug" style={{ color: TREE.textoSuave }}>
        Indicador lido do Sistema Documental. Enviar, versionar, validar ou excluir documento
        acontece lá — a árvore só mostra e leva até ele.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- Alertas
function Alertas({
  insights,
  aoIrParaPessoa,
}: {
  insights: Insight[]
  aoIrParaPessoa: (id: number) => void
}) {
  if (insights.length === 0) {
    return (
      <p className="text-[12px]" style={{ color: TREE.textoSuave }}>
        Nenhuma inconsistência encontrada para esta pessoa.
      </p>
    )
  }
  return (
    <ul className="space-y-2">
      {insights.map((i) => (
        <li key={i.id}>
          <div className="rounded-lg px-2.5 py-2" style={{ border: `1px solid ${TREE.cartaoBorda}` }}>
            <div className="flex items-start gap-1.5">
              <span
                className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: SEVERIDADE_COR[i.severidade] }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium leading-snug" style={{ color: TREE.texto }}>
                  {i.titulo}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug" style={{ color: TREE.textoFraco }}>
                  {i.explicacao}
                </p>
                {i.acao && (
                  <p className="mt-1 text-[11px] font-medium leading-snug" style={{ color: TREE.acentoTexto }}>
                    → {i.acao}
                  </p>
                )}
                {i.pessoaIds.length > 1 && (
                  <button
                    type="button"
                    onClick={() => aoIrParaPessoa(i.pessoaIds[1])}
                    className="mt-1 text-[11px] underline"
                    style={{ color: TREE.textoFraco }}
                  >
                    Ver a outra pessoa envolvida
                  </button>
                )}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------- comuns
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h3
        className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: TREE.textoFraco }}
      >
        {titulo}
      </h3>
      {children}
    </section>
  )
}

function Metrica({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-lg px-2.5 py-2" style={{ border: `1px solid ${TREE.cartaoBorda}` }}>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: TREE.textoFraco }}>
        {rotulo}
      </p>
      <p className="text-[16px] font-semibold tabular-nums" style={{ color: TREE.texto }}>
        {valor}
      </p>
      {detalhe && (
        <p className="truncate text-[10.5px]" style={{ color: TREE.textoSuave }} title={detalhe}>
          {detalhe}
        </p>
      )}
    </div>
  )
}
