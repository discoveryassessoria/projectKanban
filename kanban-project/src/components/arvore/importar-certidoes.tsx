// src/components/arvore/importar-certidoes.tsx
//
// IMPORTAR CERTIDÕES — a entrada principal do acervo, dentro da Árvore.
//
// O operador arrasta as certidões aqui e vê, antes de qualquer gravação: que tipo
// de documento é cada uma, de quem ela fala, o que foi lido, onde as duas leituras
// divergiram e como a árvore ficaria. Só depois de conferir é que ele confirma —
// e aí os arquivos entram na Pasta Documental existente, com a pessoa certa.
//
// Três telas, na ordem em que a cabeça do operador trabalha:
//   ENVIO    → arrastar/escolher arquivos, subir para o storage
//   REVISAO  → prévia por documento + árvore proposta, com decisão por documento
//   FIM      → o que entrou, e para onde ir
//
// Paleta: a da própria Árvore (branco/cinza), não a dark-glass do Financeiro.
// O portal sobe acima do modal do processo porque a Árvore vive dentro dele.

"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from "lucide-react"
import { useIsClient } from "@/src/lib/cliente"
import { LAYER } from "@/src/lib/ui/layers"
import { uploadFiles } from "@/src/lib/storage"
import type { PessoaArvore } from "./types"

// ---------------------------------------------------------------------------
// Contratos com o servidor (espelham src/services/registral/importacao.ts)
// ---------------------------------------------------------------------------

interface PessoaSugerida {
  pessoaId: number | null
  nome: string
  classe: string | null
  score: number | null
  nova: boolean
  motivo: string
}

interface CampoAnalisado {
  campo: string
  rotulo: string
  papel: string
  valor: string | null
  veredicto: string
  confianca: number
  divergente: boolean
  explicacao: string
}

interface DivergenciaAnalisada {
  campo: string
  rotulo: string
  leituraA: string | null
  leituraB: string | null
  critica: boolean
  explicacao: string
}

interface ArquivoAnalisado {
  indice: number
  nome: string
  url: string
  mimeType: string | null
  tipo: string
  confiancaTipo: number
  fonteTexto: string | null
  legivel: boolean
  motivoIlegivel: string | null
  sujeito: PessoaSugerida | null
  participantes: Array<{ papel: string; nome: string; sugestao: PessoaSugerida }>
  campos: CampoAnalisado[]
  divergencias: DivergenciaAnalisada[]
  necessidade: { id: number; item: string } | null
  transcricao: { paginas: Array<{ pagina: number; texto: string }>; fonte: string } | null
}

interface NoPrevia {
  chave: string
  nome: string
  papel: string
  pessoaId: number | null
  nova: boolean
  paiChave: string | null
  maeChave: string | null
  documentos: number[]
}

interface ResultadoAnalise {
  processoId: number
  arvoreId: number | null
  arquivos: ArquivoAnalisado[]
  previa: NoPrevia[]
  resumo: {
    total: number
    legiveis: number
    ilegiveis: number
    pessoasNovas: number
    pessoasVinculadas: number
    divergencias: number
    semOcr: boolean
  }
  avisos: string[]
  provedores?: Array<{ nome: string; disponivel: boolean; motivo: string | null }>
}

interface ResultadoConfirmacao {
  documentosCriados: number[]
  pessoasCriadas: number[]
  descartados: number
  loteId: number | null
  propostas: number
  conflitos: number
  erros: Array<{ indice: number; motivo: string }>
}

interface ArquivoEnviado {
  url: string
  nome: string
  mimeType: string | null
  tamanho: number | null
}

/** Decisão do operador por documento. */
interface Decisao {
  pessoaId: number | null
  nomeNovaPessoa: string | null
  descartar: boolean
}

type Etapa = "envio" | "analisando" | "revisao" | "confirmando" | "fim"

const ROTULO_TIPO: Record<string, string> = {
  NASCIMENTO: "Certidão de nascimento",
  CASAMENTO: "Certidão de casamento",
  OBITO: "Certidão de óbito",
  BATISMO: "Certidão de batismo",
  NATURALIZACAO: "Naturalização",
  IMIGRACAO: "Imigração",
  DESCONHECIDO: "Tipo não identificado",
}

