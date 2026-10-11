// src/components/leads/Leads.tsx
// ============================================================================
// A TELA DE LEADS — docs/leads-mandato.md, regras 19 a 27 (protótipo: docs/leads-prototipo.html).
//
// Lista com filtros por situação, a conversa aberta com o campo de resposta e o painel do lead (o que o
// agente levantou, pessoas para pesquisar, ações). A tela SÓ DESENHA: situação, "dá para responder" e
// contagens vêm prontas do servidor (`src/services/leads/situacao.ts` e `leitura.ts`).
//
// LEAD NÃO É TAREFA: nada aqui atribui, distribui ou conta tarefa. Só quem tem `leads.atender` chega aqui.
// Sem canal em tempo real no sistema: a lista e a conversa se atualizam sozinhas a cada poucos segundos.
// ============================================================================
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { api, erroDe, fmtDataHora, ModalTexto } from "@/src/components/torre/torre-base"
import { auth } from "@/src/components/operacao/kit-operacional"
import { ROTULO_DA_SITUACAO, type SituacaoDoLead } from "@/src/services/leads/situacao"
import type { LeadAberto, ListaDeLeads, MensagemDoLead } from "@/src/services/leads/leitura"
import "@/src/components/torre/torre.css"
import "./leads.css"

const ORDEM_DOS_FILTROS: SituacaoDoLead[] = ["AGUARDANDO_RESPOSTA", "RESPONDIDO", "COM_O_AGENTE", "ENCERRADO"]
const COR_DA_SITUACAO: Record<SituacaoDoLead, string> = { AGUARDANDO_RESPOSTA: "red", RESPONDIDO: "grn", COM_O_AGENTE: "blu", ENCERRADO: "gry" }
const ROTULO_DO_ARQUIVO: Record<string, string> = { audio: "Áudio", image: "Foto", document: "Documento", video: "Vídeo" }
const ROTULO_DA_FICHA: Record<string, string> = {
  nome: "Nome", pais: "País", antepassado: "Ascendente", origem: "Origem", linha: "Linha", naturalizacao: "Naturalização",
  familia: "Família com cidadania", pessoas: "Mais interessados", documentos: "Documentos",
}
const ATUALIZAR_LISTA_MS = 10_000
const ATUALIZAR_CONVERSA_MS = 7_000

