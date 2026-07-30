// src/components/arvore/importar-certidoes.tsx
//
// IMPORTAR CERTIDÕES — a árvore se constrói sozinha, e o operador confere.
//
// O operador arrasta as certidões (fotos, PDFs escaneados) e recebe de volta a
// ÁRVORE PROPOSTA inteira, desenhada com o MESMO componente que desenha a árvore
// de verdade — mesmos cards, mesmas cores, mesmas linhas, mesmos cônjuges e
// gerações. Não há cadastro de pessoa nem de vínculo: há conferência.
//
// Quatro telas, na ordem em que a cabeça do operador trabalha:
//   ENVIO    → arrastar/escolher arquivos, subir para o storage do projeto
//   REVISAO  → a árvore proposta + a lista do que precisa de olho humano
//   FIM      → o que entrou, e o botão de desfazer tudo
//
// O que aparece marcado para revisão é só o duvidoso: homônimo, divergência
// entre as duas leituras, documento que contraria o cadastro, alteração de dado
// que já existia. O resto entra aprovado por padrão — senão não seria automático.

"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  UploadCloud,
  Users,
  X,
} from "lucide-react"
import { useIsClient } from "@/src/lib/cliente"
import { LAYER } from "@/src/lib/ui/layers"
import { uploadFiles } from "@/src/lib/storage"
import { ReactFlowTree } from "./react-flow-tree"
import type { PessoaArvore, UniaoArvore } from "./types"

// ---------------------------------------------------------------------------
// Contratos com o servidor (espelham src/services/registral/importacao.ts)
// ---------------------------------------------------------------------------

interface Evidencia {
  documentoIndice: number
  documentoNome: string
  leitura: string
  trecho: string | null
  pagina: number | null
  confianca: number
}

interface CampoProposto {
  campo: string
  rotulo: string
  valor: string
  confianca: number
  bloqueado: boolean
  explicacao: string
  evidencias: Evidencia[]
}

interface Alteracao {
  campo: string
  rotulo: string
  antes: string | null
  depois: string
  tipo: "PREENCHE_VAZIO" | "ALTERA_EXISTENTE"
  aplicarPorPadrao: boolean
  evidencias: Evidencia[]
}

interface NoProposto {
  chave: string
  nome: string
  sobrenome: string | null
  sexo: "M" | "F" | null
  pessoaId: number | null
  nova: boolean
  classe: string | null
  score: number | null
  motivoIdentidade: string
  papeis: string[]
  documentos: number[]
  dados: CampoProposto[]
  alteracoes: Alteracao[]
  conflitos: string[]
  confianca: number
  outrosCandidatos: Array<{ pessoaId: number; nome: string; classe: string; score: number }>
  possiveisDuplicatas: Array<{ chave: string; nome: string; classe: string; score: number }>
}

interface VinculoProposto {
  tipo: "FILIACAO_PAI" | "FILIACAO_MAE" | "UNIAO"
  deChave: string
  paraChave: string
  jaExiste: boolean
  conflito: string | null
  confianca: number
  documentos: number[]
  evidencias: Evidencia[]
}

interface ArquivoAnalisado {
  indice: number
  nome: string
  url: string
  mimeType: string | null
  tipo: string
  confiancaTipo: number
  tipoDivergente: boolean
  fonteLeitura: string | null
  legivel: boolean
  motivoIlegivel: string | null
  legibilidade: string | null
  problemasDeImagem: string[]
  sujeitoChave: string | null
  campos: Array<{ campo: string; rotulo: string; papel: string; valor: string | null; veredicto: string; divergente: boolean }>
  divergencias: Array<{ campo: string; rotulo: string; leituraA: string | null; leituraB: string | null; critica: boolean; explicacao: string }>
  averbacoes: Array<{ texto: string; data?: string | null; tipo?: string | null }>
  necessidade: { id: number; item: string } | null
  transcricao: { paginas: Array<{ pagina: number; texto: string }>; fonte: string } | null
}

interface ResultadoAnalise {
  processoId: number
  arvoreId: number | null
  arquivos: ArquivoAnalisado[]
  nos: NoProposto[]
  vinculos: VinculoProposto[]
  resumo: {
    total: number
    legiveis: number
    ilegiveis: number
    pessoasNovas: number
    pessoasVinculadas: number
    vinculosNovos: number
    divergencias: number
    alteracoesEmDadosExistentes: number
    geracoes: number
  }
  leitura: {
    provedor: string
    modelo: string | null
    disponivel: boolean
    motivo: string | null
    custo: { chamadas: number; tokensEntrada: number; tokensSaida: number; custoUsd: number; tetoUsd: number } | null
  }
  avisos: string[]
}

interface ResultadoConfirmacao {
  importacaoId: number
  documentosCriados: number[]
  pessoasCriadas: number[]
  pessoasAtualizadas: number[]
  vinculosCriados: number
  unioesCriadas: number[]
  descartados: number
  loteId: number | null
  propostas: number
  conflitos: number
  erros: Array<{ referencia: string; motivo: string }>
}

interface ArquivoEnviado {
  url: string
  nome: string
  mimeType: string | null
  tamanho: number | null
}

type Etapa = "envio" | "analisando" | "revisao" | "confirmando" | "fim" | "revertendo"

/** Situação de UM arquivo dentro da fila. O operador vê isto por documento. */
type SituacaoArquivo =
  | { fase: "AGUARDANDO" }
  | { fase: "ENVIANDO"; pct: number }
  | { fase: "LENDO" }
  | { fase: "CONCLUIDO"; tipo: string; pessoas: number }
  | { fase: "ERRO"; motivo: string }

const ROTULO_FASE: Record<string, string> = {
  AGUARDANDO: "Aguardando",
  ENVIANDO: "Enviando",
  LENDO: "Lendo",
  CONCLUIDO: "Concluído",
  ERRO: "Erro",
}

/**
 * UM documento por requisição.
 *
 * Começou em quatro e travou com certidão de verdade: quatro documentos são OITO
 * leituras visuais dentro do mesmo teto de tempo da função, e foto de celular é
 * bem mais densa que documento gerado. O bloco inteiro passava do limite e o
 * navegador ficava pendurado sem nunca receber resposta — "Lendo" para sempre.
 *
 * Com um por requisição, cada chamada faz duas leituras em paralelo e volta em
 * dezenas de segundos, o progresso é real documento a documento, e uma certidão
 * problemática derruba só a si mesma.
 */
const POR_BLOCO = 1

