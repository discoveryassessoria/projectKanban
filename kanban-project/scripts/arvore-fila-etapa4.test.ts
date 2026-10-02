// scripts/arvore-fila-etapa4.test.ts
// ============================================================================
// ETAPA 4 DA REFORMA DA ÁRVORE — A ABA OPERAÇÃO É A FILA DE TRABALHO DA PESSOA.
//
// Trava:
//   1. O ESTADO DO DOCUMENTO VEM DO DADO (a projeção oficial da certidão) e o
//      mapeamento situação → rótulo é fechado: nada é inventado, o que não mapeia
//      (conferido) não aparece, e sem projeção o item NÃO entra.
//   2. A AÇÃO LEVA AO ALVO REAL: a tarefa certa do documento (a aberta mais recente;
//      nunca cancelada), a pessoa envolvida, ou o vínculo conjugal.
//   3. GRAIN: o item da fila é DOCUMENTO ou ACHADO — nunca tarefa (CLAUDE.md §4/§5).
//      Certidão de casamento é da UNIÃO e aparece para os dois cônjuges.
//   4. AS DIVERGÊNCIAS DO MOTOR ENTRAM NA MESMA FILA (inclusive "filho em comum sem
//      união" → "Registrar união").
//   5. COERÊNCIA COM A FASE: antes de Genealogia, a mensagem — pela fase REAL do
//      processo, nunca por literal de nome de fase.
//   6. UI: sem contadores, sem "Custos e receitas", botão de Próxima ação ligado,
//      "Não informado" clicável, casamento sem texto duplicado.
//
//   npx tsx scripts/arvore-fila-etapa4.test.ts
//   node scripts/ci/gate-build.mjs --suite todas --so arvore-fila-etapa4
// ============================================================================
import { readFileSync } from "node:fs"

import { construirGrafo } from "@/src/lib/genealogia/motor/grafo"
import { analisarArvore } from "@/src/lib/genealogia/motor/analisar"
import type { PessoaEntrada, UniaoEntrada } from "@/src/lib/genealogia/motor/tipos"
import { achadosDoMotorPorPessoa } from "@/src/lib/genealogia/operacional/achados-do-motor"
import {
  estadoDoDocumento,
  linkDaTarefaNaCentral,
  mensagemAntesDaGenealogia,
  montarFilaDaPessoa,
  tarefaDestinoDaNecessidade,
  ROTULO_ESTADO_DOCUMENTO,
  type EntradaFila,
  type ItemDocumento,
  type NecessidadeDaFila,
  type TarefaDaFila,
} from "@/src/lib/genealogia/operacional/fila-da-pessoa"
import { PREFIXO_UNIAO_IMPLICITA, PREFIXO_CONJUGE_AUSENTE } from "@/src/lib/genealogia/motor/regras/sugestoes"
import { localDaUniao, rotuloTipoDaUniao } from "@/src/lib/genealogia/uniao-rotulos"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (c: boolean, n: string, extra: unknown = "") => {
  const e = extra === "" || extra == null ? "" : ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}`
  if (c) { passou++; console.log(`  ✅ ${n}${e}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${e}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
/** Tira comentários de linha e de bloco — o que sobra é CÓDIGO. */
const codigo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

// ── fábricas ────────────────────────────────────────────────────────────────
let seq = 0
const nec = (o: Partial<NecessidadeDaFila> & { nome?: string }): NecessidadeDaFila => ({
  id: ++seq,
  pessoaId: 10,
  uniaoId: null,
  status: "PENDENTE",
  obrigatoriedade: "OBRIGATORIA",
  itemCatalogo: { id: 1, code: "X", name: o.nome ?? "Certidão de nascimento" },
  situacaoCertidao: "NAO_LOCALIZADA",
  ...o,
})
const tar = (necessidadeId: number | null, o: Partial<TarefaDaFila> = {}): TarefaDaFila => ({
  id: ++seq, titulo: "t", concluida: false, statusTarefa: "NAO_INICIADA", necessidadeId, ...o,
})
const entrada = (o: Partial<EntradaFila>): EntradaFila => ({
  pessoaId: 10, processoId: 700, faseAtualKey: "qualquer", necessidades: [], tarefas: [], uniaoIdsDaPessoa: [], achados: [], ...o,
})

