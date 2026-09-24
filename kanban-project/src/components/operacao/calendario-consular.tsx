// src/components/operacao/calendario-consular.tsx
// ============================================================================
// CALENDÁRIO — só o desenho por enquanto (mandato 24/09/2026, explícito do
// usuário: "quero um calendario somente que nao vai vincular prazos... esse
// calendario vai somente aparecer os agendamentos consulares... vamos
// configurar isso depois... so faca o desenho do calendario agora").
//
// Sem fonte de dado ainda — NENHUM prazo de Tarefa entra aqui (não é o
// calendário de prazos operacionais; esse já existe como código morto em
// `visao-global.tsx` e continua fora de uso). A grade é 100% visual: navega
// mês a mês, marca hoje, e mostra o estado vazio explicando o que vai aparecer
// quando os agendamentos consulares forem configurados.
// ============================================================================
"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, CalendarPlus } from "lucide-react"

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]

function gradeDoMes(ano: number, mes: number): Array<{ dia: number; noMes: boolean; hoje: boolean }> {
  const hoje = new Date()
  const primeiroDiaSemana = new Date(ano, mes, 1).getDay()
  const diasNoMes = new Date(ano, mes + 1, 0).getDate()
  const diasNoMesAnterior = new Date(ano, mes, 0).getDate()

  const celulas: Array<{ dia: number; noMes: boolean; hoje: boolean }> = []
  for (let i = primeiroDiaSemana - 1; i >= 0; i--) {
    celulas.push({ dia: diasNoMesAnterior - i, noMes: false, hoje: false })
  }
  for (let dia = 1; dia <= diasNoMes; dia++) {
    celulas.push({
      dia, noMes: true,
      hoje: hoje.getFullYear() === ano && hoje.getMonth() === mes && hoje.getDate() === dia,
    })
  }
  while (celulas.length % 7 !== 0 || celulas.length < 42) {
    celulas.push({ dia: celulas.length - (primeiroDiaSemana + diasNoMes) + 1, noMes: false, hoje: false })
  }
  return celulas
}

export function CalendarioConsular() {
  const agora = new Date()
  const [ano, setAno] = useState(agora.getFullYear())
  const [mes, setMes] = useState(agora.getMonth())

  const celulas = useMemo(() => gradeDoMes(ano, mes), [ano, mes])
  const irParaHoje = () => { setAno(agora.getFullYear()); setMes(agora.getMonth()) }
  const mudarMes = (delta: number) => {
    let m = mes + delta, a = ano
    if (m < 0) { m = 11; a-- } else if (m > 11) { m = 0; a++ }
    setMes(m); setAno(a)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-page)]">
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">Calendário</h1>
            <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">Agendamentos consulares da operação.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={irParaHoje}
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
            >
              Hoje
            </button>
            <div className="flex items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)]">
              <button onClick={() => mudarMes(-1)} className="p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]" aria-label="Mês anterior">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[140px] px-2 text-center text-[13px] font-medium text-[var(--text-primary)]">{MESES[mes]} {ano}</span>
              <button onClick={() => mudarMes(1)} className="p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]" aria-label="Próximo mês">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
          <div className="grid grid-cols-7 border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)]">
            {DIAS_SEMANA.map((d) => (
              <div key={d} className="px-2 py-2 text-center text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {celulas.map((c, i) => (
              <div
                key={i}
                className={`flex min-h-[86px] flex-col gap-1 border-b border-r border-[var(--border-subtle)] px-2 py-1.5 [&:nth-child(7n)]:border-r-0 ${c.noMes ? "" : "bg-[var(--surface-secondary)]/40"}`}
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11.5px] tabular-nums ${
                    c.hoje ? "bg-[var(--action-primary)] font-semibold text-[var(--action-primary-ink)]"
                    : c.noMes ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                  }`}
                >
                  {c.dia}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--surface-elevated)] px-6 py-8 text-center">
          <CalendarPlus className="h-6 w-6 text-[var(--text-muted)]" />
          <p className="text-[13px] font-medium text-[var(--text-primary)]">Nenhum agendamento consular configurado ainda.</p>
          <p className="max-w-sm text-[12px] text-[var(--text-secondary)]">
            Este calendário vai mostrar os agendamentos consulares da operação — sem ligação com prazo de tarefa. A configuração vem em uma próxima etapa.
          </p>
        </div>
      </div>
    </div>
  )
}
