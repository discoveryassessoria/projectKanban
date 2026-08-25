// src/components/kanban/PainelDaFase.tsx
//
// ÍNDICE OPERACIONAL DA FASE.
//
// REGRA DE INTERFACE (a razão de este arquivo existir):
//
//   A Central Operacional INDEXA. O painel do documento EXECUTA.
//
//   Central Operacional
//   └── Linha principal / Fora da linhagem
//       └── PESSOA (card, com contadores)
//           └── DOCUMENTO (uma linha na tabela)
//               └── AÇÃO → painel do documento, ABERTO NO WORKFLOW DELE
//                          └── passo atual em foco → Central da Etapa → executor
//
// O CAMINHO É UM SÓ. A ação da linha ("Iniciar", "Continuar", "Ver etapa", "Ver
// bloqueio", "Ver detalhes") muda de nome conforme o estado, nunca de destino:
// leva sempre ao workflow daquele documento. Havia um desvio — o painel abria
// numa aba "Operação" que repetia status, próxima ação, responsável, SLA e
// atalhos, com régua de prazo própria. Era uma Central dentro da Central, e
// exigia mais um clique para chegar onde o trabalho acontece.
//
// O QUE A LINHA MOSTRA, E DE ONDE VEM:
//
//   PROGRESSO   workflow do documento, ponderado pelo peso publicado dos passos
//   ETAPA       passo corrente do workflow
//   RESPONSÁVEL  TAREFA — a unidade operacional
//   PRAZO        TAREFA
//   STATUS       TAREFA (o estado DOCUMENTAL acompanha, em segundo plano)
//
// Responsável, prazo e status saíam todos do PASSO CORRENTE, que tem campos com
// nomes parecidos e significado outro (quem executa aquela etapa, até quando ela
// corre). O resultado em produção: a tabela dizia "Sem responsável" e todas as
// outras telas diziam "Daniela Brait", sobre a mesma certidão.
//
// Fora do painel do documento continua não aparecendo NADA de execução: nem
// botão por passo, nem editor, nem operação antecipada. Isso não é filtro de
// renderização — o DTO que esta tela recebe (IndiceOperacional) não os carrega.

"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import {
  ExternalLink,
  ChevronDown,
  ChevronRight,
  FileText,
  Star,
  Users,
  AlertTriangle,
  Layers,
  Search,
} from "lucide-react"
import type {
  DocumentoDoIndice,
  EstadoOperacionalDaLinha,
  IndiceOperacional,
  PessoaDoIndice,
  StatusResumo,
} from "@/src/lib/process-stage/estrutura-operacional-core"

// ============================================================
// TIPOS
// ============================================================

export type { DocumentoDoIndice, IndiceOperacional, PessoaDoIndice }

export interface FaseKpi {
  label: string
  value: number
  tone?: "" | "ok" | "busca" | "late"
}

