"use client"

// src/components/kanban/ProcessoPreCadastro.tsx
// ============================================================================
// ABA "PRÉ-CADASTRO" DO PROCESSO — o que o cliente enviou pelo link de coleta
// (docs/coleta-de-dados-mandato.md). SÓ CONSULTA: aqui não existe "Aprovar" por pessoa.
// Nada daqui está no cadastro de clientes; quem entra é decidido na conferência, que abre
// ao mover o processo para Genealogia. Serve para o administrador montar o contrato.
//
// Também exporta `ListaPreCadastro` (o cartão de cada envio), reaproveitada pela conferência.
// ============================================================================

import { useState } from "react"
import { Check, Copy, FileText, Link2, Loader2, XCircle } from "lucide-react"
import { useApi } from "@/src/lib/dados"
import { mascararCpf } from "@/src/lib/cpf"
import { ROTULO_TIPO_ARQUIVO, type PapelColeta } from "@/src/lib/coleta/campos"
import type { EnvioParaConferencia, PreCadastro } from "@/src/services/coleta/coleta-conferencia"

export const ROTULO_PAPEL: Record<PapelColeta, string> = { REQUERENTE: "Requerente", CONTRATANTE: "Contratante", AMBOS: "Requerente e contratante" }

const token = () => (typeof window !== "undefined" ? localStorage.getItem("authToken") : null)
const data = (d: Date | string) => new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
const tamanho = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

async function abrirArquivo(processoId: number, arquivoId: number) {
  const r = await fetch(`/api/processos/${processoId}/coleta/arquivo/${arquivoId}`, { headers: { Authorization: `Bearer ${token()}` } })
  const d = (await r.json().catch(() => ({}))) as { url?: string }
  if (r.ok && d.url) window.open(d.url, "_blank", "noopener")
}

