// ESTE ARQUIVO VAI EM: src/app/api/gerenciamento/politicas-prazo-sla/[id]/previa-calculo/route.ts
//
// POST - simula o cálculo com os parâmetros do RASCUNHO (ainda não
//        publicados) para uma data inicial informada — não exige política
//        publicada, é a prévia que a tela mostra ENQUANTO o usuário edita.
//        Nunca permite publicar sem antes mostrar isto (mandato: "não
//        permita publicar uma política inválida").

import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { prisma } from "@/lib/prisma"
import { calcularPrazoGeral, calcularAcompanhamento, classificarRisco, ehDiaUtilNoCalendario, type FeriadoCalendarioEntrada } from "@/lib/operacional/motor-prazo-sla"
import { validarParametrosVersao, type ParametrosVersaoInput } from "@/src/services/prazo-sla/politica-prazo-sla"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    await params // política existente ou nova (rascunho) — id só de contexto/URL
    const b = await request.json().catch(() => ({}))
    const p = b.parametros as ParametrosVersaoInput
    const dataInicial = b.dataInicial ? new Date(b.dataInicial) : new Date()

    const erros = validarParametrosVersao(p)
    if (erros.length > 0) return NextResponse.json({ valido: false, erros }, { status: 422 })

    let feriadosCustom: FeriadoCalendarioEntrada[] = []
    let calendarioNome = "Nacional (padrão)"
    if (p.calendarioChave) {
      const cal = await prisma.calendarioOficial.findUnique({ where: { chave: p.calendarioChave }, include: { feriados: { where: { ativo: true } } } })
      if (cal) {
        calendarioNome = cal.nome
        feriadosCustom = cal.feriados.map((f) => ({ data: f.data, recorrenteAnual: f.recorrenteAnual }))
      }
    }

    const contagem = { unidade: p.prazoUnidade, tratamentoFimDeSemana: p.tratamentoFimDeSemana, tratamentoFeriado: p.tratamentoFeriado, feriadosCustom }
    const prazoResultante = calcularPrazoGeral(dataInicial, { ...contagem, quantidade: p.prazoQuantidade, politicaDataNaoUtil: p.politicaDataNaoUtil, horarioLimite: p.horarioLimite })
    const primeiroAcompanhamento = calcularAcompanhamento(dataInicial, p.acompanhamentoPrimeiroDias, { unidade: p.acompanhamentoUnidade, tratamentoFimDeSemana: p.tratamentoFimDeSemana, tratamentoFeriado: p.tratamentoFeriado, feriadosCustom })
    const risco = classificarRisco(dataInicial, prazoResultante, p.riscoAntecedenciaDias)

    const feriadosConsiderados = feriadosCustom
      .filter((f) => prazoResultante && f.data <= prazoResultante)
      .map((f) => f.data.toISOString().slice(0, 10))

    return NextResponse.json({
      valido: true,
      dataInicial: dataInicial.toISOString(),
      prazoResultante,
      primeiroAcompanhamento,
      classificacaoRisco: risco,
      calendarioAplicado: calendarioNome,
      feriadosConsiderados,
      diaInicialEhUtil: ehDiaUtilNoCalendario(dataInicial, feriadosCustom),
      regraUtilizada: { unidade: p.prazoUnidade, quantidade: p.prazoQuantidade, eventoInicial: p.prazoEventoInicialChave, politicaDataNaoUtil: p.politicaDataNaoUtil },
    })
  } catch (error) {
    console.error("Erro ao calcular prévia:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