/**
 * Teto de espera do NAVEGADOR por documento.
 *
 * Existe porque a função pode morrer sem responder (timeout de plataforma,
 * instância reciclada). Sem isto o operador fica olhando um "Lendo" que nunca
 * termina, que é a pior falha possível: a que não se declara.
 */
const ESPERA_MAXIMA_MS = 180_000

const ROTULO_TIPO: Record<string, string> = {
  NASCIMENTO: "Nascimento",
  CASAMENTO: "Casamento",
  OBITO: "Óbito",
  BATISMO: "Batismo",
  NATURALIZACAO: "Naturalização",
  IMIGRACAO: "Imigração",
  IDENTIFICACAO: "Identificação",
  DESCONHECIDO: "Tipo não identificado",
}

const ROTULO_PAPEL: Record<string, string> = {
  REGISTRADO: "Titular",
  PAI: "Pai",
  MAE: "Mãe",
  CONJUGE: "Cônjuge",
  FILHO: "Filho",
  AVO_PATERNO: "Avô paterno",
  AVOA_PATERNA: "Avó paterna",
  AVO_MATERNO: "Avô materno",
  AVOA_MATERNA: "Avó materna",
  DECLARANTE: "Declarante",
  TESTEMUNHA: "Testemunha",
}

const ROTULO_VINCULO: Record<string, string> = {
  FILIACAO_PAI: "pai de",
  FILIACAO_MAE: "mãe de",
  UNIAO: "casado(a) com",
}

const TIPOS_ACEITOS =
  "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
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

function nomeDoNo(n: NoProposto): string {
  return [n.nome, n.sobrenome].filter(Boolean).join(" ")
}

/** Um nó precisa de olho humano? */
function precisaDeRevisao(n: NoProposto, vinculos: VinculoProposto[]): boolean {
  if (n.conflitos.length > 0) return true
  if (n.outrosCandidatos.some((c) => c.classe === "ALTAMENTE_PROVAVEL" || c.classe === "CORRESPONDENCIA_CONFIRMADA"))
    return true
  if (n.alteracoes.some((a) => a.tipo === "ALTERA_EXISTENTE")) return true
  if (n.possiveisDuplicatas.length > 0) return true
  return vinculos.some((v) => v.conflito && (v.deChave === n.chave || v.paraChave === n.chave))
}

// ---------------------------------------------------------------------------

interface Props {
  processoId: number
  pessoas: PessoaArvore[]
  aberto: boolean
  onFechar: () => void
  /** Chamado depois de confirmar ou reverter, para a árvore recarregar. */
  onImportado: () => void
}