export function ListaPreCadastro({ envios, processoId, compacto = false }: { envios: EnvioParaConferencia[]; processoId: number; compacto?: boolean }) {
  return (
    <ul className="space-y-3">
      {envios.map((e) => {
        const d = e.dados
        const endereco = [d?.endereco && `${d.endereco}${d.numero ? `, ${d.numero}` : ""}`, d?.complemento, d?.bairro, d?.cidade && `${d.cidade}${d.estado ? `/${d.estado}` : ""}`, d?.cep].filter(Boolean).join(" · ")
        return (
          <li key={e.id} className={compacto ? "" : "rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-4"} data-pre-cadastro={e.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">{d?.nome ?? "—"}</p>
                <p className="text-xs text-[var(--text-secondary)]">CPF {mascararCpf(d?.cpf)} · {ROTULO_PAPEL[e.papelDeclarado]}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {e.semIdentidade && <span className="rounded-full bg-[var(--warning-tile)] px-2 py-0.5 text-[10px] font-semibold text-[var(--warning-text)]">Sem RG ou CNH</span>}
                {e.semComprovante && <span className="rounded-full bg-[var(--warning-tile)] px-2 py-0.5 text-[10px] font-semibold text-[var(--warning-text)]">Sem comprovante de endereço</span>}
              </div>
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Enviado em {data(e.criadoEm)}{e.reenvios > 0 ? ` · reenviado ${e.reenvios}x (último em ${data(e.atualizadoEm)})` : ""}</p>
            <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-xs text-gray-800 sm:grid-cols-2">
              {d?.telefone && <div><dt className="inline text-[var(--text-secondary)]">Telefone: </dt><dd className="inline">{d.telefone}</dd></div>}
              {d?.email && <div><dt className="inline text-[var(--text-secondary)]">E-mail: </dt><dd className="inline">{d.email}</dd></div>}
              {d?.dataNascimento && <div><dt className="inline text-[var(--text-secondary)]">Nascimento: </dt><dd className="inline">{d.dataNascimento.split("-").reverse().join("/")}</dd></div>}
              {d?.rg && <div><dt className="inline text-[var(--text-secondary)]">RG: </dt><dd className="inline">{d.rg}</dd></div>}
              {d?.estadoCivil && <div><dt className="inline text-[var(--text-secondary)]">Estado civil: </dt><dd className="inline">{d.estadoCivil}</dd></div>}
              {d?.nacionalidade && <div><dt className="inline text-[var(--text-secondary)]">Nacionalidade: </dt><dd className="inline">{d.nacionalidade}</dd></div>}
              {endereco && <div className="sm:col-span-2"><dt className="inline text-[var(--text-secondary)]">Endereço: </dt><dd className="inline">{endereco}</dd></div>}
            </dl>
            {e.arquivos.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {e.arquivos.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => void abrirArquivo(processoId, a.id)} className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-[var(--surface-primary)] px-2 py-1 text-[11px] text-gray-800 hover:border-[var(--border-strong)]" title={a.nome}>
                      <FileText className="h-3 w-3" aria-hidden /> {ROTULO_TIPO_ARQUIVO[a.tipo]} · {tamanho(a.tamanho)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(e.mesmoCpf.requerente || e.mesmoCpf.contratante) && (
              <p className="mt-2 text-[11px] text-[var(--info-text)]">
                Este CPF já tem cadastro: {[e.mesmoCpf.requerente && `requerente ${e.mesmoCpf.requerente.publicCode ?? `#${e.mesmoCpf.requerente.id}`} — ${e.mesmoCpf.requerente.nome}`, e.mesmoCpf.contratante && `contratante ${e.mesmoCpf.contratante.publicCode ?? `#${e.mesmoCpf.contratante.id}`} — ${e.mesmoCpf.contratante.nome}`].filter(Boolean).join("; ")}. Na conferência o cadastro existente é reaproveitado.
              </p>
            )}
            {e.mesmoNome.length > 0 && (
              <p className="mt-1 text-[11px] text-[var(--warning-text)]">
                Atenção: já existe cliente com o mesmo nome e outro CPF ({e.mesmoNome.map((n) => `${n.publicCode ?? `#${n.id}`}`).join(", ")}). É só um aviso — confira se é a mesma pessoa.
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function ProcessoPreCadastro({ processoId }: { processoId: number }) {
  const { dados, carregando, erro, recarregar } = useApi<PreCadastro & { podeGerar: boolean }>(`/api/processos/${processoId}/coleta`)
  const [ocupado, setOcupado] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const url = dados?.link ? `${typeof window !== "undefined" ? window.location.origin : ""}/coleta/${dados.link.codigo}` : null

  async function chamar(caminho: string, rotuloErro: string) {
    setOcupado(true); setAviso(null)
    try {
      const r = await fetch(`/api/processos/${processoId}/coleta${caminho}`, { method: "POST", headers: { Authorization: `Bearer ${token()}` } })
      if (!r.ok) { setAviso(((await r.json().catch(() => ({}))) as { error?: string }).error ?? rotuloErro); return }
      await recarregar()
    } catch { setAviso(rotuloErro) } finally { setOcupado(false) }
  }

  async function copiar() {
    if (!url) return
    try { await navigator.clipboard.writeText(url); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { setAviso("Não foi possível copiar. Selecione o link e copie à mão.") }
  }

  if (carregando) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>
  if (erro || !dados) return <p className="p-6 text-sm text-red-700">Não foi possível carregar o pré-cadastro.</p>

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Pré-cadastro (link de coleta)</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          O cliente preenche os dados e anexa os documentos por um link. O que chega fica aqui, <strong>fora do cadastro de clientes</strong>. Ao mover o processo para Genealogia, a conferência abre e você escolhe quem entra.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
        {dados.link && url ? (
          <>
            <p className="flex items-center gap-2 text-sm font-medium text-gray-900"><Link2 className="h-4 w-4" aria-hidden /> Link ativo</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 rounded-lg border border-gray-300 bg-[var(--surface-secondary)] px-2 text-xs text-gray-800" aria-label="Link de coleta" />
              <button type="button" onClick={() => void copiar()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--action-primary)] px-3 text-sm font-semibold text-[var(--action-primary-ink)]">
                {copiado ? <><Check className="h-4 w-4" aria-hidden /> Copiado</> : <><Copy className="h-4 w-4" aria-hidden /> Copiar link</>}
              </button>
              <button type="button" disabled={ocupado} onClick={() => { if (window.confirm("Encerrar o link? O cliente não conseguirá mais enviar. O que já foi enviado continua aqui.")) void chamar("/encerrar", "Não foi possível encerrar o link.") }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-800 hover:border-red-400 disabled:opacity-50">
                <XCircle className="h-4 w-4" aria-hidden /> Encerrar link
              </button>
            </div>
            <p className="mt-2 text-xs text-[var(--text-secondary)]">Criado em {data(dados.link.criadoEm)}. Encerra sozinho quando o processo sair de “Aguardando fechamento”.</p>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-800">Não há link ativo.</p>
            <button type="button" disabled={ocupado || !dados.podeGerar} onClick={() => void chamar("", "Não foi possível gerar o link.")}
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--action-primary)] px-3 text-sm font-semibold text-[var(--action-primary-ink)] disabled:opacity-50">
              {ocupado && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Gerar link de coleta
            </button>
            {!dados.podeGerar && <p className="mt-2 text-xs text-[var(--text-secondary)]">O link só pode ser gerado com o processo em “Aguardando fechamento”.</p>}
          </>
        )}
        {aviso && <p className="mt-2 text-sm text-red-700" role="alert">{aviso}</p>}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Enviados ({dados.pendentes})</h3>
        {dados.envios.length === 0
          ? <p className="text-sm text-[var(--text-secondary)]">Nenhum envio ainda.</p>
          : <ListaPreCadastro envios={dados.envios} processoId={processoId} />}
      </div>
    </div>
  )
}