// ═══ 1) ESTADO DO DOCUMENTO: mapeamento fechado, vindo do dado ═══════════════
secao("1) estado do documento: situação oficial → rótulo da fila")

const caso = (status: NecessidadeDaFila["status"], situacao: NecessidadeDaFila["situacaoCertidao"]) =>
  estadoDoDocumento({ status, situacaoCertidao: situacao })
ok(caso("PENDENTE", "NAO_LOCALIZADA") === "a_localizar", "registro ainda não localizado → A localizar")
ok(caso("PENDENTE", "NAO_SOLICITADA") === "a_solicitar", "localizado, nada enviado → A solicitar")
ok(caso("EM_ATENDIMENTO", "PENDENTE") === "solicitado", "requerimento enviado → Solicitado")
ok(caso("EM_ATENDIMENTO", "SOLICITADO") === "solicitado", "cartório confirmou o pedido → Solicitado")
ok(caso("ATENDIDA", "RECEBIDA") === "recebido", "certidão chegou → Recebido")
ok(caso("DISPENSADA", "DISPENSADA") === "dispensado", "deixou de se aplicar → Dispensado")
ok(caso("NAO_LOCALIZADA", "NAO_LOCALIZADA") === "bloqueado", "marcada como não localizada → Bloqueado (mesma régua do indicador documental)")
ok(caso("NAO_LOCALIZADA", "RECEBIDA") === "bloqueado", "bloqueado vale mesmo com outra situação projetada")
ok(caso("PENDENTE", null) === null && caso("PENDENTE", undefined) === null, "SEM projeção oficial o estado não é inventado (null)")
ok(!Object.values(ROTULO_ESTADO_DOCUMENTO).some((r) => /confer/i.test(r)), "'conferido' NÃO existe: a projeção oficial não o distingue de Recebido (lacuna registrada, não inventada)")
ok(Object.keys(ROTULO_ESTADO_DOCUMENTO).length === 6, "seis estados, todos derivados de dado", Object.values(ROTULO_ESTADO_DOCUMENTO).join(" / "))

{
  const n = nec({ situacaoCertidao: null })
  const f = montarFilaDaPessoa(entrada({ necessidades: [n] }))
  ok(f.itens.length === 0, "necessidade sem projeção não vira item (nada de palpite)")
}
{
  const it = montarFilaDaPessoa(entrada({ necessidades: [nec({ situacaoCertidao: "PENDENTE" })] })).itens[0] as ItemDocumento
  ok(/aguardando a confirmação do pedido/.test(it.detalhe ?? ""), "o detalhe do Solicitado diz que aguarda a confirmação", it.detalhe ?? "")
  const it2 = montarFilaDaPessoa(entrada({ necessidades: [nec({ situacaoCertidao: "SOLICITADO" })] })).itens[0] as ItemDocumento
  ok(/cartório confirmou/.test(it2.detalhe ?? ""), "e distingue 'cartório confirmou' de 'aguardando a confirmação'")
  ok(!/prazo|previs/i.test(it.detalhe ?? "") && !/previs/i.test(codigo(ler("src/lib/genealogia/operacional/fila-da-pessoa.ts"))), "a fila não mostra prazo nem previsão (a Árvore não tem prazo/SLA)")
}

// ═══ 2) AÇÃO: leva ao alvo real ══════════════════════════════════════════════
secao("2) ação: a tarefa certa do documento")

