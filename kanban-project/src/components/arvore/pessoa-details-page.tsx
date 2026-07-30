// src/components/arvore/pessoa-details-page.tsx
//
// PÁGINA COMPLETA DA PESSOA.
//
// Composição da experiência de referência, reconstruída sobre os conceitos
// OFICIAIS do Discovery:
//
//   cabeçalho ...... retrato, nome, resumo vital, identificador e as três ações
//                    (ver árvore · ver parentesco · abrir pasta documental)
//   abas ........... Sobre · Detalhes · Fontes · Auditoria · Linha do tempo
//
// MAPEAMENTO DELIBERADO (e o que NÃO foi copiado):
//
//   "Fontes"        → referências do SISTEMA DOCUMENTAL (Necessidade
//                     Documental / Documento do Processo). A árvore LISTA e
//                     LEVA até lá; não cria, não versiona, não aprova e não
//                     guarda documento. Fonte genealógica não é Documento
//                     Mestre, e por isso a tabela aqui é leitura.
//   "Colaborar"     → AUDITORIA. O Discovery não tem colaboração pública entre
//                     usuários; tem trilha de alteração. O que existe é o que
//                     aparece.
//   "Recordações"   → NÃO EXISTE. Não há módulo oficial de mídia de pessoa no
//                     Discovery, e criar um só para imitar o nome da referência
//                     seria inventar domínio. A aba não é desenhada.
//
// A "breve história de vida" é GERADA a partir dos dados da própria ficha e diz
// isso na tela. Nenhuma frase é inventada: sem dado, não há texto.

"use client"

import { useMemo, useState } from "react"
import {
  ChevronLeft,
  FileText,
  FolderOpen,
  GitBranch,
  MapPin,
  Pencil,
  Route,
  UserPlus,
} from "lucide-react"
import type { PessoaArvore, UniaoArvore } from "./types"
import { corGenero, INFO, SEVERIDADE_COR, TREE } from "./motor/tokens"
import type { NecessidadeOficial } from "@/src/lib/genealogia/documental/indicadores"
import { ROTULO_SITUACAO, projetarIndicadores, indicadorDaPessoa } from "@/src/lib/genealogia/documental/indicadores"

type Aba = "sobre" | "detalhes" | "fontes" | "auditoria" | "linha"

const ABAS: Array<{ id: Aba; rotulo: (n: Contadores) => string }> = [
  { id: "sobre", rotulo: () => "Sobre" },
  { id: "detalhes", rotulo: () => "Detalhes" },
  { id: "fontes", rotulo: (n) => `Fontes (${n.fontes})` },
  { id: "auditoria", rotulo: () => "Auditoria" },
  { id: "linha", rotulo: () => "Linha do tempo" },
]

interface Contadores {
  fontes: number
}

export interface PessoaDetailsPageProps {
  pessoa: PessoaArvore
  conjuge?: PessoaArvore | null
  casamento?: UniaoArvore | null
  filhos?: PessoaArvore[]
  /** Pais e irmãos — a aba Detalhes precisa deles para "Membros da família". */
  pais?: PessoaArvore[]
  irmaos?: PessoaArvore[]
  /** Necessidades OFICIAIS do Sistema Documental (a "fonte" desta pessoa). */
  necessidades?: NecessidadeOficial[]
  /** Grau de parentesco com o requerente, quando o motor souber calcular. */
  parentesco?: string | null
  onBack: () => void
  onPersonClick?: (pessoa: PessoaArvore) => void
  onAddPai?: (pessoaId: number) => void
  onAddMae?: (pessoaId: number) => void
  onAddFilho?: (pessoaId: number) => void
  onAddConjuge?: (pessoaId: number) => void
  /** Volta para a árvore posicionada nesta pessoa. */
  onVerArvore?: (pessoaId: number) => void
  /** Abre a Pasta Documental — o dono do documento. */
  onAbrirPastaDocumental?: (pessoaId: number) => void
  onEditar?: (pessoa: PessoaArvore) => void
}

// ---------------------------------------------------------------- utilitários

function ano(v: Date | string | null | undefined): string | null {
  if (!v) return null
  const t = typeof v === "string" ? v : v.toISOString()
  const m = t.match(/(\d{4})/)
  return m ? m[1] : null
}

function dataLonga(v: Date | string | null | undefined): string | null {
  if (!v) return null
  const d = typeof v === "string" ? new Date(v) : v
  if (Number.isNaN(d.getTime())) return typeof v === "string" ? v : null
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
}

function lugarNasc(p: PessoaArvore): string | null {
  return [p.local_nasc, p.estado_nasc, p.pais_nasc].filter(Boolean).join(", ") || null
}

function nomeDe(p: PessoaArvore): string {
  return p.sobrenome ? `${p.nome} ${p.sobrenome}` : p.nome
}

