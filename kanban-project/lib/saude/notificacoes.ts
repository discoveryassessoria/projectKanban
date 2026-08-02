// lib/saude/notificacoes.ts
//
// NOTIFICAÇÃO DE SAÚDE — avisa quando algo merece atenção humana, sem virar spam.
//
// Regras anti-ruído:
//   • agrupa a rodada em UM aviso (não um por achado);
//   • cooldown: o mesmo incidente não é reavisado dentro da janela;
//   • incidente que continua igual ATUALIZA o aviso anterior em vez de criar outro;
//   • só notifica o que mudou de fato: crítico novo, erro novo, reincidência,
//     diagnóstico incompleto, fila parada ou piora do estado geral.
//
// O canal é a trilha de auditoria (LogAuditoria), que já é a fonte da Central e
// do Diário Operacional — nenhum canal paralelo é inventado aqui.

import { prisma } from '@/lib/prisma'
import type { ResultadoDiagnostico } from './tipos'
import type { ResumoPersistencia } from './persistencia'

const ENTIDADE = 'SAUDE'
const ACAO = 'SAUDE_INCIDENTE'
/** Janela em que o mesmo incidente não é reavisado. */
const COOLDOWN_MIN = 60

export interface ResultadoNotificacao {
  notificou: boolean
  motivo: string
  assinatura?: string
}

/** Identidade do incidente: mesma assinatura = mesmo incidente, não avisa de novo. */
function assinaturaDo(r: ResultadoDiagnostico): string {
  return [r.estado, r.criticos, r.erros, r.falhasTecnicas, r.naoExecutadas].join(':')
}

export async function notificarAchados(
  r: ResultadoDiagnostico,
  p: ResumoPersistencia,
): Promise<ResultadoNotificacao> {
  const merece =
    r.criticos > 0 ||
    r.falhasTecnicas > 0 ||
    p.novos > 0 ||
    p.reincidentes > 0 ||
    r.estado === 'DIAGNOSTICO_INCOMPLETO' ||
    r.estado === 'INDISPONIVEL'

  if (!merece) return { notificou: false, motivo: 'nada novo que exija atenção' }

  const assinatura = assinaturaDo(r)
  const desde = new Date(Date.now() - COOLDOWN_MIN * 60_000)
  const anterior = await prisma.logAuditoria.findFirst({
    where: { entidade: ENTIDADE, acao: ACAO, criadoEm: { gte: desde } },
    orderBy: { criadoEm: 'desc' },
    select: { id: true, detalhes: true },
  })

  const mesmoIncidente = (anterior?.detalhes as { assinatura?: string } | null)?.assinatura === assinatura
  if (mesmoIncidente) {
    // ATUALIZA o incidente em curso em vez de criar outro aviso idêntico.
    await prisma.logAuditoria.update({
      where: { id: anterior!.id },
      data: {
        detalhes: {
          assinatura,
          estado: r.estado,
          criticos: r.criticos, erros: r.erros, alertas: r.alertas,
          falhasTecnicas: r.falhasTecnicas, naoExecutadas: r.naoExecutadas,
          novos: p.novos, reincidentes: p.reincidentes, resolvidos: p.resolvidos,
          execucaoId: p.execucaoId,
          repeticoes: (((anterior!.detalhes as { repeticoes?: number } | null)?.repeticoes) ?? 1) + 1,
          atualizadoEm: new Date().toISOString(),
        },
      },
    })
    return { notificou: false, motivo: `incidente em curso atualizado (cooldown de ${COOLDOWN_MIN} min)`, assinatura }
  }

  const partes = [
    `Saúde do sistema: ${r.estado}`,
    r.criticos ? `${r.criticos} crítico(s)` : null,
    r.erros ? `${r.erros} erro(s)` : null,
    p.novos ? `${p.novos} novo(s)` : null,
    p.reincidentes ? `${p.reincidentes} reincidente(s)` : null,
    r.falhasTecnicas ? `${r.falhasTecnicas} verificação(ões) com falha técnica` : null,
    p.resolvidos ? `${p.resolvidos} resolvido(s)` : null,
  ].filter(Boolean)

  await prisma.logAuditoria.create({
    data: {
      acao: ACAO,
      entidade: ENTIDADE,
      entidadeId: p.execucaoId,
      descricao: partes.join(' · '),
      detalhes: {
        assinatura,
        estado: r.estado,
        motivoEstado: r.motivoEstado,
        criticos: r.criticos, erros: r.erros, alertas: r.alertas,
        falhasTecnicas: r.falhasTecnicas, naoExecutadas: r.naoExecutadas,
        novos: p.novos, reincidentes: p.reincidentes, resolvidos: p.resolvidos,
        execucaoId: p.execucaoId,
        repeticoes: 1,
      },
    },
  })

  return { notificou: true, motivo: partes.join(' · '), assinatura }
}
