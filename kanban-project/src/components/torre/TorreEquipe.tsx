"use client"
// src/components/torre/TorreEquipe.tsx — aba EQUIPE (Bloco H1/H2).
// Números das MESMAS linhas da Operação (/api/torre/equipe). Ausência é só REGISTRO (com sucessor
// sugerido); mover a carteira é ação MANUAL; "Simular saída" mostra o impacto antes de aplicar.
import { useEffect, useState } from "react"
import { api, erroDe, Campo, Modal, useTorre, fmtDia, type Desfazer } from "./torre-base"

interface Pessoa {
  usuarioId: number; nome: string; papel: string; aptidoes: string[]
  ausencia: { id: number; tipo: string; rotulo: string; fim: string | null; sucessorSugerido: { usuarioId: number; nome: string } | null } | null
  carga: { executaveis: number; limite: number | null; pct: number | null; faixa: "verde" | "ambar" | "vermelha" | null; fechaPorSemana: number }
  ativas: number; atrasadas: number; aguardando: number
  fila: { semanas: number | null; faixa: "vermelho" | "ambar" | "livre" | "sem_base" }
}
interface LinhaPrevisao { usuarioId: number | null; nome: string; porSemana: Array<{ n: number; nivel: 0 | 1 | 2 | 3 }>; vencidas: number; depois: number; semPrazo: number; total: number }
interface Previsao { semanas: Array<{ inicio: string; fim: string }>; linhas: LinhaPrevisao[] }
interface Simulacao { usuarioId: number; nome: string; dias: number; texto: string; sucessor: { nome: string } | null }

const TIPOS_AUSENCIA: Array<[string, string]> = [["FERIAS", "Férias"], ["AFASTAMENTO", "Afastamento"], ["AUSENCIA", "Ausência"], ["BLOQUEIO_OPERACIONAL", "Bloqueio operacional"]]
const PILL_FILA = { vermelho: "red", ambar: "amb", livre: "grn", sem_base: "gry" } as const
const curto = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })

export function TorreEquipe({ versao, pais = "" }: { versao: number; pais?: string }) {
  const { permissoes, avisar, recarregar } = useTorre()
  const [dados, setDados] = useState<{ pessoas: Pessoa[]; previsao: Previsao } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [ausencia, setAusencia] = useState<Pessoa | null>(null)
  const [mover, setMover] = useState<Pessoa | null>(null)
  const [sim, setSim] = useState<Simulacao | null>(null)
  const [diasSim, setDiasSim] = useState(10)
  const [ocupado, setOcupado] = useState(false)

  const permitido = !!permissoes?.equipe
  useEffect(() => {
    if (!permitido) return
    let vivo = true
    // O PAÍS DO CABEÇALHO FILTRA os números (carga, atrasadas, previsão): o servidor recorta as linhas por país antes de somar.
    void api<{ pessoas: Pessoa[]; previsao: Previsao }>(`/api/torre/equipe${pais ? `?pais=${encodeURIComponent(pais)}` : ""}`).then((r) => {
      if (!vivo) return
      if (r.ok) { setDados(r.data); setErro(null) } else setErro(erroDe(r.data, "Não foi possível carregar a equipe."))
    })
    return () => { vivo = false }
  }, [tick, versao, permitido, pais])
  const atualizar = () => { setTick((n) => n + 1); recarregar() }

  if (!permitido) return <div className="tor-card pad">A aba Equipe exige a permissão de gerenciar usuários e acessos (<code>usuarios.gerenciar</code>).</div>
  if (erro) return <div className="tor-card pad">{erro}</div>
  if (!dados) return <div className="tor-card pad small">Carregando equipe…</div>

  const cancelarAusencia = async (p: Pessoa) => {
    if (!p.ausencia) return
    const r = await api("/api/operacao/capacidade", "PATCH", { acao: "encerrar_indisponibilidade", usuarioId: p.usuarioId, indisponibilidadeId: p.ausencia.id })
    if (r.ok) { avisar(`Ausência de ${p.nome} cancelada — volta a receber trabalho.`); atualizar() } else avisar(erroDe(r.data))
  }
  const simular = async (p: Pessoa) => {
    setOcupado(true)
    const r = await api<Simulacao>("/api/torre/equipe/simular-saida", "POST", { usuarioId: p.usuarioId, dias: diasSim })
    setOcupado(false)
    if (r.ok) setSim(r.data); else avisar(erroDe(r.data))
  }
  const aplicar = async () => {
    if (!sim) return
    setOcupado(true)
    const r = await api<{ ok?: boolean; sucessor?: { nome: string } | null; carteira?: { movidas?: number; motivo?: string }; desfazer?: Desfazer | null }>("/api/torre/equipe/aplicar-saida", "POST", { usuarioId: sim.usuarioId, dias: sim.dias })
    setOcupado(false)
    if (r.ok) {
      avisar(`Ausência de ${sim.nome} registrada${r.data.sucessor ? ` (sucessor sugerido: ${r.data.sucessor.nome})` : ""}; ${r.data.carteira?.movidas ?? 0} tarefa(s) movida(s)${r.data.carteira?.motivo ? ` — ${r.data.carteira.motivo}` : ""}.`, r.data.desfazer ?? null)
      setSim(null); atualizar()
    } else avisar(erroDe(r.data))
  }

  return (
    <div>
      <div className="small mb-2">Carga = executáveis (fora as que esperam o cartório) ÷ limite do cadastro. Fila = executáveis ÷ o que a pessoa fecha por semana (média das últimas 4). Limite e aptidões vêm de Capacidade Operacional.</div>
      <div className="tor-card tor-scroll">
        <div className="tor-hd tor-gE"><span>Pessoa</span><span>Carga</span><span>Ativas</span><span>Atrasadas</span><span>Aguard.</span><span>Fila</span><span>Ações</span></div>
        {dados.pessoas.length === 0 && <div className="p-4 small">Nenhuma pessoa executa trabalho ainda.</div>}
        {dados.pessoas.map((p) => (
          <div key={p.usuarioId} className="tor-row tor-gE">
            <div>
              <b>{p.nome}</b>
              <div className="small">{p.papel} · aptidões: {p.aptidoes.length ? p.aptidoes.join(", ") : "nenhuma declarada"} · {p.ausencia ? `ausente (${p.ausencia.rotulo}${p.ausencia.fim ? ` até ${fmtDia(p.ausencia.fim)}` : ""})${p.ausencia.sucessorSugerido ? ` · sucessor sugerido: ${p.ausencia.sucessorSugerido.nome}` : ""}` : "disponível"}</div>
            </div>
            <div>
              {p.carga.limite != null && p.carga.pct != null && p.carga.faixa ? (
                <><div className="tor-meter"><i className={p.carga.faixa} style={{ width: `${Math.min(100, p.carga.pct)}%` }} /></div><div className="small">{p.carga.executaveis} de {p.carga.limite} · fecha {p.carga.fechaPorSemana}/sem</div></>
              ) : (<div className="small">sem limite cadastrado · {p.carga.executaveis} executáveis · fecha {p.carga.fechaPorSemana}/sem</div>)}
            </div>
            <div><b>{p.ativas}</b></div>
            <div><b style={p.atrasadas ? { color: "var(--danger-text)" } : undefined}>{p.atrasadas}</b></div>
            <div>{p.aguardando}</div>
            <div><span className={`tor-p ${PILL_FILA[p.fila.faixa]}`}>{p.fila.faixa === "livre" ? "livre" : p.fila.faixa === "sem_base" ? "sem base" : `${String(p.fila.semanas).replace(".", ",")} sem`}</span></div>
            <div className="flex flex-wrap gap-1">
              {p.ausencia ? <button className="tor-btn" onClick={() => void cancelarAusencia(p)}>Cancelar ausência</button> : <button className="tor-btn" onClick={() => setAusencia(p)}>Marcar ausência</button>}
              {permissoes?.editar && <button className="tor-btn" disabled={p.ativas === 0} title={p.ativas === 0 ? "Nada a mover" : undefined} onClick={() => setMover(p)}>Mover carteira</button>}
              <button className="tor-btn" disabled={ocupado} onClick={() => void simular(p)}>Simular saída</button>
            </div>
          </div>
        ))}
      </div>

      <label className="small flex items-center gap-2 mb-3">Dias da simulação de saída
        <input type="number" min={1} max={365} className="tor-in" style={{ width: 80 }} value={diasSim} onChange={(e) => setDiasSim(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />
      </label>

      {sim && (
        <div className="tor-card pad" style={{ borderLeft: "4px solid var(--warning)" }}>
          <h2 className="font-extrabold">Simulação: se {sim.nome} sair {sim.dias} dias</h2>
          <div className="mt-2 leading-relaxed">{sim.texto}</div>
          <div className="small mt-1">Nada foi gravado. Aplicar registra a ausência (com o sucessor sugerido) e move a carteira ao sucessor — o que ele é apto a executar.</div>
          <div className="mt-3 flex gap-2">
            {permissoes?.editar && <button className="tor-btn pri" disabled={ocupado} onClick={() => void aplicar()}>Aplicar: marcar ausência e mover carteira</button>}
            <button className="tor-btn" onClick={() => setSim(null)}>Fechar</button>
          </div>
        </div>
      )}

      <div className="tor-card pad">
        <h2 className="font-extrabold">Previsão de carga · próximas 4 semanas (vencimentos por pessoa)</h2>
        <div style={{ overflowX: "auto" }}>
        <div className="tor-prev com-extras mt-3">
          <div />{dados.previsao.semanas.map((s) => <div key={s.inicio} className="small">{curto(s.inicio)}–{curto(s.fim)}</div>)}
          <div className="small">Vencidas</div><div className="small">Depois</div><div className="small">Sem prazo</div><div className="small"><b>Abertas</b></div>
          {dados.previsao.linhas.map((l) => (
            <PrevisaoLinha key={l.usuarioId ?? "sem"} linha={l} />
          ))}
        </div>
        </div>
        <div className="small mt-2">Conta os prazos das tarefas abertas de cada pessoa em cada semana, a partir de hoje. O que fica fora das 4 semanas aparece ao lado (vencidas, depois da 4ª semana, sem prazo): as quatro semanas + essas três colunas fecham com o total de abertas da pessoa.</div>
      </div>

      {ausencia && <AusenciaModal pessoa={ausencia} onFechar={() => setAusencia(null)} onFeito={(msg) => { setAusencia(null); avisar(msg); atualizar() }} />}
      {mover && <MoverModal origem={mover} pessoas={dados.pessoas} onFechar={() => setMover(null)} onFeito={(msg, d) => { setMover(null); avisar(msg, d); atualizar() }} />}
    </div>
  )
}

function PrevisaoLinha({ linha }: { linha: LinhaPrevisao }) {
  return (
    <>
      <div><b>{linha.nome}</b></div>
      {linha.porSemana.map((c, i) => <div key={i} className={`tor-cell h${c.nivel}`}>{c.n || "·"}</div>)}
      <div className={`tor-cell ${linha.vencidas > 0 ? "h3" : "h0"}`}>{linha.vencidas || "·"}</div>
      <div className="tor-cell h0">{linha.depois || "·"}</div>
      <div className="tor-cell h0">{linha.semPrazo > 0 ? `sem prazo (${linha.semPrazo})` : "·"}</div>
      <div className="tor-cell h0"><b>{linha.total}</b></div>
    </>
  )
}

function AusenciaModal({ pessoa, onFechar, onFeito }: { pessoa: Pessoa; onFechar: () => void; onFeito: (msg: string) => void }) {
  const [tipo, setTipo] = useState("AUSENCIA")
  const [de, setDe] = useState("")
  const [ate, setAte] = useState("")
  const [motivo, setMotivo] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const enviar = async () => {
    setEnviando(true); setErro(null)
    const r = await api<{ sucessorSugerido?: { nome: string } | null }>("/api/operacao/capacidade", "PATCH", {
      acao: "indisponibilizar", usuarioId: pessoa.usuarioId, tipo,
      ...(de ? { inicio: `${de}T00:00:00-03:00` } : {}), ...(ate ? { fim: `${ate}T23:59:59-03:00` } : {}), motivo: motivo.trim() || undefined,
    })
    setEnviando(false)
    if (r.ok) onFeito(`Ausência de ${pessoa.nome} registrada${r.data.sucessorSugerido ? ` · sucessor sugerido: ${r.data.sucessorSugerido.nome}` : ""} — nada foi movido.`)
    else setErro(erroDe(r.data))
  }
  return (
    <Modal titulo={`Marcar ausência · ${pessoa.nome}`} subtitulo="É só registro: o sistema sugere um sucessor, mas não move nenhuma tarefa sozinho." onFechar={onFechar} ocupado={enviando} rodape={<>
      <button className="tor-btn" onClick={onFechar} disabled={enviando}>Cancelar</button>
      <button className="tor-btn pri" onClick={() => void enviar()} disabled={enviando}>{enviando ? "Registrando…" : "Marcar ausência"}</button>
    </>}>
      <Campo rotulo="Tipo"><select className="tor-in w-full" value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS_AUSENCIA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="De (vazio = agora)"><input type="date" className="tor-in w-full" value={de} onChange={(e) => setDe(e.target.value)} /></Campo>
        <Campo rotulo="Até (opcional)"><input type="date" className="tor-in w-full" value={ate} onChange={(e) => setAte(e.target.value)} /></Campo>
      </div>
      <Campo rotulo="Motivo (opcional)"><input className="tor-in w-full" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
      {erro && <div className="text-[12px] rounded-lg px-3 py-2 bg-[var(--danger-tile)] text-[var(--danger-text)]">{erro}</div>}
    </Modal>
  )
}

function MoverModal({ origem, pessoas, onFechar, onFeito }: { origem: Pessoa; pessoas: Pessoa[]; onFechar: () => void; onFeito: (msg: string, d: Desfazer | null) => void }) {
  const [para, setPara] = useState("")
  const [naoAptas, setNaoAptas] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const enviar = async () => {
    setEnviando(true); setErro(null)
    const r = await api<{ mensagem?: string; para?: { nome: string }; movidas?: number; total?: number; naoAptas?: number; falhas?: number; desfazer?: Desfazer | null }>("/api/torre/equipe/mover-carteira", "POST", { deUsuarioId: origem.usuarioId, paraUsuarioId: para ? Number(para) : null, incluirNaoAptas: naoAptas })
    setEnviando(false)
    if (r.data && typeof r.data.movidas === "number") onFeito(`${r.data.movidas} de ${r.data.total} tarefa(s) de ${origem.nome} movida(s) para ${r.data.para?.nome}${r.data.naoAptas ? ` · ${r.data.naoAptas} ficaram (destino não apto)` : ""}${r.data.falhas ? ` · ${r.data.falhas} falharam` : ""}.`, r.data.desfazer ?? null)
    else setErro(erroDe(r.data))
  }
  return (
    <Modal titulo={`Mover carteira · ${origem.nome}`} subtitulo={`Move as ${origem.ativas} tarefa(s) ativas — ação manual, auditada.`} onFechar={onFechar} ocupado={enviando} rodape={<>
      <button className="tor-btn" onClick={onFechar} disabled={enviando}>Cancelar</button>
      <button className="tor-btn pri" onClick={() => void enviar()} disabled={enviando}>{enviando ? "Movendo…" : "Mover carteira"}</button>
    </>}>
      <Campo rotulo="Destino">
        <select className="tor-in w-full" value={para} onChange={(e) => setPara(e.target.value)}>
          <option value="">Sucessor sugerido{origem.ausencia?.sucessorSugerido ? ` (${origem.ausencia.sucessorSugerido.nome})` : ""}</option>
          {pessoas.filter((p) => p.usuarioId !== origem.usuarioId).map((p) => <option key={p.usuarioId} value={p.usuarioId}>{p.nome}</option>)}
        </select>
      </Campo>
      <label className="flex items-center gap-2 small"><input type="checkbox" checked={naoAptas} onChange={(e) => setNaoAptas(e.target.checked)} /> Incluir tarefas para as quais o destino não é apto</label>
      {erro && <div className="text-[12px] rounded-lg px-3 py-2 bg-[var(--danger-tile)] text-[var(--danger-text)]">{erro}</div>}
    </Modal>
  )
}