{
  const n = nec({ situacaoCertidao: "NAO_SOLICITADA" })
  const tGenealogia = tar(n.id, { concluida: true, statusTarefa: "CONCLUIDO_RECEBIDO" })
  const tEmissao = tar(n.id)
  const tCancelada = tar(n.id, { statusTarefa: "CANCELADA" })
  const tSuperseded = tar(n.id, { statusTarefa: "SUPERSEDIDA" })
  const alheia = tar(n.id + 999)
  const destino = tarefaDestinoDaNecessidade(n.id, [tGenealogia, tEmissao, tCancelada, tSuperseded, alheia])
  ok(destino?.id === tEmissao.id, "vai para a tarefa ABERTA (não a concluída, não a cancelada/superseded, não a de outro documento)")
  ok(tarefaDestinoDaNecessidade(n.id, [tGenealogia, tCancelada])?.id === tGenealogia.id, "sem aberta, cai na concluída mais recente")
  ok(tarefaDestinoDaNecessidade(n.id, [tCancelada, tSuperseded]) === null, "só cancelada → sem destino")
  const aberta1 = tar(n.id), aberta2 = tar(n.id)
  ok(tarefaDestinoDaNecessidade(n.id, [aberta1, aberta2])?.id === aberta2.id, "duas abertas: a mais recente")

  const f = montarFilaDaPessoa(entrada({ necessidades: [n], tarefas: [tGenealogia, tEmissao] }))
  const it = f.itens[0] as ItemDocumento
  const a = it.acoes[0]
  ok(a?.tipo === "abrir_tarefa" && a.tarefaId === tEmissao.id && a.processoId === 700 && a.rotulo === "Solicitar", "A solicitar → botão 'Solicitar' abre a tarefa certa", JSON.stringify(a))
  ok(f.proximo?.chave === it.chave, "e é a Próxima ação")
}
{
  const n = nec({ situacaoCertidao: "DISPENSADA", status: "DISPENSADA" })
  const f = montarFilaDaPessoa(entrada({ necessidades: [n], tarefas: [tar(n.id, { concluida: true })] }))
  ok((f.itens[0] as ItemDocumento).acoes.length === 0 && f.proximo === null, "Dispensado não tem botão e não é próxima ação")
}
{
  const n = nec({ situacaoCertidao: "NAO_LOCALIZADA" })
  const f = montarFilaDaPessoa(entrada({ necessidades: [n], tarefas: [] }))
  ok((f.itens[0] as ItemDocumento).acoes.length === 0 && f.proximo === null, "sem tarefa não há botão (nunca botão morto) e nada vira próxima ação")
}
ok(linkDaTarefaNaCentral(7, 9) === "/kanban?processoId=7&tab=central&taskId=9", "deep-link canônico da Central (o mesmo dos avisos)")

// ═══ 3) GRAIN: documento ou achado, nunca tarefa; casamento é da UNIÃO ═══════
secao("3) grain: o item é DOCUMENTO ou ACHADO")

{
  const nasc = nec({ nome: "Certidão de nascimento", pessoaId: 10 })
  const outraPessoa = nec({ nome: "Certidão de óbito", pessoaId: 11 })
  const casamento = nec({ nome: "Certidão de casamento", pessoaId: null, uniaoId: 55 })
  const soTarefa = tar(null, { titulo: "Tarefa solta, sem documento" })
  const f = montarFilaDaPessoa(entrada({
    necessidades: [nasc, outraPessoa, casamento],
    tarefas: [soTarefa, tar(nasc.id), tar(casamento.id)],
    uniaoIdsDaPessoa: [55],
  }))
  ok(f.itens.every((i) => i.tipo === "documento" || i.tipo === "divergencia"), "nenhum item é tarefa")
  ok(f.itens.length === 2, "tarefa solta não vira item; documento de OUTRA pessoa não entra", f.itens.map((i) => i.chave).join(","))
  ok(f.itens.some((i) => i.tipo === "documento" && i.necessidadeId === casamento.id), "a certidão de casamento (da UNIÃO) aparece para o cônjuge")
  ok(!f.itens.some((i) => i.tipo === "documento" && i.necessidadeId === outraPessoa.id), "o documento de outra pessoa não vaza")
  const fFora = montarFilaDaPessoa(entrada({ necessidades: [casamento], uniaoIdsDaPessoa: [] }))
  ok(fFora.itens.length === 0, "quem não é da união não vê a certidão dela")
}
{
  const c1 = nec({ nome: "Certidão de casamento", pessoaId: null, uniaoId: 1 })
  const c2 = nec({ nome: "Certidão de casamento", pessoaId: null, uniaoId: 2 })
  const nomes: Record<number, string> = { 1: "Ana", 2: "Bia" }
  const f = montarFilaDaPessoa(entrada({
    necessidades: [c1, c2], uniaoIdsDaPessoa: [1, 2], nomeDoConjugeDaUniao: (u) => nomes[u] ?? null,
  }))
  const nomesItens = f.itens.map((i) => (i.tipo === "documento" ? i.nome : ""))
  ok(nomesItens.includes("Certidão de casamento · com Ana") && nomesItens.includes("Certidão de casamento · com Bia"), "duas uniões = duas linhas, distintas pelo cônjuge (identidade por união, não por nome)", nomesItens.join(" | "))
}

