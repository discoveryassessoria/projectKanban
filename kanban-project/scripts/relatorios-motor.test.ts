// scripts/relatorios-motor.test.ts
//
// O MOTOR DE RELATÓRIOS, CONTRA O BANCO REAL.
//
// A prova que interessa não é "a tela abriu": é o usuário conseguir mudar a
// pergunta sem que ninguém escreva um relatório novo. Cada bloco abaixo é uma
// pergunta diferente feita ao MESMO domínio, pelo MESMO motor.
//
// SOMENTE LEITURA — nenhum teste aqui escreve.
import { prisma } from "@/lib/prisma"
import { DOMINIO_PROTOCOLOS } from "@/src/lib/relatorios/motor/dominios/protocolos"
import { DOMINIO_CERTIDOES } from "@/src/lib/relatorios/motor/dominios/certidoes"
import { executar, exportarCsv } from "@/src/lib/relatorios/motor/executar"
import { nacionalidadesOfertadas, paisesGeograficos } from "@/src/lib/relatorios/motor/opcoes"
import { DOMINIOS, dominioPorChave } from "@/src/lib/relatorios/motor/registro"
import type { QuerySpec } from "@/src/lib/relatorios/motor/tipos"

let ok = 0, falhou = 0
const falhas: string[] = []
const t = (cond: boolean, nome: string, detalhe = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}
const D = DOMINIO_PROTOCOLOS
const spec = (p: Partial<QuerySpec> = {}): QuerySpec => ({ dominio: "protocolos", filtros: [], ...p })