const telefoneLegivel = (t: string) => {
  const m = t.match(/^55(\d{2})(\d{4,5})(\d{4})$/)
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${t}`
}
const nomeDoLead = (l: { nome: string; telefone: string }) => l.nome.trim() || telefoneLegivel(l.telefone)

function linhasDaLinhagem(lead: LeadAberto): string[] {
  return lead.linhagem.map((p) => {
    const partes = [p.nome && p.nome !== "não sabe" ? p.nome : "nome não informado"]
    if (p.conjuge.trim()) partes.push(`casado(a) com ${p.conjuge}`)
    if (p.pais.trim()) partes.push(`pais: ${p.pais}`)
    if (p.nasceu.trim()) partes.push(`nasceu: ${p.nasceu}`)
    return `${p.quem ? p.quem.charAt(0).toUpperCase() + p.quem.slice(1) : "Pessoa"}: ${partes.join(", ")}`
  })
}

/** O arquivo que o lead mandou. Só é buscado quando a pessoa pede; foto e áudio abrem na conversa, o resto abre ou baixa. */
function ArquivoDaMensagem({ mensagem, avisar }: { mensagem: MensagemDoLead; avisar: (m: string) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [tipo, setTipo] = useState("")
  const [carregando, setCarregando] = useState(false)
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  if (!mensagem.arquivo) return null
  const rotulo = ROTULO_DO_ARQUIVO[mensagem.arquivo.tipo] ?? "Arquivo"

  const abrir = async () => {
    setCarregando(true)
    try {
      const r = await fetch(`/api/leads/arquivo/${mensagem.id}`, { headers: { Authorization: auth().Authorization } })
      if (!r.ok) {
        avisar(erroDe(await r.json().catch(() => ({})), "Não foi possível abrir o arquivo."))
        return
      }
      const blob = await r.blob()
      const endereco = URL.createObjectURL(blob)
      if (blob.type.startsWith("image/") || blob.type.startsWith("audio/")) {
        setTipo(blob.type)
        setUrl(endereco)
      } else if (blob.type === "application/pdf") {
        window.open(endereco, "_blank", "noopener")
      } else {
        // Qualquer outro tipo nunca é aberto dentro do sistema: só baixado.
        const a = document.createElement("a")
        a.href = endereco
        a.download = mensagem.arquivo?.nome || `arquivo-do-lead-${mensagem.id}`
        a.click()
        setTimeout(() => URL.revokeObjectURL(endereco), 30_000)
      }
    } catch {
      avisar("Erro de conexão ao abrir o arquivo.")
    } finally {
      setCarregando(false)
    }
  }

  if (url && tipo.startsWith("image/")) return <img src={url} alt={`${rotulo} enviada pelo lead`} />
  if (url && tipo.startsWith("audio/")) return <audio controls src={url} />
  return (
    <button type="button" className="tor-btn mt-1" onClick={() => void abrir()} disabled={carregando}>
      {carregando ? "Abrindo…" : `Abrir ${rotulo.toLowerCase()}${mensagem.arquivo.nome ? `: ${mensagem.arquivo.nome}` : ""}`}
    </button>
  )
}

export function Leads() {
  const router = useRouter()
  const params = useSearchParams()
  const situacaoDaUrl = params.get("situacao")
  const filtro: SituacaoDoLead | "TODOS" = situacaoDaUrl === "TODOS" ? "TODOS" : situacaoDaUrl && situacaoDaUrl in ROTULO_DA_SITUACAO ? (situacaoDaUrl as SituacaoDoLead) : "AGUARDANDO_RESPOSTA"
  const abertoId = /^\d+$/.test(params.get("lead") ?? "") ? Number(params.get("lead")) : null

  const [busca, setBusca] = useState("")
  const [lista, setLista] = useState<ListaDeLeads | null>(null)
  const [erroDaLista, setErroDaLista] = useState<string | null>(null)
  const [lead, setLead] = useState<LeadAberto | null>(null)
  const [erroDoLead, setErroDoLead] = useState<string | null>(null)
  const [texto, setTexto] = useState("")
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [encerrando, setEncerrando] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const fimDaConversa = useRef<HTMLDivElement | null>(null)
  const ultimaMensagemVista = useRef<string | null>(null)
  const leadPedido = useRef<number | null>(abertoId)

  // Trocou de lead: a conversa, o rascunho e o aviso de "copiado" do anterior não valem para o novo.
  const [idMostrado, setIdMostrado] = useState(abertoId)
  if (idMostrado !== abertoId) {
    setIdMostrado(abertoId)
    setLead(null); setErroDoLead(null); setTexto(""); setCopiado(false)
  }

  const irPara = useCallback((mudancas: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(mudancas)) { if (v === null) sp.delete(k); else sp.set(k, v) }
    router.replace(`/leads${sp.toString() ? `?${sp}` : ""}`, { scroll: false })
  }, [params, router])

  const avisar = useCallback((m: string) => setAviso(m), [])
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 6000)
    return () => clearTimeout(t)
  }, [aviso])

  const carregarLista = useCallback(async () => {
    const sp = new URLSearchParams()
    if (filtro !== "TODOS") sp.set("situacao", filtro)
    if (busca.trim()) sp.set("busca", busca.trim())
    const r = await api<ListaDeLeads>(`/api/leads${sp.toString() ? `?${sp}` : ""}`)
    if (r.ok) { setLista(r.data); setErroDaLista(null) } else setErroDaLista(erroDe(r.data, "Não foi possível carregar os leads."))
  }, [filtro, busca])

  const carregarLead = useCallback(async () => {
    if (abertoId === null) return
    const r = await api<{ lead: LeadAberto }>(`/api/leads/${abertoId}`)
    // A resposta de um lead que já não é o aberto (a pessoa trocou enquanto carregava) é descartada.
    if (leadPedido.current !== abertoId) return
    if (r.ok) { setLead(r.data.lead); setErroDoLead(null) } else { setLead(null); setErroDoLead(erroDe(r.data, "Não foi possível abrir o lead.")) }
  }, [abertoId])

  // A busca espera a pessoa parar de digitar; a lista se atualiza sozinha.
  useEffect(() => {
    const t = setTimeout(() => void carregarLista(), 250)
    const i = setInterval(() => void carregarLista(), ATUALIZAR_LISTA_MS)
    return () => { clearTimeout(t); clearInterval(i) }
  }, [carregarLista])

  useEffect(() => {
    leadPedido.current = abertoId
    if (abertoId === null) return
    const t = setTimeout(() => void carregarLead(), 0)
    const i = setInterval(() => void carregarLead(), ATUALIZAR_CONVERSA_MS)
    return () => { clearTimeout(t); clearInterval(i) }
  }, [abertoId, carregarLead])

  // Abre na mensagem mais recente e acompanha as novas (sem puxar a rolagem quando nada mudou).
  const ultimaVista = lead && lead.mensagens.length ? `${lead.id}:${lead.mensagens[lead.mensagens.length - 1].id}` : null
  useEffect(() => {
    if (ultimaVista !== null && ultimaVista !== ultimaMensagemVista.current) {
      ultimaMensagemVista.current = ultimaVista
      fimDaConversa.current?.scrollIntoView({ block: "end" })
    }
  }, [ultimaVista])

  const acao = async (caminho: string, corpo: unknown, sucesso: string | null) => {
    if (abertoId === null) return false
    setOcupado(true)
    const r = await api(`/api/leads/${abertoId}/${caminho}`, "POST", corpo)
    setOcupado(false)
    if (!r.ok) { avisar(erroDe(r.data)); return false }
    if (sucesso) avisar(sucesso)
    await Promise.all([carregarLead(), carregarLista()])
    return true
  }

  const enviar = async () => {
    const t = texto.trim()
    if (!t) return
    if (await acao("mensagens", { texto: t }, null)) setTexto("")
  }

  const copiarLinhagem = async () => {
    if (!lead) return
    try {
      await navigator.clipboard.writeText([`${nomeDoLead(lead)} (${telefoneLegivel(lead.telefone)})`, ...linhasDaLinhagem(lead)].join("\n"))
      setCopiado(true)
    } catch {
      avisar("Não foi possível copiar. Selecione o texto e copie manualmente.")
    }
  }

  // Sempre na mesma ordem (a da triagem), não na ordem em que o banco devolve os campos.
  const fichaVisivel = lead
    ? [...Object.keys(ROTULO_DA_FICHA), ...Object.keys(lead.ficha).filter((c) => !(c in ROTULO_DA_FICHA))].filter((c) => lead.ficha[c]?.trim()).map((c) => [c, lead.ficha[c]] as const)
    : []
  const linhagem = lead ? linhasDaLinhagem(lead) : []
  const faixa = !lead ? null
    : lead.situacao === "COM_O_AGENTE" ? { texto: "O agente está atendendo. Se você responder, ele sai da conversa e ela passa a ser sua.", alerta: false }
    : lead.situacao === "ENCERRADO" ? { texto: `Lead encerrado${lead.motivoEncerramento ? `: ${lead.motivoEncerramento}` : ""}. Se a pessoa escrever de novo, ele volta para o agente.`, alerta: true }
    : !lead.podeResponder ? { texto: "Passaram mais de 24 horas desde a última mensagem do lead. O WhatsApp só libera a resposta quando ele escrever de novo.", alerta: true }
    : null

  return (
    <div className="tor">
      <div className="ld-filtros" role="group" aria-label="Filtrar por situação">
        {ORDEM_DOS_FILTROS.map((s) => (
          <button key={s} type="button" className="ld-filtro" aria-pressed={filtro === s} onClick={() => irPara({ situacao: s })}>
            {ROTULO_DA_SITUACAO[s]}<b>{lista ? lista.contagem[s] : "…"}</b>
          </button>
        ))}
        <button type="button" className="ld-filtro" aria-pressed={filtro === "TODOS"} onClick={() => irPara({ situacao: "TODOS" })}>
          Todos<b>{lista ? lista.total : "…"}</b>
        </button>
      </div>

      <div className={`ld-corpo ${abertoId !== null ? "aberto" : ""}`}>
        <div className="tor-card ld-coluna-lista" style={{ marginBottom: 0 }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-default)" }}>
            <input type="search" className="tor-in w-full" placeholder="Buscar por nome ou telefone" aria-label="Buscar lead" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div className="ld-lista">
            {erroDaLista && <div className="ld-vazio ld-perigo">{erroDaLista}</div>}
            {!erroDaLista && !lista && <div className="ld-vazio">Carregando…</div>}
            {lista && lista.leads.length === 0 && <div className="ld-vazio">{busca.trim() ? "Nenhum lead encontrado nesta busca." : "Nenhum lead nesta situação."}</div>}
            {lista?.leads.map((l) => (
              <button key={l.id} type="button" className="ld-linha" aria-current={l.id === abertoId} onClick={() => irPara({ lead: String(l.id) })}>
                <span className="topo"><span className="nome">{nomeDoLead(l)}</span><span className="quando">{l.ultimaMensagem ? fmtDataHora(l.ultimaMensagem.em) : ""}</span></span>
                <span className="previa">{l.ultimaMensagem?.texto ?? "Sem mensagens."}</span>
                <span className="rodape"><span className={`tor-p ${COR_DA_SITUACAO[l.situacao]}`}>{ROTULO_DA_SITUACAO[l.situacao]}</span>{l.pais}</span>
              </button>
            ))}
            {lista?.cortada && <div className="ld-vazio small">Mostrando os {lista.total} leads de atividade mais recente.</div>}
          </div>
        </div>

        <div className="tor-card ld-conversa" style={{ marginBottom: 0 }}>
          {abertoId === null && <div className="ld-vazio">Escolha um lead na lista para ver a conversa.</div>}
          {abertoId !== null && erroDoLead && <div className="ld-vazio ld-perigo">{erroDoLead}</div>}
          {abertoId !== null && !erroDoLead && !lead && <div className="ld-vazio">Abrindo a conversa…</div>}
          {lead && (
            <>
              <div className="ld-cab">
                <button type="button" className="tor-btn ld-voltar" onClick={() => irPara({ lead: null })}>← Lista</button>
                <span className="titulo">{nomeDoLead(lead)}</span>
                <span className="small">{telefoneLegivel(lead.telefone)}</span>
              </div>
              {faixa && <div className={`ld-faixa ${faixa.alerta ? "alerta" : ""}`}>{faixa.texto}</div>}
              <div className="ld-msgs" aria-label="Conversa com o lead">
                {lead.mensagens.map((m) => (
                  <div key={m.id} className={`ld-msg ${m.de !== "LEAD" ? "nossa" : ""} ${m.de === "ATENDENTE" ? "pessoa" : ""}`}>
                    <div className="quem">{m.de === "LEAD" ? "Lead" : m.de === "AGENTE" ? "Agente" : m.autor || "Equipe"}</div>
                    {m.texto}
                    <ArquivoDaMensagem mensagem={m} avisar={avisar} />
                    <div className="hora">{fmtDataHora(m.em)}</div>
                  </div>
                ))}
                {lead.mensagens.length === 0 && <div className="ld-vazio">Sem mensagens.</div>}
                <div ref={fimDaConversa} />
              </div>
              <div className="ld-resp">
                <textarea
                  className="tor-in" rows={2} aria-label="Resposta ao lead" placeholder={lead.podeResponder ? "Escreva a resposta" : "Resposta indisponível"}
                  value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!lead.podeResponder || ocupado} maxLength={4096}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void enviar() } }}
                />
                <button type="button" className="tor-btn pri" style={{ minHeight: 44, padding: "0 16px" }} onClick={() => void enviar()} disabled={!lead.podeResponder || ocupado || !texto.trim()}>
                  {ocupado ? "Enviando…" : "Enviar"}
                </button>
              </div>
            </>
          )}
        </div>

        {lead && (
          <div className="ld-painel">
            <div className="tor-card pad">
              <h3>O que o agente levantou</h3>
              {fichaVisivel.length > 0
                ? <dl className="ld-ficha">{fichaVisivel.map(([campo, valor]) => (<FichaLinha key={campo} rotulo={ROTULO_DA_FICHA[campo] ?? campo} valor={valor} />))}</dl>
                : <div className="small">Nada levantado ainda.</div>}
              {lead.motivoPassagem && <div className="small mt-2">Motivo da passagem: {lead.motivoPassagem}</div>}
            </div>
            <div className="tor-card pad">
              <h3>Pessoas para pesquisar</h3>
              {linhagem.length > 0 ? (
                <>
                  <ol className="ld-pessoas">{linhagem.map((linha, i) => <li key={i}>{linha}</li>)}</ol>
                  <button type="button" className="tor-btn mt-2" onClick={() => void copiarLinhagem()}>{copiado ? "Copiado" : "Copiar para a pesquisa"}</button>
                </>
              ) : <div className="small">Nenhuma pessoa informada.</div>}
              {lead.resumo.trim() && <div className="small mt-2">{lead.resumo}</div>}
            </div>
            <div className="tor-card pad">
              <h3>Ações</h3>
              <div className="ld-acoes">
                {(lead.situacao === "AGUARDANDO_RESPOSTA" || lead.situacao === "RESPONDIDO") && (
                  <button type="button" className="tor-btn" disabled={ocupado} onClick={() => void acao("devolver", {}, "Conversa devolvida ao agente.")}>Devolver ao agente</button>
                )}
                {lead.situacao !== "ENCERRADO"
                  ? <button type="button" className="tor-btn ld-perigo" disabled={ocupado} onClick={() => setEncerrando(true)}>Encerrar lead</button>
                  : <button type="button" className="tor-btn" disabled={ocupado} onClick={() => void acao("reabrir", {}, "Lead reaberto.")}>Reabrir lead</button>}
              </div>
            </div>
          </div>
        )}
      </div>

      {encerrando && lead && (
        <ModalTexto
          titulo={`Encerrar ${nomeDoLead(lead)}`} subtitulo="Se a pessoa escrever de novo, o lead volta para o agente." rotulo="Motivo do encerramento" confirmar="Encerrar lead"
          onFechar={() => setEncerrando(false)}
          onEnviar={async (motivo) => {
            const r = await api(`/api/leads/${lead.id}/encerrar`, "POST", { motivo })
            if (!r.ok) return { ok: false, mensagem: erroDe(r.data) }
            setEncerrando(false)
            avisar("Lead encerrado.")
            await Promise.all([carregarLead(), carregarLista()])
            return { ok: true }
          }}
        />
      )}
      {aviso && <div className="tor-toast" role="status">{aviso}<button type="button" className="tor-btn" onClick={() => setAviso(null)}>Fechar</button></div>}
    </div>
  )
}

function FichaLinha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (<><dt>{rotulo}</dt><dd>{valor}</dd></>)
}
