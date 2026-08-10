// src/components/financeiro/v3/PlanilhaDocumentalView.tsx
// ============================================================================
// PLANILHA DOCUMENTAL — a matriz, no Design System do Discovery.
//
// ─── O QUE O PDF DE REFERÊNCIA DECIDE, E O QUE ELE NÃO DECIDE ───────────────
// Do arquivo vêm ESTRUTURA e ORDEM: quais colunas, em que sequência, o
// agrupamento por pessoa, as três linhas de registro, a separação de quem está
// fora da linhagem, o total ao fim.
//
// Do arquivo NÃO vem o visual. A versão anterior reproduzia a folha literal —
// fundo branco, faixas azul-acinzentadas, fonte de 9px, bordas pretas — e o
// resultado era um documento COLADO dentro do Discovery: parecia um PDF
// embutido, não uma tela do sistema. Estrutura é do PDF; superfície é do
// Discovery.
//
// ─── DENSIDADE SEM MIMETISMO ────────────────────────────────────────────────
// A planilha continua densa: é uma tela de conferência, e quem confere precisa
// ver a família inteira de uma vez. Densidade se faz com o `text-xs` e o
// espaçamento curto do próprio sistema — não copiando o corpo 7 do Excel.
//
// ─── O QUE A CÉLULA MOSTRA ──────────────────────────────────────────────────
// Nenhum estado vira R$ 0,00. `BASE_DISPONIVEL` é o preço que existe e está
// resolvido enquanto a Regra Documental ainda não disse se a etapa se aplica:
// ele aparece atenuado, editável, e fora do total.
// ============================================================================
"use client"

import { useState } from "react"
import { useApi } from "@/src/lib/dados"

type EstadoCelula =
  | "NAO_APLICAVEL" | "BASE_DISPONIVEL" | "SEM_PRECO" | "PREVISTO" | "REALIZADO" | "SOBRESCRITO" | "AMBIGUO"

interface Celula {
  colunaId: number
  estado: EstadoCelula
  valorBase: number | null
  valorOverride: number | null
  valorEfetivo: number | null
  editavel: boolean
  explicacao?: {
    servico: string
    registro: string | null
    origem: string | null
    regra: string | null
    motivo: string | null
    itemResolvidoNome: string | null
    valorBase: number | null
  }
}
interface Linha {
  tipoDocumentoId: number | null
  tipoRegistro: string | null
  dataRegistro: string | null
  local: string | null
  cartorio: string | null
  livro: string | null
  folha: string | null
  termo: string | null
  conjuge: string | null
  paiNome: string | null
  maeNome: string | null
  celulas: Celula[]
  totalBrl: number
}
interface Bloco {
  pessoaId: number | null
  nome: string
  geracao: number | null
  linhagemPrincipal: boolean
  posicao: string | null
  linhas: Linha[]
  totalBrl: number
}
interface Planilha {
  nomeProcesso?: string | null
  colunas: { colunaId: number; nome: string }[]
  pessoas: Bloco[]
  totalGeralBrl: number
  totalBaseBrl?: number
}

/** Rótulos das colunas fixas — a ordem é a da referência. */
const CABECALHOS_FIXOS = ["Geração", "Registro", "Data", "Local", "Dados do registro", "Cônjuge", "Genitores"]

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

/**
 * Data de registro em UTC — NUNCA no fuso do navegador. A data de uma certidão
 * é fato de calendário, não instante: no fuso local `1868-07-14T00:00:00Z`
 * vira 13/07 e a planilha passa a discordar da certidão que está na mão.
 */
const dataBR = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—"

const dadosDoRegistro = (l: Linha): string => {
  if (!l.livro && !l.folha && !l.termo) return "—"
  return `Livro ${l.livro || "—"} / Folhas ${l.folha || "—"} / Termo ${l.termo || "—"}`
}

/**
 * O TEXTO DA CÉLULA. Nenhum estado cai em zero — cada um diz uma coisa que
 * R$ 0,00 não sabe dizer.
 */