function resumoVital(p: PessoaArvore): string {
  const n = ano(p.data_nasc)
  const o = ano(p.data_obito)
  const falecida = p.vivo === false || !!p.data_obito
  const rotulo = (p.sexo || "").toLowerCase().startsWith("f") ? "Falecida" : "Falecido"
  if (n && o) return `${n} – ${o}`
  if (n) return falecida ? `${n} – ${rotulo}` : `${n} – Viva(o)`
  if (o) return `Nascimento não localizado – ${o}`
  return falecida ? rotulo : "Datas não localizadas"
}

/**
 * História de vida GERADA.
 *
 * Só usa o que está na ficha e no núcleo familiar. Cada frase existe porque o
 * dado existe — sem data não há frase sobre data, sem cônjuge não há frase
 * sobre casamento. É por isso que a tela pode dizer, com honestidade, de onde
 * o texto veio.
 */
function historiaGerada(
  p: PessoaArvore,
  conjuge: PessoaArvore | null | undefined,
  filhos: PessoaArvore[],
): string[] {
  const frases: string[] = []
  const n = ano(p.data_nasc)
  const lugar = lugarNasc(p)
  if (n && lugar) frases.push(`${nomeDe(p)} nasceu em ${n}, em ${lugar}.`)
  else if (n) frases.push(`${nomeDe(p)} nasceu em ${n}.`)
  else if (lugar) frases.push(`${nomeDe(p)} nasceu em ${lugar}.`)

  if (conjuge) {
    const casou = ano((p as unknown as { data_casamento?: string }).data_casamento)
    frases.push(
      casou
        ? `Casou-se com ${nomeDe(conjuge)} em ${casou}.`
        : `Uniu-se a ${nomeDe(conjuge)}.`,
    )
  }
  if (filhos.length) {
    frases.push(
      filhos.length === 1
        ? `Teve pelo menos 1 filho(a) registrado(a) na árvore.`
        : `Teve pelo menos ${filhos.length} filhos registrados na árvore.`,
    )
  }
  const o = ano(p.data_obito)
  if (o) frases.push(`Faleceu em ${o}${p.local_obito ? `, em ${p.local_obito}` : ""}.`)
  return frases
}

/** Evento da linha do tempo — projeção, nunca persistência. */
interface EventoLinha {
  ano: string
  titulo: string
  detalhe: string
  lugar: string | null
}

function linhaDoTempo(
  p: PessoaArvore,
  conjuge: PessoaArvore | null | undefined,
  casamento: UniaoArvore | null | undefined,
  filhos: PessoaArvore[],
): EventoLinha[] {
  const eventos: EventoLinha[] = []
  const nasc = ano(p.data_nasc)
  if (nasc) {
    eventos.push({
      ano: nasc,
      titulo: "Nascimento",
      detalhe: dataLonga(p.data_nasc) ?? nasc,
      lugar: lugarNasc(p),
    })
  }
  const bat = ano(p.data_batismo)
  if (bat) {
    eventos.push({
      ano: bat,
      titulo: "Batismo",
      detalhe: dataLonga(p.data_batismo) ?? bat,
      lugar: [p.igreja_batismo, p.local_batismo].filter(Boolean).join(", ") || null,
    })
  }
  const cas = ano(casamento?.data_inicio)
  if (cas) {
    eventos.push({
      ano: cas,
      titulo: "Casamento",
      detalhe: conjuge ? `com ${nomeDe(conjuge)}` : (dataLonga(casamento?.data_inicio) ?? cas),
      lugar: [casamento?.local, casamento?.pais].filter(Boolean).join(", ") || null,
    })
  }
  for (const f of filhos) {
    const a = ano(f.data_nasc)
    if (!a) continue
    const idade = nasc ? Number(a) - Number(nasc) : null
    eventos.push({
      ano: a,
      titulo: idade != null ? `Nascimento de filho(a) · Idade ${idade}` : "Nascimento de filho(a)",
      detalhe: nomeDe(f),
      lugar: lugarNasc(f),
    })
  }
  const emig = ano(p.data_emigracao)
  if (emig) {
    eventos.push({
      ano: emig,
      titulo: "Emigração",
      detalhe: [p.porto_embarque, p.navio].filter(Boolean).join(" · ") || dataLonga(p.data_emigracao) || emig,
      lugar: p.local_emigracao ?? null,
    })
  }
  const cheg = ano(p.data_chegada)
  if (cheg) {
    eventos.push({
      ano: cheg,
      titulo: "Chegada",
      detalhe: p.porto_chegada ?? dataLonga(p.data_chegada) ?? cheg,
      lugar: p.pais_destino ?? null,
    })
  }
  const nat = ano(p.data_naturalizacao)
  if (nat) {
    eventos.push({
      ano: nat,
      titulo: "Naturalização",
      detalhe: dataLonga(p.data_naturalizacao) ?? nat,
      lugar: p.pais_naturalizacao ?? null,
    })
  }
  const ob = ano(p.data_obito)
  if (ob) {
    eventos.push({
      ano: ob,
      titulo: "Falecimento",
      detalhe: dataLonga(p.data_obito) ?? ob,
      lugar: p.local_obito ?? null,
    })
  }
  return eventos.sort((a, b) => Number(a.ano) - Number(b.ano))
}