export interface PainelDaFaseProps {
  faseNome: string                 // "Emissão documental"
  faseSub: string                  // subtítulo da fase
  faseTabs: string[]               // abas do mockup pra essa fase
  kpis: FaseKpi[]                  // contadores agregados (calculados no backend)
  progressoPct: number             // % da fase (projeção operacional canônica)
  progressoConcluidos: number
  progressoTotal: number
  progressoTexto: string
  /**
   * O QUE FAZER para a fase sair do lugar, um item por linha.
   *
   * `progressoTexto` resume; isto diz o passo seguinte. Enquanto os dois vinham
   * colados num parágrafo, o operador lia o resumo e parava antes da instrução.
   */
  oQueFazer?: Array<{ code: string; message: string }>
  /** ÍNDICE OFICIAL da fase — pessoas e documentos. Sem nada de execução. */
  indice: IndiceOperacional
  /**
   * Identidade da fase exibida (processo + fase + ciclo). Trocar de fase RESETA a
   * expansão: manter o card de outra fase aberto mostraria a posição de um trabalho
   * que não é este.
   */
  chaveExpansao: string
  /** Abre o MODAL do documento — a única porta para a execução. */
  onAbrirDetalhes?: (doc: DocumentoDoIndice) => void
  /**
   * GESTÃO DE RESPONSABILIDADE NO CONTEXTO DO PROCESSO.
   *
   * O gestor que vê uma certidão sem dono resolve ali, sem sair para a Operação
   * e voltar. As duas superfícies chamam a MESMA porta de domínio; esta tela só
   * repassa o `taskId` e a pessoa escolhida.
   *
   * Ausentes ⇒ a coluna vira leitura pura. É o caso de quem executa: ele PRECISA
   * ver de quem é o trabalho, e não ganha o poder de distribuí-lo por estar
   * olhando o processo.
   */
  onAtribuirResponsavel?: (taskId: number, responsavelId: number) => void | Promise<void>
  onRetirarResponsavel?: (taskId: number) => void | Promise<void>
  /** Quem pode receber trabalho. Carregada UMA vez pelo container, nunca por linha. */
  usuarios?: Array<{ id: number; nome: string }>
  /** taskId em gravação — trava só a linha que está mudando. */
  salvandoResponsavel?: number | null
  onAbrirPainelCompleto?: () => void
  /** Consulta de fase passada: mesmo layout, sem ações de mutação. */
  readOnly?: boolean
  /**
   * DEEP-LINK: o documento que trouxe o usuário até aqui.
   *
   * A pessoa dele abre sozinha e a linha recebe realce discreto — com quinze
   * certidões na tela, chegar por um link e ter de procurar qual delas é
   * anula o propósito do link.
   */
  documentoDestacadoId?: number | null
  // LEGADO_INATIVO (desativação Genealogia): em modo reestruturação o painel NÃO
  // exibe KPIs/progresso antigos (derivados de Documento.status + linhaReta).
  modoReestruturacao?: boolean
  avisoReestruturacao?: string
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function PainelDaFase({
  faseNome,
  faseSub,
  faseTabs,
  kpis,
  progressoPct,
  progressoConcluidos,
  progressoTotal,
  progressoTexto,
  oQueFazer,
  indice,
  chaveExpansao,
  onAbrirDetalhes,
  onAbrirPainelCompleto,
  onAtribuirResponsavel,
  onRetirarResponsavel,
  usuarios,
  salvandoResponsavel = null,
  readOnly = false,
  documentoDestacadoId = null,
  modoReestruturacao = false,
  avisoReestruturacao,
}: PainelDaFaseProps) {
  const [abaAtiva, setAbaAtiva] = useState("Resumo")
  // O RECORTE É DA TELA. Filtrar é olhar de outro jeito para o mesmo conjunto —
  // não muda nada no banco, e por isso não precisa ir a lugar nenhum.
  const [recorte, setRecorte] = useState<Recorte>(RECORTE_VAZIO)

  return (
    <div>
      {/* ============== CABEÇALHO DA FASE ============== */}
      <div className="bg-[var(--surface-popover)] border border-[var(--border-default)] border-b-0 rounded-t-2xl px-5 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-[19px] font-extrabold text-white/95">{faseNome}</h2>
          </div>
          <button
            onClick={onAbrirPainelCompleto}
            className="inline-flex items-center gap-1.5 border-[1.5px] border-[var(--border-default)] bg-[var(--surface-popover)] text-white/80 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg whitespace-nowrap hover:border-[var(--border-strong)] hover:text-[#fff] transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Abrir painel da fase
          </button>
        </div>
        <div className="text-[13px] text-white/55 mt-1.5">{faseSub}</div>

        <div className="flex gap-1 overflow-x-auto mt-3.5 border-b border-[var(--border-default)]">
          {faseTabs.map((t) => (
            <button
              key={t}
              onClick={() => setAbaAtiva(t)}
              className={`text-[12.5px] font-semibold px-3 py-2.5 border-b-2 whitespace-nowrap transition-colors ${
                abaAtiva === t
                  ? "border-[#2563eb] text-white"
                  : "text-white/55 border-transparent hover:text-white/95"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ============== CORPO DA FASE ============== */}
      <div className="bg-[var(--surface-popover)] border border-[var(--border-default)] border-t-0 rounded-b-2xl px-5 py-5">

        {modoReestruturacao ? (
          <div className="bg-[#d2a948]/12 border border-[#d2a948]/30 rounded-xl px-5 py-4 mb-5">
            <div className="text-[13px] font-bold text-[#d2a948] mb-1">Fase em reestruturação</div>
            <div className="text-[12.5px] text-[#d2a948] leading-relaxed">
              {avisoReestruturacao ||
                "A definição documental da Genealogia está em reestruturação. Nenhum progresso automático é calculado nesta etapa."}
            </div>
            <div className="text-[11.5px] text-[#d2a948]/80 mt-2">
              A árvore e os dados civis continuam disponíveis. Documentos exibidos são
              registros operacionais existentes — não representam obrigatoriedade nem validação.
            </div>
          </div>
        ) : (
        <>
          {/* --- RESUMO AGREGADO DA FASE --- Contadores vêm do backend, nunca de
              contar elementos renderizados. auto-fit para o número nunca ser espremido. */}
          <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))" }}>
            {kpis.map((k, i) => {
              const cor =
                k.tone === "ok" ? "text-[#4ade80]"
                : k.tone === "busca" ? "text-[#d2a948]"
                : k.tone === "late" ? "text-[#f87171]"
                : "text-white/95"
              // UM CONTADOR QUE VIRA FILTRO. "Pendentes: 137" e depois procurar
              // os 137 na mão é um número que informa e não ajuda; clicar nele é
              // o gesto óbvio, e ele passou a existir.
              const alvo = recorteDoKpi(k.label)
              const ativo = alvo != null && recorte.rapido === alvo
              const classe = `bg-[var(--surface-popover)] border rounded-[10px] px-4 py-3 text-left transition-colors ${
                ativo ? "border-[#7dd3fc]/60 ring-1 ring-inset ring-[#7dd3fc]/25" : "border-[var(--border-default)]"
              } ${alvo != null ? "hover:border-[var(--border-strong)] cursor-pointer" : ""}`
              const conteudo = (
                <>
                  <b className={`text-[22px] font-extrabold block leading-none ${cor}`}>{k.value}</b>
                  <span className="text-[11px] text-white/40 font-semibold block mt-1.5">{k.label}</span>
                </>
              )
              return alvo == null ? (
                <div key={i} className={classe}>{conteudo}</div>
              ) : (
                <button
                  key={i}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setRecorte((r) => ({ ...r, rapido: ativo ? "todos" : alvo }))}
                  className={classe}
                >
                  {conteudo}
                </button>
              )
            })}
          </div>

          {/* --- PROGRESSO DA FASE (projeção operacional canônica) --- */}
          <div className="bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-xl px-5 py-4 mb-5">
            <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
              <div>
                {/* O QUE ESTE NÚMERO CONTA — dito no rótulo.
                    O topo mede DOCUMENTOS INTEIROS concluídos (a mesma régua do
                    gate de avanço): 0 de 1 validado é 0%, mesmo com a certidão a
                    44%. A linha mede o WORKFLOW daquele documento, ponderado
                    pelo peso dos passos. São duas perguntas, e chamar as duas de
                    "progresso da fase" fazia o operador achar que uma delas
                    estava errada. */}
                <div className="text-[13px] font-semibold text-white/55 mb-1">
                  Documentos concluídos na {faseNome}
                </div>
                <div className="text-[28px] font-extrabold text-white/95 leading-none">{progressoPct}%</div>
              </div>
              <div className="text-[13px] text-white/55">{progressoConcluidos} de {progressoTotal} documentos validados</div>
            </div>
            <div className="h-1.5 bg-[#252c35] rounded-full overflow-hidden mt-3">
              <div className="h-full bg-[#7dd3fc] transition-all duration-500" style={{ width: `${progressoPct}%` }} />
            </div>
            <div className="text-center text-[12.5px] text-white/40 mt-3">{progressoTexto}</div>
            {/* A FASE PAROU E O SISTEMA SABE POR QUÊ. Dizer isso em lista, com o verbo
                na frente, é a diferença entre o operador agir e o processo esperar duas
                semanas por uma árvore que ninguém sabia que faltava. */}
            {(oQueFazer?.length ?? 0) > 0 && (
              <ul className="mt-3 space-y-1.5 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
                {oQueFazer!.map((m) => (
                  <li key={m.code} className="flex gap-2 text-[12.5px] leading-snug text-amber-100/80">
                    <span aria-hidden className="text-amber-300/60">·</span>
                    <span>{m.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
        )}

        {/* --- ÍNDICE: pessoas e documentos --- */}
        <IndiceView
          indice={indice}
          chaveExpansao={chaveExpansao}
          onAbrirDetalhes={onAbrirDetalhes}
          gestao={{ onAtribuirResponsavel, onRetirarResponsavel, usuarios, salvandoResponsavel }}
          readOnly={readOnly}
          documentoDestacadoId={documentoDestacadoId}
          recorte={recorte}
          setRecorte={setRecorte}
        />
      </div>
    </div>
  )
}

// ============================================================
// ÍNDICE
// ============================================================

/** Acima disto os cards nascem fechados: abrir tudo viraria um muro. */
const LIMITE_AUTO_EXPANSAO = 12

/**
 * Linhas desenhadas por pessoa antes do "mostrar mais".
 *
 * Uma pessoa com oitenta certidões não precisa de oitenta linhas no primeiro
 * paint: precisa das primeiras e da possibilidade de ver o resto. O corte é
 * de RENDERIZAÇÃO, não de dados — os contadores continuam falando do conjunto
 * inteiro, e o filtro age sobre todos.
 */
const LINHAS_POR_PESSOA = 25

// ============================================================
// RECORTE — filtros, busca e ordenação da tabela da fase
// ============================================================
// Tudo aqui é DERIVAÇÃO da projeção que o servidor já mandou. Nenhum filtro
// consulta nada, nenhum filtro grava nada: são recortes do mesmo conjunto, e é
// por isso que os números do topo e os da tabela nunca podem discordar.

export type RecorteRapido = "todos" | "prontos" | "pendentes" | "divergentes" | "atrasados" | "sem_responsavel"

export interface Recorte {
  rapido: RecorteRapido
  busca: string
  estado: EstadoOperacionalDaLinha | ""
  responsavelId: number | "" | "sem"
  etapa: string
  ordem: OrdemDaTabela
}

export type OrdemDaTabela = "atencao" | "progresso" | "prazo" | "documento" | "etapa" | "responsavel" | "status"

export const RECORTE_VAZIO: Recorte = {
  rapido: "todos", busca: "", estado: "", responsavelId: "", etapa: "", ordem: "atencao",
}

/**
 * O CONTADOR DO TOPO E O FILTRO SÃO A MESMA PERGUNTA.
 *
 * Os KPIs vêm rotulados do servidor; o mapa liga o rótulo ao recorte que ele
 * descreve. O que não tem recorte correspondente segue sendo só número — melhor
 * do que um clique que não faz nada.
 */
export function recorteDoKpi(label: string): RecorteRapido | null {
  const t = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  if (t.includes("pronto") || t.includes("valida")) return "prontos"
  if (t.includes("pendente")) return "pendentes"
  if (t.includes("divergen") || t.includes("invalid")) return "divergentes"
  if (t.includes("atrasad") || t.includes("vencid")) return "atrasados"
  if (t.includes("sem responsavel")) return "sem_responsavel"
  return null
}

const semAcento = (t: string) =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()

/**
 * O documento passa pelo recorte?
 *
 * Os recortes rápidos usam EXATAMENTE a mesma régua dos contadores do topo
 * (`statusFinal`), e não uma parecida. Clicar em "Pendentes: 400" e receber 450
 * linhas seria pior do que não poder clicar: o número deixaria de significar
 * alguma coisa. É por isso que "pendente" aqui não é "tudo que não terminou" —
 * é o que o contador chama de pendente.
 */
export function passaNoRecorte(doc: DocumentoDoIndice, r: Recorte, pessoaNome: string): boolean {
  const f = doc.naFase
  if (r.rapido === "prontos" && doc.statusFinal !== "PRONTO") return false
  if (r.rapido === "pendentes" && doc.statusFinal !== "PENDENTE" && doc.statusFinal !== "EM_ANDAMENTO") return false
  if (r.rapido === "divergentes" && doc.statusFinal !== "DIVERGENTE" && doc.statusFinal !== "INVALIDADO") return false
  if (r.rapido === "atrasados" && !f.atrasado) return false
  if (r.rapido === "sem_responsavel" && (f.responsavelId != null || f.estado === "CONCLUIDA")) return false

  if (r.estado !== "" && f.estado !== r.estado) return false
  if (r.responsavelId === "sem" && f.responsavelId != null) return false
  if (typeof r.responsavelId === "number" && f.responsavelId !== r.responsavelId) return false
  if (r.etapa !== "" && f.etapaAtual !== r.etapa) return false

  if (r.busca.trim() !== "") {
    // A busca alcança o que o operador tem na cabeça: o nome da pessoa, o tipo
    // do documento e o título do registro.
    const alvo = semAcento([pessoaNome, doc.titulo, doc.tipoLabel ?? "", doc.pais ?? ""].join(" "))
    for (const termo of semAcento(r.busca).split(/\s+/).filter(Boolean)) {
      if (!alvo.includes(termo)) return false
    }
  }
  return true
}

/** Peso de atenção: quanto MENOR, mais cedo a linha aparece. */
function urgenciaDaLinha(doc: DocumentoDoIndice): number {
  const f = doc.naFase
  if (f.estado === "BLOQUEADA") return 0
  if (f.atrasado) return 1
  if (f.venceHoje) return 2
  if (doc.statusFinal === "DIVERGENTE" || doc.statusFinal === "INVALIDADO") return 3
  if (f.estado === "EM_ANDAMENTO") return 4
  if (f.estado === "A_FAZER") return 5
  if (f.estado === "AGUARDANDO_TERCEIRO") return 6
  return 7 // concluída
}

/**
 * A ORDEM É DETERMINÍSTICA — sempre desempatada pelo título.
 *
 * O padrão põe na frente o que exige atenção (bloqueado, atrasado, vence hoje),
 * e isso é uma regra escrita, não um "score" que ninguém consegue explicar
 * depois. As outras ordens são o que o cabeçalho diz: nada de secreto.
 */
export function ordenarDocumentos(docs: DocumentoDoIndice[], ordem: OrdemDaTabela): DocumentoDoIndice[] {
  const desempate = (a: DocumentoDoIndice, b: DocumentoDoIndice) => a.titulo.localeCompare(b.titulo, "pt-BR")
  const copia = [...docs]
  switch (ordem) {
    case "progresso":
      return copia.sort((a, b) => a.naFase.progresso.pct - b.naFase.progresso.pct || desempate(a, b))
    case "prazo":
      // Sem prazo vai para o fim: ausência de prazo não é urgência.
      return copia.sort((a, b) => {
        const pa = a.naFase.prazo ? Date.parse(a.naFase.prazo) : Number.POSITIVE_INFINITY
        const pb = b.naFase.prazo ? Date.parse(b.naFase.prazo) : Number.POSITIVE_INFINITY
        return pa - pb || desempate(a, b)
      })
    case "documento":
      return copia.sort(desempate)
    case "etapa":
      return copia.sort((a, b) => (a.naFase.etapaAtual ?? "~").localeCompare(b.naFase.etapaAtual ?? "~", "pt-BR") || desempate(a, b))
    case "responsavel":
      return copia.sort((a, b) => (a.naFase.responsavelNome ?? "~").localeCompare(b.naFase.responsavelNome ?? "~", "pt-BR") || desempate(a, b))
    case "status":
      return copia.sort((a, b) => a.naFase.estadoLabel.localeCompare(b.naFase.estadoLabel, "pt-BR") || desempate(a, b))
    default:
      return copia.sort((a, b) => urgenciaDaLinha(a) - urgenciaDaLinha(b) || desempate(a, b))
  }
}

/**
 * O QUE A LINHA PRECISA PARA SER GERIDA — repassado inteiro, nunca por prop solta.
 *
 * Fica num objeto só porque as quatro coisas viajam juntas de ponta a ponta: sem
 * as ações não há o que fazer, sem a lista não há a quem atribuir, e sem saber
 * quem está gravando a linha pisca duas vezes.
 */
export interface GestaoDeResponsavel {
  onAtribuirResponsavel?: (taskId: number, responsavelId: number) => void | Promise<void>
  onRetirarResponsavel?: (taskId: number) => void | Promise<void>
  usuarios?: Array<{ id: number; nome: string }>
  salvandoResponsavel?: number | null
}

interface Expansao {
  chave: string
  semeado: boolean
  abertos: Set<string>
}

function semear(chave: string, indice: IndiceOperacional): Expansao {
  const abertos = new Set<string>()
  if (indice.resumo.documentos > 0 && indice.resumo.documentos <= LIMITE_AUTO_EXPANSAO) {
    for (const p of [...indice.linhaPrincipal, ...indice.foraDaLinha, ...indice.pendenteClassificacao]) {
      if (!p.semDocumentoAplicavel) abertos.add(`pessoa:${p.pessoa.pessoaId}`)
    }
  }
  return { chave, semeado: indice.resumo.documentos > 0, abertos }
}

function IndiceView({
  indice: indiceBruto,
  chaveExpansao,
  onAbrirDetalhes,
  gestao,
  readOnly,
  documentoDestacadoId,
  recorte = RECORTE_VAZIO,
  setRecorte,
}: {
  indice: IndiceOperacional
  chaveExpansao: string
  onAbrirDetalhes?: (doc: DocumentoDoIndice) => void
  gestao?: GestaoDeResponsavel
  readOnly: boolean
  documentoDestacadoId?: number | null
  recorte?: Recorte
  setRecorte?: React.Dispatch<React.SetStateAction<Recorte>>
}) {
  // ── O RECORTE APLICADO ────────────────────────────────────────────────────
  //
  // O índice filtrado é derivado do índice inteiro, e o `resumo` ORIGINAL é
  // preservado: o topo fala da FASE, a tabela fala do recorte, e a diferença
  // entre os dois é dita em texto em vez de virar um número que ninguém explica.
  //
  // O DOCUMENTO DO DEEP-LINK NUNCA É FILTRADO PARA FORA. Chegar por um link e
  // encontrar a tela vazia porque um filtro estava ligado é o pior desfecho
  // possível de uma navegação que existe justamente para levar até ele.
  const filtrado = useMemo(() => {
    const ativo =
      recorte.rapido !== "todos" || recorte.busca.trim() !== "" || recorte.estado !== ""
      || recorte.responsavelId !== "" || recorte.etapa !== ""
    const recortarPessoa = (p: PessoaDoIndice): PessoaDoIndice => {
      const docs = ativo
        ? p.documentos.filter((d) =>
            (documentoDestacadoId != null && d.documentoId === documentoDestacadoId)
            || passaNoRecorte(d, recorte, p.pessoa.nome))
        : p.documentos
      return { ...p, documentos: ordenarDocumentos(docs, recorte.ordem) }
    }
    const manterComTrabalho = (p: PessoaDoIndice) => !ativo || p.documentos.length > 0
    return {
      ...indiceBruto,
      linhaPrincipal: indiceBruto.linhaPrincipal.map(recortarPessoa).filter(manterComTrabalho),
      foraDaLinha: indiceBruto.foraDaLinha.map(recortarPessoa).filter(manterComTrabalho),
      pendenteClassificacao: indiceBruto.pendenteClassificacao.map(recortarPessoa).filter(manterComTrabalho),
      semDono: ordenarDocumentos(
        ativo
          ? indiceBruto.semDono.filter((d) =>
              (documentoDestacadoId != null && d.documentoId === documentoDestacadoId)
              || passaNoRecorte(d, recorte, ""))
          : indiceBruto.semDono,
        recorte.ordem,
      ),
    }
  }, [indiceBruto, recorte, documentoDestacadoId])
  const indice = filtrado

  // As opções dos seletores saem do conjunto REAL da fase, não de uma lista
  // fixa: responsável que não trabalha aqui não aparece, etapa que não existe
  // nesta fase também não.
  const todosOsDocs = useMemo(
    () => [
      ...indiceBruto.linhaPrincipal.flatMap((p) => p.documentos),
      ...indiceBruto.foraDaLinha.flatMap((p) => p.documentos),
      ...indiceBruto.pendenteClassificacao.flatMap((p) => p.documentos),
      ...indiceBruto.semDono,
    ],
    [indiceBruto],
  )
  const visiveis = useMemo(
    () => [
      ...indice.linhaPrincipal.flatMap((p) => p.documentos),
      ...indice.foraDaLinha.flatMap((p) => p.documentos),
      ...indice.pendenteClassificacao.flatMap((p) => p.documentos),
      ...indice.semDono,
    ].length,
    [indice],
  )
  // Expansão local, por processo/fase. Preferência visual não vai ao banco.
  // O ajuste acontece DURANTE a renderização (padrão do React para estado derivado de
  // prop), não num efeito: um efeito que dependesse do índice fecharia os cards a cada
  // revalidação em segundo plano, e o operador perderia a posição no meio do trabalho.
  const [expansao, setExpansao] = useState<Expansao>(() => semear(chaveExpansao, indice))
  let atual = expansao
  if (atual.chave !== chaveExpansao || (!atual.semeado && indice.resumo.documentos > 0)) {
    atual = semear(chaveExpansao, indice)
    setExpansao(atual)
  }
  const abertos = atual.abertos

  // A PESSOA DO DOCUMENTO ALVO ABRE SOZINHA — e só ela. Expandir tudo devolveria
  // ao usuário o mesmo problema que o link veio resolver, só que maior.
  const pessoaAlvo = documentoDestacadoId != null
    ? [...indice.linhaPrincipal, ...indice.foraDaLinha, ...indice.pendenteClassificacao]
        .find((p) => p.documentos.some((d) => d.documentoId === documentoDestacadoId))
    : undefined
  const chaveDaPessoaAlvo = pessoaAlvo ? `pessoa:${pessoaAlvo.pessoa.pessoaId}` : null
  const abertosComAlvo = chaveDaPessoaAlvo != null && !abertos.has(chaveDaPessoaAlvo)
    ? new Set([...abertos, chaveDaPessoaAlvo])
    : abertos

  const alternar = (chave: string) =>
    setExpansao((prev) => {
      const proximo = new Set(prev.abertos)
      if (proximo.has(chave)) proximo.delete(chave)
      else proximo.add(chave)
      return { ...prev, abertos: proximo }
    })

  const responsaveis = useMemo(() => {
    const m = new Map<number, string>()
    for (const d of todosOsDocs) {
      if (d.naFase.responsavelId != null && d.naFase.responsavelNome) {
        m.set(d.naFase.responsavelId, d.naFase.responsavelNome)
      }
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
  }, [todosOsDocs])
  const etapas = useMemo(
    () => [...new Set(todosOsDocs.map((d) => d.naFase.etapaAtual).filter((x): x is string => x != null))]
      .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [todosOsDocs],
  )
  const recortando =
    recorte.rapido !== "todos" || recorte.busca.trim() !== "" || recorte.estado !== ""
    || recorte.responsavelId !== "" || recorte.etapa !== ""

  const totalPessoas =
    indice.linhaPrincipal.length + indice.foraDaLinha.length + indice.pendenteClassificacao.length

  const campo = "bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-lg text-[11.5px] text-white/80 px-2.5 py-1.5 focus:border-white/25 focus:outline-none"

  // ── A BARRA DE RECORTE ────────────────────────────────────────────────────
  //
  // Montada UMA vez e usada nos dois desfechos. Quando o recorte não devolve
  // nada, ela precisa continuar na tela: sumir junto com as linhas tirava do
  // usuário justamente o campo que ele estava usando, e desfazer uma busca
  // virava adivinhação.
  const barraDeRecorte = setRecorte ? (
    // Com quinhentos documentos a pergunta deixa de ser "o que existe" e passa a
    // ser "o que falta". Busca e filtros são a resposta; ordenação é por onde
    // começar. Nenhum deles consulta nada: recortam o que já veio do servidor.
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-white/30 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          value={recorte.busca}
          onChange={(e) => setRecorte((r) => ({ ...r, busca: e.target.value }))}
          placeholder="Buscar pessoa ou documento…"
          className={`${campo} pl-8 w-[230px]`}
        />
      </div>

      <select
        value={recorte.estado}
        onChange={(e) => setRecorte((r) => ({ ...r, estado: e.target.value as EstadoOperacionalDaLinha | "" }))}
        className={campo}
        aria-label="Filtrar por status"
      >
        <option value="">Todos os status</option>
        <option value="A_FAZER">A fazer</option>
        <option value="EM_ANDAMENTO">Em andamento</option>
        <option value="AGUARDANDO_TERCEIRO">Aguardando terceiro</option>
        <option value="BLOQUEADA">Bloqueada</option>
        <option value="CONCLUIDA">Concluída</option>
      </select>

      <select
        value={String(recorte.responsavelId)}
        onChange={(e) => setRecorte((r) => ({
          ...r,
          responsavelId: e.target.value === "" ? "" : e.target.value === "sem" ? "sem" : Number(e.target.value),
        }))}
        className={campo}
        aria-label="Filtrar por responsável"
      >
        <option value="">Todos os responsáveis</option>
        <option value="sem">Sem responsável</option>
        {responsaveis.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
      </select>

      {etapas.length > 0 && (
        <select
          value={recorte.etapa}
          onChange={(e) => setRecorte((r) => ({ ...r, etapa: e.target.value }))}
          className={campo}
          aria-label="Filtrar por etapa atual"
        >
          <option value="">Todas as etapas</option>
          {etapas.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      )}

      <select
        value={recorte.ordem}
        onChange={(e) => setRecorte((r) => ({ ...r, ordem: e.target.value as OrdemDaTabela }))}
        className={campo}
        aria-label="Ordenar"
      >
        <option value="atencao">Ordem: o que precisa de atenção</option>
        <option value="progresso">Ordem: menor progresso</option>
        <option value="prazo">Ordem: prazo mais próximo</option>
        <option value="documento">Ordem: documento (A–Z)</option>
        <option value="etapa">Ordem: etapa atual</option>
        <option value="responsavel">Ordem: responsável</option>
        <option value="status">Ordem: status</option>
      </select>

      {recortando && (
        <button
          type="button"
          onClick={() => setRecorte(RECORTE_VAZIO)}
          className="text-[11.5px] font-semibold text-white/55 hover:text-white/85 underline underline-offset-2"
        >
          Limpar filtros
        </button>
      )}
    </div>
  ) : null

  if (totalPessoas === 0 && indice.semDono.length === 0 && recortando) {
    // NADA NO RECORTE ≠ NADA NA FASE. Dizer "a fase não tem trabalho" com um
    // filtro ligado seria mentir sobre o processo por causa de um clique. E a
    // barra continua na tela: sumir com ela tirava do usuário justamente o
    // campo que ele estava usando.
    return (
      <div>
        {barraDeRecorte}
      <div className="border border-[var(--border-default)] rounded-xl px-5 py-8 text-center">
        <div className="text-[13px] text-white/68">Nenhum documento neste recorte.</div>
        <div className="text-[11.5px] text-white/40 mt-1">
          A fase tem {indiceBruto.resumo.documentos} documento(s).
        </div>
        <button
          type="button"
          onClick={() => setRecorte?.(RECORTE_VAZIO)}
          className="mt-3 text-[12px] font-semibold text-[#7dd3fc] hover:underline underline-offset-2"
        >
          Limpar filtros
        </button>
        </div>
      </div>
    )
  }

  if (totalPessoas === 0 && indice.semDono.length === 0) {
    return (
      <div className="border border-[var(--border-default)] rounded-xl px-5 py-8 text-center">
        <div className="text-[13px] text-white/68">Esta fase não tem trabalho materializado.</div>
        <div className="text-[11.5px] text-white/40 mt-1 leading-relaxed">
          Publique os passos da fase em Gerenciamento › Workflows das Fases. Enquanto
          não houver passo publicado, não há o que executar aqui.
        </div>
      </div>
    )
  }

  const grupo = (
    icone: React.ReactNode,
    titulo: string,
    tone: "linha" | "fora" | "pendente",
    pessoas: PessoaDoIndice[],
  ) =>
    pessoas.length === 0 ? null : (
      <div className="mb-5 last:mb-0">
        <div className="flex items-center gap-2.5 mb-2.5">
          <span className={`w-[22px] h-[22px] rounded-lg grid place-items-center flex-none ${
            tone === "pendente" ? "bg-[#d2a948]/20 text-[#d2a948]" : tone === "fora" ? "bg-[#252c35] text-white/40" : "bg-[#252c35] text-white/55"
          }`}>
            {icone}
          </span>
          <b className="text-[11.5px] font-extrabold tracking-wide uppercase text-white/55">{titulo}</b>
          <span className="ml-auto text-[11px] font-bold text-white/40 bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-full px-2.5 py-0.5">
            {pessoas.length} pessoa(s)
          </span>
        </div>
        <div className="flex flex-col gap-2.5">
          {pessoas.map((p) => (
            <PessoaCard
              key={p.pessoa.pessoaId} linha={p}
              aberto={abertosComAlvo.has(`pessoa:${p.pessoa.pessoaId}`)}
              alternar={() => alternar(`pessoa:${p.pessoa.pessoaId}`)}
              onAbrirDetalhes={onAbrirDetalhes} gestao={gestao} readOnly={readOnly}
              documentoDestacadoId={documentoDestacadoId}
            />
          ))}
        </div>
      </div>
    )

  return (
    <div>
      {barraDeRecorte}

      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-[22px] h-[22px] rounded-lg grid place-items-center flex-none bg-[#252c35] text-white/55">
          <Layers className="w-3 h-3" />
        </span>
        <b className="text-[11.5px] font-extrabold tracking-wide uppercase text-white/55">Documentos por pessoa</b>
        {/* O TOPO FALA DA FASE; ISTO FALA DO RECORTE. Dois números com o mesmo
            nome e escopos diferentes seria a confusão que esta tela evita. */}
        <span className="ml-auto text-[11px] font-bold text-white/40 bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-full px-2.5 py-0.5">
          {recortando
            ? `${visiveis} de ${indiceBruto.resumo.documentos} documento(s)`
            : `${indiceBruto.resumo.documentos} documento(s)`}
        </span>
      </div>

      {grupo(<Star className="w-3 h-3" />, "Linha principal · transmissão de cidadania", "linha", indice.linhaPrincipal)}
      {grupo(<Users className="w-3 h-3" />, "Fora da linhagem · cônjuges / apoio", "fora", indice.foraDaLinha)}
      {grupo(<AlertTriangle className="w-3 h-3" />, "Pendente de classificação · revisar cadastro", "pendente", indice.pendenteClassificacao)}

      {/* DOCUMENTO SEM PESSOA NO ROSTER — cadastro inconsistente. Fica VISÍVEL:
          sumir seria esconder trabalho real que ninguém veria de novo. */}
      {indice.semDono.length > 0 && (
        <div className="rounded-xl border border-[#d2a948]/30 bg-[#d2a948]/[0.07] overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-[#d2a948]/20">
            <AlertTriangle className="w-3.5 h-3.5 text-[#d2a948] flex-none" />
            <b className="text-[11.5px] font-extrabold tracking-wide uppercase text-[#d2a948]">
              Sem pessoa vinculada · revisar cadastro do registro
            </b>
          </div>
          <TabelaDocumentos docs={indice.semDono} onAbrirDetalhes={onAbrirDetalhes} gestao={gestao} readOnly={readOnly} />
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// PESSOA — card do índice
// ------------------------------------------------------------
// A pessoa existe na Central pelo vínculo com a árvore. Aparece com ou sem documento
// aplicável: quem não tem trabalho nesta fase diz isso em texto, e não conta como
// pendência nem bloqueia a conclusão.
function PessoaCard({
  linha,
  aberto,
  alternar,
  onAbrirDetalhes,
  gestao,
  readOnly,
  documentoDestacadoId,
}: {
  linha: PessoaDoIndice
  aberto: boolean
  alternar: () => void
  onAbrirDetalhes?: (doc: DocumentoDoIndice) => void
  gestao?: GestaoDeResponsavel
  readOnly: boolean
  documentoDestacadoId?: number | null
}) {
  const p = linha.pessoa
  const t = linha.totais
  const podeAbrir = !linha.semDocumentoAplicavel

  const transmissao =
    p.classificacao === "LINHA_PRINCIPAL"
      ? { cor: "text-[#4ade80]", dot: "bg-[#4ade80]", label: "Na linha de transmissão" }
      : p.classificacao === "FORA_DA_LINHAGEM"
        ? { cor: "text-white/40", dot: "bg-[var(--surface-secondary)]", label: "Fora da linha" }
        : { cor: "text-[#f87171]", dot: "bg-[#f87171]", label: "Classificação pendente" }

  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] overflow-hidden">
      <button
        type="button"
        onClick={() => podeAbrir && alternar()}
        disabled={!podeAbrir}
        className={`w-full text-left flex items-center gap-4 px-4 py-3.5 transition-colors ${podeAbrir ? "hover:bg-[#20262e]" : "cursor-default"}`}
      >
        <span className="w-10 h-10 rounded-full grid place-items-center text-[#fff] font-extrabold text-[13px] flex-none bg-[#252c35]">
          {p.iniciais}
        </span>

        <span className="min-w-0 flex-1">
          <b className="text-[14.5px] font-extrabold block leading-tight truncate text-white/95">{p.nome}</b>
          <span className="text-[11.5px] text-white/40 font-semibold flex items-center gap-1.5 mt-0.5 flex-wrap">
            {p.geracao != null && (
              <span className="text-[10px] font-extrabold bg-[#252c35] border border-[var(--border-default)] rounded px-1.5 py-px">
                G{p.geracao + 1}
              </span>
            )}
            <span className="truncate">{p.requerente ? "Requerente" : p.posicao}</span>
            <span className={`flex items-center gap-1 ${transmissao.cor}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${transmissao.dot}`} />
              {transmissao.label}
            </span>
          </span>
          {p.pendencia && (
            <span className="text-[11px] text-[#d2a948] font-semibold flex items-start gap-1.5 leading-snug mt-1">
              <AlertTriangle className="w-3 h-3 flex-none mt-px" />
              {p.pendencia}
            </span>
          )}
        </span>

        {/* CONTADORES — do backend, nunca contando o que está na tela */}
        {linha.semDocumentoAplicavel ? (
          <span className="text-[12px] text-white/40 flex-none">Nenhum documento aplicável nesta fase</span>
        ) : (
          <span className="flex items-center gap-5 flex-none">
            <Pilula valor={t.documentos} rotulo="documentos" />
            <Pilula valor={t.prontos} rotulo="prontos" tone="ok" />
            <Pilula valor={t.pendentes} rotulo="pendentes" tone="busca" />
            {t.divergentes > 0 && <Pilula valor={t.divergentes} rotulo="divergentes" tone="late" />}
          </span>
        )}

        <span className="text-white/40 flex-none w-4">
          {!podeAbrir ? null : aberto ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
      </button>

      {aberto && podeAbrir && (
        <div className="border-t border-[var(--border-default)]">
          <TabelaDocumentos
            docs={linha.documentos}
            onAbrirDetalhes={onAbrirDetalhes}
            gestao={gestao}
            readOnly={readOnly}
            documentoDestacadoId={documentoDestacadoId}
          />
        </div>
      )}
    </div>
  )
}

function Pilula({ valor, rotulo, tone }: { valor: number; rotulo: string; tone?: "ok" | "busca" | "late" }) {
  const cor =
    tone === "ok" ? "text-[#4ade80]" : tone === "busca" ? "text-[#d2a948]" : tone === "late" ? "text-[#f87171]" : "text-white/95"
  return (
    <span className="text-center block">
      <b className={`text-[16px] font-extrabold block leading-none ${cor}`}>{valor}</b>
      <span className="text-[10px] text-white/40 font-semibold block mt-1">{rotulo}</span>
    </span>
  )
}

// ------------------------------------------------------------
// DOCUMENTOS DA PESSOA — uma linha por documento, sem execução
// ------------------------------------------------------------
// A LINHA RESPONDE UMA PERGUNTA SÓ: "como está este documento NESTA FASE?".
//
// Ela já respondeu outra: "já foi retificado? traduzido? apostilado?" — quatro
// colunas sobre fases FUTURAS. Com um punhado de documentos isso passava; com
// quinhentos, o operador precisava abrir item por item para descobrir o que
// faltava HOJE, que é exatamente o que uma tabela existe para evitar.
//
// Retificação, tradução e apostilamento não sumiram do produto: são fases com
// tela própria, e o ciclo documental inteiro continua na aba Documentos e na
// timeline do documento. O que saiu foi a mistura de horizontes numa tabela só.
const COLUNAS = "minmax(200px,2fr) 150px minmax(140px,1.2fr) 130px 120px 120px 128px"

function TabelaDocumentos({
  docs,
  onAbrirDetalhes,
  gestao,
  readOnly,
  documentoDestacadoId,
}: {
  docs: DocumentoDoIndice[]
  onAbrirDetalhes?: (doc: DocumentoDoIndice) => void
  gestao?: GestaoDeResponsavel
  readOnly: boolean
  documentoDestacadoId?: number | null
}) {
  // CORTE DE RENDERIZAÇÃO, NÃO DE DADOS.
  //
  // Oitenta linhas de uma pessoa só custam oitenta vezes o mesmo trabalho de
  // pintura, e ninguém lê oitenta de uma vez. As primeiras aparecem; o resto
  // fica a um clique — e o número dito é o real, nunca o desenhado.
  const [mostrarTudo, setMostrarTudo] = useState(false)
  const alvoForaDoCorte =
    documentoDestacadoId != null
    && docs.findIndex((d) => d.documentoId === documentoDestacadoId) >= LINHAS_POR_PESSOA
  // O documento que trouxe o usuário nunca fica escondido atrás de "mostrar mais".
  const visiveis = mostrarTudo || alvoForaDoCorte ? docs : docs.slice(0, LINHAS_POR_PESSOA)
  const ocultos = docs.length - visiveis.length

  if (docs.length === 0) {
    return <div className="px-4 py-4 text-[12px] text-white/40">Nenhum documento aplicável nesta fase.</div>
  }
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        <div
          className="grid items-end gap-3 px-4 py-2 bg-[#20262e] border-b border-[var(--border-default)] text-[10px] font-bold uppercase tracking-wider text-white/40"
          style={{ gridTemplateColumns: COLUNAS }}
        >
          <div>Documento</div>
          <div>Progresso</div>
          <div>Etapa atual</div>
          <div>Responsável</div>
          <div>Prazo</div>
          <div>Status</div>
          <div className="text-right">Ação</div>
        </div>
        {visiveis.map((d) => (
          <LinhaDocumento
            key={d.chave}
            doc={d}
            onAbrirDetalhes={onAbrirDetalhes}
            gestao={gestao}
            readOnly={readOnly}
            destacado={documentoDestacadoId != null && d.documentoId === documentoDestacadoId}
          />
        ))}
        {ocultos > 0 && (
          <button
            type="button"
            onClick={() => setMostrarTudo(true)}
            className="w-full px-4 py-2.5 text-[11.5px] font-semibold text-white/55 hover:text-white/85 hover:bg-[#20262e]/60 transition-colors"
          >
            Mostrar mais {ocultos} documento(s)
          </button>
        )}
      </div>
    </div>
  )
}

const CLS_ARTEFATO: Record<StatusResumo, string> = {
  PRONTO: "text-[#4ade80]",
  EM_ANDAMENTO: "text-[#7dd3fc]",
  PENDENTE: "text-white/68",
  DIVERGENTE: "text-[#f87171]",
  INVALIDADO: "text-[#f87171]",
  NAO_APLICAVEL: "text-white/25",
}

// ------------------------------------------------------------
// AS CÉLULAS DA FASE
// ------------------------------------------------------------
// Cores pela semântica que o sistema já usa: verde = pronto, azul = andando,
// âmbar = espera, vermelho = crítico. Nenhuma cor nova.

/**
 * PROGRESSO — barra, percentual e a fração que a pessoa lê.
 *
 * O percentual é PONDERADO pelo peso publicado dos passos (na Emissão
 * Documental: 25/10/18/15/12), a mesma conta que a aba Workflow do documento
 * mostra. A fração continua sendo de etapas, porque é assim que alguém descreve
 * o próprio trabalho: "estou em duas de cinco".
 *
 * Nada aqui é persistido: se o percentual e o workflow divergirem, é o
 * percentual que está errado, e ele se corrige sozinho na próxima leitura.
 */
function CelulaProgresso({ p }: { p: DocumentoDoIndice["naFase"]["progresso"] }) {
  const completo = p.pct >= 100
  const detalhe = p.total > 0
    ? `${p.concluidos} de ${p.total} etapas · ${p.pontosFeitos} de ${p.pontosTotais} pontos`
    : "Sem etapa obrigatória nesta fase"
  return (
    <div title={detalhe}>
      <div className="flex items-baseline gap-1.5">
        <b className={`text-[12.5px] font-bold tabular-nums ${completo ? "text-[#4ade80]" : "text-white/90"}`}>
          {p.pct}%
        </b>
        {p.total > 0 && (
          <span className="text-[10.5px] text-white/35 tabular-nums">{p.concluidos}/{p.total}</span>
        )}
      </div>
      <div className="h-1.5 bg-[#252c35] rounded-full overflow-hidden mt-1.5">
        <div
          className={`h-full transition-all duration-500 ${completo ? "bg-[#4ade80]" : "bg-[#7dd3fc]"}`}
          style={{ width: `${p.pct}%` }}
        />
      </div>
    </div>
  )
}

const CLS_ESTADO: Record<EstadoOperacionalDaLinha, string> = {
  A_FAZER: "bg-[#252c35] text-white/68",
  EM_ANDAMENTO: "bg-[#7dd3fc]/15 text-[#7dd3fc]",
  AGUARDANDO_TERCEIRO: "bg-[#d2a948]/15 text-[#d2a948]",
  BLOQUEADA: "bg-[#f87171]/15 text-[#f87171]",
  CONCLUIDA: "bg-[#4ade80]/15 text-[#4ade80]",
}

/**
 * PRAZO — o que ele SIGNIFICA primeiro, a data depois.
 *
 * "Atrasada há 3 dias" é a informação; 14/08/2026 é a referência. E atraso é
 * CONDIÇÃO, não status: a tarefa continua Em andamento — as duas coisas
 * aparecem juntas porque são verdadeiras juntas.
 *
 * Este prazo é o da TAREFA. A previsão que o cartório deu vive no andamento da
 * etapa e não entra aqui: um terceiro que promete quarenta dias não pode
 * reescrever um SLA de cinco.
 */
function CelulaPrazo({ f }: { f: DocumentoDoIndice["naFase"] }) {
  if (f.estado === "CONCLUIDA") return <span className="text-[11px] text-white/25">—</span>
  if (f.prazo == null) return <span className="text-[11px] text-white/35">{f.rotuloDoPrazo}</span>
  // A FRASE VEM DO SERVIDOR. Cada tela montando a sua produzia "Vence em 1
  // dias", "Vence amanhã" e "1 dia restante" para o mesmo prazo — e, pior, réguas
  // diferentes por trás das frases.
  const texto = f.rotuloDoPrazo
  const cor = f.atrasado ? "text-[#f87171]" : f.venceHoje ? "text-[#d2a948]" : "text-white/68"
  return (
    <div>
      <div className={`text-[11.5px] font-semibold ${cor}`}>{texto}</div>
      <div className="text-[10.5px] text-white/30 tabular-nums">
        {new Date(f.prazo).toLocaleDateString("pt-BR")}
      </div>
    </div>
  )
}

/** O rótulo da AÇÃO segue o estado — o mesmo vocabulário da Minha Fila. */
function rotuloDaAcao(f: DocumentoDoIndice["naFase"]): string {
  switch (f.estado) {
    case "A_FAZER": return "Iniciar"
    case "EM_ANDAMENTO": return "Continuar"
    case "AGUARDANDO_TERCEIRO": return "Ver etapa"
    case "BLOQUEADA": return "Ver bloqueio"
    case "CONCLUIDA": return "Ver detalhes"
  }
}

/**
 * QUEM RESPONDE POR ESTE TRABALHO — e como isso se muda, sem sair do processo.
 *
 * ─── POR QUE A AÇÃO MORA NA COLUNA ──────────────────────────────────────────
 * O gestor está olhando o processo e vê uma certidão sem dono. O caminho antigo
 * era: sair para a Operação, achar a tarefa numa lista de TODOS os processos,
 * atribuir, e voltar para onde já estava. A pergunta nasce aqui; a resposta
 * passou a caber aqui.
 *
 * A Operação continua existindo e continua sendo o lugar da distribuição em
 * escala — cem tarefas sem dono não se resolvem uma linha por vez. As duas
 * superfícies chamam a MESMA porta de domínio, sobre a MESMA tarefa.
 *
 * ─── O SELETOR ABRE SOB DEMANDA ─────────────────────────────────────────────
 * Quinhentas linhas com um `<select>` montado em cada uma são quinhentas listas
 * de funcionários no DOM para no máximo uma ser usada. O seletor nasce no
 * clique; a lista de gente vem pronta do container, carregada UMA vez.
 *
 * ─── ATRIBUIR NÃO INICIA ────────────────────────────────────────────────────
 * Este controle muda o DONO. Não toca em estado, prazo, etapa ou progresso —
 * quem começa o trabalho é quem executa, na fila dele, com um clique próprio.
 */
function CelulaResponsavel({
  doc,
  gestao,
  readOnly,
}: {
  doc: DocumentoDoIndice
  gestao?: GestaoDeResponsavel
  readOnly: boolean
}) {
  const [editando, setEditando] = useState(false)
  const f = doc.naFase
  const taskId = f.taskId
  const salvando = gestao?.salvandoResponsavel != null && gestao.salvandoResponsavel === taskId
  // SEM TAREFA NÃO HÁ A QUEM ATRIBUIR — e isso é dito, não escondido atrás de um
  // botão que não faria nada. Documento concluído também não se redistribui.
  const podeGerir =
    !readOnly
    && taskId != null
    && f.estado !== "CONCLUIDA"
    && !!gestao?.onAtribuirResponsavel
    && (gestao?.usuarios?.length ?? 0) > 0

  const nome = f.responsavelNome
    ? <span className="text-white/80 truncate">{f.responsavelNome}</span>
    : f.estado === "CONCLUIDA"
      ? <span className="text-white/25">—</span>
      : <span className="text-[#d2a948]">Sem responsável</span>

  if (!podeGerir) return <div className="min-w-0 text-[11.5px] truncate">{nome}</div>

  if (editando) {
    return (
      <div className="min-w-0 text-[11.5px]">
        <select
          autoFocus
          aria-label="Responsável pela tarefa"
          disabled={salvando}
          defaultValue={f.responsavelId ?? ""}
          onChange={async (e) => {
            const v = e.target.value
            setEditando(false)
            if (v === "") await gestao!.onRetirarResponsavel?.(taskId!)
            else await gestao!.onAtribuirResponsavel!(taskId!, Number(v))
          }}
          onBlur={() => setEditando(false)}
          className="w-full rounded border border-[var(--border-default)] bg-[var(--app-background)] px-1.5 py-1 text-[11.5px] text-white/85 focus:outline-none focus:border-[#7dd3fc]/50 disabled:opacity-50"
        >
          <option value="" className="bg-[#20262e]">
            {f.responsavelId != null ? "— retirar responsável —" : "— selecione —"}
          </option>
          {gestao!.usuarios!.map((u) => (
            <option key={u.id} value={u.id} className="bg-[#20262e]">{u.nome}</option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div className="min-w-0 text-[11.5px]">
      <div className="truncate">{nome}</div>
      <button
        type="button"
        disabled={salvando}
        onClick={() => setEditando(true)}
        className="text-[10.5px] text-[#7dd3fc]/80 hover:text-[#7dd3fc] hover:underline disabled:opacity-40"
      >
        {salvando ? "salvando…" : f.responsavelId != null ? "alterar" : "atribuir"}
      </button>
    </div>
  )
}

function LinhaDocumento({
  doc,
  onAbrirDetalhes,
  gestao,
  readOnly,
  destacado,
}: {
  doc: DocumentoDoIndice
  onAbrirDetalhes?: (doc: DocumentoDoIndice) => void
  gestao?: GestaoDeResponsavel
  readOnly: boolean
  destacado?: boolean
}) {
  const pode = !!onAbrirDetalhes && doc.podeAbrirDetalhes
  // O DOCUMENTO QUE TROUXE O USUÁRIO ATÉ AQUI.
  //
  // Realce discreto e permanente enquanto o link estiver ativo: nada pisca,
  // nada anima. A frase que ele responde é "foi esta certidão que me trouxe",
  // e para isso basta a linha se distinguir das outras catorze.
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (destacado) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [destacado])
  return (
    <div
      ref={ref}
      className={`grid items-center gap-3 px-4 py-3 border-b border-white/[0.07] last:border-b-0 transition-colors ${
        destacado ? "bg-sky-400/[0.07] ring-1 ring-inset ring-sky-300/25" : "hover:bg-[#20262e]/60"
      }`}
      style={{ gridTemplateColumns: COLUNAS }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-7 h-7 rounded-lg grid place-items-center border border-[var(--border-default)] bg-[#252c35] text-white/55 flex-none">
          <FileText className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0">
          <b className="text-[13px] font-bold block leading-tight truncate text-white/95">{doc.titulo}</b>
          <span className="text-[11px] text-white/40 block truncate">
            {[doc.tipoLabel, doc.pais].filter(Boolean).join(" · ") || "Certidão do processo"}
          </span>
        </div>
        {/* DIVERGÊNCIA cabe num selo. Uma coluna inteira para um caso raro custa
            espaço em TODAS as linhas para informar sobre pouquíssimas. */}
        {(doc.statusFinal === "DIVERGENTE" || doc.statusFinal === "INVALIDADO") && (
          <span
            className="flex-none text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#f87171]/15 text-[#f87171]"
            title={doc.statusFinalLabel}
          >
            {doc.statusFinal === "INVALIDADO" ? "Invalidado" : "Divergente"}
          </span>
        )}
      </div>

      <CelulaProgresso p={doc.naFase.progresso} />

      <div className="min-w-0">
        <div className="text-[12px] text-white/80 truncate" title={doc.naFase.etapaAtual ?? undefined}>
          {doc.naFase.etapaAtual ?? "—"}
        </div>
        {doc.naFase.motivoBloqueio && (
          <div className="text-[10.5px] text-[#f87171]/80 truncate" title={doc.naFase.motivoBloqueio}>
            {doc.naFase.motivoBloqueio}
          </div>
        )}
      </div>

      {/* O RESPONSÁVEL É O DA TAREFA. Não existe um segundo dono por documento:
          inventar um criaria a divergência de "Daniela numa tela e Equipe
          Documental na outra". E é AQUI que ele se muda — ver CelulaResponsavel. */}
      <CelulaResponsavel doc={doc} gestao={gestao} readOnly={readOnly} />

      <CelulaPrazo f={doc.naFase} />

      {/* STATUS OPERACIONAL DA TAREFA em primeiro plano; o ESTADO DOCUMENTAL
          abaixo, em segundo. São perguntas diferentes — "como vai o trabalho" e
          "o que este registro é hoje" — e as duas têm resposta. A tabela da fase
          responde a primeira; a segunda acompanha, nunca substitui. */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${CLS_ESTADO[doc.naFase.estado]}`}>
            {doc.naFase.estadoLabel}
          </span>
          {/* ATRASADA NÃO É STATUS — é uma condição que acompanha o status. */}
          {doc.naFase.atrasado && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#f87171]/15 text-[#f87171] whitespace-nowrap">
              Atrasada
            </span>
          )}
        </div>
        {doc.naFase.statusDocumentalLabel && (
          <div
            className="text-[10.5px] text-white/35 mt-1 truncate"
            title={`Estado do documento: ${doc.naFase.statusDocumentalLabel}`}
          >
            Doc.: {doc.naFase.statusDocumentalLabel}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        {pode ? (
          <button
            type="button"
            onClick={() => onAbrirDetalhes!(doc)}
            className="inline-flex items-center gap-1.5 bg-[#252c35] text-white/95 border border-[var(--border-default)] text-[12px] font-bold px-3 py-1.5 rounded-lg hover:bg-[#2d353f] transition-colors whitespace-nowrap"
          >
            {rotuloDaAcao(doc.naFase)} <ChevronRight className="w-3 h-3" />
          </button>
        ) : (
          // Sem executor configurado: o documento CONTINUA visível e o que falta é
          // dito em texto. Esconder a linha seria mentir sobre o trabalho.
          <span className="text-[11px] font-semibold text-[#d2a948] text-right leading-snug" title={doc.impedimento ?? undefined}>
            {readOnly ? "Somente leitura" : "Sem executor"}
          </span>
        )}
      </div>
    </div>
  )
}