function textoDaCelula(c?: Celula): string {
  if (!c) return "—"
  switch (c.estado) {
    case "NAO_APLICAVEL": return "—"
    case "SEM_PRECO": return "Sem valor"
    case "AMBIGUO": return "Ambíguo"
    // O preço existe e está resolvido; só a aplicabilidade está em aberto.
    case "BASE_DISPONIVEL": return fmt(c.valorBase ?? 0)
    default: return fmt(c.valorEfetivo ?? c.valorBase ?? 0)
  }
}

/**
 * A COR CONTA O ESTADO — sem badge, sem pílula, sem ícone permanente.
 *
 * Só tokens do sistema: um preço confirmado tem o peso do texto primário; um
 * preço cuja aplicabilidade está em aberto fica atenuado, porque ele ainda não
 * é um compromisso; o que falta cadastrar usa o token de alerta.
 */
function classeDaCelula(c?: Celula): string {
  switch (c?.estado) {
    case "REALIZADO": return "text-[var(--text-primary)] font-medium"
    case "SOBRESCRITO": return "text-[var(--text-primary)] underline decoration-dotted underline-offset-[3px]"
    case "PREVISTO": return "text-[var(--text-secondary)]"
    case "BASE_DISPONIVEL": return "text-[var(--text-muted)]"
    case "SEM_PRECO": return "text-[var(--warning,var(--text-muted))]"
    case "AMBIGUO": return "text-[var(--danger)]"
    default: return "text-[var(--text-muted)]"
  }
}

/** Por que esta célula vale isto — a resposta do Modo Auditor, no `title`. */
function tituloDaCelula(c?: Celula): string | undefined {
  const e = c?.explicacao
  if (!e) return undefined
  const linhas = [
    e.registro && e.servico ? `${e.registro} × ${e.servico}` : e.servico,
    e.itemResolvidoNome ? `Item: ${e.itemResolvidoNome}` : null,
    // Sob combinado, o preço da Tabela continua dito: ele não some, só deixa de
    // valer AQUI. É essa distinção que impede o override de virar "o preço".
    c?.estado === "SOBRESCRITO" && e.valorBase != null ? `Preço padrão: ${fmt(e.valorBase)}` : null,
    c?.estado === "SOBRESCRITO" && c.valorOverride != null ? `Valor deste processo: ${fmt(c.valorOverride)}` : null,
    e.motivo,
    e.origem ? `Origem: ${e.origem}` : null,
    e.regra,
  ].filter(Boolean)
  return linhas.length > 0 ? linhas.join("\n") : undefined
}

/** Aceita "1.234,56", "1234.56" e "1234" — o operador digita como fala. */
function lerValor(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, "").trim()
  if (!limpo) return null
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo
  const n = Number(normal)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * A CÉLULA EDITÁVEL.
 *
 * Fora de edição é uma célula de tabela do Discovery — sem botão, sem coluna
 * "Ações", sem ícone fixo. O único sinal permanente de combinado é o
 * sublinhado pontilhado, que não ocupa espaço nenhum.
 *
 * `Enter` grava, `Escape` cancela, e o blur **cancela** em vez de gravar:
 * clicar fora é o gesto de quem desistiu, e gravar aí produziria alteração
 * financeira que ninguém pediu.
 */