async function main() {
  console.log("MOTOR DE RELATÓRIOS — PROTOCOLOS É O DOMÍNIO DE PROVA\n")

  console.log("Estrutura do motor:")
  t(DOMINIOS.length > 0 && dominioPorChave("protocolos") === D, "o domínio está registrado")
  t(D.grain === "1 linha = 1 protocolo", "grain declarado", D.grain)
  t(new Set(D.filtros.map((f) => f.key)).size === D.filtros.length, "nenhuma chave de filtro repetida")
  t(new Set(D.colunas.map((c) => c.key)).size === D.colunas.length, "nenhuma chave de coluna repetida")
  t(D.colunasIniciais.every((k) => D.colunas.some((c) => c.key === k)), "toda coluna padrão existe")
  for (const d of DOMINIOS) {
    const inexistentes = d.filtrosPrincipais.filter((k) => !d.filtros.some((f) => f.key === k))
    t(inexistentes.length === 0, `${d.rotulo}: todo filtro principal existe`, inexistentes.join(", "))
    t(d.filtrosPrincipais.length > 0, `${d.rotulo}: declara filtros à mostra`)
    t(!!d.grupo, `${d.rotulo}: declara o grupo a que pertence`)
  }
  t(D.ordenacoes.some((o) => o.key === D.ordenacaoPadrao.key), "a ordenação padrão existe")

  // ── A PROVA DA NACIONALIDADE ──────────────────────────────────────────────
  console.log("\nPAÍS GEOGRÁFICO ≠ NACIONALIDADE OFERTADA:")
  const ofertadas = await nacionalidadesOfertadas()
  const geograficos = await paisesGeograficos()
  const brasil = await prisma.catalogoPais.findUnique({
    where: { countryKey: "brasil" },
    select: { id: true, countryLabel: true, _count: { select: { orgaoPaisCanonico: true, tiposDeProcesso: true } } },
  })
  t(!!brasil, "Brasil existe no cadastro de países")
  t((brasil?._count.orgaoPaisCanonico ?? 0) > 0, "Brasil tem órgãos", `${brasil?._count.orgaoPaisCanonico}`)
  t(!ofertadas.some((n) => n.valor === "brasil"),
    "Brasil NÃO aparece como nacionalidade ofertada", `ofertadas: ${ofertadas.map((n) => n.valor).join(", ")}`)
  t(geograficos.some((p) => p.rotulo === brasil?.countryLabel),
    "Brasil APARECE no filtro de país do órgão", `${geograficos.length} países geográficos`)
  t(geograficos.length >= ofertadas.length, "a geografia é mais ampla que a oferta",
    `${geograficos.length} geográficos × ${ofertadas.length} ofertadas`)
  const semOferta = geograficos.length - ofertadas.length
  t(semOferta > 0, "existe país geográfico sem oferta", `${semOferta}`)

  // ── CERTIDÃO × DOCUMENTO: A FRONTEIRA VALE PARA AS OPÇÕES TAMBÉM ─────────
  console.log("\nO filtro só oferece o que a consulta pode devolver:")
  const { opcoesDoCadastro } = await import("@/src/lib/relatorios/motor/opcoes")
  const opCert = await opcoesDoCadastro("itens_certidao")
  const opDoc = await opcoesDoCadastro("itens_nao_certidao")
  const nomesCert = opCert.map((o) => o.rotulo)
  t(opCert.length > 0, "Certidões oferece tipos", nomesCert.join(", "))
  // O filtro listava CNH e RG dentro de Certidões — tipos que a consulta nunca
  // traria, porque as linhas já são só de registro civil.
  t(!nomesCert.some((n) => /^(RG|CNH|Comprovante|Procuração)/i.test(n)),
    "Certidões NÃO oferece RG, CNH, comprovante nem procuração")
  const cruzam = opCert.filter((c) => opDoc.some((d) => d.valor === c.valor))
  t(cruzam.length === 0, "nenhum item aparece nos dois domínios ao mesmo tempo",
    cruzam.map((c) => c.rotulo).join(", "))

  // Toda opção ofertada precisa ser alcançável: filtrar por ela não pode dar
  // erro nem trazer linha de outro domínio.
  for (const o of opCert.slice(0, 5)) {
    const rc = await executar(DOMINIO_CERTIDOES, {
      dominio: "certidoes", filtros: [{ key: "tipo", valor: { tipo: "multi_selecao", valores: [o.valor] } }], porPagina: 1,
    })
    t(rc.ignorados.length === 0, `filtrar Certidões por "${o.rotulo}" é aceito`)
  }

  // ── AS PERGUNTAS A–L ──────────────────────────────────────────────────────
  console.log("\nA MESMA CONSULTA, PERGUNTAS DIFERENTES:")
  const jan2023 = { key: "periodo_protocolo", valor: { tipo: "intervalo_data" as const, de: "2023-01-01", ate: "2023-01-31" } }

  const base = await executar(D, spec())
  t(base.total >= 0, "A. sem filtro — o domínio responde", `${base.total} protocolo(s)`)
  t(base.colunas.length === D.colunasIniciais.length, "colunas padrão aplicadas", `${base.colunas.length}`)

  const janeiro = await executar(D, spec({ filtros: [jan2023] }))
  t(janeiro.total <= base.total, "B. período estreita o resultado", `jan/2023: ${janeiro.total}`)
  t(janeiro.aplicados.some((a) => a.key === "periodo_protocolo"), "o período entra na consulta atual",
    janeiro.aplicados.find((a) => a.key === "periodo_protocolo")?.descricao)

  const italia = await executar(D, spec({ nacionalidade: "italia", filtros: [jan2023] }))
  t(italia.total <= janeiro.total, "C. nacionalidade + período", `${italia.total}`)
  t(italia.aplicados.some((a) => a.key === "__nacionalidade"), "a nacionalidade é contexto declarado")

  const orgao = await prisma.orgaoProtocolo.findFirst({ where: { ativo: true }, select: { id: true, name: true } })
  const porOrgao = await executar(D, spec({ filtros: [{ key: "orgao", valor: { tipo: "entidade", id: orgao!.id, rotulo: orgao!.name } }] }))
  t(porOrgao.total <= base.total, "D. por órgão", `${orgao!.name}: ${porOrgao.total}`)

  const eua = await prisma.catalogoPais.findUnique({ where: { countryKey: "estados_unidos" }, select: { id: true } })
  const cruzado = await executar(D, spec({
    nacionalidade: "italia",
    filtros: [{ key: "orgao_pais", valor: { tipo: "multi_selecao", valores: [String(eua!.id)] } }],
  }))
  t(cruzado.total <= base.total, "E. nacionalidade Itália + país do órgão Estados Unidos", `${cruzado.total}`)
  t(cruzado.aplicados.length === 2, "as duas dimensões de país convivem na mesma consulta")

  const exig = await executar(D, spec({ filtros: [{ key: "exigencia_aberta", valor: { tipo: "booleano", valor: true } }] }))
  t(exig.total <= base.total, "F. com exigência em aberto", `${exig.total}`)

  const parados = await executar(D, spec({ filtros: [{ key: "sem_movimentacao_dias", valor: { tipo: "numero", numero: 30 } }] }))
  t(parados.total <= base.total, "G. sem movimentação há 30 dias", `${parados.total}`)

  const porFamilia = await executar(D, spec({ agruparPor: "familia" }))
  t(porFamilia.grupos !== null, "H. agrupar por família não cria outro relatório",
    `${porFamilia.grupos?.length ?? 0} grupo(s)`)
  const soma = (porFamilia.grupos ?? []).reduce((s, g) => s + g.total, 0)
  t(soma === porFamilia.linhas.length, "os grupos cobrem exatamente as linhas da página", `${soma} = ${porFamilia.linhas.length}`)

  const porMes = await executar(D, spec({ agruparPor: "mes" }))
  t(porMes.grupos !== null, "I. agrupar por mês", `${porMes.grupos?.length ?? 0} grupo(s)`)

  const porOrgaoG = await executar(D, spec({ agruparPor: "orgao" }))
  t(porOrgaoG.grupos !== null, "J. agrupar por órgão", `${porOrgaoG.grupos?.length ?? 0} grupo(s)`)

  // ── CONSISTÊNCIA: COUNT = DETALHE = EXPORT ────────────────────────────────
  console.log("\nCONSISTÊNCIA — o mesmo número em toda parte:")
  const p1 = await executar(D, spec({ porPagina: 1, pagina: 1 }))
  t(p1.total === base.total, "o COUNT não muda com a paginação", `${p1.total} = ${base.total}`)
  t(p1.linhas.length <= 1, "a página respeita o tamanho pedido")

  const csv = await exportarCsv(D, spec())
  const linhasCsv = csv.trim().split("\n").length - 1
  t(linhasCsv === base.total, "K. o export traz exatamente o resultado filtrado", `${linhasCsv} = ${base.total}`)
  const csvJan = await exportarCsv(D, spec({ filtros: [jan2023] }))
  t(csvJan.trim().split("\n").length - 1 === janeiro.total, "L. o export respeita os filtros da tela",
    `${csvJan.trim().split("\n").length - 1} = ${janeiro.total}`)
  t(csv.split("\n")[0].split(";").length === base.colunas.length, "o cabeçalho do CSV é o das colunas da tela")

  // ── COLUNAS, ORDENAÇÃO, ENTRADAS INVÁLIDAS ────────────────────────────────
  console.log("\nColunas, ordenação e entrada inválida:")
  const colunas = await executar(D, spec({ colunas: ["data", "orgao", "situacao"] }))
  t(colunas.colunas.length === 3, "as colunas escolhidas mandam", colunas.colunas.map((c) => c.key).join(", "))

  const inventada = await executar(D, spec({ colunas: ["data", "coluna_que_nao_existe"] }))
  t(inventada.colunas.length === 1, "coluna inexistente é descartada, não quebra")

  const filtroFalso = await executar(D, spec({ filtros: [{ key: "nao_existe", valor: { tipo: "texto", texto: "x" } }] }))
  t(filtroFalso.ignorados.includes("nao_existe"), "filtro não declarado é IGNORADO e reportado")
  t(filtroFalso.total === base.total, "filtro inválido não estreita nem amplia silenciosamente")

  const vazio = await executar(D, spec({ filtros: [{ key: "periodo_protocolo", valor: { tipo: "intervalo_data", de: "1900-01-01", ate: "1900-01-02" } }] }))
  t(vazio.total === 0 && vazio.linhas.length === 0, "zero resultados é um resultado, não um erro")

  const asc = await executar(D, spec({ ordenarPor: "data", direcao: "asc" }))
  const desc = await executar(D, spec({ ordenarPor: "data", direcao: "desc" }))
  t(asc.total === desc.total, "a ordenação não muda o conjunto")
  if (base.total > 1) t(asc.linhas[0]?.id !== desc.linhas[0]?.id || base.total === 1, "asc e desc começam diferente")

  // ── VISÕES SALVAS ─────────────────────────────────────────────────────────
  console.log("\nVisões:")
  t(D.visoesDoSistema.length > 0, "existem visões prontas do sistema", `${D.visoesDoSistema.length}`)
  for (const v of D.visoesDoSistema) {
    const r = await executar(D, { ...v.spec, dominio: "protocolos" })
    t(r.total >= 0, `visão pronta "${v.nome}" executa`, `${r.total}`)
  }
  const reproduz1 = await executar(D, spec({ nacionalidade: "italia", filtros: [jan2023], agruparPor: "familia" }))
  const reproduz2 = await executar(D, spec({ nacionalidade: "italia", filtros: [jan2023], agruparPor: "familia" }))
  t(reproduz1.total === reproduz2.total, "a mesma QuerySpec devolve o mesmo resultado (visão é reproduzível)")

  // ── A BORDA DO PERÍODO ────────────────────────────────────────────────────
  // `new Date("2023-01-01")` é meia-noite UTC — 21h do dia 31 no Brasil. Um
  // relatório com essa borda continua devolvendo números, só que errados
  // justamente nos dias que alguém confere à mão.
  console.log("\nBorda de período (o filtro é DIA de calendário, não instante):")
  const { inicioDoDia, fimDoDia } = await import("@/src/lib/relatorios/motor/datas")
  const ini = inicioDoDia("2023-01-01")
  const fim = fimDoDia("2023-01-31")
  t(ini.getDate() === 1 && ini.getMonth() === 0 && ini.getHours() === 0,
    "o início do período é 00:00 do dia escolhido", ini.toLocaleString("pt-BR"))
  t(fim.getDate() === 31 && fim.getHours() === 23 && fim.getMinutes() === 59,
    "o fim do período é 23:59:59 do dia escolhido (ate é INCLUSIVO)", fim.toLocaleString("pt-BR"))
  const rotuloPeriodo = (await executar(D, spec({ filtros: [jan2023] }))).aplicados.find((a) => a.key === "periodo_protocolo")
  t(rotuloPeriodo?.descricao === "01/01/2023 – 31/01/2023", "a tela mostra o mesmo dia que o operador escolheu", rotuloPeriodo?.descricao)

  console.log(`\n${ok} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.error("FALHAS: " + falhas.join("; ")); process.exit(1) }
}
main().finally(() => prisma.$disconnect())