const ROTULO_PAPEL: Record<string, string> = {
  REGISTRADO: "Titular",
  PAI: "Pai",
  MAE: "Mãe",
  CONJUGE: "Cônjuge",
  PAI_CONJUGE: "Pai do cônjuge",
  MAE_CONJUGE: "Mãe do cônjuge",
  TESTEMUNHA: "Testemunha",
  DECLARANTE: "Declarante",
}

const TIPOS_ACEITOS = "application/pdf,image/jpeg,image/png,image/webp,image/tiff,.pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff"
const MAX_ARQUIVOS = 30

function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

function nomeCompleto(p: PessoaArvore): string {
  return [p.nome, p.sobrenome].filter(Boolean).join(" ")
}

// ---------------------------------------------------------------------------

interface Props {
  processoId: number
  pessoas: PessoaArvore[]
  aberto: boolean
  onFechar: () => void
  /** Chamado depois de confirmar, para a árvore recarregar. */
  onImportado: () => void
}

export function ImportarCertidoes({ processoId, pessoas, aberto, onFechar, onImportado }: Props) {
  const montado = useIsClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const [etapa, setEtapa] = useState<Etapa>("envio")
  const [arrastando, setArrastando] = useState(false)
  const [selecionados, setSelecionados] = useState<File[]>([])
  const [progresso, setProgresso] = useState<Record<string, number>>({})
  const [enviados, setEnviados] = useState<ArquivoEnviado[]>([])
  const [analise, setAnalise] = useState<ResultadoAnalise | null>(null)
  const [decisoes, setDecisoes] = useState<Record<number, Decisao>>({})
  const [resultado, setResultado] = useState<ResultadoConfirmacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [expandido, setExpandido] = useState<number | null>(null)

  const ordenadas = useMemo(
    () => [...pessoas].sort((a, b) => nomeCompleto(a).localeCompare(nomeCompleto(b))),
    [pessoas],
  )

  const limpar = useCallback(() => {
    setEtapa("envio")
    setSelecionados([])
    setProgresso({})
    setEnviados([])
    setAnalise(null)
    setDecisoes({})
    setResultado(null)
    setErro(null)
    setExpandido(null)
  }, [])

  const fechar = useCallback(() => {
    limpar()
    onFechar()
  }, [limpar, onFechar])

  // ---- seleção de arquivos ------------------------------------------------

  const adicionar = useCallback((lista: FileList | File[]) => {
    setErro(null)
    const novos = Array.from(lista)
    setSelecionados((atual) => {
      const juntos = [...atual]
      for (const f of novos) {
        if (!juntos.some((x) => x.name === f.name && x.size === f.size)) juntos.push(f)
      }
      if (juntos.length > MAX_ARQUIVOS) {
        setErro(`Máximo de ${MAX_ARQUIVOS} arquivos por importação. Envie o restante em outra rodada.`)
        return juntos.slice(0, MAX_ARQUIVOS)
      }
      return juntos
    })
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setArrastando(false)
      if (e.dataTransfer.files?.length) adicionar(e.dataTransfer.files)
    },
    [adicionar],
  )

  // ---- envio + análise ----------------------------------------------------

  const enviarEAnalisar = useCallback(async () => {
    if (selecionados.length === 0) return
    setErro(null)
    setEtapa("analisando")
    try {
      // 1) sobe os arquivos para o MESMO storage dos documentos do processo
      const subidos = await uploadFiles(selecionados, {
        prefix: "documentos",
        onProgress: (file, pct) => setProgresso((p) => ({ ...p, [file.name]: pct })),
      })
      const arquivos: ArquivoEnviado[] = subidos.map((s) => ({
        url: s.url,
        nome: s.name,
        mimeType: s.type || null,
        tamanho: s.size ?? null,
      }))
      setEnviados(arquivos)

      // 2) analisa SEM gravar — o servidor lê, classifica e monta a prévia
      const res = await authFetch(`/api/processos/${processoId}/registral/importar/analisar`, {
        method: "POST",
        body: JSON.stringify({ arquivos }),
      })
      const dados = await res.json()
      if (!res.ok) throw new Error(dados?.error || "Falha ao analisar os documentos.")

      const analisado = dados as ResultadoAnalise
      setAnalise(analisado)
      setDecisoes(
        Object.fromEntries(
          analisado.arquivos.map((a) => [
            a.indice,
            {
              pessoaId: a.sujeito?.pessoaId ?? null,
              nomeNovaPessoa: a.sujeito?.nome ?? null,
              // Documento ilegível já entra marcado para descarte: sem leitura,
              // não há de quem seja — o operador reverte se quiser guardá-lo.
              descartar: !a.legivel,
            } satisfies Decisao,
          ]),
        ),
      )
      setEtapa("revisao")
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
      setEtapa("envio")
    }
  }, [processoId, selecionados])

  // ---- confirmação --------------------------------------------------------

  const confirmar = useCallback(async () => {
    if (!analise) return
    setErro(null)
    setEtapa("confirmando")
    try {
      const res = await authFetch(`/api/processos/${processoId}/registral/importar/confirmar`, {
        method: "POST",
        body: JSON.stringify({
          arquivos: enviados,
          analise: analise.arquivos,
          decisoes: analise.arquivos.map((a) => ({
            indice: a.indice,
            pessoaId: decisoes[a.indice]?.pessoaId ?? null,
            nomeNovaPessoa: decisoes[a.indice]?.nomeNovaPessoa ?? null,
            descartar: decisoes[a.indice]?.descartar ?? false,
          })),
        }),
      })
      const dados = await res.json()
      if (!res.ok) throw new Error(dados?.error || "Falha ao confirmar a importação.")
      setResultado(dados as ResultadoConfirmacao)
      setEtapa("fim")
      onImportado()
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
      setEtapa("revisao")
    }
  }, [analise, decisoes, enviados, onImportado, processoId])

  if (!montado || !aberto) return null

  const aImportar = analise ? analise.arquivos.filter((a) => !decisoes[a.indice]?.descartar).length : 0

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: LAYER.aboveProcess }}>
      <div className="absolute inset-0 bg-black/50" onClick={etapa === "analisando" || etapa === "confirmando" ? undefined : fechar} />

      <div className="relative w-full max-w-5xl max-h-[92vh] bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-blue-50">
              <UploadCloud className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Importar certidões</h2>
              <p className="text-xs text-gray-500">
                Os arquivos vão para a Pasta Documental do processo. Nada é gravado antes da sua confirmação.
              </p>
            </div>
          </div>
          <button
            onClick={fechar}
            disabled={etapa === "analisando" || etapa === "confirmando"}
            className="p-2 hover:bg-gray-100 rounded transition-colors disabled:opacity-40"
            title="Fechar"
          >
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        {/* Passos */}
        <div className="flex items-center gap-2 px-5 py-2 border-b bg-gray-50 text-xs">
          <Passo n={1} rotulo="Enviar" ativo={etapa === "envio" || etapa === "analisando"} feito={etapa === "revisao" || etapa === "confirmando" || etapa === "fim"} />
          <div className="h-px w-6 bg-gray-300" />
          <Passo n={2} rotulo="Revisar" ativo={etapa === "revisao" || etapa === "confirmando"} feito={etapa === "fim"} />
          <div className="h-px w-6 bg-gray-300" />
          <Passo n={3} rotulo="Concluir" ativo={etapa === "fim"} feito={false} />
        </div>

        {erro && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {(etapa === "envio" || etapa === "analisando") && (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setArrastando(true)
                }}
                onDragLeave={() => setArrastando(false)}
                onDrop={onDrop}
                onClick={() => etapa === "envio" && inputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
                  etapa === "analisando"
                    ? "border-gray-200 bg-gray-50 cursor-default"
                    : arrastando
                      ? "border-blue-400 bg-blue-50 cursor-pointer"
                      : "border-gray-300 hover:border-blue-300 hover:bg-gray-50 cursor-pointer"
                }`}
              >
                <Upload className={`h-8 w-8 ${arrastando ? "text-blue-500" : "text-gray-400"}`} />
                <p className="text-sm font-medium text-gray-700">
                  Arraste as certidões aqui ou clique para escolher
                </p>
                <p className="text-xs text-gray-500">
                  PDF ou imagem · vários arquivos de uma vez · até {MAX_ARQUIVOS} por rodada
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept={TIPOS_ACEITOS}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) adicionar(e.target.files)
                    e.target.value = ""
                  }}
                />
              </div>

              {selecionados.length > 0 && (
                <ul className="mt-4 space-y-1">
                  {selecionados.map((f) => (
                    <li key={`${f.name}-${f.size}`} className="flex items-center gap-3 rounded border px-3 py-2 text-sm">
                      <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                      <span className="flex-1 truncate text-gray-800">{f.name}</span>
                      <span className="text-xs text-gray-500">{(f.size / 1024).toFixed(0)} KB</span>
                      {etapa === "analisando" ? (
                        <span className="w-24 text-right text-xs text-gray-500">
                          {progresso[f.name] === 100 ? "enviado" : `${progresso[f.name] ?? 0}%`}
                        </span>
                      ) : (
                        <button
                          onClick={() => setSelecionados((a) => a.filter((x) => x !== f))}
                          className="p-1 hover:bg-gray-100 rounded"
                          title="Remover"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-gray-400" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {etapa === "analisando" && (
                <div className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Lendo as certidões, classificando e comparando com a árvore…
                </div>
              )}
            </>
          )}

          {(etapa === "revisao" || etapa === "confirmando") && analise && (
            <div className="space-y-4">
              <Resumo analise={analise} />

              {analise.previa.length > 0 && <ArvoreProposta previa={analise.previa} />}

              <div className="space-y-3">
                {analise.arquivos.map((a) => (
                  <CartaoDocumento
                    key={a.indice}
                    a={a}
                    pessoas={ordenadas}
                    decisao={decisoes[a.indice]}
                    expandido={expandido === a.indice}
                    onExpandir={() => setExpandido(expandido === a.indice ? null : a.indice)}
                    onDecidir={(d) => setDecisoes((atual) => ({ ...atual, [a.indice]: { ...atual[a.indice], ...d } }))}
                  />
                ))}
              </div>
            </div>
          )}

          {etapa === "fim" && resultado && (
            <Conclusao resultado={resultado} />
          )}
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-between gap-3 border-t bg-gray-50 px-5 py-3">
          <div className="text-xs text-gray-500">
            {etapa === "revisao" && analise && (
              <>
                {aImportar} de {analise.arquivos.length} documento(s) serão importados
                {analise.resumo.pessoasNovas > 0 && ` · ${analise.resumo.pessoasNovas} pessoa(s) nova(s)`}
              </>
            )}
            {etapa === "envio" && selecionados.length > 0 && `${selecionados.length} arquivo(s) selecionado(s)`}
          </div>

          <div className="flex items-center gap-2">
            {etapa === "envio" && (
              <>
                <button onClick={fechar} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">
                  Cancelar
                </button>
                <button
                  onClick={enviarEAnalisar}
                  disabled={selecionados.length === 0}
                  className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <UploadCloud className="h-4 w-4" />
                  Enviar e analisar
                </button>
              </>
            )}

            {(etapa === "revisao" || etapa === "confirmando") && (
              <>
                <button
                  onClick={fechar}
                  disabled={etapa === "confirmando"}
                  className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmar}
                  disabled={etapa === "confirmando" || aImportar === 0}
                  className="flex items-center gap-2 rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {etapa === "confirmando" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {etapa === "confirmando" ? "Importando…" : "Confirmar importação"}
                </button>
              </>
            )}

            {etapa === "analisando" && (
              <span className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Analisando…
              </span>
            )}

            {etapa === "fim" && (
              <>
                <button onClick={limpar} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">
                  Importar mais
                </button>
                <button onClick={fechar} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  Voltar à árvore
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

function Passo({ n, rotulo, ativo, feito }: { n: number; rotulo: string; ativo: boolean; feito: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
          feito ? "bg-green-600 text-white" : ativo ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"
        }`}
      >
        {feito ? <Check className="h-3 w-3" /> : n}
      </span>
      <span className={ativo || feito ? "font-medium text-gray-800" : "text-gray-500"}>{rotulo}</span>
    </div>
  )
}