// ---------------------------------------------------------------- componente

export function PessoaDetailsPage({
  pessoa,
  conjuge,
  casamento,
  filhos = [],
  pais = [],
  irmaos = [],
  necessidades,
  parentesco,
  onBack,
  onPersonClick,
  onAddPai,
  onAddMae,
  onAddFilho,
  onAddConjuge,
  onVerArvore,
  onAbrirPastaDocumental,
  onEditar,
}: PessoaDetailsPageProps) {
  const [aba, setAba] = useState<Aba>("sobre")

  const genero = corGenero(pessoa.sexo)
  const codigo = (pessoa as { publicCode?: string | null }).publicCode || null

  // "Fontes" = o que o SISTEMA DOCUMENTAL registrou para esta pessoa. A árvore
  // projeta o indicador oficial e lista as necessidades; não guarda nada.
  const projecao = useMemo(() => projetarIndicadores(necessidades), [necessidades])
  const indicador = useMemo(
    () => indicadorDaPessoa(projecao, pessoa.id, []),
    [projecao, pessoa.id],
  )
  const fontes = useMemo(
    () => (necessidades ?? []).filter((n) => n.pessoaId === pessoa.id),
    [necessidades, pessoa.id],
  )

  const eventos = useMemo(
    () => linhaDoTempo(pessoa, conjuge, casamento, filhos),
    [pessoa, conjuge, casamento, filhos],
  )
  const historia = useMemo(() => historiaGerada(pessoa, conjuge, filhos), [pessoa, conjuge, filhos])
  const contadores: Contadores = { fontes: fontes.length }

  return (
    <div
      className="fixed inset-0 z-[9500] flex flex-col overflow-hidden"
      style={{ background: TREE.fundo }}
      role="dialog"
      aria-label={`Página de ${nomeDe(pessoa)}`}
    >
      {/* Régua de identidade — a faixa que a referência põe no topo da ficha. */}
      <div aria-hidden className="h-[5px] shrink-0" style={{ background: genero.linha }} />

      <header className="shrink-0 px-6 pb-0 pt-5" style={{ background: TREE.cartao }}>
        <div className="mx-auto flex max-w-[1180px] items-start gap-4">
          <button
            type="button"
            onClick={onBack}
            title="Voltar à árvore"
            aria-label="Voltar à árvore"
            className="mt-1 rounded-md p-1.5 arv-hover"
            style={{ color: TREE.textoFraco }}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <span
            aria-hidden
            className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full"
            style={{ background: genero.suave, border: `1px solid ${genero.linha}`, color: genero.tinta }}
          >
            <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="8.2" r="4" />
              <path d="M3.8 21c0-4.3 3.7-7 8.2-7s8.2 2.7 8.2 7z" />
            </svg>
          </span>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[30px] font-bold leading-tight" style={{ color: TREE.texto }}>
              {nomeDe(pessoa)}
            </h1>
            <p className="mt-0.5 text-[14px]" style={{ color: TREE.textoFraco }}>
              {resumoVital(pessoa)}
              {codigo && (
                <>
                  {" • "}
                  <span className="text-[12px] tabular-nums" style={{ color: TREE.textoSuave }}>
                    {codigo}
                  </span>
                </>
              )}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-5">
              <AcaoCabecalho
                icone={<GitBranch className="h-4 w-4" />}
                rotulo="Ver árvore"
                onClick={onVerArvore ? () => onVerArvore(pessoa.id) : undefined}
                indisponivel="Reposicionar a árvore não está disponível neste contexto"
              />
              <AcaoCabecalho
                icone={<Route className="h-4 w-4" />}
                rotulo={parentesco ? `Parentesco: ${parentesco}` : "Ver parentesco"}
                onClick={undefined}
                indisponivel={
                  parentesco
                    ? "O grau já está calculado e exibido aqui"
                    : "Sem requerente identificado para calcular o parentesco"
                }
              />
              <AcaoCabecalho
                icone={<FolderOpen className="h-4 w-4" />}
                rotulo="Pasta documental"
                onClick={onAbrirPastaDocumental ? () => onAbrirPastaDocumental(pessoa.id) : undefined}
                indisponivel="Pasta Documental indisponível neste contexto"
              />
              <AcaoCabecalho
                icone={<Pencil className="h-4 w-4" />}
                rotulo="Editar"
                onClick={onEditar ? () => onEditar(pessoa) : undefined}
                indisponivel="Seu perfil não tem permissão para editar esta pessoa"
              />
            </div>
          </div>
        </div>

        <nav
          role="tablist"
          aria-label="Seções da pessoa"
          className="mx-auto mt-4 flex max-w-[1180px] justify-center gap-1"
        >
          {ABAS.map((t) => {
            const ativo = aba === t.id
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={ativo}
                type="button"
                onClick={() => setAba(t.id)}
                className="relative px-4 py-2 text-[13.5px] font-medium transition-colors"
                style={{ color: ativo ? INFO : TREE.textoFraco }}
              >
                {t.rotulo(contadores)}
                {ativo && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 bottom-0 h-[3px] rounded-t"
                    style={{ background: INFO }}
                  />
                )}
              </button>
            )
          })}
        </nav>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-5" role="tabpanel">
        <div className="mx-auto max-w-[1180px]">
          {aba === "sobre" && (
            <Sobre
              pessoa={pessoa}
              conjuge={conjuge}
              filhos={filhos}
              historia={historia}
              eventos={eventos}
              fontes={fontes}
              onPersonClick={onPersonClick}
              onVerLinha={() => setAba("linha")}
              onVerFontes={() => setAba("fontes")}
            />
          )}
          {aba === "detalhes" && (
            <Detalhes
              pessoa={pessoa}
              conjuge={conjuge}
              casamento={casamento}
              filhos={filhos}
              pais={pais}
              irmaos={irmaos}
              indicadorRotulo={ROTULO_SITUACAO[indicador.situacao]}
              progresso={indicador.progresso}
              onPersonClick={onPersonClick}
              onAddPai={onAddPai}
              onAddMae={onAddMae}
              onAddFilho={onAddFilho}
              onAddConjuge={onAddConjuge}
              onEditar={onEditar}
            />
          )}
          {aba === "fontes" && (
            <Fontes
              fontes={fontes}
              onAbrirPastaDocumental={onAbrirPastaDocumental ? () => onAbrirPastaDocumental(pessoa.id) : undefined}
            />
          )}
          {aba === "auditoria" && <Auditoria pessoa={pessoa} />}
          {aba === "linha" && <LinhaDoTempo eventos={eventos} />}
        </div>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------- cabeçalho

