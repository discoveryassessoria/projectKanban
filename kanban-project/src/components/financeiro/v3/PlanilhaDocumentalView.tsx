// src/components/financeiro/v3/PlanilhaDocumentalView.tsx
// ============================================================================
// PLANILHA DOCUMENTAL — a visão que existia no Excel, agora como PROJEÇÃO.
//
// Uma tela de leitura. Agrupa por pessoa; dentro da pessoa, uma linha por
// documento; uma coluna por serviço documental aplicável ao processo. Totais por
// linha, por pessoa e do processo inteiro.
//
// O que ela NÃO é: fonte. Não edita valor, não cria custo, não guarda número. O
// dinheiro é da obrigação (cujo saldo é do Ledger) e os dados registrais são do
// documento. Aqui só se lê e se soma.
//
// As colunas vêm do servidor — que as deriva do cadastro — e não de uma lista
// escrita aqui. Um processo com quatro serviços mostra quatro colunas; um com
// sete, sete.
// ============================================================================
"use client"

import { useApi } from "@/src/lib/dados"
import { FileSpreadsheet, RefreshCw } from "lucide-react"
import { fmtMoeda as fmt } from "@/src/lib/financeiro/formato"
import { AvisoNaoConvertido } from "./ValorBrl"

interface Celula {
  tipoServicoId: number
  valor: number
  valorBrl: number
  moeda: string | null
  naoConvertido: number
  automatico: boolean
  obrigacoes: number[]
}
interface Linha {
  documentoId: number
  tipoRegistro: string | null
  dataRegistro: string | null
  local: string | null
  cartorio: string | null
  livro: string | null
  folha: string | null
  termo: string | null
  numeroRegistro: string | null
  observacao: string | null
  localizado: boolean
  celulas: Celula[]
  totalBrl: number
  naoConvertido: number
}
interface Bloco {
  pessoaId: number | null
  nome: string
  numeroLinhagem: number | null
  conjuges: string[]
  paiNome: string | null
  maeNome: string | null
  linhas: Linha[]
  totalBrl: number
  naoConvertido: number
}
interface Planilha {
  colunas: { tipoServicoId: number; nome: string; ordem: number }[]
  pessoas: Bloco[]
  totaisPorServico: Record<number, number>
  totalGeralBrl: number
  naoConvertido: number
  custosSemVinculo: number
}

const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—")

/** Livro / folha / termo numa célula só — como a planilha antiga mostrava. */
function dadosRegistro(l: Linha): string {
  const partes = [
    l.livro ? `Livro ${l.livro}` : null,
    l.folha ? `Folha ${l.folha}` : null,
    l.termo ? `Termo ${l.termo}` : null,
  ].filter(Boolean)
  return partes.length ? partes.join(" · ") : "—"
}