// ═══ 4) DIVERGÊNCIAS DO MOTOR NA MESMA FILA ══════════════════════════════════
secao("4) divergências do motor entram na fila, com ações reais")

// Casal com filho em comum SEM união registrada (achado real do motor).
const PESSOAS: PessoaEntrada[] = [
  { id: 1, nome: "Giuseppe", sobrenome: "Rossi", sexo: "M", pais_nasc: "Itália", data_nasc: "1900-01-01", vivo: false, data_obito: "1970-01-01" },
  { id: 2, nome: "Carla", sobrenome: "Bianchi", sexo: "F", pais_nasc: "Itália", data_nasc: "1905-01-01", vivo: false, data_obito: "1975-01-01" },
  { id: 3, nome: "Marcos", sobrenome: "Rossi", sexo: "M", pais_nasc: "Brasil", data_nasc: "1940-01-01", paiId: 1, maeId: 2, requerente: "maior" },
]
const UNIOES: UniaoEntrada[] = []
void construirGrafo(PESSOAS, UNIOES)
const analise = analisarArvore(PESSOAS, UNIOES, { paisAlvo: "ITALIA", raizId: 3 })
const achadosPorPessoa = achadosDoMotorPorPessoa(analise)
const nomeDe = (id: number) => PESSOAS.find((p) => p.id === id)?.nome ?? `#${id}`
{
  const achados = achadosPorPessoa.get(1) ?? []
  const ach = achados.find((a) => a.id.startsWith(PREFIXO_UNIAO_IMPLICITA))
  ok(!!ach, "o motor real aponta o casal sem união", achados.map((a) => a.id).join(","))
  const f = montarFilaDaPessoa(entrada({ pessoaId: 1, achados, nomeDePessoa: nomeDe }))
  const it = f.itens.find((i) => i.tipo === "divergencia" && i.achadoId === ach!.id)
  ok(!!it, "a divergência é item da MESMA fila")
  const acoes = it?.acoes ?? []
  ok(acoes[0]?.tipo === "vincular_conjuge" && (acoes[0] as { outraPessoaId: number | null }).outraPessoaId === 2 && acoes[0].rotulo === "Registrar união",
    "primeira ação = Registrar união, já com o outro cônjuge", JSON.stringify(acoes[0]))
  ok(acoes.some((a) => a.tipo === "abrir_pessoa" && a.pessoaId === 2 && a.rotulo === "Abrir Carla"), "e 'Abrir <nome>' leva à outra pessoa")
  ok(f.proximo?.tipo === "divergencia", "sem documento pendente, uma divergência é a Próxima ação (a mais urgente)", f.proximo?.chave ?? "")
}
{
  // sem outra pessoa: Ver no mapa
  const so = { id: "x-1", categoria: "divergencia" as const, severidade: "alto" as const, impeditivo: false, titulo: "t", explicacao: "e", acao: "a", pessoaIds: [10], pessoaId: 10, fonte: "f", peso: 5 }
  const f = montarFilaDaPessoa(entrada({ achados: [so] }))
  ok(f.itens[0].acoes[0]?.tipo === "ver_no_mapa", "achado só desta pessoa → 'Ver no mapa'")
  const ausente = { ...so, id: `${PREFIXO_CONJUGE_AUSENTE}10`, categoria: "relacao" as const }
  const f2 = montarFilaDaPessoa(entrada({ achados: [ausente] }))
  ok(f2.itens[0].acoes[0]?.tipo === "vincular_conjuge" && f2.itens[0].acoes[0].rotulo === "Vincular cônjuge", "'consta como casada, sem cônjuge' → Vincular cônjuge")
}
{
  // ORDEM: bloqueado > divergência crítica > a localizar > a solicitar > solicitado > divergência leve > recebido > dispensado
  const crit = { id: "c", categoria: "divergencia" as const, severidade: "critico" as const, impeditivo: true, titulo: "crit", explicacao: "e", acao: "a", pessoaIds: [10], pessoaId: 10, fonte: "f", peso: 90 }
  const leve = { ...crit, id: "l", severidade: "baixo" as const, impeditivo: false, titulo: "leve", peso: 10 }
  const ns = [
    nec({ situacaoCertidao: "DISPENSADA", status: "DISPENSADA", nome: "Dispensado" }),
    nec({ situacaoCertidao: "RECEBIDA", status: "ATENDIDA", nome: "Recebido" }),
    nec({ situacaoCertidao: "PENDENTE", nome: "Solicitado" }),
    nec({ situacaoCertidao: "NAO_SOLICITADA", nome: "ASolicitar" }),
    nec({ situacaoCertidao: "NAO_LOCALIZADA", nome: "ALocalizar" }),
    nec({ status: "NAO_LOCALIZADA", situacaoCertidao: "NAO_LOCALIZADA", nome: "Bloqueado" }),
  ]
  const f = montarFilaDaPessoa(entrada({ necessidades: ns, achados: [leve, crit], tarefas: ns.map((n) => tar(n.id)) }))
  const ordem = f.itens.map((i) => (i.tipo === "documento" ? i.nome : i.titulo)).join(",")
  ok(ordem === "Bloqueado,crit,ALocalizar,ASolicitar,Solicitado,leve,Recebido,Dispensado", "ordem de urgência determinística", ordem)
  ok(f.proximo?.tipo === "documento" && f.proximo.nome === "Bloqueado", "a Próxima ação é o bloqueio")
  const f2 = montarFilaDaPessoa(entrada({ necessidades: [...ns].reverse(), achados: [crit, leve], tarefas: ns.map((n) => tar(n.id)) }))
  ok(f2.itens.map((i) => (i.tipo === "documento" ? i.nome : i.titulo)).join(",") === ordem, "e não depende da ordem de chegada")
}

