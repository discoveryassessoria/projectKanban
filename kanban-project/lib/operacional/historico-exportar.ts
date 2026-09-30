// lib/operacional/historico-exportar.ts
// ============================================================================
// HISTÓRICO DO PROCESSO — o que vai para o CSV e para o PDF (módulo PURO).
//
// As duas exportações leem as MESMAS linhas, feitas dos MESMOS fatos que a tela
// mostra depois dos filtros (`filtrarFatos`). CSV: separador `;` e BOM (Excel em
// pt-BR); célula que começa com = + - @ (ou TAB) vira fórmula no Excel e é
// neutralizada com apóstrofo — a mesma proteção do CSV da Auditoria da Torre.
// ============================================================================
import type { FatoDoHistorico } from './historico-processo'
import { ROTULO_TIPO_DE_FATO } from './historico-processo'
import { dataHoraSP } from './historico-filtros'

export const CABECALHO_DA_EXPORTACAO = ['Quando', 'Quem', 'Tipo', 'Fato', 'Certidão', 'Pessoa', 'Fase', 'Passo', 'Motivo', 'Justificativa', 'Efeito', 'Automático', 'Qtd', 'Itens'] as const

/** Uma linha por cartão do histórico, na ordem da tela (mais recente primeiro). */
export function linhasDaExportacao(fatos: FatoDoHistorico[]): string[][] {
  return fatos.map((f) => [
    dataHoraSP(f.quando), f.quem.nome, ROTULO_TIPO_DE_FATO[f.tipo], f.frase, f.certidao ?? '', f.pessoa ?? '', f.fase ?? '', f.passo ?? '',
    f.motivo ?? '', f.justificativa ?? '', f.efeito ?? '', f.automatico ? 'sim' : 'não', String(f.quantidade),
    f.agrupadoDe.map((i) => `${dataHoraSP(i.quando)} ${[i.certidao, i.pessoa].filter(Boolean).join(' · ')}`.trim()).join(' | '),
  ])
}

/** Proteção de planilha: célula que começa com = + - @ vira fórmula no Excel. */
export function celulaSegura(v: string | null | undefined): string {
  let s = (v ?? '').replace(/\r?\n/g, ' ').trim()
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

export function csvDoHistorico(fatos: FatoDoHistorico[]): string {
  const corpo = [
    [...CABECALHO_DA_EXPORTACAO].map(celulaSegura).join(';'),
    ...linhasDaExportacao(fatos).map((l) => l.map(celulaSegura).join(';')),
  ].join('\r\n')
  return `﻿${corpo}\r\n`
}

export function nomeDoArquivo(processoNome: string, extensao: 'csv' | 'pdf', agora: Date): string {
  const slug = processoNome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'processo'
  return `historico-${slug}-${agora.toISOString().slice(0, 10)}.${extensao}`
}