function Resumo({ analise }: { analise: ResultadoAnalise }) {
  const r = analise.resumo
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi rotulo="Documentos lidos" valor={`${r.legiveis}/${r.total}`} />
        <Kpi rotulo="Pessoas vinculadas" valor={String(r.pessoasVinculadas)} />
        <Kpi rotulo="Pessoas novas" valor={String(r.pessoasNovas)} destaque={r.pessoasNovas > 0} />
        <Kpi rotulo="Divergências" valor={String(r.divergencias)} alerta={r.divergencias > 0} />
      </div>

      {analise.avisos.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="font-medium mb-1">Sobre a leitura automática</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {analise.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Kpi({ rotulo, valor, alerta, destaque }: { rotulo: string; valor: string; alerta?: boolean; destaque?: boolean }) {
  return (
    <div className="rounded border bg-white px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{rotulo}</p>
      <p className={`text-lg font-semibold ${alerta ? "text-amber-600" : destaque ? "text-blue-600" : "text-gray-900"}`}>
        {valor}
      </p>
    </div>
  )
}

/** Árvore PROPOSTA — o que sairia desta importação, antes de existir. */
function ArvoreProposta({ previa }: { previa: NoPrevia[] }) {
  const porChave = new Map(previa.map((n) => [n.chave, n]))
  // Raízes = quem não é pai/mãe de ninguém dentro da prévia; desenha de baixo
  // (descendente) para cima (ascendentes), que é como a certidão se lê.
  const filhos = new Set(previa.filter((n) => n.paiChave || n.maeChave).map((n) => n.chave))
  const raizes = previa.filter((n) => filhos.has(n.chave))
  const soltos = previa.filter((n) => !filhos.has(n.chave) && !previa.some((o) => o.paiChave === n.chave || o.maeChave === n.chave))

  const linha = (no: NoPrevia, nivel: number): React.ReactNode => {
    const pai = no.paiChave ? porChave.get(no.paiChave) : null
    const mae = no.maeChave ? porChave.get(no.maeChave) : null
    return (
      <div key={`${no.chave}-${nivel}`} style={{ marginLeft: nivel * 16 }} className="space-y-1">
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2 w-2 rounded-full ${no.nova ? "bg-green-500" : "bg-blue-500"}`} />
          <span className="font-medium text-gray-800">{no.nome}</span>
          <span className="text-[11px] text-gray-500">{ROTULO_PAPEL[no.papel] ?? no.papel}</span>
          {no.nova ? (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">nova</span>
          ) : (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">já existe</span>
          )}
        </div>
        {pai && linha(pai, nivel + 1)}
        {mae && linha(mae, nivel + 1)}
      </div>
    )
  }

  return (
    <div className="rounded border bg-white p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Árvore proposta</p>
      <div className="space-y-2">
        {raizes.map((n) => linha(n, 0))}
        {soltos.map((n) => linha(n, 0))}
      </div>
    </div>
  )
}

function CartaoDocumento({
  a,
  pessoas,
  decisao,
  expandido,
  onExpandir,
  onDecidir,
}: {
  a: ArquivoAnalisado
  pessoas: PessoaArvore[]
  decisao: Decisao | undefined
  expandido: boolean
  onExpandir: () => void
  onDecidir: (d: Partial<Decisao>) => void
}) {
  const descartado = decisao?.descartar ?? false
  const valorSelect = decisao?.pessoaId != null ? String(decisao.pessoaId) : "nova"

  return (
    <div className={`rounded border ${descartado ? "border-gray-200 bg-gray-50 opacity-60" : "border-gray-200 bg-white"}`}>
      <div className="flex items-start gap-3 px-3 py-3">
        <FileText className={`h-4 w-4 mt-0.5 shrink-0 ${a.legivel ? "text-blue-500" : "text-gray-400"}`} />

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-gray-900">{a.nome}</span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
              {ROTULO_TIPO[a.tipo] ?? a.tipo}
            </span>
            {a.divergencias.length > 0 && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                {a.divergencias.length} divergência(s)
              </span>
            )}
            {a.necessidade && (
              <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                atende: {a.necessidade.item}
              </span>
            )}
          </div>

          {!a.legivel && (
            <p className="text-xs text-amber-700">
              Não foi possível ler este arquivo. {a.motivoIlegivel ?? ""}
            </p>
          )}

          {a.legivel && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-gray-500">Documento de:</label>
              <select
                value={valorSelect}
                disabled={descartado}
                onChange={(e) =>
                  onDecidir(
                    e.target.value === "nova"
                      ? { pessoaId: null, nomeNovaPessoa: a.sujeito?.nome ?? null }
                      : { pessoaId: Number(e.target.value) },
                  )
                }
                className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 disabled:opacity-50"
              >
                <option value="nova">
                  + Criar pessoa: {a.sujeito?.nome ?? "(sem nome lido)"}
                </option>
                {pessoas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {nomeCompleto(p)}
                  </option>
                ))}
              </select>
              {a.sujeito && !a.sujeito.nova && (
                <span className="text-[11px] text-gray-500">sugerido pelo motor · {a.sujeito.classe}</span>
              )}
            </div>
          )}

          {a.participantes.length > 0 && (
            <p className="text-xs text-gray-500">
              Também citados:{" "}
              {a.participantes.map((p, i) => (
                <span key={`${p.papel}-${p.nome}`}>
                  {i > 0 && " · "}
                  <span className="text-gray-700">{p.nome}</span>{" "}
                  <span className="text-gray-400">({ROTULO_PAPEL[p.papel] ?? p.papel})</span>
                </span>
              ))}
            </p>
          )}

          <button onClick={onExpandir} className="text-xs font-medium text-blue-600 hover:underline">
            {expandido ? "Ocultar leitura" : "Ver o que foi lido"}
          </button>

          {expandido && (
            <div className="space-y-2 rounded bg-gray-50 p-2">
              {a.divergencias.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                    Divergências entre as duas leituras
                  </p>
                  {a.divergencias.map((d) => (
                    <div key={d.campo} className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs">
                      <span className="font-medium text-amber-900">{d.rotulo}</span>
                      <span className="text-amber-800">
                        {" "}
                        — leitura A: <em>{d.leituraA ?? "—"}</em> · leitura B: <em>{d.leituraB ?? "—"}</em>
                      </span>
                      {d.critica && (
                        <span className="ml-1 rounded bg-amber-200 px-1 text-[10px] font-medium text-amber-900">
                          bloqueia
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-1 sm:grid-cols-2">
                {a.campos.map((c) => (
                  <div key={`${c.papel}-${c.campo}`} className="flex items-baseline gap-2 text-xs">
                    <span className="shrink-0 text-gray-500">
                      {ROTULO_PAPEL[c.papel] ?? c.papel} · {c.rotulo}:
                    </span>
                    <span className={c.divergente ? "text-amber-700" : "text-gray-800"}>{c.valor ?? "—"}</span>
                  </div>
                ))}
                {a.campos.length === 0 && <p className="text-xs text-gray-500">Nenhum campo foi extraído.</p>}
              </div>

              {a.fonteTexto && (
                <p className="text-[11px] text-gray-400">Leitura obtida por: {a.fonteTexto}</p>
              )}
            </div>
          )}
        </div>

        <button
          onClick={() => onDecidir({ descartar: !descartado })}
          className="shrink-0 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
          title={descartado ? "Voltar a importar" : "Não importar este arquivo"}
        >
          {descartado ? "Reincluir" : "Descartar"}
        </button>
      </div>
    </div>
  )
}

function Conclusao({ resultado }: { resultado: ResultadoConfirmacao }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded border border-green-200 bg-green-50 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        <div>
          <p className="text-sm font-medium text-green-900">Importação concluída</p>
          <p className="text-xs text-green-800">
            Os arquivos estão na Pasta Documental do processo, na aba Documentos.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi rotulo="Documentos" valor={String(resultado.documentosCriados.length)} />
        <Kpi rotulo="Pessoas criadas" valor={String(resultado.pessoasCriadas.length)} destaque={resultado.pessoasCriadas.length > 0} />
        <Kpi rotulo="Propostas" valor={String(resultado.propostas)} />
        <Kpi rotulo="Conflitos" valor={String(resultado.conflitos)} alerta={resultado.conflitos > 0} />
      </div>

      {(resultado.propostas > 0 || resultado.conflitos > 0) && (
        <p className="text-xs text-gray-600">
          As alterações que exigem decisão humana ficaram aguardando em{" "}
          <a href="/registral" className="font-medium text-blue-600 hover:underline">
            Revisão Registral
          </a>
          . Nada foi alterado na árvore sem aprovação.
        </p>
      )}

      {resultado.descartados > 0 && (
        <p className="text-xs text-gray-500">{resultado.descartados} arquivo(s) descartado(s) na revisão.</p>
      )}

      {resultado.erros.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <p className="mb-1 font-medium">Arquivos que não puderam entrar:</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {resultado.erros.map((e) => (
              <li key={e.indice}>
                #{e.indice + 1} — {e.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
