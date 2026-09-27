// scripts/relatorios-certidoes-extensao.test.ts
//
// EXTENSÃO DO DOMÍNIO "CERTIDÕES" (Central de Relatórios) — rodada "Relatório
// de Certidões", 27/09/2026. Novas colunas (protocolo, confirmado em, prazo +
// situação colorida, responsável, geração, município/UF do órgão), novos
// filtros (confirmado_em, responsavel, situacao_prazo) e a visão salva
// "Certidões solicitadas no período".
//
// SOMENTE LEITURA contra o banco real — nenhum teste aqui escreve.
import { DOMINIO_CERTIDOES, situacaoDoPrazo } from "@/src/lib/relatorios/motor/dominios/certidoes"
import { executar } from "@/src/lib/relatorios/motor/executar"
import { CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO, ehSubtarefaDeConfirmacaoDoPedido } from "@/src/lib/process-stage/subtarefa-confirmacao-pedido"

let ok = 0, falhou = 0
const falhas: string[] = []
const t = (cond: boolean, nome: string, detalhe = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}

const D = DOMINIO_CERTIDOES
const PROCESSO_CIBILS = 651

async function main() {
  console.log("EXTENSÃO DO DOMÍNIO CERTIDÕES\n")

  console.log("(1) Estrutura — sem colisão de chave:")
  t(new Set(D.filtros.map((f) => f.key)).size === D.filtros.length, "nenhuma chave de filtro repetida")
  t(new Set(D.colunas.map((c) => c.key)).size === D.colunas.length, "nenhuma chave de coluna repetida (achado real: 'responsavel' colidia)")
  for (const k of ["confirmado_em", "responsavel", "situacao_prazo"]) {
    t(D.filtros.some((f) => f.key === k), `filtro novo declarado: ${k}`)
  }
  for (const k of ["protocolo", "confirmado_em", "prazo", "situacao_prazo", "responsavel_tarefa", "geracao", "orgao_municipio_uf"]) {
    t(D.colunas.some((c) => c.key === k), `coluna nova declarada: ${k}`)
  }
  t(D.ordenacoes.some((o) => o.key === "familia_geracao"), "ordenação família+geração declarada")

  console.log("\n(2) subtarefa-confirmacao-pedido — papel semântico, não string solta:")
  t(CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO.length > 0, "constante não vazia", CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO.join(","))
  t(ehSubtarefaDeConfirmacaoDoPedido("receber_confirmacao_pedido"), "reconhece a key real de produção")
  t(!ehSubtarefaDeConfirmacaoDoPedido("enviar_requerimento_cartorio"), "não confunde com a subtarefa anterior")
  t(!ehSubtarefaDeConfirmacaoDoPedido(null), "null não quebra, só não bate")

  console.log("\n(3) situacaoDoPrazo — a régua canônica, 4 rótulos fixos:")
  const dias = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d }
  t(situacaoDoPrazo(null).rotulo === "Sem prazo" && situacaoDoPrazo(null).cor === "cinza", "sem Tarefa → Sem prazo/cinza")
  t(situacaoDoPrazo({ dataPrazo: null, dataConclusao: null, statusTarefa: null }).rotulo === "Sem prazo", "dataPrazo null → Sem prazo")
  const vencido = situacaoDoPrazo({ dataPrazo: dias(-3), dataConclusao: null, statusTarefa: "EM_ANDAMENTO" })
  t(vencido.rotulo === "Vencido" && vencido.cor === "vermelho", "prazo 3 dias atrás → Vencido/vermelho")
  const vence5 = situacaoDoPrazo({ dataPrazo: dias(5), dataConclusao: null, statusTarefa: "EM_ANDAMENTO" })
  t(vence5.rotulo === "Vence em até 7 dias" && vence5.cor === "amarelo", "prazo em 5 dias → Vence em até 7 dias/amarelo")
  const noPrazo = situacaoDoPrazo({ dataPrazo: dias(30), dataConclusao: null, statusTarefa: "EM_ANDAMENTO" })
  t(noPrazo.rotulo === "No prazo" && noPrazo.cor === "verde", "prazo em 30 dias → No prazo/verde")
  // Concluída CONGELA — mesma régua de tempo-operacional.ts: prazo vencido mas já concluída não é "Vencido" pra sempre.
  const concluidaComAtraso = situacaoDoPrazo({ dataPrazo: dias(-10), dataConclusao: dias(-2), statusTarefa: "CONCLUIDO_RECEBIDO" })
  t(concluidaComAtraso.rotulo !== "Vencido", "Tarefa CONCLUÍDA não aparece como Vencido (a régua canônica congela)", concluidaComAtraso.rotulo)

  console.log("\n(4) Contra o processo real (Cibils, id=651) — colunas novas não quebram e casam com o achado do Bug 3:")
  const r = await executar(D, {
    dominio: "certidoes",
    filtros: [{ key: "processo", valor: { tipo: "entidade", id: PROCESSO_CIBILS } }],
    colunas: ["tipo", "pessoa", "geracao", "protocolo", "confirmado_em", "orgao", "orgao_municipio_uf", "prazo", "situacao_prazo", "responsavel_tarefa"],
    porPagina: 50,
  })
  t(r.total === 20, "20 necessidades REGISTRO_CIVIL no Cibils (mesma contagem da investigação)", String(r.total))
  t(r.linhas.length === r.total, "nenhuma linha some ao pedir as colunas novas juntas")
  const geracoes = r.linhas.map((l) => l.celulas.find((c) => c.key === "geracao")?.valor).filter((v): v is string => v != null)
  t(geracoes.every((g) => /^G\d+$/.test(g)), "toda 'Geração' preenchida é G<número>", [...new Set(geracoes)].sort().join(","))
  const situacoes = r.linhas.map((l) => l.celulas.find((c) => c.key === "situacao_prazo"))
  t(situacoes.every((s) => ["Vencido", "Vence em até 7 dias", "No prazo", "Sem prazo"].includes(String(s?.valor))), "situação do prazo sempre um dos 4 rótulos")
  t(situacoes.every((s) => !s?.valor || ["vermelho", "amarelo", "verde", "cinza"].includes(String(s?.cor))), "toda situação preenchida tem cor")
  // Achado do Bug 3 (sessão 27/09): 6 Documentos deste processo têm
  // Documento.orgaoId nulo (texto livre em Documento.cartorio) — a coluna
  // "Município/UF do órgão" não pode inventar dado que o cadastro não tem.
  // Direto no Documento (não por nome de exibição — "Tapes" também é nome
  // real de um OrgaoProtocolo cadastrado, então casar por texto daria falso
  // positivo).
  const { prisma: prismaChk } = await import("@/lib/prisma")
  const docsSemOrgao = await prismaChk.documento.findMany({
    where: { necessidade: { processoId: PROCESSO_CIBILS }, orgaoId: null },
    select: { id: true, cartorio: true },
  })
  t(docsSemOrgao.length === 6, "6 Documentos do Cibils sem orgaoId (achado 5b)", String(docsSemOrgao.length))
  const colunaOrgaoUf = D.colunas.find((c) => c.key === "orgao_municipio_uf")!
  const linhaSinteticaSemOrgao = { documentos: [{ orgao: null, cartorio: "Bage" }] }
  t(colunaOrgaoUf.valor(linhaSinteticaSemOrgao) === null, "coluna município/UF: Documento sem orgao → null, nunca lê cartorio")
  const linhaSinteticaComOrgao = { documentos: [{ orgao: { city: "Tapes", state: "RS" }, cartorio: null }] }
  t(colunaOrgaoUf.valor(linhaSinteticaComOrgao) === "Tapes/RS", "coluna município/UF: Documento com orgao → city/state do cadastro")

  console.log("\n(5) Filtros novos não quebram o motor:")
  const rConfirmado = await executar(D, {
    dominio: "certidoes",
    filtros: [{ key: "confirmado_em", valor: { tipo: "intervalo_data", de: "2020-01-01", ate: "2030-12-31" } }],
  })
  t(Number.isFinite(rConfirmado.total), "filtro 'confirmado_em' roda sem erro", String(rConfirmado.total))

  const usuarios = await import("@/lib/prisma").then((m) => m.prisma.usuario.findFirst({ select: { id: true } }))
  if (usuarios) {
    const rResp = await executar(D, {
      dominio: "certidoes",
      filtros: [{ key: "responsavel", valor: { tipo: "entidade", id: usuarios.id } }],
    })
    t(Number.isFinite(rResp.total), "filtro 'responsavel' roda sem erro", String(rResp.total))
  }

  const rSituacao = await executar(D, {
    dominio: "certidoes",
    filtros: [{ key: "situacao_prazo", valor: { tipo: "multi_selecao", valores: ["SEM_PRAZO"] } }],
  })
  t(Number.isFinite(rSituacao.total), "filtro 'situacao_prazo' roda sem erro", String(rSituacao.total))

  console.log("\n(6) Visão salva 'Certidões solicitadas no período':")
  const visoes = D.visoesDoSistema
  const v = visoes.find((x) => x.key === "certidoes-solicitadas-periodo")
  t(!!v, "a visão existe no getter")
  if (v) {
    const filtroPeriodo = v.spec.filtros?.find((f) => f.key === "confirmado_em")
    t(filtroPeriodo?.valor.tipo === "intervalo_data", "filtro padrão é 'confirmado_em' por período")
    if (filtroPeriodo?.valor.tipo === "intervalo_data") {
      const hoje = new Date()
      const inicioEsperado = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
      t(filtroPeriodo.valor.de === inicioEsperado, "início = 1º dia do mês ATUAL (recalculado, não congelado)", `${filtroPeriodo.valor.de} vs esperado ${inicioEsperado}`)
    }
    t(v.spec.agruparPor === "familia", "agrupada por Família")
    t(JSON.stringify(v.spec.colunas) === JSON.stringify(["confirmado_em", "pessoa", "geracao", "tipo", "protocolo", "orgao", "orgao_municipio_uf", "prazo", "responsavel_tarefa"]),
      "colunas na ordem pedida")
    t(v.spec.ordenarPor === "familia_geracao" && v.spec.direcao === "asc", "ordenação família → geração, ascendente")
    const rv = await executar(D, { dominio: "certidoes", ...v.spec })
    t(Number.isFinite(rv.total), "a visão roda de ponta a ponta sem erro", `total=${rv.total} (mês atual, todo o sistema)`)
  }

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${ok} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => {
  const { prisma } = await import("@/lib/prisma")
  await prisma.$disconnect()
})
