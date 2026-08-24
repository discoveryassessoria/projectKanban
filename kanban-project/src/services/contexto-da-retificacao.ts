// src/services/contexto-da-retificacao.ts
//
// O QUE O OPERADOR PRECISA SABER PARA EXECUTAR ESTA ETAPA — lido dos donos.
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
// O modo, o advogado e o número do processo saíram do payload e foram morar no pedido;
// o protocolo mora em `Protocolo`; o órgão, em Órgãos e Organizações. Isso resolveu a
// segunda verdade e criou uma consequência: a tela deixou de ver o que ela precisa
// mostrar.
//
// A saída ERRADA seria copiar tudo de volta para o payload "só para a UI" — que é
// exatamente a segunda verdade voltando pela porta dos fundos, agora com a desculpa
// de ser projeção. A saída certa é esta: PROJETAR, a cada leitura, a partir de quem
// responde por cada fato.
//
// ─── CONTEXTUAL, NÃO DESPEJO ────────────────────────────────────────────────
// Nem toda etapa precisa de tudo. Quem vai protocolar não precisa do parecer da
// validação; quem valida precisa saber o que foi averbado. Cada bloco declara em
// QUAIS passos ele é relevante, e a etapa recebe só o que ajuda a fazer o que está
// na frente dela.

import { prisma } from "@/src/lib/prisma"

export interface BlocoDeContexto {
  chave: string
  titulo: string
  itens: Array<{ rotulo: string; valor: string; detalhe?: string | null }>
}

export interface ContextoDaRetificacao {
  pacoteId: number
  num: string
  blocos: BlocoDeContexto[]
}

/**
 * Quais blocos cada passo mostra.
 *
 * `"*"` = todo passo. A chave é do PASSO PUBLICADO, e não do código: um passo novo
 * que não esteja aqui simplesmente não ganha bloco extra — nunca quebra.
 */
const RELEVANCIA: Record<string, string[]> = {
  pedido: ["*"],
  judicial: ["definir_modo_de_retificacao", "preparar_requerimento_peticao", "protocolar_retificacao", "acompanhar_decisao"],
  protocolo: ["acompanhar_decisao", "registrar_averbacao", "validar_retificacao"],
  divergencias: ["definir_modo_de_retificacao", "preparar_requerimento_peticao", "validar_retificacao"],
}
const mostra = (bloco: string, stepKey: string) => {
  const onde = RELEVANCIA[bloco] ?? []
  return onde.includes("*") || onde.includes(stepKey)
}

/** `null` quando a etapa não pertence a um pedido de retificação. */
export async function contextoDaRetificacao(
  stepInstanceId: number,
): Promise<ContextoDaRetificacao | null> {
  const passo = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: stepInstanceId },
    select: { stepKey: true, retificacaoPacoteId: true },
  })
  if (!passo?.retificacaoPacoteId) return null

  const pacote = await prisma.retificacaoPacote.findUnique({
    where: { id: passo.retificacaoPacoteId },
    select: {
      id: true, num: true, tipo: true, status: true, motivo: true, processoNum: true,
      orgao: { select: { name: true, nomeFantasia: true, type: true, city: true, state: true, ativo: true } },
      profissional: {
        select: {
          nome: true, categoria: true, ativo: true,
          organizacao: { select: { name: true, nomeFantasia: true } },
          registros: { where: { ativo: true }, orderBy: { id: "asc" }, select: { tipo: true, numero: true, jurisdicao: true } },
        },
      },
      protocoloRef: { select: { numeroProtocolo: true, dataProtocolo: true, setor: true } },
      divergencias: {
        orderBy: { divergenciaId: "asc" },
        select: {
          divergencia: {
            select: { id: true, campoLabel: true, pessoaNome: true, documentoTitulo: true,
              valorArvore: true, valorDocumento: true, severidade: true },
          },
        },
      },
    },
  })
  if (!pacote) return null

  const blocos: BlocoDeContexto[] = []
  const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : "—")

  if (mostra("pedido", passo.stepKey)) {
    blocos.push({
      chave: "pedido", titulo: `Pedido ${pacote.num}`,
      itens: [
        // O MODO AINDA PODE NÃO TER SIDO DECIDIDO — e dizer isso é melhor que mostrar
        // um campo vazio que parece erro.
        { rotulo: "Modo", valor: pacote.tipo ?? "a definir" },
        { rotulo: "Situação", valor: pacote.status },
        ...(pacote.motivo ? [{ rotulo: "Motivo", valor: pacote.motivo }] : []),
        ...(pacote.orgao
          ? [{
              rotulo: "Órgão receptor",
              valor: pacote.orgao.nomeFantasia?.trim() || pacote.orgao.name,
              detalhe: [pacote.orgao.type, [pacote.orgao.city, pacote.orgao.state].filter(Boolean).join(" · "),
                pacote.orgao.ativo ? null : "inativo no cadastro"].filter(Boolean).join(" — ") || null,
            }]
          : []),
      ],
    })
  }

  // BLOCO JUDICIAL SÓ NA VIA JUDICIAL. Na administrativa ele não aparece vazio —
  // quem decide é o dado do pedido, não um `if` na tela.
  if (pacote.tipo === "judicial" && mostra("judicial", passo.stepKey)) {
    const p = pacote.profissional
    const registro = p?.registros[0]
      ? `${p.registros[0].tipo} ${p.registros[0].numero}${p.registros[0].jurisdicao ? `/${p.registros[0].jurisdicao}` : ""}`
      : null
    blocos.push({
      chave: "judicial", titulo: "Via judicial",
      itens: [
        { rotulo: "Processo", valor: pacote.processoNum ?? "a informar" },
        ...(p
          ? [{
              rotulo: "Responsável",
              valor: registro ? `${p.nome} — ${registro}` : p.nome,
              detalhe: [p.categoria, p.organizacao?.nomeFantasia || p.organizacao?.name,
                p.ativo ? null : "fora de circulação no cadastro"].filter(Boolean).join(" · ") || null,
            }]
          : [{ rotulo: "Responsável", valor: "a definir" }]),
      ],
    })
  }

  if (pacote.protocoloRef && mostra("protocolo", passo.stepKey)) {
    blocos.push({
      chave: "protocolo", titulo: "Protocolo",
      itens: [
        { rotulo: "Número", valor: pacote.protocoloRef.numeroProtocolo ?? "—" },
        { rotulo: "Data", valor: dia(pacote.protocoloRef.dataProtocolo) },
        ...(pacote.protocoloRef.setor ? [{ rotulo: "Vara / setor", valor: pacote.protocoloRef.setor }] : []),
      ],
    })
  }

  if (pacote.divergencias.length && mostra("divergencias", passo.stepKey)) {
    blocos.push({
      chave: "divergencias",
      titulo: `O que este pedido veio corrigir (${pacote.divergencias.length})`,
      itens: pacote.divergencias.map(({ divergencia: d }) => ({
        rotulo: d.campoLabel,
        valor: `${d.valorDocumento ?? "—"} → ${d.valorArvore ?? "—"}`,
        detalhe: [d.pessoaNome, d.documentoTitulo, d.severidade].filter(Boolean).join(" · "),
      })),
    })
  }

  return { pacoteId: pacote.id, num: pacote.num, blocos }
}