export function PlanilhaDocumentalView({ processoId }: { processoId: number }) {
  const req = useApi<{ planilha?: Planilha }>(`/api/processos/${processoId}/custos`)
  const p = req.dados?.planilha ?? null

  // Quatro estados: carregando / erro / vazio / conteúdo. Nenhum deles é silêncio.
  if (req.carregando && !p) {
    return <div className="py-10 text-center text-sm text-[var(--text-muted)]">carregando a planilha…</div>
  }
  if (req.erro) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-8 text-center">
        <p className="text-sm text-[var(--text-secondary)]">Não foi possível carregar a planilha documental.</p>
        <button onClick={() => void req.recarregar()} className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
          <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
        </button>
      </div>
    )
  }
  if (!p) return null

  const temLinhas = p.pessoas.some((b) => b.linhas.length > 0)
  const colunas = p.colunas

  return (
    <div className="mt-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
            <FileSpreadsheet className="h-4 w-4 text-[var(--text-muted)]" /> Planilha documental
          </h3>
          <p className="text-sm text-[var(--text-muted)]">
            Custos previstos por pessoa e por documento. Projeção — o lançamento vive em Custos.
          </p>
        </div>
        <button onClick={() => void req.recarregar()} title="Recarregar" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-primary)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-active)]">
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </button>
      </div>

      <AvisoNaoConvertido className="mb-2" quantidade={p.naoConvertido > 0 ? 1 : 0} />

      {/* Custo sem vínculo documental não some: ele existe na lista, só não tem
          lugar na grade (é despesa extraordinária ou lançamento anterior ao vínculo). */}
      {p.custosSemVinculo > 0 && (
        <p className="mb-2 text-xs text-[var(--text-muted)]">
          {p.custosSemVinculo} custo(s) sem vínculo documental não aparecem nesta grade — veja a lista de Custos.
        </p>
      )}

      {!temLinhas ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-10 text-center">
          <p className="text-sm text-[var(--text-secondary)]">Nenhum documento desta família participa da planilha ainda.</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            As linhas nascem dos documentos das pessoas da árvore; os custos, quando o registro é localizado.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-3 font-medium">Registro</th>
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Local</th>
                <th className="px-4 py-3 font-medium">Dados do registro</th>
                {colunas.map((c) => (
                  <th key={c.tipoServicoId} className="px-4 py-3 text-right font-medium">{c.nome}</th>
                ))}
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {p.pessoas.filter((b) => b.linhas.length > 0).map((b) => (
                <PessoaBloco key={b.pessoaId ?? b.nome} bloco={b} colunas={colunas} />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-hover)]">
                <td colSpan={4} className="px-4 py-3 font-semibold text-[var(--text-primary)]">Total do processo</td>
                {colunas.map((c) => (
                  <td key={c.tipoServicoId} className="px-4 py-3 text-right tabular-nums font-medium text-[var(--text-secondary)]">
                    {fmt(p.totaisPorServico[c.tipoServicoId] ?? 0)}
                  </td>
                ))}
                <td className="px-4 py-3 text-right tabular-nums font-bold text-[var(--text-primary)]">{fmt(p.totalGeralBrl)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function PessoaBloco({ bloco, colunas }: { bloco: Bloco; colunas: Planilha["colunas"] }) {
  const cols = colunas.length + 5
  return (
    <>
      <tr className="border-t border-[var(--border-default)] bg-[var(--surface-hover)]">
        <td colSpan={cols} className="px-4 py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-semibold text-[var(--text-primary)]">{bloco.nome}</span>
            {bloco.numeroLinhagem != null && (
              <span className="text-[11px] text-[var(--text-muted)]">geração {bloco.numeroLinhagem}</span>
            )}
            {bloco.conjuges[0] && <span className="text-xs text-[var(--text-secondary)]">cônjuge: {bloco.conjuges[0]}</span>}
            {(bloco.paiNome || bloco.maeNome) && (
              <span className="text-xs text-[var(--text-muted)]">
                filiação: {[bloco.paiNome, bloco.maeNome].filter(Boolean).join(" e ")}
              </span>
            )}
          </div>
        </td>
      </tr>
      {bloco.linhas.map((l) => (
        <tr key={l.documentoId} className="border-t border-[var(--border-default)] hover:bg-[var(--surface-hover)]">
          <td className="px-4 py-3">
            <div className="text-[var(--text-primary)]">{l.tipoRegistro ?? "—"}</div>
            {/* "Localizado" é a régua oficial do registro, não um enfeite: é ela que
                autoriza a projeção do custo. Mostrar quando falta evita a pergunta
                "por que este documento não tem custo?". */}
            {!l.localizado && <div className="text-[11px] text-[var(--warning)]">registro ainda não localizado</div>}
          </td>
          <td className="px-4 py-3 text-[var(--text-secondary)]">{dataBR(l.dataRegistro)}</td>
          <td className="px-4 py-3 text-[var(--text-secondary)]">{l.local ?? l.cartorio ?? "—"}</td>
          <td className="px-4 py-3 text-[var(--text-secondary)]">
            <div>{dadosRegistro(l)}</div>
            {l.cartorio && <div className="text-[11px] text-[var(--text-muted)]">{l.cartorio}</div>}
          </td>
          {colunas.map((c) => {
            const cel = l.celulas.find((x) => x.tipoServicoId === c.tipoServicoId)
            const v = cel?.valorBrl ?? 0
            return (
              <td key={c.tipoServicoId} className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                {v > 0 ? fmt(v) : <span className="text-[var(--text-muted)]">—</span>}
              </td>
            )
          })}
          <td className="px-4 py-3 text-right tabular-nums font-medium text-[var(--text-primary)]">{fmt(l.totalBrl)}</td>
        </tr>
      ))}
      <tr className="border-t border-[var(--border-default)]">
        <td colSpan={4} className="px-4 py-2 text-right text-xs text-[var(--text-muted)]">Total de {bloco.nome}</td>
        {colunas.map((c) => (
          <td key={c.tipoServicoId} className="px-4 py-2 text-right tabular-nums text-xs text-[var(--text-muted)]">
            {fmt(bloco.linhas.reduce((s, l) => s + (l.celulas.find((x) => x.tipoServicoId === c.tipoServicoId)?.valorBrl ?? 0), 0))}
          </td>
        ))}
        <td className="px-4 py-2 text-right tabular-nums text-sm font-semibold text-[var(--text-primary)]">{fmt(bloco.totalBrl)}</td>
      </tr>
    </>
  )
}

export default PlanilhaDocumentalView