export function ImportarCertidoes({ processoId, pessoas, aberto, onFechar, onImportado }: Props) {
  const montado = useIsClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const [etapa, setEtapa] = useState<Etapa>("envio")
  const [arrastando, setArrastando] = useState(false)
  const [selecionados, setSelecionados] = useState<File[]>([])
  const [situacoes, setSituacoes] = useState<Record<string, SituacaoArquivo>>({})
  const [enviados, setEnviados] = useState<ArquivoEnviado[]>([])
  const [analise, setAnalise] = useState<ResultadoAnalise | null>(null)
  const [resultado, setResultado] = useState<ResultadoConfirmacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aba, setAba] = useState<"arvore" | "revisao" | "documentos">("arvore")
  const [noAberto, setNoAberto] = useState<string | null>(null)

  // Decisões do operador, por chave. O padrão é "aceitar o que o sistema propôs";
  // o operador só mexe no que discorda.
  const [acoes, setAcoes] = useState<Record<string, "CRIAR" | "VINCULAR" | "IGNORAR">>({})
  const [vinculoAlvo, setVinculoAlvo] = useState<Record<string, number | null>>({})
  const [camposAprovados, setCamposAprovados] = useState<Record<string, Set<string>>>({})
  const [vinculosAprovados, setVinculosAprovados] = useState<Record<string, boolean>>({})
  const [descartados, setDescartados] = useState<Record<number, boolean>>({})
  // "este nó é a mesma pessoa que aquele" — sempre decisão humana.
  const [mesmoQue, setMesmoQue] = useState<Record<string, string | null>>({})

  const limpar = useCallback(() => {
    setEtapa("envio")
    setSelecionados([])
    setSituacoes({})
    setEnviados([])
    setAnalise(null)
    setResultado(null)
    setErro(null)
    setAba("arvore")
    setNoAberto(null)
    setAcoes({})
    setVinculoAlvo({})
    setCamposAprovados({})
    setVinculosAprovados({})
    setDescartados({})
    setMesmoQue({})
  }, [])

  const fechar = useCallback(() => {
    limpar()
    onFechar()
  }, [limpar, onFechar])

  // ---- seleção -------------------------------------------------------------

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

  // ---- envio + análise -----------------------------------------------------

  /**
   * Envia e lê, EM BLOCOS, com a situação de cada arquivo à vista.
   *
   * Três coisas que a versão anterior errava e que mudam aqui:
   *
   *   · vinte e quatro certidões iam numa requisição só — bastava uma estourar o
   *     timeout para o lote inteiro se perder, sem dizer onde parou;
   *   · os arquivos escolhidos eram descartados no erro, e o operador tinha de
   *     selecionar tudo de novo;
   *   · quando NADA era lido, a tela ainda avançava e mostrava uma árvore vazia,
   *     como se vazio fosse resultado. Não é: é falha, e agora ela para aqui.
   */
  const enviarEAnalisar = useCallback(
    async (apenasIndices?: number[]) => {
      const alvo = apenasIndices ?? selecionados.map((_, i) => i)
      if (alvo.length === 0) return
      setErro(null)
      setEtapa("analisando")

      const situacaoDe = (nome: string, s: SituacaoArquivo) =>
        setSituacoes((atual) => ({ ...atual, [nome]: s }))
      for (const i of alvo) situacaoDe(selecionados[i].name, { fase: "AGUARDANDO" })

      try {
        // ---- 1. upload, um a um, com progresso real
        const enviadosAgora: ArquivoEnviado[] = []
        for (const i of alvo) {
          const file = selecionados[i]
          situacaoDe(file.name, { fase: "ENVIANDO", pct: 0 })
          try {
            // Soluço de rede no PUT é falha transitória: três tentativas com
            // espera crescente, como já se faz na chamada de leitura.
            let subido: Awaited<ReturnType<typeof uploadFiles>>[number] | undefined
            let ultimoErro: unknown = null
            for (let tentativa = 1; tentativa <= 3 && !subido; tentativa++) {
              try {
                ;[subido] = await uploadFiles([file], {
                  prefix: "documentos",
                  onProgress: (_f, pct) => situacaoDe(file.name, { fase: "ENVIANDO", pct }),
                })
              } catch (err) {
                ultimoErro = err
                if (tentativa < 3) await new Promise((r) => setTimeout(r, 500 * 2 ** (tentativa - 1)))
              }
            }
            if (!subido) throw ultimoErro instanceof Error ? ultimoErro : new Error(String(ultimoErro))
            enviadosAgora.push({
              url: subido.url,
              nome: subido.name,
              mimeType: subido.type || null,
              tamanho: subido.size ?? null,
            })
            situacaoDe(file.name, { fase: "AGUARDANDO" })
          } catch (e) {
            situacaoDe(file.name, { fase: "ERRO", motivo: e instanceof Error ? e.message : String(e) })
          }
        }
        setEnviados(enviadosAgora)

        if (enviadosAgora.length === 0) {
          setErro("Nenhum arquivo chegou ao armazenamento. Os arquivos continuam selecionados — tente de novo.")
          setEtapa("envio")
          return
        }

        // ---- 2. leitura em blocos; cada bloco é uma requisição curta
        const arquivosLidos: ArquivoAnalisado[] = []
        const nos: NoProposto[] = []
        const vinculos: VinculoProposto[] = []
        let leitura: ResultadoAnalise["leitura"] | null = null
        const avisos = new Set<string>()

        for (let inicio = 0; inicio < enviadosAgora.length; inicio += POR_BLOCO) {
          const bloco = enviadosAgora.slice(inicio, inicio + POR_BLOCO)
          for (const a of bloco) situacaoDe(a.nome, { fase: "LENDO" })

          let parcial: ResultadoAnalise
          const relogio = new AbortController()
          const alarme = setTimeout(() => relogio.abort(), ESPERA_MAXIMA_MS)
          try {
            const res = await authFetch(`/api/processos/${processoId}/registral/importar/analisar`, {
              method: "POST",
              body: JSON.stringify({ arquivos: bloco }),
              signal: relogio.signal,
            })
            const dados = await res.json()
            if (!res.ok) throw new Error(dados?.error || `Falha ao ler (HTTP ${res.status}).`)
            parcial = dados as ResultadoAnalise
          } catch (e) {
            const abortado = e instanceof Error && e.name === "AbortError"
            const motivo = abortado
              ? `A leitura passou de ${Math.round(ESPERA_MAXIMA_MS / 1000)}s e foi interrompida. Tente este documento de novo.`
              : e instanceof Error
                ? e.message
                : String(e)
            for (const a of bloco) situacaoDe(a.nome, { fase: "ERRO", motivo })
            continue
          } finally {
            clearTimeout(alarme)
          }

          // Os índices vêm por bloco; reindexa para o lote inteiro.
          const deslocamento = arquivosLidos.length
          for (const a of parcial.arquivos) {
            const reindexado: ArquivoAnalisado = { ...a, indice: deslocamento + a.indice }
            arquivosLidos.push(reindexado)
            situacaoDe(
              a.nome,
              a.legivel
                ? { fase: "CONCLUIDO", tipo: a.tipo, pessoas: parcial.nos.filter((n) => n.documentos.includes(a.indice)).length }
                : { fase: "ERRO", motivo: a.motivoIlegivel ?? "Não foi possível ler este documento." },
            )
          }
          for (const n of parcial.nos) {
            const existente = nos.find((x) => x.chave === n.chave)
            const documentos = n.documentos.map((d) => d + deslocamento)
            if (existente) {
              existente.documentos = [...new Set([...existente.documentos, ...documentos])]
              for (const d of n.dados) if (!existente.dados.some((x) => x.campo === d.campo)) existente.dados.push(d)
              existente.conflitos = [...new Set([...existente.conflitos, ...n.conflitos])]
            } else {
              nos.push({ ...n, documentos })
            }
          }
          for (const v of parcial.vinculos) {
            const chave = `${v.tipo}|${v.deChave}|${v.paraChave}`
            if (!vinculos.some((x) => `${x.tipo}|${x.deChave}|${x.paraChave}` === chave)) {
              vinculos.push({ ...v, documentos: v.documentos.map((d) => d + deslocamento) })
            }
          }
          leitura = parcial.leitura
          for (const a of parcial.avisos) avisos.add(a)
        }

        const legiveis = arquivosLidos.filter((a) => a.legivel).length

        // ---- 3. vazio NÃO é resultado
        if (legiveis === 0) {
          setErro(
            "Nenhum documento foi lido, então não há árvore para revisar. " +
              "O motivo de cada arquivo está na lista abaixo. Os arquivos continuam selecionados — corrija e tente de novo.",
          )
          setEtapa("envio")
          return
        }

        setAnalise({
          processoId,
          arvoreId: null,
          arquivos: arquivosLidos,
          nos,
          vinculos,
          resumo: {
            total: arquivosLidos.length,
            legiveis,
            ilegiveis: arquivosLidos.length - legiveis,
            pessoasNovas: nos.filter((n) => n.nova).length,
            pessoasVinculadas: nos.filter((n) => !n.nova).length,
            vinculosNovos: vinculos.filter((v) => !v.jaExiste).length,
            divergencias: arquivosLidos.reduce((s2, a) => s2 + a.divergencias.length, 0),
            alteracoesEmDadosExistentes: nos.reduce(
              (s2, n) => s2 + n.alteracoes.filter((x) => x.tipo === "ALTERA_EXISTENTE").length,
              0,
            ),
            geracoes: 0,
          },
          leitura: leitura ?? { provedor: "?", modelo: null, disponivel: false, motivo: null, custo: null },
          avisos: [...avisos],
        })

        const acoesIniciais: Record<string, "CRIAR" | "VINCULAR" | "IGNORAR"> = {}
        const camposIniciais: Record<string, Set<string>> = {}
        for (const n of nos) {
          acoesIniciais[n.chave] = n.nova ? "CRIAR" : "VINCULAR"
          const marcados = new Set<string>()
          for (const d of n.dados) {
            if (d.bloqueado) continue
            if (n.nova) {
              marcados.add(d.campo)
              continue
            }
            const alt = n.alteracoes.find((x) => x.campo === d.campo)
            if (alt?.aplicarPorPadrao) marcados.add(d.campo)
          }
          camposIniciais[n.chave] = marcados
        }
        const vinculosIniciais: Record<string, boolean> = {}
        for (const v of vinculos) vinculosIniciais[chaveVinculo(v)] = !v.jaExiste && !v.conflito
        setAcoes(acoesIniciais)
        setCamposAprovados(camposIniciais)
        setVinculosAprovados(vinculosIniciais)
        setDescartados(Object.fromEntries(arquivosLidos.filter((x) => !x.legivel).map((x) => [x.indice, true])))
        setEtapa("revisao")
        setAba("arvore")
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e))
        setEtapa("envio")
      }
    },
    [processoId, selecionados],
  )

  // ---- confirmação ---------------------------------------------------------

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
          nos: analise.nos,
          vinculos: analise.vinculos,
          decisoesNos: analise.nos.map((n) => ({
            chave: n.chave,
            acao: acoes[n.chave] ?? (n.nova ? "CRIAR" : "VINCULAR"),
            pessoaId: vinculoAlvo[n.chave] ?? n.pessoaId,
            nome: n.nome,
            sobrenome: n.sobrenome,
            camposAAplicar: [...(camposAprovados[n.chave] ?? [])],
            mesmoQue: mesmoQue[n.chave] ?? null,
          })),
          decisoesVinculos: analise.vinculos.map((v) => ({
            tipo: v.tipo,
            deChave: v.deChave,
            paraChave: v.paraChave,
            aplicar: vinculosAprovados[chaveVinculo(v)] === true,
          })),
          decisoesDocumentos: analise.arquivos.map((a) => ({
            indice: a.indice,
            pessoaChave: a.sujeitoChave,
            descartar: descartados[a.indice] === true,
          })),
        }),
      })
      const dados = await res.json()
      if (!res.ok) throw new Error(dados?.error || "Falha ao aplicar a importação.")
      setResultado(dados as ResultadoConfirmacao)
      setEtapa("fim")
      // Sem recarregar a página: a árvore relê os dados e o desenho se atualiza.
      onImportado()
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
      setEtapa("revisao")
    }
  }, [analise, acoes, camposAprovados, descartados, enviados, mesmoQue, onImportado, processoId, vinculoAlvo, vinculosAprovados])

  // ---- reversão ------------------------------------------------------------

  const reverter = useCallback(async () => {
    if (!resultado) return
    setErro(null)
    setEtapa("revertendo")
    try {
      const res = await authFetch(`/api/processos/${processoId}/registral/importar/reverter`, {
        method: "POST",
        body: JSON.stringify({ importacaoId: resultado.importacaoId }),
      })
      const dados = await res.json()
      if (!res.ok) throw new Error(dados?.error || "Falha ao reverter a importação.")
      onImportado()
      limpar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
      setEtapa("fim")
    }
  }, [limpar, onImportado, processoId, resultado])

  // ---- árvore proposta, desenhada com o componente real ---------------------

  const previa = useMemo(() => montarPrevia(analise, acoes, vinculosAprovados, pessoas), [analise, acoes, vinculosAprovados, pessoas])

  const precisamRevisao = useMemo(
    () => (analise ? analise.nos.filter((n) => precisaDeRevisao(n, analise.vinculos)) : []),
    [analise],
  )

  if (!montado || !aberto) return null

  const ocupado = etapa === "analisando" || etapa === "confirmando" || etapa === "revertendo"

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-3" style={{ zIndex: LAYER.aboveProcess }}>
      <div className="absolute inset-0 bg-black/50" onClick={ocupado ? undefined : fechar} />

      <div className="relative w-full max-w-6xl h-[92vh] bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-3 border-b bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-blue-50">
              <UploadCloud className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Importar certidões</h2>
              <p className="text-xs text-gray-500">
                As certidões constroem a árvore. Nada é gravado antes da sua confirmação.
              </p>
            </div>
          </div>
          <button
            onClick={fechar}
            disabled={ocupado}
            className="p-2 hover:bg-gray-100 rounded transition-colors disabled:opacity-40"
            title="Fechar"
          >
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        {erro && (
          <div className="mx-5 mt-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 shrink-0">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        {/* Corpo */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {(etapa === "envio" || etapa === "analisando") && (
            <TelaEnvio
              etapa={etapa}
              arrastando={arrastando}
              selecionados={selecionados}
              situacoes={situacoes}
              inputRef={inputRef}
              onArrastar={setArrastando}
              onDrop={onDrop}
              onAdicionar={adicionar}
              onRemover={(f) => setSelecionados((a) => a.filter((x) => x !== f))}
            />
          )}

          {(etapa === "revisao" || etapa === "confirmando") && analise && (
            <div className="h-full flex flex-col">
              <BarraResumo analise={analise} precisamRevisao={precisamRevisao.length} />

              <div className="flex items-center gap-1 border-b bg-white px-4 shrink-0">
                <Aba ativa={aba === "arvore"} onClick={() => setAba("arvore")} icone={<Users className="h-3.5 w-3.5" />}>
                  Árvore proposta
                </Aba>
                <Aba
                  ativa={aba === "revisao"}
                  onClick={() => setAba("revisao")}
                  icone={<Eye className="h-3.5 w-3.5" />}
                  contador={precisamRevisao.length}
                >
                  Precisa de revisão
                </Aba>
                <Aba ativa={aba === "documentos"} onClick={() => setAba("documentos")} icone={<FileText className="h-3.5 w-3.5" />}>
                  Documentos ({analise.arquivos.length})
                </Aba>
              </div>

              <div className="flex-1 min-h-0 overflow-hidden">
                {aba === "arvore" && (
                  <div className="h-full bg-gradient-to-b from-gray-100 to-gray-200">
                    {previa.pessoas.length > 0 ? (
                      <ReactFlowTree
                        pessoas={previa.pessoas}
                        unioes={previa.unioes}
                        pessoaPrincipal={previa.principal}
                        mode="paisagem"
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-sm text-gray-500">
                        Nenhuma pessoa foi reconhecida nas certidões enviadas.
                      </div>
                    )}
                  </div>
                )}

                {aba === "revisao" && (
                  <div className="h-full overflow-y-auto p-4 space-y-3">
                    {precisamRevisao.length === 0 ? (
                      <div className="flex items-center gap-3 rounded border border-green-200 bg-green-50 px-4 py-3">
                        <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                        <div className="text-sm text-green-900">
                          Nada ficou duvidoso. As certidões concordam entre si e com a árvore atual — pode confirmar.
                        </div>
                      </div>
                    ) : (
                      precisamRevisao.map((n) => (
                        <CartaoNo
                          key={n.chave}
                          no={n}
                          vinculos={analise.vinculos.filter((v) => v.deChave === n.chave || v.paraChave === n.chave)}
                          nos={analise.nos}
                          arquivos={analise.arquivos}
                          pessoas={pessoas}
                          acao={acoes[n.chave] ?? (n.nova ? "CRIAR" : "VINCULAR")}
                          alvo={vinculoAlvo[n.chave] ?? n.pessoaId}
                          camposMarcados={camposAprovados[n.chave] ?? new Set()}
                          vinculosMarcados={vinculosAprovados}
                          mesmoQue={mesmoQue[n.chave] ?? null}
                          onMesmoQue={(chave) => setMesmoQue((s) => ({ ...s, [n.chave]: chave }))}
                          aberto={noAberto === n.chave}
                          onAbrir={() => setNoAberto(noAberto === n.chave ? null : n.chave)}
                          onAcao={(a) => setAcoes((s) => ({ ...s, [n.chave]: a }))}
                          onAlvo={(id) => setVinculoAlvo((s) => ({ ...s, [n.chave]: id }))}
                          onCampo={(campo, marcado) =>
                            setCamposAprovados((s) => {
                              const atual = new Set(s[n.chave] ?? [])
                              if (marcado) atual.add(campo)
                              else atual.delete(campo)
                              return { ...s, [n.chave]: atual }
                            })
                          }
                          onVinculo={(chave, marcado) => setVinculosAprovados((s) => ({ ...s, [chave]: marcado }))}
                        />
                      ))
                    )}

                    {analise.nos.filter((n) => !precisaDeRevisao(n, analise.vinculos)).length > 0 && (
                      <div className="rounded border bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        Outras {analise.nos.filter((n) => !precisaDeRevisao(n, analise.vinculos)).length} pessoa(s)
                        entram sem ressalva — as certidões concordam e nada contraria o cadastro.
                      </div>
                    )}
                  </div>
                )}

                {aba === "documentos" && (
                  <div className="h-full overflow-y-auto p-4 space-y-2">
                    {analise.arquivos.map((a) => (
                      <CartaoDocumento
                        key={a.indice}
                        a={a}
                        nos={analise.nos}
                        descartado={descartados[a.indice] === true}
                        onDescartar={(v) => setDescartados((s) => ({ ...s, [a.indice]: v }))}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {(etapa === "fim" || etapa === "revertendo") && resultado && (
            <div className="h-full overflow-y-auto p-5">
              <Conclusao resultado={resultado} revertendo={etapa === "revertendo"} onReverter={reverter} />
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-between gap-3 border-t bg-gray-50 px-5 py-3 shrink-0">
          <div className="text-xs text-gray-500">
            {etapa === "envio" && selecionados.length > 0 && `${selecionados.length} arquivo(s) selecionado(s)`}
            {(etapa === "revisao" || etapa === "confirmando") && analise && (
              <>
                {analise.nos.filter((n) => (acoes[n.chave] ?? (n.nova ? "CRIAR" : "VINCULAR")) !== "IGNORAR").length} pessoa(s)
                {" · "}
                {Object.values(vinculosAprovados).filter(Boolean).length} vínculo(s)
                {" · "}
                {analise.arquivos.filter((a) => !descartados[a.indice]).length} documento(s)
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {etapa === "envio" && (
              <>
                <button onClick={fechar} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">
                  Cancelar
                </button>
                {/* Repetir só o que falhou — reenviar o que já deu certo custa
                    dinheiro à toa e demora. */}
                {selecionados.some((f) => situacoes[f.name]?.fase === "ERRO") && (
                  <button
                    onClick={() =>
                      void enviarEAnalisar(
                        selecionados.map((f, i) => (situacoes[f.name]?.fase === "ERRO" ? i : -1)).filter((i) => i >= 0),
                      )
                    }
                    className="flex items-center gap-2 rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Tentar novamente os que falharam
                  </button>
                )}
                <button
                  onClick={() => void enviarEAnalisar()}
                  disabled={selecionados.length === 0}
                  className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Sparkles className="h-4 w-4" />
                  Ler certidões e montar a árvore
                </button>
              </>
            )}

            {etapa === "analisando" && (
              <span className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Lendo…
              </span>
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
                  disabled={etapa === "confirmando" || !analise || analise.nos.length === 0}
                  className="flex items-center gap-2 rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {etapa === "confirmando" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {etapa === "confirmando" ? "Aplicando…" : "Aplicar árvore"}
                </button>
              </>
            )}

            {(etapa === "fim" || etapa === "revertendo") && (
              <>
                <button
                  onClick={limpar}
                  disabled={etapa === "revertendo"}
                  className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded disabled:opacity-40"
                >
                  Importar mais
                </button>
                <button
                  onClick={fechar}
                  disabled={etapa === "revertendo"}
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                >
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

function chaveVinculo(v: { tipo: string; deChave: string; paraChave: string }): string {
  return `${v.tipo}|${v.deChave}|${v.paraChave}`
}

// ---------------------------------------------------------------------------
// A árvore proposta, no formato que o componente real consome
// ---------------------------------------------------------------------------

/**
 * Traduz nós e vínculos para `PessoaArvore`/`UniaoArvore`.
 *
 * Pessoa nova ganha id NEGATIVO: é um id que não existe no banco e por isso não
 * pode ser confundido com ninguém, mas serve de chave para o desenho. Pessoa
 * existente entra com os dados que já tem no cadastro, para o card mostrar a
 * árvore como ela FICARÁ, não uma versão empobrecida dela.
 */
function montarPrevia(
  analise: ResultadoAnalise | null,
  acoes: Record<string, "CRIAR" | "VINCULAR" | "IGNORAR">,
  vinculosAprovados: Record<string, boolean>,
  existentes: PessoaArvore[],
): { pessoas: PessoaArvore[]; unioes: UniaoArvore[]; principal: PessoaArvore | null } {
  if (!analise) return { pessoas: [], unioes: [], principal: null }

  const porId = new Map(existentes.map((p) => [p.id, p]))
  const idPorChave = new Map<string, number>()
  const pessoas: PessoaArvore[] = []

  let proximoTemporario = -1
  for (const n of analise.nos) {
    const acao = acoes[n.chave] ?? (n.nova ? "CRIAR" : "VINCULAR")
    if (acao === "IGNORAR") continue
    const id = n.pessoaId ?? proximoTemporario--
    idPorChave.set(n.chave, id)

    const base = n.pessoaId != null ? porId.get(n.pessoaId) : undefined
    const valorDe = (campo: string): string | undefined => n.dados.find((d) => d.campo === campo && !d.bloqueado)?.valor

    pessoas.push({
      ...(base ?? {}),
      id,
      nome: base?.nome ?? n.nome,
      sobrenome: base?.sobrenome ?? n.sobrenome,
      sexo: base?.sexo ?? n.sexo,
      data_nasc: base?.data_nasc ?? valorDe("DATA_NASCIMENTO") ?? null,
      data_obito: base?.data_obito ?? valorDe("DATA_OBITO") ?? null,
      local_nasc: base?.local_nasc ?? valorDe("LOCAL_NASCIMENTO") ?? null,
      pais_nasc: base?.pais_nasc ?? valorDe("PAIS_NASCIMENTO") ?? null,
      profissao: base?.profissao ?? valorDe("PROFISSAO") ?? null,
      paiId: base?.paiId ?? null,
      maeId: base?.maeId ?? null,
      // Posição livre: o layout da árvore recalcula.
      x: null,
      y: null,
    })
  }

  const unioes: UniaoArvore[] = []
  let idUniao = -1
  for (const v of analise.vinculos) {
    if (!vinculosAprovados[chaveVinculo(v)] && !v.jaExiste) continue
    const de = idPorChave.get(v.deChave)
    const para = idPorChave.get(v.paraChave)
    if (de == null || para == null) continue

    if (v.tipo === "UNIAO") {
      unioes.push({ id: idUniao--, pessoa1Id: de, pessoa2Id: para, tipo: "casamento" })
      continue
    }
    const alvo = pessoas.find((p) => p.id === de)
    if (!alvo) continue
    if (v.tipo === "FILIACAO_PAI") alvo.paiId = para
    else alvo.maeId = para
  }

  // Principal: o requerente já cadastrado, senão quem tem mais ascendentes.
  const requerente = pessoas.find((p) => p.requerente === "sim" || p.requerente === "maior")
  const comAscendentes = [...pessoas].sort(
    (a, b) => Number(!!b.paiId) + Number(!!b.maeId) - (Number(!!a.paiId) + Number(!!a.maeId)),
  )
  return { pessoas, unioes, principal: requerente ?? comAscendentes[0] ?? null }
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

function TelaEnvio({
  etapa,
  arrastando,
  selecionados,
  situacoes,
  inputRef,
  onArrastar,
  onDrop,
  onAdicionar,
  onRemover,
}: {
  etapa: Etapa
  arrastando: boolean
  selecionados: File[]
  situacoes: Record<string, SituacaoArquivo>
  inputRef: React.RefObject<HTMLInputElement | null>
  onArrastar: (v: boolean) => void
  onDrop: (e: React.DragEvent) => void
  onAdicionar: (l: FileList | File[]) => void
  onRemover: (f: File) => void
}) {
  return (
    <div className="h-full overflow-y-auto p-5">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          onArrastar(true)
        }}
        onDragLeave={() => onArrastar(false)}
        onDrop={onDrop}
        onClick={() => etapa === "envio" && inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${
          etapa === "analisando"
            ? "border-gray-200 bg-gray-50 cursor-default"
            : arrastando
              ? "border-blue-400 bg-blue-50 cursor-pointer"
              : "border-gray-300 hover:border-blue-300 hover:bg-gray-50 cursor-pointer"
        }`}
      >
        <Upload className={`h-8 w-8 ${arrastando ? "text-blue-500" : "text-gray-400"}`} />
        <p className="text-sm font-medium text-gray-700">Arraste as certidões aqui ou clique para escolher</p>
        <p className="text-xs text-gray-500">
          Fotografias ou PDFs escaneados · vários de uma vez · até {MAX_ARQUIVOS} por rodada
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={TIPOS_ACEITOS}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onAdicionar(e.target.files)
            e.target.value = ""
          }}
        />
      </div>

      {selecionados.length > 0 && (
        <ul className="mt-4 space-y-1">
          {selecionados.map((f) => (
            <li key={`${f.name}-${f.size}`} className="rounded border px-3 py-2 text-sm">
              <div className="flex items-center gap-3">
              <FileText className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="flex-1 truncate text-gray-800">{f.name}</span>
              <span className="text-xs text-gray-500 shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
              <SituacaoDoArquivo situacao={situacoes[f.name]} />
              {etapa !== "analisando" && (
                <button onClick={() => onRemover(f)} className="p-1 hover:bg-gray-100 rounded shrink-0" title="Remover">
                  <Trash2 className="h-3.5 w-3.5 text-gray-400" />
                </button>
              )}
              </div>
              {situacoes[f.name]?.fase === "ERRO" && (
                <p className="mt-1 pl-7 text-xs text-red-700">
                  {(situacoes[f.name] as { motivo: string }).motivo}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {etapa === "analisando" && (
        <div className="mt-8 flex flex-col items-center gap-2 text-sm text-gray-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          <p>Lendo cada certidão duas vezes, conferindo as leituras e montando a árvore…</p>
          <p className="text-xs text-gray-400">Certidões escaneadas levam alguns segundos cada.</p>
        </div>
      )}
    </div>
  )
}

/** A situação de UM arquivo, com o vocabulário que o operador entende. */
function SituacaoDoArquivo({ situacao }: { situacao: SituacaoArquivo | undefined }) {
  const s = situacao ?? { fase: "AGUARDANDO" as const }
  const cor =
    s.fase === "ERRO"
      ? "text-red-700"
      : s.fase === "CONCLUIDO"
        ? "text-green-700"
        : s.fase === "AGUARDANDO"
          ? "text-gray-400"
          : "text-blue-600"
  const texto =
    s.fase === "ENVIANDO"
      ? `Enviando ${s.pct}%`
      : s.fase === "CONCLUIDO"
        ? `${ROTULO_TIPO[s.tipo] ?? s.tipo}`
        : ROTULO_FASE[s.fase]
  return (
    <span className={`flex w-28 shrink-0 items-center justify-end gap-1 text-xs ${cor}`}>
      {s.fase === "LENDO" && <Loader2 className="h-3 w-3 animate-spin" />}
      {s.fase === "CONCLUIDO" && <Check className="h-3 w-3" />}
      {s.fase === "ERRO" && <AlertTriangle className="h-3 w-3" />}
      {texto}
    </span>
  )
}

function BarraResumo({ analise, precisamRevisao }: { analise: ResultadoAnalise; precisamRevisao: number }) {
  const r = analise.resumo
  return (
    <div className="shrink-0 border-b bg-white px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <Metrica rotulo="Documentos lidos" valor={`${r.legiveis}/${r.total}`} />
        <Metrica rotulo="Pessoas" valor={`${r.pessoasNovas} nova(s) · ${r.pessoasVinculadas} já na árvore`} />
        <Metrica rotulo="Vínculos" valor={String(r.vinculosNovos)} />
        <Metrica rotulo="Gerações" valor={String(r.geracoes)} />
        <Metrica rotulo="Precisa de revisão" valor={String(precisamRevisao)} alerta={precisamRevisao > 0} />
        {analise.leitura.disponivel ? (
          <span className="ml-auto text-[11px] text-gray-400">
            leitura visual · {analise.leitura.modelo}
            {analise.leitura.custo ? ` · US$ ${analise.leitura.custo.custoUsd.toFixed(3)}` : ""}
          </span>
        ) : (
          <span className="ml-auto text-[11px] text-amber-600">leitura visual desligada</span>
        )}
      </div>

      {analise.avisos.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {analise.avisos.map((a) => (
            <li key={a} className="text-[11px] text-amber-700">
              · {a}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Metrica({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-gray-500">{rotulo}:</span>
      <span className={`font-semibold ${alerta ? "text-amber-600" : "text-gray-900"}`}>{valor}</span>
    </span>
  )
}

function Aba({
  ativa,
  onClick,
  icone,
  contador,
  children,
}: {
  ativa: boolean
  onClick: () => void
  icone: React.ReactNode
  contador?: number
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
        ativa ? "border-blue-600 font-medium text-blue-700" : "border-transparent text-gray-600 hover:text-gray-900"
      }`}
    >
      {icone}
      {children}
      {contador != null && contador > 0 && (
        <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">{contador}</span>
      )}
    </button>
  )
}

function CartaoNo({
  no,
  vinculos,
  nos,
  arquivos,
  pessoas,
  acao,
  alvo,
  camposMarcados,
  vinculosMarcados,
  mesmoQue,
  onMesmoQue,
  aberto,
  onAbrir,
  onAcao,
  onAlvo,
  onCampo,
  onVinculo,
}: {
  no: NoProposto
  vinculos: VinculoProposto[]
  nos: NoProposto[]
  arquivos: ArquivoAnalisado[]
  pessoas: PessoaArvore[]
  acao: "CRIAR" | "VINCULAR" | "IGNORAR"
  alvo: number | null
  camposMarcados: Set<string>
  vinculosMarcados: Record<string, boolean>
  mesmoQue: string | null
  onMesmoQue: (chave: string | null) => void
  aberto: boolean
  onAbrir: () => void
  onAcao: (a: "CRIAR" | "VINCULAR" | "IGNORAR") => void
  onAlvo: (id: number | null) => void
  onCampo: (campo: string, marcado: boolean) => void
  onVinculo: (chave: string, marcado: boolean) => void
}) {
  const nomeDe = (chave: string) => {
    const n = nos.find((x) => x.chave === chave)
    return n ? nomeDoNo(n) : chave
  }

  return (
    <div className="rounded border border-amber-200 bg-white">
      <div className="flex items-start gap-3 px-3 py-3">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${no.nova ? "bg-green-500" : "bg-blue-500"}`} />

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">{nomeDoNo(no)}</span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
              {no.papeis.map((p) => ROTULO_PAPEL[p] ?? p).join(" · ")}
            </span>
            {no.nova ? (
              <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">nova</span>
            ) : (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">já na árvore</span>
            )}
            <span className="text-[11px] text-gray-400">
              {no.documentos.length} certidão(ões) · confiança {(no.confianca * 100).toFixed(0)}%
            </span>
          </div>

          {no.conflitos.map((c) => (
            <p key={c} className="flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {c}
            </p>
          ))}

          {/* Identidade */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-500">Esta pessoa é:</label>
            <select
              value={acao === "IGNORAR" ? "ignorar" : acao === "CRIAR" ? "nova" : String(alvo ?? "")}
              onChange={(e) => {
                if (e.target.value === "ignorar") onAcao("IGNORAR")
                else if (e.target.value === "nova") onAcao("CRIAR")
                else {
                  onAcao("VINCULAR")
                  onAlvo(Number(e.target.value))
                }
              }}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800"
            >
              <option value="nova">+ Pessoa nova: {nomeDoNo(no)}</option>
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {[p.nome, p.sobrenome].filter(Boolean).join(" ")}
                  {p.data_nasc ? ` (${String(p.data_nasc).slice(0, 10)})` : ""}
                </option>
              ))}
              <option value="ignorar">Não incluir esta pessoa</option>
            </select>
          </div>

          {no.outrosCandidatos.length > 0 && (
            <p className="text-[11px] text-gray-500">
              Parecidas na árvore:{" "}
              {no.outrosCandidatos.map((c, i) => (
                <span key={c.pessoaId}>
                  {i > 0 && " · "}
                  {c.nome} <span className="text-gray-400">({c.classe.toLowerCase()}, {(c.score * 100).toFixed(0)}%)</span>
                </span>
              ))}
            </p>
          )}

          {no.possiveisDuplicatas.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded bg-amber-50 px-2 py-1.5">
              <label className="text-xs text-amber-900">Pode ser a mesma pessoa que:</label>
              <select
                value={mesmoQue ?? ""}
                onChange={(e) => onMesmoQue(e.target.value || null)}
                className="rounded border border-amber-300 bg-white px-2 py-1 text-xs text-gray-800"
              >
                <option value="">São pessoas diferentes</option>
                {no.possiveisDuplicatas.map((d) => (
                  <option key={d.chave} value={d.chave}>
                    É a mesma que {d.nome} ({(d.score * 100).toFixed(0)}%)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Antes → depois */}
          {no.alteracoes.length > 0 && (
            <div className="space-y-1 rounded bg-gray-50 p-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                O que mudaria no cadastro
              </p>
              {no.alteracoes.map((a) => (
                <label key={a.campo} className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={camposMarcados.has(a.campo)}
                    onChange={(e) => onCampo(a.campo, e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="flex-1">
                    <span className="text-gray-700">{a.rotulo}: </span>
                    <span className="text-gray-500 line-through">{a.antes ?? "(vazio)"}</span>
                    <span className="text-gray-400"> → </span>
                    <span className="font-medium text-gray-900">{a.depois}</span>
                    {a.tipo === "ALTERA_EXISTENTE" && (
                      <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">sobrescreve</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          {/* Vínculos */}
          {vinculos.length > 0 && (
            <div className="space-y-1">
              {vinculos.map((v) => {
                const chave = chaveVinculo(v)
                const rotulo =
                  v.deChave === no.chave
                    ? `${nomeDoNo(no)} — ${ROTULO_VINCULO[v.tipo]} inverso — ${nomeDe(v.paraChave)}`
                    : `${nomeDe(v.deChave)} — ${ROTULO_VINCULO[v.tipo]}`
                return (
                  <label key={chave} className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={vinculosMarcados[chave] === true}
                      disabled={v.jaExiste}
                      onChange={(e) => onVinculo(chave, e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="flex-1">
                      <span className="text-gray-700">
                        {v.tipo === "UNIAO"
                          ? `${nomeDe(v.deChave)} casado(a) com ${nomeDe(v.paraChave)}`
                          : `${nomeDe(v.paraChave)} é ${v.tipo === "FILIACAO_PAI" ? "pai" : "mãe"} de ${nomeDe(v.deChave)}`}
                      </span>
                      {v.jaExiste && <span className="ml-1 text-[10px] text-gray-400">(já cadastrado)</span>}
                      {v.conflito && <span className="block text-amber-700">{v.conflito}</span>}
                      <span className="sr-only">{rotulo}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          <button onClick={onAbrir} className="text-xs font-medium text-blue-600 hover:underline">
            {aberto ? "Ocultar evidências" : "Ver evidências"}
          </button>

          {aberto && (
            <div className="space-y-1 rounded bg-gray-50 p-2">
              {no.dados.map((d) => (
                <div key={d.campo} className="text-xs">
                  <span className="text-gray-500">{d.rotulo}: </span>
                  <span className={d.bloqueado ? "text-amber-700" : "text-gray-900"}>{d.valor}</span>
                  <span className="text-gray-400"> ({(d.confianca * 100).toFixed(0)}%)</span>
                  {d.bloqueado && <span className="ml-1 text-amber-700">— {d.explicacao}</span>}
                  <ul className="ml-3 mt-0.5 space-y-0.5">
                    {d.evidencias.map((e, i) => (
                      <li key={`${e.documentoIndice}-${i}`} className="text-[11px] text-gray-500">
                        · {arquivos.find((a) => a.indice === e.documentoIndice)?.nome ?? e.documentoNome}
                        {e.pagina ? ` p.${e.pagina}` : ""} — <span className="italic">{e.trecho ?? "(sem trecho)"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {no.dados.length === 0 && <p className="text-xs text-gray-500">Nenhum dado extraído para esta pessoa.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CartaoDocumento({
  a,
  nos,
  descartado,
  onDescartar,
}: {
  a: ArquivoAnalisado
  nos: NoProposto[]
  descartado: boolean
  onDescartar: (v: boolean) => void
}) {
  const sujeito = nos.find((n) => n.chave === a.sujeitoChave)
  return (
    <div className={`rounded border px-3 py-2 ${descartado ? "border-gray-200 bg-gray-50 opacity-60" : "border-gray-200 bg-white"}`}>
      <div className="flex items-start gap-3">
        <FileText className={`h-4 w-4 mt-0.5 shrink-0 ${a.legivel ? "text-blue-500" : "text-gray-400"}`} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-gray-900">{a.nome}</span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
              {ROTULO_TIPO[a.tipo] ?? a.tipo}
            </span>
            {a.tipoDivergente && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">tipo em dúvida</span>
            )}
            {a.divergencias.length > 0 && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                {a.divergencias.length} divergência(s)
              </span>
            )}
            {a.necessidade && (
              <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">
                atende: {a.necessidade.item}
              </span>
            )}
          </div>

          {sujeito && <p className="text-xs text-gray-600">Vai para o dossiê de {nomeDoNo(sujeito)}.</p>}
          {!a.legivel && <p className="text-xs text-amber-700">{a.motivoIlegivel ?? "Não foi possível ler."}</p>}
          {a.problemasDeImagem.length > 0 && (
            <p className="text-[11px] text-gray-500">
              Qualidade: {a.legibilidade?.toLowerCase()} · {a.problemasDeImagem.join(", ").toLowerCase().replace(/_/g, " ")}
            </p>
          )}
          {a.divergencias.map((d) => (
            <p key={d.campo} className="text-[11px] text-amber-800">
              {d.rotulo}: leitura A “{d.leituraA ?? "—"}” × leitura B “{d.leituraB ?? "—"}”
              {d.critica && " — bloqueia"}
            </p>
          ))}
          {a.averbacoes.map((av) => (
            <p key={av.texto} className="text-[11px] text-gray-600">
              Averbação: {av.texto}
            </p>
          ))}
        </div>

        <button
          onClick={() => onDescartar(!descartado)}
          className="shrink-0 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
        >
          {descartado ? "Reincluir" : "Descartar"}
        </button>
      </div>
    </div>
  )
}

function Conclusao({
  resultado,
  revertendo,
  onReverter,
}: {
  resultado: ResultadoConfirmacao
  revertendo: boolean
  onReverter: () => void
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3 rounded border border-green-200 bg-green-50 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
        <div>
          <p className="text-sm font-medium text-green-900">Árvore aplicada</p>
          <p className="text-xs text-green-800">
            Os arquivos estão na Pasta Documental do processo, na aba Documentos.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cartao rotulo="Pessoas criadas" valor={String(resultado.pessoasCriadas.length)} />
        <Cartao rotulo="Vínculos" valor={String(resultado.vinculosCriados)} />
        <Cartao rotulo="Documentos" valor={String(resultado.documentosCriados.length)} />
        <Cartao rotulo="Conflitos" valor={String(resultado.conflitos)} alerta={resultado.conflitos > 0} />
      </div>

      {(resultado.propostas > 0 || resultado.conflitos > 0) && (
        <p className="text-xs text-gray-600">
          O que exige decisão humana ficou aguardando em{" "}
          <a href="/registral" className="font-medium text-blue-600 hover:underline">
            Revisão Registral
          </a>
          .
        </p>
      )}

      {resultado.erros.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <p className="mb-1 font-medium">Não entraram:</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {resultado.erros.map((e) => (
              <li key={`${e.referencia}-${e.motivo}`}>
                {e.referencia} — {e.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded border bg-gray-50 px-3 py-3">
        <p className="text-xs text-gray-600">
          Se algo saiu errado, dá para desfazer esta importação inteira — documentos, pessoas, vínculos e alterações de
          campo. Pessoas que já ganharam trabalho novo depois não são apagadas.
        </p>
        <button
          onClick={onReverter}
          disabled={revertendo}
          className="mt-2 flex items-center gap-2 rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
        >
          {revertendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          {revertendo ? "Desfazendo…" : "Desfazer esta importação"}
        </button>
      </div>
    </div>
  )
}

function Cartao({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="rounded border bg-white px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{rotulo}</p>
      <p className={`text-lg font-semibold ${alerta ? "text-amber-600" : "text-gray-900"}`}>{valor}</p>
    </div>
  )
}