// ═══ 5) COERÊNCIA COM A FASE ═════════════════════════════════════════════════
secao("5) antes de Genealogia: mensagem, pela fase REAL")

{
  const antes = montarFilaDaPessoa(entrada({ faseAtualKey: "a_iniciar" }))
  ok(antes.antesDaGenealogia === true && antes.itens.length === 0, "processo em 'Aguardando fechamento' e sem exigência → antesDaGenealogia")
  const depois = montarFilaDaPessoa(entrada({ faseAtualKey: "genealogia" }))
  ok(depois.antesDaGenealogia === false, "já na Genealogia sem exigência continua sendo 'sem exigência' (a regra não exige nada) — não a mensagem")
  const comItem = montarFilaDaPessoa(entrada({ faseAtualKey: "a_iniciar", necessidades: [nec({})] }))
  ok(comItem.antesDaGenealogia === false, "se já existe exigência (legado), ela manda — a mensagem não esconde dado real")
  ok(mensagemAntesDaGenealogia("Genealogia") === "As exigências serão geradas quando o processo entrar em Genealogia.", "mensagem com o rótulo do CADASTRO")
  ok(/sair de Aguardando fechamento/.test(mensagemAntesDaGenealogia(null)), "sem rótulo no cadastro, cita a fase real em que o processo está")
  const mod = codigo(ler("src/lib/genealogia/operacional/fila-da-pessoa.ts"))
  ok(!/["']a_iniciar["']|["']genealogia["']/.test(mod), "o módulo não tem nome de fase por literal (usa fase-pre-contrato)")
  ok(/ehFaseAguardandoFechamento\(e\.faseAtualKey\)/.test(mod), "decide pela função canônica da fase")
}

// ═══ 6) UI: sem contadores, sem financeiro, botão ligado ═════════════════════
secao("6) UI da aba Operação")

const sidebarSrc = ler("src/components/arvore/pessoa-sidebar.tsx")
const sidebar = codigo(sidebarSrc)
const filaUi = codigo(ler("src/components/arvore/fila-da-pessoa.tsx"))
const viewSrc = ler("src/components/arvore/arvore-genealogica-view.tsx")
const view = codigo(viewSrc)
const hook = codigo(ler("src/components/arvore/inteligencia/use-arvore-operacional.ts"))
const detalhes = codigo(ler("src/components/arvore/pessoa-details-page.tsx"))

ok(!/rotulo="(Exig\.|Receb\.|Pend\.|Diverg\.|Tarefas)"/.test(sidebar + filaUi) && !/<Numero/.test(sidebar + filaUi), "os contadores Exig./Receb./Pend./Diverg./Tarefas saíram")
ok(!/Custos e receitas|BlocoValores|formatarTotal|Wallet/.test(sidebar), "'Custos e receitas' saiu da pessoa")
ok(/\/processos\/\$\{processoId\}\?tab=faturas/.test(sidebar) && /financeiroVisivel && processoId != null/.test(sidebar), "no lugar, só o link para o Financeiro do processo (com a permissão)")
ok(/impact|requerentes dependem desta pessoa/.test(filaUi), "a linha de impacto 'N requerentes dependem desta pessoa' continua no topo")
ok(/data-proxima-acao/.test(filaUi) && /onClick=\{\(\) => onExecutar\(acaoProxima\)\}/.test(filaUi), "Próxima ação é um BOTÃO que executa o alvo")
ok(!/\{dossie\.proximaAcao\}/.test(filaUi + sidebar), "e deixou de ser um parágrafo")
ok(/Fila de trabalho/.test(sidebar) && /<ListaDaFila/.test(sidebar) && !/DivergenciasDoMotor/.test(sidebar), "a aba tem a fila (as divergências não são mais uma lista à parte)")
for (const tipo of ["abrir_tarefa", "abrir_pessoa", "ver_no_mapa", "vincular_conjuge"]) {
  ok(new RegExp(`case "${tipo}"`).test(filaUi), `todo tipo de ação tem handler: ${tipo}`)
}
ok(/linkDoAvisoParaAdmin\(link, tipo\)/.test(filaUi) && /router\.push\(/.test(filaUi), "abrir tarefa navega pelo deep-link (Torre para admin)")
ok(/fila=\{selectedPersonId != null \? operacional\.filaDe\(selectedPersonId\)/.test(view) && /mensagemAntesDaGenealogia=\{operacional\.mensagemAntesDaGenealogia\}/.test(view), "a tela alimenta a fila e a mensagem")
ok(/onVincularConjuge=\{pode\('arvore\.criar'\) \? abrirVincularConjuge : undefined\}/.test(view), "o vínculo conjugal só aparece com permissão de criar")
ok(/filaDe,/.test(hook) && /montarFilaDaPessoa\(/.test(hook), "o hook monta a fila pela função pura")
ok(/acaoDisponivel/.test(filaUi) && /destinos\.onVincularConjuge/.test(filaUi), "botão sem destino não é desenhado (sem botão morto)")

const rota = codigo(ler("src/app/api/processos/[processoId]/genealogia/operacional/route.ts"))
ok(/projecoesDeCertidaoPorNecessidade\(/.test(rota) && /situacaoCertidao:/.test(rota), "o endpoint entrega a situação da certidão pela projeção oficial (não recalcula)")
ok(/faseAtualKey: processo\?\.faseAtualKey/.test(rota) && /catalogoFase\.findUnique/.test(rota), "e a fase real + o rótulo da fase destino lido do cadastro")

// ═══ 7) PÁGINA DA PESSOA ═════════════════════════════════════════════════════
secao("7) página da pessoa: 'Não informado' clicável; casamento sem duplicata")

ok(rotuloTipoDaUniao("casamento") === null && rotuloTipoDaUniao("Casamento") === null && rotuloTipoDaUniao(null) === null, "tipo 'casamento' não repete o título")
ok(rotuloTipoDaUniao("casamento_civil") === "Civil" && rotuloTipoDaUniao("religioso") === "Religioso", "tipo que acrescenta informação sobrevive", `${rotuloTipoDaUniao("casamento_civil")}/${rotuloTipoDaUniao("religioso")}`)
ok(localDaUniao({ local: "Caxias do Sul", estado: "RS", pais: "Brasil" }) === "Caxias do Sul, RS, Brasil" && localDaUniao({}) === "", "local do casamento: o que existe na União")
ok(!/casamento\.tipo &&/.test(detalhes) && /rotuloTipoDaUniao\(casamento\.tipo\)/.test(detalhes), "a página usa o rótulo sem duplicata")
ok(/data-preencher/.test(detalhes) && /Não informado — preencher/.test(detalhes), "campo vazio vira atalho clicável")
ok(/onEditar=\{pode\('arvore\.editar'\)/.test(view) && /setCampoEdicaoInicial\(campo\)/.test(view) && /campoInicial=\{campoEdicaoInicial\}/.test(view), "o atalho abre a edição da pessoa já focando o campo (e só com permissão)")
const campos = ["sexo", "data_nasc", "pais_nasc", "cidade_nasc", "nacionalidade", "data_obito", "local_obito", "data_casamento", "local_casamento"]
for (const c of campos) {
  ok(viewSrc.includes(`data-campo="${c}"`) && detalhes.includes(`"${c}"`), `campo '${c}': o formulário e a página falam do mesmo nome`)
}
ok(/Data não informada — preencher/.test(detalhes) && /localDaUniao\(casamento\)/.test(detalhes), "data e local do casamento aparecem no vínculo do casal (ou o atalho de preencher)")

// ═══ 8) VINCULAR CÔNJUGE — porta oficial ═════════════════════════════════════
secao("8) vincular cônjuge pela porta oficial")

const rotaUniao = codigo(ler("src/app/api/unioes/route.ts"))
ok(/Number\(pessoa1Id\) === Number\(pessoa2Id\)/.test(rotaUniao), "a mesma pessoa é recusada")
ok(/pessoa1\.arvoreId !== pessoa2\.arvoreId/.test(rotaUniao), "só pessoas da mesma árvore")
ok(/marcarCasados === true[\s\S]{0,200}tx\.pessoa\.updateMany/.test(rotaUniao), "o estado civil é gravado NA transação da união (tx, nunca prisma global)")
ok(/idempotente === true/.test(rotaUniao), "idempotência explícita")
ok(/aplicarMudancaNaArvore/.test(rotaUniao), "a união continua passando por aplicarMudancaNaArvore")
ok(/comandoVincularConjuges\(dados, http\)/.test(view) && /historicoRef\.current\.registrar\(comando\)/.test(view), "o vínculo entra no histórico (Ctrl+Z) e usa as rotas oficiais")
ok(/Desfazer/.test(view.slice(view.indexOf("executarVinculoConjugal"), view.indexOf("executarVinculoConjugal") + 1400)), "e avisa com 'Desfazer'")

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