/**
 * Ação do cabeçalho.
 *
 * Sem destino a ação NÃO some — ela aparece desabilitada e explica por quê no
 * tooltip. Sumir esconde a capacidade; um botão inerte mente. Desabilitado com
 * motivo é a única forma honesta.
 */
function AcaoCabecalho({
  icone,
  rotulo,
  onClick,
  indisponivel,
}: {
  icone: React.ReactNode
  rotulo: string
  onClick?: () => void
  indisponivel: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={onClick ? rotulo : indisponivel}
      aria-label={rotulo}
      className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-wide transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      style={{ color: INFO }}
    >
      {icone}
      {rotulo}
    </button>
  )
}

// ---------------------------------------------------------------- Sobre

function Sobre({
  pessoa,
  conjuge,
  filhos,
  historia,
  eventos,
  fontes,
  onPersonClick,
  onVerLinha,
  onVerFontes,
}: {
  pessoa: PessoaArvore
  conjuge?: PessoaArvore | null
  filhos: PessoaArvore[]
  historia: string[]
  eventos: EventoLinha[]
  fontes: NecessidadeOficial[]
  onPersonClick?: (p: PessoaArvore) => void
  onVerLinha: () => void
  onVerFontes: () => void
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4">
        <Cartao titulo={`Uma breve história de vida de ${pessoa.nome}`}>
          {historia.length ? (
            <>
              <p className="text-[13.5px] leading-relaxed" style={{ color: TREE.texto }}>
                {historia.join(" ")}
              </p>
              <p className="mt-3 text-[11.5px] leading-snug" style={{ color: TREE.textoSuave }}>
                Este texto é gerado pelo Discovery a partir dos dados da aba Detalhes. Para
                alterá-lo, corrija os dados — não há texto guardado separadamente.
              </p>
            </>
          ) : (
            <Vazio>
              Ainda não há dado suficiente na ficha para escrever a história desta pessoa.
            </Vazio>
          )}
        </Cartao>

        <Cartao titulo="Cônjuge e filhos">
          <ul className="space-y-1">
            <ItemPessoa pessoa={pessoa} destaque />
            {conjuge ? (
              <ItemPessoa pessoa={conjuge} onClick={onPersonClick} />
            ) : (
              <li className="px-2 py-1.5 text-[12.5px]" style={{ color: TREE.textoSuave }}>
                Nenhum cônjuge cadastrado.
              </li>
            )}
          </ul>
          <p className="mb-1 mt-3 text-[12px] font-semibold" style={{ color: TREE.texto }}>
            Filhos ({filhos.length})
          </p>
          {filhos.length ? (
            <ul className="space-y-1">
              {filhos.map((f) => (
                <ItemPessoa key={f.id} pessoa={f} onClick={onPersonClick} />
              ))}
            </ul>
          ) : (
            <Vazio>Nenhum filho cadastrado.</Vazio>
          )}
        </Cartao>
      </div>

      <Cartao titulo="Origem e deslocamento">
        <dl className="space-y-2">
          <Linha rotulo="Nascimento" valor={lugarNasc(pessoa) ?? "Não informado"} />
          <Linha rotulo="Nacionalidade" valor={pessoa.nacionalidade ?? "Não informada"} />
          <Linha rotulo="Profissão" valor={pessoa.profissao ?? "Não informada"} />
          <Linha
            rotulo="Emigração"
            valor={
              [pessoa.local_emigracao, pessoa.porto_embarque, pessoa.navio].filter(Boolean).join(" · ") ||
              "Sem registro"
            }
          />
          <Linha
            rotulo="Chegada"
            valor={
              [pessoa.porto_chegada, pessoa.pais_destino].filter(Boolean).join(" · ") || "Sem registro"
            }
          />
          <Linha
            rotulo="Naturalização"
            valor={
              pessoa.naturalizado
                ? [dataLonga(pessoa.data_naturalizacao), pessoa.pais_naturalizacao]
                    .filter(Boolean)
                    .join(" · ") || "Naturalizado(a)"
                : "Sem registro"
            }
          />
        </dl>
      </Cartao>

      <div className="space-y-4">
        <Cartao
          titulo="Linha do tempo"
          acao={{ rotulo: "Ver com o mapa", onClick: onVerLinha }}
        >
          {eventos.length ? (
            <ol className="space-y-2">
              {eventos.slice(0, 4).map((e, i) => (
                <li key={`${e.ano}-${i}`} className="flex gap-3">
                  <span
                    className="w-[38px] shrink-0 text-[12px] tabular-nums"
                    style={{ color: TREE.textoFraco }}
                  >
                    {e.ano}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold" style={{ color: TREE.texto }}>
                      {e.titulo}
                    </span>
                    <span className="block text-[12px]" style={{ color: TREE.textoFraco }}>
                      {e.detalhe}
                      {e.lugar ? ` · ${e.lugar}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <Vazio>Nenhum evento datado nesta ficha.</Vazio>
          )}
        </Cartao>

        <Cartao titulo={`Fontes (${fontes.length})`} acao={{ rotulo: "Ver todas", onClick: onVerFontes }}>
          {fontes.length ? (
            <ul className="space-y-1.5">
              {fontes.slice(0, 4).map((f) => (
                <li key={f.id} className="flex items-start gap-2">
                  <FileText className="mt-[2px] h-3.5 w-3.5 shrink-0" style={{ color: TREE.textoSuave }} />
                  <span className="text-[12.5px] leading-snug" style={{ color: TREE.texto }}>
                    {f.itemCatalogo?.name ?? f.itemCatalogo?.code ?? `Necessidade #`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Vazio>
              O Sistema Documental ainda não registrou nenhuma exigência para esta pessoa.
            </Vazio>
          )}
        </Cartao>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Detalhes

function Detalhes({
  pessoa,
  conjuge,
  casamento,
  filhos,
  pais,
  irmaos,
  indicadorRotulo,
  progresso,
  onPersonClick,
  onAddPai,
  onAddMae,
  onAddFilho,
  onAddConjuge,
  onEditar,
}: {
  pessoa: PessoaArvore
  conjuge?: PessoaArvore | null
  casamento?: UniaoArvore | null
  filhos: PessoaArvore[]
  pais: PessoaArvore[]
  irmaos: PessoaArvore[]
  indicadorRotulo: string
  progresso: number | null
  onPersonClick?: (p: PessoaArvore) => void
  onAddPai?: (id: number) => void
  onAddMae?: (id: number) => void
  onAddFilho?: (id: number) => void
  onAddConjuge?: (id: number) => void
  onEditar?: (p: PessoaArvore) => void
}) {
  const temPai = pais.some((p) => p.id === pessoa.paiId)
  const temMae = pais.some((p) => p.id === pessoa.maeId)

  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-4">
        <Cartao titulo="Dados vitais">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Linha rotulo="Nome" valor={nomeDe(pessoa)} />
            <Linha rotulo="Sexo" valor={pessoa.sexo || "Não informado"} />
            <Linha
              rotulo="Nascimento"
              valor={[dataLonga(pessoa.data_nasc), lugarNasc(pessoa)].filter(Boolean).join(" · ") || "Não informado"}
            />
            <Linha
              rotulo="Batizado"
              valor={
                // `batizado` é campo próprio da ficha (o "sim/não" do sacramento)
                // e estava sendo ignorado: a página só lia data, igreja e local.
                // Uma pessoa marcada como batizada sem data aparecia como "Sem
                // registro", que é o contrário do que a ficha diz.
                [
                  pessoa.batizado,
                  dataLonga(pessoa.data_batismo),
                  pessoa.igreja_batismo,
                  pessoa.local_batismo,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Sem registro"
              }
            />
            <Linha
              rotulo="Falecimento"
              valor={
                pessoa.vivo === false || pessoa.data_obito
                  ? [dataLonga(pessoa.data_obito), pessoa.local_obito].filter(Boolean).join(" · ") ||
                    "Falecido(a) — data não localizada"
                  : "Pessoa viva ou sem registro"
              }
            />
            <Linha rotulo="Sepultamento" valor="Sem registro" />
          </dl>
          {onEditar && (
            <button
              type="button"
              onClick={() => onEditar(pessoa)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium arv-hover"
              style={{ border: `1px solid ${TREE.cartaoBorda}`, color: TREE.texto }}
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar dados vitais
            </button>
          )}
        </Cartao>

        <Cartao titulo="Outras informações">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Linha rotulo="Profissão" valor={pessoa.profissao ?? "Não informada"} />
            <Linha rotulo="Nacionalidade" valor={pessoa.nacionalidade ?? "Não informada"} />
            <Linha rotulo="Outras cidadanias" valor={pessoa.cidadanias_outras ?? "Sem registro"} />
            <Linha rotulo="Anotações" valor={pessoa.comentario ?? "Sem anotação"} />
          </dl>
        </Cartao>

        <Cartao titulo="Membros da família">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[12px] font-semibold" style={{ color: TREE.texto }}>
                Cônjuge e filhos
              </p>
              <ul className="space-y-1">
                <ItemPessoa pessoa={pessoa} destaque />
                {conjuge ? (
                  <ItemPessoa pessoa={conjuge} onClick={onPersonClick} />
                ) : (
                  <Acrescentar
                    rotulo="Acrescentar o cônjuge"
                    onClick={onAddConjuge ? () => onAddConjuge(pessoa.id) : undefined}
                  />
                )}
              </ul>
              {casamento && (
                <p className="mt-1.5 text-[11.5px]" style={{ color: TREE.textoFraco }}>
                  Casamento:{" "}
                  {[dataLonga(casamento.data_inicio), casamento.local].filter(Boolean).join(" · ") ||
                    "sem data registrada"}
                </p>
              )}
              <p className="mb-1 mt-3 text-[12px] font-semibold" style={{ color: TREE.texto }}>
                Filhos ({filhos.length})
              </p>
              <ul className="space-y-1">
                {filhos.map((f) => (
                  <ItemPessoa key={f.id} pessoa={f} onClick={onPersonClick} />
                ))}
                <Acrescentar
                  rotulo="Acrescentar filho(a)"
                  onClick={onAddFilho ? () => onAddFilho(pessoa.id) : undefined}
                />
              </ul>
            </div>

            <div>
              <p className="mb-1.5 text-[12px] font-semibold" style={{ color: TREE.texto }}>
                Pais e irmãos
              </p>
              <ul className="space-y-1">
                {pais.map((p) => (
                  <ItemPessoa key={p.id} pessoa={p} onClick={onPersonClick} />
                ))}
                {!temPai && (
                  <Acrescentar
                    rotulo="Acrescentar o pai"
                    onClick={onAddPai ? () => onAddPai(pessoa.id) : undefined}
                  />
                )}
                {!temMae && (
                  <Acrescentar
                    rotulo="Acrescentar a mãe"
                    onClick={onAddMae ? () => onAddMae(pessoa.id) : undefined}
                  />
                )}
              </ul>
              <p className="mb-1 mt-3 text-[12px] font-semibold" style={{ color: TREE.texto }}>
                Irmãos ({irmaos.length})
              </p>
              {irmaos.length ? (
                <ul className="space-y-1">
                  {irmaos.map((i) => (
                    <ItemPessoa key={i.id} pessoa={i} onClick={onPersonClick} />
                  ))}
                </ul>
              ) : (
                <Vazio>Nenhum irmão cadastrado.</Vazio>
              )}
            </div>
          </div>
        </Cartao>
      </div>

      <div className="space-y-4">
        <Cartao titulo="Situação documental">
          <p className="text-[13px]" style={{ color: TREE.texto }}>
            {indicadorRotulo}
            {progresso != null ? ` — ${progresso}%` : ""}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-snug" style={{ color: TREE.textoSuave }}>
            O dossiê pertence ao Sistema Documental. A árvore mostra a situação e leva até a Pasta
            Documental; documento nenhum é criado, versionado ou aprovado aqui.
          </p>
        </Cartao>

        <Cartao titulo="Identificação">
          <dl className="space-y-2">
            <Linha rotulo="Código" valor={(pessoa as { publicCode?: string | null }).publicCode ?? "Sem código"} />
            <Linha rotulo="Identificador interno" valor={`#${pessoa.id}`} />
            <Linha
              rotulo="Requerente"
              valor={pessoa.requerente && pessoa.requerente !== "nao" ? "Sim" : "Não"}
            />
            <Linha rotulo="Linha reta" valor={pessoa.linhaReta ? "Sim" : "Não"} />
          </dl>
        </Cartao>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Fontes

function Fontes({
  fontes,
  onAbrirPastaDocumental,
}: {
  fontes: NecessidadeOficial[]
  onAbrirPastaDocumental?: () => void
}) {
  return (
    <Cartao
      titulo={`Fontes (${fontes.length})`}
      acao={
        onAbrirPastaDocumental
          ? { rotulo: "Abrir a Pasta Documental", onClick: onAbrirPastaDocumental }
          : undefined
      }
    >
      <p className="mb-3 text-[11.5px] leading-snug" style={{ color: TREE.textoSuave }}>
        Estas são as exigências que o Sistema Documental registrou para esta pessoa. A árvore lê e
        aponta; acrescentar, anexar ou aprovar documento acontece na Pasta Documental.
      </p>

      {fontes.length === 0 ? (
        <Vazio>Nenhuma exigência documental registrada para esta pessoa.</Vazio>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr style={{ borderBottom: `1px solid ${TREE.cartaoBorda}` }}>
                <Th>Documento</Th>
                <Th>Situação</Th>
                <Th>Obrigatoriedade</Th>
              </tr>
            </thead>
            <tbody>
              {fontes.map((f) => (
                <tr key={f.id} style={{ borderBottom: `1px solid ${TREE.cartaoBorda}` }}>
                  <Td>{f.itemCatalogo?.name ?? f.itemCatalogo?.code ?? `Necessidade #`}</Td>
                  <Td>{f.status ?? "—"}</Td>
                  <Td>{f.obrigatoriedade === "OBRIGATORIA" ? "Obrigatória" : "Opcional"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Cartao>
  )
}

// ---------------------------------------------------------------- Auditoria

function Auditoria({ pessoa }: { pessoa: PessoaArvore }) {
  const linhas = [
    pessoa.createdAt ? { rotulo: "Cadastro criado", quando: dataLonga(pessoa.createdAt) } : null,
    pessoa.updatedAt ? { rotulo: "Última alteração", quando: dataLonga(pessoa.updatedAt) } : null,
  ].filter(Boolean) as Array<{ rotulo: string; quando: string | null }>

  return (
    <Cartao titulo="Auditoria">
      <p className="mb-3 text-[11.5px] leading-snug" style={{ color: TREE.textoSuave }}>
        O Discovery registra trilha de alteração, não colaboração pública entre usuários. O que
        aparece aqui é o que a ficha guarda; a trilha completa por operação vive no Log de
        Auditoria do processo.
      </p>
      {linhas.length ? (
        <dl className="space-y-2">
          {linhas.map((l) => (
            <Linha key={l.rotulo} rotulo={l.rotulo} valor={l.quando ?? "—"} />
          ))}
        </dl>
      ) : (
        <Vazio>Esta ficha ainda não tem carimbo de criação ou alteração.</Vazio>
      )}
    </Cartao>
  )
}

// ---------------------------------------------------------------- Linha do tempo

/**
 * Linha do tempo com painel de lugares.
 *
 * A referência põe um MAPA ao lado. Aqui não há mapa desenhado, e isso é
 * deliberado: o Discovery não guarda coordenada de nenhum evento, e o único
 * jeito de desenhar um pino seria geocodificar o texto do lugar em silêncio —
 * transformando "Vittorio Veneto" num ponto que ninguém conferiu e que o
 * operador leria como dado. O painel lista os lugares reais, agrupados, e diz
 * exatamente por que não há mapa.
 */
function LinhaDoTempo({ eventos }: { eventos: EventoLinha[] }) {
  /**
   * Agrupamento de lugares por CONTENÇÃO, não por semelhança.
   *
   * "Caxias do Sul" e "Caxias do Sul, RS" aparecem como dois lugares porque
   * vêm de campos diferentes (a união guarda só a localidade; a pessoa guarda
   * localidade + estado). Contá-los separado é ruído, e aproximá-los por
   * fonética seria adivinhação. O critério aqui é literal e verificável: quando
   * uma cadeia de segmentos é PREFIXO da outra, é o mesmo lugar escrito com
   * menos detalhe — e a tela mostra a forma mais completa.
   */
  const lugares = useMemo(() => {
    const segmentos = (s: string) =>
      s
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)

    const grupos: Array<{ rotulo: string; chave: string[]; total: number }> = []
    for (const e of eventos) {
      if (!e.lugar) continue
      const chave = segmentos(e.lugar)
      const ehPrefixo = (a: string[], b: string[]) =>
        a.length <= b.length && a.every((v, i) => v === b[i])

      const existente = grupos.find((g) => ehPrefixo(g.chave, chave) || ehPrefixo(chave, g.chave))
      if (!existente) {
        grupos.push({ rotulo: e.lugar, chave, total: 1 })
        continue
      }
      existente.total++
      // Fica a forma mais detalhada — é a que responde "onde exatamente".
      if (chave.length > existente.chave.length) {
        existente.rotulo = e.lugar
        existente.chave = chave
      }
    }
    return grupos
      .sort((a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo))
      .map((g) => [g.rotulo, g.total] as [string, number])
  }, [eventos])

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Cartao titulo="Linha do tempo">
        {eventos.length === 0 ? (
          <Vazio>Nenhum evento datado nesta ficha.</Vazio>
        ) : (
          <ol className="relative space-y-3 pl-5">
            <span
              aria-hidden
              className="absolute bottom-1 left-[5px] top-1 w-[2px]"
              style={{ background: TREE.cartaoBorda }}
            />
            {eventos.map((e, i) => (
              <li key={`${e.ano}-${i}`} className="relative">
                <span
                  aria-hidden
                  className="absolute -left-5 top-[7px] h-[9px] w-[9px] rounded-full"
                  style={{ background: INFO }}
                />
                <div
                  className="rounded-lg px-3 py-2"
                  style={{ background: TREE.hover, border: `1px solid ${TREE.cartaoBorda}` }}
                >
                  <p className="text-[13px] font-semibold" style={{ color: TREE.texto }}>
                    <span className="mr-2 tabular-nums" style={{ color: TREE.textoFraco }}>
                      {e.ano}
                    </span>
                    {e.titulo}
                  </p>
                  <p className="text-[12px]" style={{ color: TREE.textoFraco }}>
                    {e.detalhe}
                  </p>
                  {e.lugar && (
                    <p className="text-[12px]" style={{ color: TREE.textoSuave }}>
                      {e.lugar}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Cartao>

      <Cartao titulo="Lugares">
        {lugares.length === 0 ? (
          <Vazio>Nenhum lugar registrado nos eventos desta pessoa.</Vazio>
        ) : (
          <ul className="space-y-1.5">
            {lugares.map(([lugar, n]) => (
              <li key={lugar} className="flex items-start gap-2">
                <MapPin className="mt-[2px] h-3.5 w-3.5 shrink-0" style={{ color: SEVERIDADE_COR.baixo }} />
                <span className="text-[13px]" style={{ color: TREE.texto }}>
                  {lugar}
                  <span className="ml-1.5 text-[11.5px] tabular-nums" style={{ color: TREE.textoSuave }}>
                    {n} evento(s)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11.5px] leading-snug" style={{ color: TREE.textoSuave }}>
          Não há mapa desenhado porque o Discovery não guarda coordenada de evento. Marcar um pino
          exigiria adivinhar a posição a partir do texto do lugar, e o resultado seria lido como
          dado conferido — o que não seria verdade.
        </p>
      </Cartao>
    </div>
  )
}

// ---------------------------------------------------------------- peças

function Cartao({
  titulo,
  acao,
  children,
}: {
  titulo: string
  acao?: { rotulo: string; onClick: () => void }
  children: React.ReactNode
}) {
  return (
    <section
      className="rounded-lg p-4"
      style={{ background: TREE.cartao, border: `1px solid ${TREE.cartaoBorda}`, boxShadow: TREE.sombra }}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[16px] font-semibold" style={{ color: TREE.texto }}>
          {titulo}
        </h2>
        {acao && (
          <button
            type="button"
            onClick={acao.onClick}
            className="shrink-0 text-[12px] font-semibold uppercase tracking-wide"
            style={{ color: INFO }}
          >
            {acao.rotulo}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: TREE.textoSuave }}>
        {rotulo}
      </dt>
      <dd className="text-[13px]" style={{ color: TREE.texto }}>
        {valor}
      </dd>
    </div>
  )
}

function ItemPessoa({
  pessoa,
  destaque,
  onClick,
}: {
  pessoa: PessoaArvore
  destaque?: boolean
  onClick?: (p: PessoaArvore) => void
}) {
  const genero = corGenero(pessoa.sexo)
  const conteudo = (
    <>
      <span
        aria-hidden
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full"
        style={{ background: genero.suave, border: `1px solid ${genero.linha}`, color: genero.tinta }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="8.2" r="4" />
          <path d="M3.8 21c0-4.3 3.7-7 8.2-7s8.2 2.7 8.2 7z" />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium" style={{ color: TREE.texto }}>
          {nomeDe(pessoa)}
        </span>
        <span className="block text-[11.5px] tabular-nums" style={{ color: TREE.textoSuave }}>
          {ano(pessoa.data_nasc) ?? "—"}
          {ano(pessoa.data_obito) ? `–${ano(pessoa.data_obito)}` : "–"}
        </span>
      </span>
    </>
  )

  if (!onClick || destaque) {
    return (
      <li
        className="flex items-center gap-2 rounded-md px-2 py-1.5"
        style={{ background: destaque ? TREE.hover : "transparent" }}
      >
        {conteudo}
      </li>
    )
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onClick(pessoa)}
        title={`Abrir ${nomeDe(pessoa)}`}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left arv-hover"
      >
        {conteudo}
      </button>
    </li>
  )
}

function Acrescentar({ rotulo, onClick }: { rotulo: string; onClick?: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        title={onClick ? rotulo : "Seu perfil não tem permissão para alterar esta árvore"}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] font-semibold uppercase tracking-wide arv-hover disabled:cursor-not-allowed disabled:opacity-40"
        style={{ color: INFO }}
      >
        <UserPlus className="h-4 w-4" />
        {rotulo}
      </button>
    </li>
  )
}

function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12.5px] leading-snug" style={{ color: TREE.textoSuave }}>
      {children}
    </p>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="px-2 py-1.5 text-[11.5px] font-semibold uppercase tracking-wide"
      style={{ color: TREE.textoSuave }}
    >
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-2 py-2 text-[13px]" style={{ color: TREE.texto }}>
      {children}
    </td>
  )
}
