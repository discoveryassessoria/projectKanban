"use client"

// src/app/coleta/[codigo]/page.tsx
// ============================================================================
// PÁGINA PÚBLICA DE COLETA DE DADOS — o cliente abre o link, sem login, e envia os
// próprios dados (e os de familiares) e os documentos. docs/coleta-de-dados-mandato.md.
//
//  • NUNCA mostra dado já enviado: depois de enviar, só aparece quantas pessoas foram
//    enviadas nesta visita; o formulário volta em branco.
//  • Link inexistente, encerrado ou processo fora de "Aguardando fechamento": a MESMA
//    tela ("link não está mais disponível") — não revela qual.
//  • Arquivos sobem direto para o storage PRIVADO por URL assinada de curta duração.
//  • Nada de dado pessoal em localStorage nem em log.
// ============================================================================

import { use, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { CheckCircle2, FileUp, Loader2, ShieldCheck, Trash2 } from "lucide-react"
import discoveryLogo from "@/public/logo-discovery.png"
import { TelefoneInput } from "@/src/components/telefone-input"
import { cpfValido, mascararCpf, soDigitosCpf } from "@/src/lib/cpf"
import {
  ESTADO_CIVIL_OPCOES, MAX_ARQUIVOS_POR_TIPO, MAX_BYTES_ARQUIVO_COLETA, MIMES_ARQUIVO_COLETA,
  NACIONALIDADE_OPCOES, ROTULO_TIPO_ARQUIVO, SEXO_OPCOES, TIPOS_ARQUIVO_COLETA,
  type PapelColeta, type TipoArquivoColeta,
} from "@/src/lib/coleta/campos"

interface InfoLink { consentimento: { texto: string; versao: string }; limites: { maxBytes: number; maxArquivosPorTipo: number } }
interface ArquivoSubido { tipo: TipoArquivoColeta; chave: string; nome: string; tamanho: number; mime: string }
type Campos = Record<string, string>

const CAMPOS_VAZIOS: Campos = {
  nome: "", cpf: "", rg: "", dataNascimento: "", sexo: "", estadoCivil: "", nacionalidade: "", telefone: "", email: "",
  pais: "Brasil", cep: "", endereco: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "",
}

const PAPEIS: Array<{ valor: PapelColeta; titulo: string; ajuda: string }> = [
  { valor: "REQUERENTE", titulo: "Requerente", ajuda: "Quem vai solicitar a cidadania." },
  { valor: "CONTRATANTE", titulo: "Contratante", ajuda: "Quem contrata o serviço." },
  { valor: "AMBOS", titulo: "Os dois", ajuda: "Contrata e também vai solicitar." },
]

const classeCampo = (erro?: string) =>
  `h-[42px] w-full rounded-lg border bg-[var(--surface-primary)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus-visible:ring-[3px] focus-visible:ring-[var(--border-strong)] ${erro ? "border-red-500" : "border-gray-300"}`

function Rotulo({ texto, obrigatorio, erro, children }: { texto: string; obrigatorio?: boolean; erro?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">
        {texto}{obrigatorio && <span className="text-red-600"> *</span>}
      </span>
      {children}
      {erro && <span className="mt-1 block text-xs text-red-600" role="alert">{erro}</span>}
    </label>
  )
}

export default function PaginaColeta({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = use(params)
  const [estado, setEstado] = useState<"carregando" | "aberto" | "indisponivel">("carregando")
  const [info, setInfo] = useState<InfoLink | null>(null)

  const [campos, setCampos] = useState<Campos>(CAMPOS_VAZIOS)
  const [papel, setPapel] = useState<PapelColeta | "">("")
  const [arquivos, setArquivos] = useState<ArquivoSubido[]>([])
  const [consentiu, setConsentiu] = useState(false)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [avisoGeral, setAvisoGeral] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [subindo, setSubindo] = useState<TipoArquivoColeta | null>(null)
  const [enviados, setEnviados] = useState(0)
  const topo = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let vivo = true
    fetch(`/api/coleta/${encodeURIComponent(codigo)}`)
      .then(async (r) => {
        if (!vivo) return
        if (!r.ok) return setEstado("indisponivel")
        setInfo((await r.json()) as InfoLink)
        setEstado("aberto")
      })
      .catch(() => vivo && setEstado("indisponivel"))
    return () => { vivo = false }
  }, [codigo])

  const set = (k: string, v: string) => { setCampos((c) => ({ ...c, [k]: v })); setErros((e) => ({ ...e, [k]: "" })) }

  async function subirArquivo(tipo: TipoArquivoColeta, file: File) {
    setAvisoGeral(null)
    if (!MIMES_ARQUIVO_COLETA.has(file.type)) return setAvisoGeral("Envie imagem (JPG, PNG, WEBP) ou PDF.")
    if (file.size > MAX_BYTES_ARQUIVO_COLETA) return setAvisoGeral("Arquivo grande demais (máximo 10 MB).")
    if (arquivos.filter((a) => a.tipo === tipo).length >= MAX_ARQUIVOS_POR_TIPO) return setAvisoGeral(`Envie no máximo ${MAX_ARQUIVOS_POR_TIPO} arquivos por documento.`)
    setSubindo(tipo)
    try {
      const pedido = await fetch(`/api/coleta/${encodeURIComponent(codigo)}/arquivo`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, nome: file.name, mime: file.type, tamanho: file.size }),
      })
      if (!pedido.ok) throw new Error((await pedido.json().catch(() => ({})) as { error?: string }).error ?? "Não foi possível enviar o arquivo.")
      const { chave, uploadUrl } = (await pedido.json()) as { chave: string; uploadUrl: string }
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file })
      if (!put.ok) throw new Error("Falha ao enviar o arquivo. Tente de novo.")
      setArquivos((a) => [...a, { tipo, chave, nome: file.name.slice(0, 200), tamanho: file.size, mime: file.type }])
    } catch (e) {
      setAvisoGeral(e instanceof Error ? e.message : "Não foi possível enviar o arquivo.")
    } finally {
      setSubindo(null)
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setAvisoGeral(null)
    const novos: Record<string, string> = {}
    if (!campos.nome.trim()) novos.nome = "Informe o nome completo."
    if (!soDigitosCpf(campos.cpf)) novos.cpf = "Informe o CPF."
    else if (!cpfValido(campos.cpf)) novos.cpf = "CPF inválido. Confira os números."
    if (campos.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(campos.email)) novos.email = "E-mail inválido."
    if (!papel) novos.papel = "Escolha uma opção."
    if (!consentiu) novos.consentimento = "É preciso concordar para enviar."
    if (Object.keys(novos).length > 0) {
      setErros(novos)
      setAvisoGeral("Confira os campos destacados.")
      topo.current?.scrollIntoView({ behavior: "smooth" })
      return
    }
    setEnviando(true)
    try {
      const r = await fetch(`/api/coleta/${encodeURIComponent(codigo)}/enviar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dados: { ...campos, cpf: soDigitosCpf(campos.cpf) }, papel, consentimento: true, arquivos }),
      })
      if (r.status === 404) return setEstado("indisponivel")
      const corpo = (await r.json().catch(() => ({}))) as { error?: string; erros?: Record<string, string> }
      if (!r.ok) {
        setErros(corpo.erros ?? {})
        setAvisoGeral(corpo.error ?? "Não foi possível enviar. Tente de novo.")
        topo.current?.scrollIntoView({ behavior: "smooth" })
        return
      }
      // Sucesso: o formulário volta em branco — a página nunca reexibe o que foi enviado.
      setEnviados((n) => n + 1)
      setCampos(CAMPOS_VAZIOS); setPapel(""); setArquivos([]); setConsentiu(false); setErros({})
      topo.current?.scrollIntoView({ behavior: "smooth" })
    } catch {
      setAvisoGeral("Sem conexão. Verifique a internet e tente de novo.")
    } finally {
      setEnviando(false)
    }
  }

  const moldura = (filhos: React.ReactNode) => (
    <div className="min-h-screen bg-[var(--surface-secondary)] px-4 py-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex justify-center"><Image src={discoveryLogo} alt="Grupo Discovery" width={200} priority /></div>
        {filhos}
      </div>
    </div>
  )

  if (estado === "carregando") {
    return moldura(<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-[var(--text-secondary)]" aria-label="Carregando" /></div>)
  }
  if (estado === "indisponivel") {
    return moldura(
      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-8 text-center shadow-[var(--elev-1)]">
        <h1 className="text-lg font-semibold text-gray-900">Este link não está mais disponível</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">Fale com a Discovery para receber um novo link.</p>
      </div>,
    )
  }

  const lista = (tipo: TipoArquivoColeta) => arquivos.filter((a) => a.tipo === tipo)

  return moldura(
    <form onSubmit={enviar} noValidate className="space-y-5">
      <div ref={topo} />
      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-6 shadow-[var(--elev-1)]">
        <h1 className="text-xl font-semibold text-gray-900">Envio de dados e documentos</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Preencha os dados de cada pessoa do processo. Você pode enviar mais de uma pessoa, uma de cada vez. Os documentos são opcionais, mas ajudam a agilizar.
        </p>
        {enviados > 0 && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-[var(--success-tile)] px-3 py-2 text-sm text-[var(--success-text)]" role="status">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {enviados === 1 ? "Dados enviados com sucesso." : `${enviados} pessoas enviadas nesta visita.`} Se houver mais alguém, preencha de novo abaixo.
          </p>
        )}
        {avisoGeral && <p className="mt-4 rounded-lg bg-[var(--danger-tile)] px-3 py-2 text-sm text-[var(--danger-text)]" role="alert">{avisoGeral}</p>}
      </div>

      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-6 shadow-[var(--elev-1)]">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Esta pessoa é…</h2>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Papel da pessoa">
          {PAPEIS.map((p) => (
            <label key={p.valor} className={`cursor-pointer rounded-lg border p-3 text-sm transition ${papel === p.valor ? "border-[var(--action-primary)] bg-[var(--surface-secondary)]" : "border-gray-300"}`}>
              <input type="radio" name="papel" value={p.valor} checked={papel === p.valor} onChange={() => { setPapel(p.valor); setErros((x) => ({ ...x, papel: "" })) }} className="sr-only" />
              <span className="block font-medium text-gray-900">{p.titulo}</span>
              <span className="block text-xs text-[var(--text-secondary)]">{p.ajuda}</span>
            </label>
          ))}
        </div>
        {erros.papel && <p className="mt-2 text-xs text-red-600" role="alert">{erros.papel}</p>}
      </section>

      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-6 shadow-[var(--elev-1)]">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Dados pessoais</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Rotulo texto="Nome completo" obrigatorio erro={erros.nome}>
              <input className={classeCampo(erros.nome)} value={campos.nome} maxLength={100} autoComplete="off" onChange={(e) => set("nome", e.target.value)} />
            </Rotulo>
          </div>
          <Rotulo texto="CPF" obrigatorio erro={erros.cpf}>
            <input className={classeCampo(erros.cpf)} inputMode="numeric" value={campos.cpf} maxLength={14} autoComplete="off"
              onChange={(e) => set("cpf", mascararCpf(soDigitosCpf(e.target.value).slice(0, 11)))} placeholder="000.000.000-00" />
          </Rotulo>
          <Rotulo texto="RG" erro={erros.rg}>
            <input className={classeCampo(erros.rg)} value={campos.rg} maxLength={20} onChange={(e) => set("rg", e.target.value)} />
          </Rotulo>
          <Rotulo texto="Data de nascimento" erro={erros.dataNascimento}>
            <input type="date" className={classeCampo(erros.dataNascimento)} value={campos.dataNascimento} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set("dataNascimento", e.target.value)} />
          </Rotulo>
          <Rotulo texto="Sexo" erro={erros.sexo}>
            <select className={classeCampo(erros.sexo)} value={campos.sexo} onChange={(e) => set("sexo", e.target.value)}>
              <option value="">Selecione</option>
              {SEXO_OPCOES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Rotulo>
          <Rotulo texto="Estado civil" erro={erros.estadoCivil}>
            <select className={classeCampo(erros.estadoCivil)} value={campos.estadoCivil} onChange={(e) => set("estadoCivil", e.target.value)}>
              <option value="">Selecione</option>
              {ESTADO_CIVIL_OPCOES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Rotulo>
          <Rotulo texto="Nacionalidade" erro={erros.nacionalidade}>
            <select className={classeCampo(erros.nacionalidade)} value={campos.nacionalidade} onChange={(e) => set("nacionalidade", e.target.value)}>
              <option value="">Selecione</option>
              {NACIONALIDADE_OPCOES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Rotulo>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-6 shadow-[var(--elev-1)]">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Contato</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Rotulo texto="Telefone" erro={erros.telefone}>
            <TelefoneInput value={campos.telefone} onChange={(v) => set("telefone", v)} usarBase={false} />
          </Rotulo>
          <Rotulo texto="E-mail" erro={erros.email}>
            <input type="email" className={classeCampo(erros.email)} value={campos.email} maxLength={100} onChange={(e) => set("email", e.target.value)} />
          </Rotulo>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-6 shadow-[var(--elev-1)]">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Endereço</h2>
        <div className="grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-2"><Rotulo texto="CEP"><input className={classeCampo()} value={campos.cep} maxLength={15} onChange={(e) => set("cep", e.target.value)} /></Rotulo></div>
          <div className="sm:col-span-4"><Rotulo texto="Rua / logradouro"><input className={classeCampo()} value={campos.endereco} maxLength={200} onChange={(e) => set("endereco", e.target.value)} /></Rotulo></div>
          <div className="sm:col-span-2"><Rotulo texto="Número"><input className={classeCampo()} value={campos.numero} maxLength={20} onChange={(e) => set("numero", e.target.value)} /></Rotulo></div>
          <div className="sm:col-span-4"><Rotulo texto="Complemento"><input className={classeCampo()} value={campos.complemento} maxLength={100} onChange={(e) => set("complemento", e.target.value)} /></Rotulo></div>
          <div className="sm:col-span-3"><Rotulo texto="Bairro"><input className={classeCampo()} value={campos.bairro} maxLength={100} onChange={(e) => set("bairro", e.target.value)} /></Rotulo></div>
          <div className="sm:col-span-3"><Rotulo texto="Cidade"><input className={classeCampo()} value={campos.cidade} maxLength={100} onChange={(e) => set("cidade", e.target.value)} /></Rotulo></div>
          <div className="sm:col-span-3"><Rotulo texto="Estado"><input className={classeCampo()} value={campos.estado} maxLength={50} onChange={(e) => set("estado", e.target.value)} /></Rotulo></div>
          <div className="sm:col-span-3"><Rotulo texto="País"><input className={classeCampo()} value={campos.pais} maxLength={50} onChange={(e) => set("pais", e.target.value)} /></Rotulo></div>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-6 shadow-[var(--elev-1)]">
        <h2 className="text-sm font-semibold text-gray-900">Documentos <span className="font-normal text-[var(--text-secondary)]">(opcional)</span></h2>
        <p className="mb-4 mt-1 text-xs text-[var(--text-secondary)]">Foto nítida ou PDF, até 10 MB cada, no máximo {info?.limites.maxArquivosPorTipo ?? MAX_ARQUIVOS_POR_TIPO} arquivos por documento.</p>
        <div className="space-y-4">
          {TIPOS_ARQUIVO_COLETA.map((tipo) => (
            <div key={tipo} className="rounded-lg border border-gray-200 p-4">
              <p className="text-sm font-medium text-gray-900">{ROTULO_TIPO_ARQUIVO[tipo]}</p>
              <ul className="mt-2 space-y-1">
                {lista(tipo).map((a) => (
                  <li key={a.chave} className="flex items-center justify-between gap-2 rounded bg-[var(--surface-secondary)] px-2 py-1 text-xs">
                    <span className="truncate">{a.nome}</span>
                    <button type="button" onClick={() => setArquivos((x) => x.filter((y) => y.chave !== a.chave))} className="shrink-0 text-[var(--text-secondary)] hover:text-red-600" aria-label={`Remover ${a.nome}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-[var(--surface-primary)] px-3 py-1.5 text-xs font-medium text-gray-800 transition hover:border-[var(--border-strong)]">
                {subindo === tipo ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FileUp className="h-3.5 w-3.5" aria-hidden />}
                {subindo === tipo ? "Enviando…" : "Escolher arquivo"}
                <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only" disabled={subindo !== null}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void subirArquivo(tipo, f) }} />
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-6 shadow-[var(--elev-1)]">
        <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-800">
          <input type="checkbox" checked={consentiu} onChange={(e) => { setConsentiu(e.target.checked); setErros((x) => ({ ...x, consentimento: "" })) }} className="mt-1 h-4 w-4" />
          <span>{info?.consentimento.texto}</span>
        </label>
        {erros.consentimento && <p className="mt-2 text-xs text-red-600" role="alert">{erros.consentimento}</p>}
        <button type="submit" disabled={enviando || subindo !== null}
          className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--action-primary)] text-sm font-semibold text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary-hover)] disabled:opacity-60">
          {enviando ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Enviando…</> : "Enviar"}
        </button>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Seus dados e documentos são tratados com sigilo e só a equipe da Discovery tem acesso.</p>
      </section>
    </form>,
  )
}
