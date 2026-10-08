"use client"
// src/components/torre/PainelTorreTarefa.tsx
// ============================================================================
// PAINEL ESPELHADO DA TAREFA — entra no `DocumentoOperationalDrawer` real (a superfície de TRABALHO: "Conferir"/"Abrir") pela prop
// `barraSuperiorExtra`. Bola com / status / prazo da tarefa / próxima cobrança / responsável, os passos e as ações do gestor. As ações
// são as MESMAS da gaveta da aba Tarefas (`ModalDaAcao`: justificativa de 5 letras que vai para o histórico) e cada uma chama uma
// porta existente — só aparece com a permissão dela.
// ============================================================================
import { useState } from "react"
import { AtalhoAbrirProcessoParaAtribuir } from "./AtalhoAbrirProcessoParaAtribuir"
import { relTxt, fmtData, statusTarefaCls } from "@/src/components/operacao/operacao-v3-derivacoes"
import { textoDaBola, textoDoCobrar, textoDoIniciou, statusDaLinha } from "@/lib/operacional/torre-tarefas-tela"
import { useTorre } from "./torre-base"
import type { LinhaTorre } from "./tipos"
import { temAcompanhamento } from "./tipos"
import { textoPrazoDaTarefa } from "@/src/lib/tarefa/texto-prazo"
import { ModalDaAcao } from "./TarefasModais"
import type { AcaoComModal } from "./tarefas-tipos"

export function PainelTorreTarefa({ linha, agora }: { linha: LinhaTorre; agora: Date }) {
  const { permissoes } = useTorre()
  const [aberto, setAberto] = useState<AcaoComModal | null>(null)
  const bola = textoDaBola(linha, agora)
  const cobrar = textoDoCobrar(linha.cobrarEm, agora)
  const st = statusDaLinha(linha)
  const concluida = linha.estadoOperacao === "CONCLUIDA"

  // O prazo/regra do PASSO ("Espera do passo") mora SÓ aqui — a coluna Prazo das tabelas é sempre o prazo da TAREFA.
  const passos = linha.passoAtual
  return (
    <div className="tor tor-painel" data-testid="painel-torre">
      <div className="tor-kv">
        <div><b>Aguardando</b><span className={`tor-p ${bola.comTerceiro ? "amb" : "blu"}`}>{bola.texto}</span></div>
        <div><b>Status</b><span className={`tor-p ${statusTarefaCls(linha).replace("opv3-p-", "")}`}>{st.texto}</span></div>
        <div><b>Prazo da tarefa</b>{textoPrazoDaTarefa(linha) || "—"}</div>
        {linha.regraTemporalPasso && !linha.regraTemporalPasso.semPrazo && <div><b>Espera do passo</b>{relTxt(linha.regraTemporalPasso)} · {fmtData(linha.regraTemporalPasso.dueAt)}</div>}
        <div><b>Próxima cobrança</b>{cobrar?.texto ?? "—"}</div>
        <div><b>Responsável</b>{linha.responsavelNome ?? "Sem responsável"}</div>
        <div><b>Iniciou em</b>{textoDoIniciou(linha)}</div>
      </div>
      {passos && (
        <div className="tor-passos" aria-label="Passos da tarefa">
          {Array.from({ length: passos.total }, (_, i) => (
            <div key={i} className={`tor-passo ${i < passos.ordem ? "done" : i === passos.ordem ? "cur" : ""}`}>
              {i + 1}/{passos.total}{i === passos.ordem && linha.passoCorrente ? ` · ${linha.passoCorrente.label}` : ""}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {/* ATRIBUIÇÃO SÓ NA PÁGINA DO PROCESSO: aqui só se vê o responsável atual e o atalho. */}
        {!concluida && permissoes?.editar && !linha.responsavelId && <AtalhoAbrirProcessoParaAtribuir processoId={linha.processoId} />}
        {!concluida && permissoes?.editar && <button className="tor-btn" onClick={() => setAberto("repactuar")}>Repactuar prazo</button>}
        {!concluida && permissoes?.bloquear && linha.statusTarefa !== "BLOQUEADA" && <button className="tor-btn" onClick={() => setAberto("bloquear")}>Bloquear com motivo</button>}
        {permissoes?.editar && <button className="tor-btn" onClick={() => setAberto("reabrir")}>Reabrir passo</button>}
        {temAcompanhamento(linha) && !concluida && <button className="tor-btn" onClick={() => setAberto("adiar")}>Adiar</button>}
        <button className="tor-btn" onClick={() => setAberto("ligacao")}>Registrar ligação</button>
        {!concluida && permissoes?.editar && <button className="tor-btn" onClick={() => setAberto("canal")}>Trocar canal</button>}
      </div>
      {aberto && <ModalDaAcao acao={aberto} linha={linha} agora={agora} onFechar={() => setAberto(null)} />}
    </div>
  )
}