function CelulaEconomica({
  celula, processoId, pessoaId, tipoDocumentoId, aoMudar,
}: {
  celula?: Celula
  processoId: number
  pessoaId: number | null
  tipoDocumentoId: number | null
  aoMudar: () => void
}) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const podeEditar = !!celula?.editavel && pessoaId != null && tipoDocumentoId != null

  const gravar = async (remover: boolean) => {
    if (!celula || pessoaId == null || tipoDocumentoId == null) return
    const valor = remover ? null : lerValor(texto)
    if (!remover && valor == null) { setErro("valor inválido"); return }
    setSalvando(true); setErro(null)
    try {
      const r = await fetch(`/api/processos/${processoId}/planilha-override`, {
        method: remover ? "DELETE" : "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${typeof window === "undefined" ? "" : localStorage.getItem("authToken") ?? ""}`,
        },
        body: JSON.stringify({ pessoaId, tipoDocumentoId, colunaId: celula.colunaId, valor }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? "falha ao salvar")
      setEditando(false)
      aoMudar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  if (editando) {
    return (
      <td className="relative px-2 py-1 text-right">
        <input
          autoFocus
          value={texto}
          disabled={salvando}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void gravar(false) }
            if (e.key === "Escape") { e.preventDefault(); setEditando(false); setErro(null) }
          }}
          onBlur={() => { setEditando(false); setErro(null) }}
          className={`w-full rounded-[var(--radius-sm)] border bg-[var(--surface-primary)] px-1.5 py-0.5 text-right text-xs tabular-nums text-[var(--text-primary)] outline-none ${
            erro ? "border-[var(--danger)]" : "border-[var(--accent-primary)]"
          }`}
          title={erro ?? "Enter grava · Esc cancela"}
        />
        {celula?.valorOverride != null && (
          // `onMouseDown` porque o `onBlur` do input dispara antes do click.
          <button
            onMouseDown={(e) => { e.preventDefault(); void gravar(true) }}
            className="absolute right-2 top-full z-10 mt-0.5 whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Restaurar padrão
          </button>
        )}
      </td>
    )
  }

  return (
    <td
      className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${classeDaCelula(celula)} ${
        podeEditar ? "cursor-cell hover:bg-[var(--surface-hover)]" : ""
      }`}
      title={tituloDaCelula(celula)}
      onClick={() => {
        if (!podeEditar) return
        const inicial = celula?.valorEfetivo ?? celula?.valorBase ?? null
        setTexto(inicial != null ? String(inicial).replace(".", ",") : "")
        setEditando(true)
      }}
    >
      {textoDaCelula(celula)}
    </td>
  )
}

export function PlanilhaDocumentalView({ processoId }: { processoId: number }) {
  const req = useApi<{ planilha?: Planilha }>(`/api/processos/${processoId}/custos`)
  const p = req.dados?.planilha ?? null

  // Quatro estados: carregando / erro / vazio / conteúdo. Nenhum é silêncio.
  if (req.carregando && !p) {
    return <div className="py-10 text-center text-sm text-[var(--text-muted)]">carregando a planilha…</div>
  }
  if (req.erro) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-8 text-center">
        <p className="text-sm text-[var(--text-secondary)]">Não foi possível carregar a planilha documental.</p>
        <button
          onClick={() => void req.recarregar()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
        >
          Tentar novamente
        </button>
      </div>
    )
  }
  if (!p) return null

  // Reler a planilha inteira depois de gravar: o total da linha, o da pessoa e
  // o do processo mudam junto, e recalcular no cliente seria a segunda régua.
  const recarregar = () => { void req.recarregar() }
  const economicas = p.colunas
  const principais = p.pessoas.filter((b) => b.linhagemPrincipal)
  const apoio = p.pessoas.filter((b) => !b.linhagemPrincipal)

  if (p.pessoas.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-10 text-center">
        <p className="text-sm text-[var(--text-secondary)]">Nenhuma pessoa na árvore deste processo.</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          As linhas nascem das pessoas da árvore; os valores, das Regras Documentais e da Tabela de Preços.
        </p>
      </div>
    )
  }

  const comum = { economicas, processoId, aoMudar: recarregar }

  return (
    <div className="mt-3 space-y-6">
      {principais.length > 0 && (
        <section className="space-y-4">
          {principais.map((b) => <BlocoPessoa key={b.pessoaId} bloco={b} rotuloPrimeira="Geração" {...comum} />)}
        </section>
      )}

      {apoio.length > 0 && (
        <section className="space-y-4">
          {/* Divisor de seção do sistema — a faixa cheia do arquivo vira uma
              régua com rótulo, que é como o Discovery separa blocos. */}
          <div className="flex items-center gap-3 pt-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Fora da linhagem · Cônjuges / apoio
            </span>
            <span className="h-px flex-1 bg-[var(--border-default)]" />
          </div>
          {/* Aqui a primeira coluna deixa de ser "Geração": quem está fora da
              linhagem não tem geração, tem número de ordem. */}
          {apoio.map((b) => <BlocoPessoa key={b.pessoaId} bloco={b} rotuloPrimeira="Número" {...comum} />)}
        </section>
      )}

      <div className="flex flex-wrap items-baseline justify-end gap-x-8 gap-y-1 border-t border-[var(--border-default)] pt-3 text-sm">
        {p.totalBaseBrl != null && p.totalBaseBrl > 0 && (
          <span
            className="text-xs text-[var(--text-muted)]"
            title="Preço cadastrado cuja aplicabilidade a Regra Documental ainda não definiu. Não é custo assumido, por isso fica fora do total."
          >
            Preço base disponível <span className="tabular-nums">{fmt(p.totalBaseBrl)}</span>
          </span>
        )}
        <span className="text-[var(--text-secondary)]">
          Total <span className="ml-2 font-medium tabular-nums text-[var(--text-primary)]">{fmt(p.totalGeralBrl)}</span>
        </span>
      </div>
    </div>
  )
}

/**
 * UM BLOCO = UMA PESSOA: o nome como agrupamento e, abaixo, as suas linhas de
 * registro. O cabeçalho se repete por pessoa — é a leitura da referência, e um
 * cabeçalho global só serviria a uma lista contínua, que esta tela não é.
 */
function BlocoPessoa({
  bloco, economicas, rotuloPrimeira, processoId, aoMudar,
}: {
  bloco: Bloco
  economicas: { colunaId: number; nome: string }[]
  rotuloPrimeira: string
  processoId: number
  aoMudar: () => void
}) {
  return (
    <div style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)]">{bloco.nome}</h4>
        {bloco.posicao && <span className="text-[11px] text-[var(--text-muted)]">{bloco.posicao}</span>}
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-default)]">
        {/* Largura mínima: o suficiente para o Total caber sem rolagem no painel
            do processo. Acima disso a tabela ocupa o que houver; abaixo, o
            container rola — que é como o Discovery trata tabela larga. */}
        <table className="w-full min-w-[860px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--border-default)] bg-[var(--surface-primary)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              {[rotuloPrimeira, ...CABECALHOS_FIXOS.slice(1)].map((h) => (
                <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>
              ))}
              {economicas.map((c) => (
                <th key={c.colunaId} className="px-2 py-2 text-right font-medium">{c.nome}</th>
              ))}
              <th className="px-2 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="text-[var(--text-secondary)]">
            {bloco.linhas.map((l, i) => (
              <tr
                key={l.tipoDocumentoId ?? i}
                className="border-b border-[var(--border-default)] last:border-0 hover:bg-[var(--surface-hover)]"
              >
                <td className="px-2 py-1 text-[var(--text-muted)]">{bloco.geracao ?? "—"}</td>
                <td className="whitespace-nowrap px-2 py-1 text-[var(--text-primary)]">{l.tipoRegistro ?? "—"}</td>
                <td className="whitespace-nowrap px-2 py-1 tabular-nums">{dataBR(l.dataRegistro)}</td>
                <td className="min-w-[90px] px-2 py-1">{l.local ?? l.cartorio ?? "—"}</td>
                <td className="px-2 py-1">{dadosDoRegistro(l)}</td>
                <td className="px-2 py-1">{l.conjuge ?? "—"}</td>
                <td className="px-2 py-1 leading-tight">
                  {l.paiNome || l.maeNome ? (
                    <>
                      <div><span className="text-[var(--text-muted)]">Pai:</span> {l.paiNome ?? "—"}</div>
                      <div><span className="text-[var(--text-muted)]">Mãe:</span> {l.maeNome ?? "—"}</div>
                    </>
                  ) : "—"}
                </td>
                {economicas.map((c) => (
                  <CelulaEconomica
                    key={c.colunaId}
                    celula={l.celulas.find((x) => x.colunaId === c.colunaId)}
                    processoId={processoId}
                    pessoaId={bloco.pessoaId}
                    tipoDocumentoId={l.tipoDocumentoId}
                    aoMudar={aoMudar}
                  />
                ))}
                <td className="px-2 py-1 text-right font-medium tabular-nums text-[var(--text-primary)]">
                  {fmt(l.totalBrl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default PlanilhaDocumentalView
