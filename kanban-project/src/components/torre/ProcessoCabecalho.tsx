"use client"
// src/components/torre/ProcessoCabecalho.tsx — trilha, cabeçalho, faixa de pausa e os três cartões do Detalhe do Processo
// (Próxima ação · Trava para avançar · Previsão). Só desenha o que `GET /api/torre/foco/{id}?detalhe=1` entregou.
import Link from "next/link"
import { urlArvoreDoProcesso } from "@/lib/operacional/navegacao"
import { textoTempoNaFase } from "@/lib/operacional/torre-predicados"
import { rotuloQuando, seloDoCabecalho } from "@/lib/operacional/torre-processo-puro"
import type { DetalheDoProcesso } from "@/lib/operacional/torre-foco"
import { fmtDataHora } from "./torre-base"

export interface PermissoesDoDetalhe { editar: boolean; bloquear: boolean; relatorio: boolean; forcarAvanco: boolean }

export function ProcessoCabecalho({ d, agora, perm, ocupado, onDistribuir, onRelatorio, onHistorico, onPausar, onReativar, onForcar }: {
  d: DetalheDoProcesso; agora: Date; perm: PermissoesDoDetalhe; ocupado: boolean
  onDistribuir: () => void; onRelatorio: () => void; onHistorico: () => void; onPausar: () => void; onReativar: () => void; onForcar: () => void
}) {
  const faseLabel = d.faseAtual.label
  const selo = seloDoCabecalho({ pausado: d.pausa != null, risco: d.cabecalho.risco?.nivel ?? null, numeros: d.numeros })
  const n = d.numeros.semResponsavel
  const desde = d.faseAtual.desde ? `desde ${rotuloQuando(d.faseAtual.desde, agora, true)}` : "sem registro de quando entrou na fase"
  const meta = [
    d.pais ?? "—", d.codigo ?? "—",
    `${d.cabecalho.requerentes} ${d.cabecalho.requerentes === 1 ? "requerente" : "requerentes"}`,
    d.cabecalho.abertoEm ? `aberto em ${fmtDataHora(d.cabecalho.abertoEm)}` : "abertura sem registro",
  ].join(" · ")
  const fase = d.cabecalho.faseNumero != null ? `Fase ${d.cabecalho.faseNumero} de ${d.cabecalho.faseTotal}` : "Fase fora do caminho cadastrado"
  const t = d.trava
  const pa = d.proximaAcao

  return (
    <>
      <nav className="tpr-crumb" aria-label="Trilha">
        <Link href="/torre?aba=hoje">Torre de Controle</Link><span>›</span>
        {d.faseAtual.key ? <Link href={`/torre?aba=familias&fase=${encodeURIComponent(d.faseAtual.key)}`}>{faseLabel ?? "Processos"}</Link> : <Link href="/torre?aba=familias">Processos</Link>}
        <span>›</span><b>{d.familiaNome}</b>
      </nav>

      <div className="tpr-cab">
        <div className="tpr-avatar" aria-hidden>{d.cabecalho.inicial}</div>
        <div className="tpr-cab-txt">
          <div className="tpr-cab-lin1">
            <h1 className="tpr-titulo">{d.familiaNome}</h1>
            <span className="tpr-12 tpr-mut">{meta}</span>
            <span className={`tpr-selo ${selo.tom}`} title={d.cabecalho.risco?.motivo}>{selo.rotulo}</span>
          </div>
          <div className="tpr-13 tpr-mut">
            {fase} · {faseLabel ?? "—"} · {desde}{d.faseAtual.desde && textoTempoNaFase(d.faseAtual) !== "—" ? ` (${textoTempoNaFase(d.faseAtual)})` : ""} · {d.certidoes.recebidas} de {d.certidoes.requeridas} certidões recebidas
          </div>
          {/* Os mesmos quatro números e a mesma conta do antigo "Foco da família" (`d.numeros`, vindo de `torre-foco.ts`). */}
          <div className="tpr-nums" aria-label="Números do processo">
            {([["Abertas", d.numeros.abertas], ["Vencidas", d.numeros.vencidas], ["Aguardando terceiros", d.numeros.comCartorio], ["Sem responsável", d.numeros.semResponsavel]] as const).map(([rotulo, valor]) => (
              <span key={rotulo} className="tpr-num" title={rotulo === "Aguardando terceiros" ? "Toda tarefa aberta esperando resposta de fora, com ou sem responsável (o filtro da aba Tarefas). Na Visão geral, as sem responsável contam em 'Sem responsável'." : undefined}>
                <b>{valor}</b>{rotulo}
              </span>
            ))}
          </div>
        </div>
        <div className="tpr-acoes">
          <button type="button" className="tpr-btn pri" disabled={ocupado || !perm.editar || n === 0} onClick={onDistribuir}
            title={!perm.editar ? "Seu perfil não atribui tarefas." : n === 0 ? "Todas as tarefas abertas já têm responsável." : "Distribui por aptidão e carga, só para quem tem aptidão comprovada."}>
            {n > 0 ? `Distribuir as ${n}` : "Distribuir"}
          </button>
          <button type="button" className="tpr-btn" disabled={!perm.relatorio} onClick={onRelatorio} title={perm.relatorio ? undefined : "Seu perfil não tem acesso ao módulo de Relatórios."}>Relatório de controle</button>
          <button type="button" className="tpr-btn" onClick={onHistorico}>Histórico completo</button>
          <Link className="tpr-btn" href={urlArvoreDoProcesso(d.processoId)}>Árvore e cadastro</Link>
          {d.pausa
            ? <button type="button" className="tpr-btn" disabled={ocupado || !perm.bloquear} onClick={onReativar}>Reativar processo</button>
            : <button type="button" className="tpr-btn mudo" disabled={ocupado || !perm.bloquear} onClick={onPausar} title={perm.bloquear ? undefined : "Seu perfil não pausa processos."}>Pausar processo</button>}
        </div>
      </div>

      {d.pausa && (
        <div className="tpr-pausa" role="status">
          <b>Pausado</b> desde {fmtDataHora(d.pausa.pausadoEm)}{d.pausa.pausadoPor ? ` por ${d.pausa.pausadoPor.nome}` : ""} — {d.pausa.motivo}. Fora do Radar e das contagens da Torre até você reativar; as tarefas continuam com quem as tem.
        </div>
      )}

      <div className="tpr-tres">
        <div className={`tpr-cartao ${pa?.urgente ? "vermelho" : ""}`}>
          <span className="rot">Próxima ação · obrigatória</span>
          <span className="tit">{pa ? pa.titulo : "—"}</span>
          <span className="sub">{pa ? pa.detalhe : "nenhuma tarefa aberta na fase atual"}</span>
        </div>
        <div className="tpr-cartao">
          <span className="rot">{t ? t.rotulo : "Trava para avançar"}</span>
          <span className="tit">{t ? t.titulo : "—"}</span>
          <span className="sub">{t ? t.detalhe : "o processo não tem fase atual no caminho"}</span>
          {t?.travado && perm.forcarAvanco && <button type="button" className="tpr-link" onClick={onForcar}>Avançar na marra</button>}
        </div>
        <div className="tpr-cartao">
          <span className="rot">Previsão · validade</span>
          <span className="tit">{d.previsao.titulo}</span>
          <span className="sub">{d.previsao.sub}</span>
        </div>
      </div>
    </>
  )
}
