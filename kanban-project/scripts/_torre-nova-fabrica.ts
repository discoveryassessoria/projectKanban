// scripts/_torre-nova-fabrica.ts — fábrica de `ProcessoDaTorre` para os testes PUROS do Radar e de Processos (sem banco).
import type { ProcessoDaTorre } from "../lib/operacional/torre-processos"
import { baldeDoRadar, situacaoDaFase, type NivelDeRisco } from "../lib/operacional/torre-risco"

export function processo(o: Partial<ProcessoDaTorre> & { id: number; nome: string; nivel?: NivelDeRisco; semDono?: boolean; fase?: string }): ProcessoDaTorre {
  const nivel = o.nivel ?? "no_ritmo"
  const semDono = o.semDono ?? false
  const { id, nome, fase, ...resto } = o
  return {
    processoId: id, familiaId: id, familiaNome: nome, pais: "Itália", codigo: `IT-${id}`,
    faseAtual: { key: fase ?? "emissao", label: fase ?? "Emissão" },
    diasNaFase: 10, naFase: { desde: "2026-09-20T12:00:00.000Z", origem: "AVANCO_DE_FASE", dias: 10, horas: 240 }, metaDias: 30,
    bola: { rotulo: "Equipe", dias: null }, risco: baldeDoRadar(nivel), nivelDeRisco: nivel, motivoDoRisco: "", situacao: situacaoDaFase(nivel, semDono), semDono, scoreMaximo: 0,
    requerentes: 2, numeros: { abertas: 3, vencidas: 0, comCartorio: 0, semResponsavel: 0 }, proximaAcao: null,
    tarefasDaFase: { abertas: 0, semResponsavel: 0, concluidas: 0, passos: [], ehCertidao: true }, celulas: [],
    ...resto,
  }
}
