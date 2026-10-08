// scripts/sincronizacao-registral-arvore.test.ts
// ============================================================================
// GUARDA (06/10/2026) — árvore ⇄ Dados Registrais da Genealogia + "Editar" dos Dados Registrais depois do passo concluído.
//   • vazio na árvore PREENCHE sozinho; diferente → vale o registro, com divergência resolvida e histórico antes → depois (quem, quando);
//   • a certidão de ÓBITO nunca altera o nascimento (cada evento só altera os seus campos);
//   • DESFAZER devolve o valor anterior e a sincronização não o reaplica;
//   • campo que veio do registro fica TRAVADO na árvore (a rota recusa a edição, 409); campo sem registro continua editável;
//   • notação equivalente ("SP" = "São Paulo", "São Paulo (Santo Amaro)" = "São Paulo") NÃO é divergência (não degrada o dado da árvore);
//   • EDITAR depois do passo concluído: motivo obrigatório, aviso de requerimento já enviado, histórico, sem reabrir passo / mudar fase, e dispara a sincronização.
//   node scripts/ci/gate-build.mjs --suite todas --so sincronizacao-registral-arvore
// ============================================================================
import { existsSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { criarPalco } from "./_fixture-arvore-fonte"
import {
  diferencasDoEvento, mesmoLugar, textoDoAvisoDeConflito, CAMPOS_SINCRONIZAVEIS, camposTravados, eventoDoTipoDeDocumento,
} from "../src/lib/genealogia/sincronizacao-registral"
import { avisoDoRequerimentoEnviado, motivoValido, mudancasDaEdicao, conflitosComArvore } from "../src/lib/genealogia/dados-registrais-edicao"

const MARCA = "SINCRG"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const dia = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

async function main() {
  exigirBancoDeTeste("sincronizacao-registral-arvore.test.ts")

  secao("A) Regras puras")
  const campo = (chave: string) => CAMPOS_SINCRONIZAVEIS.find((c) => c.chave === chave)!
  const reg = { data_evento: "1937-10-12", cidade_registro: "Santo André", estado_registro: "São Paulo", pais_registro: "Brasil" }
  const d1 = diferencasDoEvento("NASCIMENTO", reg, { data_nasc: new Date("1937-10-03T00:00:00Z"), local_nasc: null, estado_nasc: null, pais_nasc: null })
  ok("vazio na árvore → PREENCHER (cidade, estado, país)", d1.filter((d) => d.tipo === "PREENCHER").map((d) => d.campo.chave).sort().join() === "PESSOA.estado_nasc,PESSOA.local_nasc,PESSOA.pais_nasc")
  ok("data diferente → CONFLITO (a árvore diz 03/10/1937, o registro 12/10/1937)", d1.some((d) => d.tipo === "CONFLITO" && d.campo.chave === "PESSOA.data_nasc" && d.arvore === "1937-10-03" && d.registro === "1937-10-12"))
  ok("o aviso da tela diz exatamente: «A árvore diz 03/10/1937. Confirmar 12/10/1937 como data do nascimento?»", textoDoAvisoDeConflito(campo("PESSOA.data_nasc"), "1937-10-03", "1937-10-12") === "A árvore diz 03/10/1937. Confirmar 12/10/1937 como data do nascimento?")
  ok("a certidão de ÓBITO só mexe em campos do óbito (data, cidade, estado, país — nunca em campo de nascimento)", diferencasDoEvento("OBITO", reg, { data_obito: null, data_nasc: null, local_nasc: null }).every((d) => d.campo.evento === "OBITO") && diferencasDoEvento("OBITO", reg, {}).map((d) => d.campo.chave).sort().join() === "PESSOA.data_obito,PESSOA.estado_obito,PESSOA.local_obito,PESSOA.pais_obito")
  ok("a certidão de CASAMENTO só mexe nos campos da união", diferencasDoEvento("CASAMENTO", reg, { data_inicio: null }).every((d) => d.campo.alvo === "UNIAO"))
  ok("o registro VAZIO nunca apaga a árvore", diferencasDoEvento("NASCIMENTO", { data_evento: null, cidade_registro: "", estado_registro: " ", pais_registro: null }, { data_nasc: new Date("1937-10-03T00:00:00Z"), local_nasc: "Santo André" }).length === 0)
  ok("«SP» = «São Paulo» e «São Paulo (Santo Amaro)» = «São Paulo»: o MESMO lugar não é divergência", mesmoLugar({ origem: "estado_registro" }, "SP", "São Paulo") && mesmoLugar({ origem: "cidade_registro" }, "São Paulo (Santo Amaro)", "São Paulo") && !mesmoLugar({ origem: "cidade_registro" }, "Cravinhos", "Comacchio") && !mesmoLugar({ origem: "estado_registro" }, "SP", "Rio de Janeiro"))
  ok("o tipo do documento decide o evento", eventoDoTipoDeDocumento("CERTIDAO_NASCIMENTO_INTEIRO_TEOR") === "NASCIMENTO" && eventoDoTipoDeDocumento("CERTIDAO_OBITO") === "OBITO" && eventoDoTipoDeDocumento("CERTIDAO_CASAMENTO") === "CASAMENTO" && eventoDoTipoDeDocumento("PASSAPORTE") === null)
  ok("campos travados = os que o registro preencheu (e só do próprio evento)", [...camposTravados([{ evento: "NASCIMENTO", valores: reg }])].sort().join() === "PESSOA.data_nasc,PESSOA.estado_nasc,PESSOA.local_nasc,PESSOA.pais_nasc")
  ok("conflito na tela: só do que a árvore já tinha e difere", conflitosComArvore([{ chave: "PESSOA.data_nasc", rotulo: "data do nascimento", origem: "data_evento", tipo: "data", arvore: "1937-10-03" }, { chave: "PESSOA.local_nasc", rotulo: "cidade", origem: "cidade_registro", tipo: "texto", arvore: null }], { data_evento: "1937-10-12", cidade_registro: "Santo André" }).length === 1)

  secao("B) Editar: motivo e aviso do requerimento (puro)")
  const antes = { data_evento: new Date("1937-10-12T00:00:00Z"), livro: "A1" }
  const m = mudancasDaEdicao(antes, { data_evento: "1937-10-03", livro: "a1" })
  ok("a mudança traz antes → depois só do que mudou (livro em caixa alta não muda)", m.length === 1 && m[0].chave === "data_evento" && m[0].antes === "1937-10-12" && m[0].depois === "1937-10-03")
  ok("passo concluído: motivo OBRIGATÓRIO (≥ 10 caracteres)", !motivoValido(true, "").ok && !motivoValido(true, "curto").ok && motivoValido(true, "data do evento estava trocada com a do registro").ok)
  ok("passo não concluído: motivo opcional", motivoValido(false, "").ok)
  ok("requerimento já enviado: aviso «o pedido ao cartório já saiu … com 12/10/1937»", /O pedido ao cartório já saiu em 05\/10\/2026 com 12\/10\/1937 \(data do evento\)\. Nada será reenviado/.test(avisoDoRequerimentoEnviado("2026-10-05T12:00:00Z", m) ?? ""))
  ok("sem envio (ou sem mudança) não há aviso", avisoDoRequerimentoEnviado(null, m) === null && avisoDoRequerimentoEnviado("2026-10-05T12:00:00Z", []) === null)

  secao("C) No banco de teste — rotas e serviços reais")
  const P = criarPalco(MARCA)
  await P.montar()
  const { sincronizarDocumento, desfazerSincronizacao, divergenciasResolvidas, camposDoRegistro } = await import("../src/services/genealogia/sincronizar-com-registro")
  const { editarDadosRegistrais, contextoDeEdicao } = await import("../src/services/genealogia/editar-dados-registrais")
  const { historicoDoProcesso } = await import("../src/services/historico-processo")
  // A ponte `legacyEnumKey` do cadastro é o que dá o TIPO (nascimento/óbito) ao documento que o sistema materializa: os tipos do palco ganham a ponte.
  for (const [code, chave] of [[P.COD.NAS, "CERTIDAO_NASCIMENTO"], [P.COD.CAS, "CERTIDAO_CASAMENTO"], [P.COD.OBI, "CERTIDAO_OBITO"]] as const) {
    if (!(await prisma.tipoDocumentoCadastro.findFirst({ where: { legacyEnumKey: chave }, select: { id: true } }))) await prisma.tipoDocumentoCadastro.updateMany({ where: { code }, data: { legacyEnumKey: chave } })
  }
  const c = await P.novoCenario("sinc")
  await prisma.pessoa.update({ where: { id: c.titularId }, data: { data_nasc: new Date("1937-10-03T00:00:00Z"), estado_nasc: "SP", local_nasc: null, pais_nasc: null, profissao: "x" } })
  // Os documentos são os que o SISTEMA materializa a partir da árvore (documento órfão, sem necessidade, a árvore marca como «não exigido»): pessoa falecida → nascimento e óbito.
  await P.putPessoa(c.titularId, { vivo: false, documentacao: true })
  const doDoTipo = async (chave: string) => prisma.documento.findFirstOrThrow({ where: { pessoaId: c.titularId, documentType: { legacyEnumKey: chave }, status: { notIn: ["NAO_EXIGIDO", "CANCELADO"] }, necessidadeId: { not: null } }, select: { id: true } })
  const doc = await doDoTipo("CERTIDAO_NASCIMENTO")
  await prisma.documento.update({ where: { id: doc.id }, data: { data_evento: new Date("1937-10-12T00:00:00Z"), cidade_registro: "Santo André", estado_registro: "São Paulo", pais_registro: "Brasil", livro: "A1" } })
  const passoDe = (documentoId: number) => prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { documentoId, stepKey: "localizar_registro" }, select: { id: true, status: true } })
  const nasc = () => prisma.pessoa.findUniqueOrThrow({ where: { id: c.titularId }, select: { data_nasc: true, local_nasc: true, estado_nasc: true, pais_nasc: true, data_obito: true, profissao: true } })

  const s0 = await sincronizarDocumento(doc.id, P.adminId, "EDICAO_DOS_DADOS_REGISTRAIS")
  ok("ANTES do «Localizar registro» concluído, nada sincroniza (a edição é rascunho)", s0.aplicados.length === 0 && dia((await nasc()).data_nasc) === "1937-10-03")

  const passo = await passoDe(doc.id)
  await prisma.phaseWorkflowStepInstance.update({ where: { id: passo.id }, data: { status: "CONCLUIDO" } })
  const s1 = await sincronizarDocumento(doc.id, P.adminId, "CONCLUSAO_DO_REGISTRO")
  const n1 = await nasc()
  ok("ao CONCLUIR: vazio preenche (cidade, país) e o estado «SP» fica (mesmo lugar de «São Paulo»)", n1.local_nasc === "Santo André" && n1.pais_nasc === "Brasil" && n1.estado_nasc === "SP")
  ok("data diferente: a Genealogia SEMPRE prevalece — a sincronização automática grava 12/10 (era 03/10), como divergência resolvida", dia(n1.data_nasc) === "1937-10-12" && s1.aplicados.some((a) => a.tipo === "CONFLITO" && a.chave === "PESSOA.data_nasc"))
  // A escolha explícita (aviso, item a item): aí o registro vale (03/10 → 12/10), com divergência resolvida e histórico.
  const { sincronizarArvore } = await import("../src/services/genealogia/sincronizar-com-registro")
  await sincronizarArvore({ arvoreId: c.arvoreId, autorId: P.adminId, origem: "ESCOLHA_NO_AVISO", documentoId: doc.id, selecao: new Set([`PESSOA:${c.titularId}:PESSOA.data_nasc`]) })
  ok("escolha explícita: VALE O REGISTRO (03/10 → 12/10)", dia((await nasc()).data_nasc) === "1937-10-12")
  const logData = await prisma.logAuditoria.findFirst({ where: { acao: "SINCRONIZACAO_REGISTRAL", detalhes: { path: ["chave"], equals: "PESSOA.data_nasc" } }, select: { id: true, usuarioId: true, criadoEm: true, detalhes: true, entidade: true, entidadeId: true } })
  const det = (logData?.detalhes ?? {}) as Record<string, unknown>
  ok("histórico: antes → depois, quem e quando", !!logData && det.antes === "1937-10-03" && det.depois === "1937-10-12" && logData.usuarioId === P.adminId && logData.criadoEm instanceof Date && logData.entidade === "Processo" && logData.entidadeId === c.processoId)
  const dv = await divergenciasResolvidas(c.arvoreId)
  ok("registrada como DIVERGÊNCIA RESOLVIDA (visível na Inteligência da árvore): só a data (as notações equivalentes não contam)", dv.length === 1 && dv[0].rotulo === "data do nascimento" && dv[0].antes === "03/10/1937" && dv[0].depois === "12/10/1937" && !dv[0].desfeita)
  const hist = JSON.stringify(await historicoDoProcesso(c.processoId))
  ok("o Histórico do processo mostra a sincronização (antes → depois)", /sincronizou a árvore com a Genealogia/.test(hist) && /03\/10\/1937|1937-10-03/.test(hist))

  secao("Óbito não altera nascimento")
  const docObito = await doDoTipo("CERTIDAO_OBITO")
  await prisma.documento.update({ where: { id: docObito.id }, data: { data_evento: new Date("2001-02-03T00:00:00Z"), cidade_registro: "Outra Cidade", estado_registro: "Bahia", pais_registro: "Portugal" } })
  await prisma.phaseWorkflowStepInstance.update({ where: { id: (await passoDe(docObito.id)).id }, data: { status: "CONCLUIDO" } })
  await sincronizarDocumento(docObito.id, P.adminId, "CONCLUSAO_DO_REGISTRO")
  const n2 = await nasc()
  ok("a data do óbito vem da certidão de óbito", dia(n2.data_obito) === "2001-02-03")
  ok("nascimento INTACTO (cidade, país e data não viram os da certidão de óbito)", n2.local_nasc === "Santo André" && n2.pais_nasc === "Brasil" && dia(n2.data_nasc) === "1937-10-12" && n2.estado_nasc === "SP")

  secao("Campo travado na árvore (sentido único)")
  const travados = await camposDoRegistro(c.arvoreId)
  ok("os campos que vieram do registro estão travados", (travados.pessoas[c.titularId] ?? []).includes("PESSOA.data_nasc") && (travados.pessoas[c.titularId] ?? []).includes("PESSOA.local_nasc") && (travados.pessoas[c.titularId] ?? []).includes("PESSOA.data_obito"))
  const r1 = await P.putPessoa(c.titularId, { data_nasc: "1990-01-01T00:00:00.000Z" })
  ok("a rota da árvore RECUSA editar a data do nascimento (409 CAMPO_DO_REGISTRO)", r1.status === 409 && dia((await nasc()).data_nasc) === "1937-10-12", `status ${r1.status}`)
  const r2 = await P.putPessoa(c.titularId, { data_nasc: "1937-10-12T00:00:00.000Z", local_nasc: "Santo André", profissao: "médico" })
  ok("o MESMO valor passa (a tela reenvia o formulário inteiro) e campo SEM registro continua editável (profissão)", r2.status === 200 && (await nasc()).profissao === "médico", `status ${r2.status}`)

  secao("Desfazer")
  const d = await desfazerSincronizacao(logData!.id, P.adminId)
  ok("desfazer devolve o valor anterior da árvore (12/10 → 03/10)", d.ok && dia((await nasc()).data_nasc) === "1937-10-03")
  ok("a sincronização NÃO reaplica o que foi desfeito (mesmo valor do registro)", (await sincronizarDocumento(doc.id, P.adminId, "EDICAO_DOS_DADOS_REGISTRAIS")).aplicados.every((a) => a.chave !== "PESSOA.data_nasc") && dia((await nasc()).data_nasc) === "1937-10-03")
  ok("o campo desfeito sai da trava (volta a ser editável) e a divergência aparece como desfeita", !((await camposDoRegistro(c.arvoreId)).pessoas[c.titularId] ?? []).includes("PESSOA.data_nasc") && (await divergenciasResolvidas(c.arvoreId))[0]?.desfeita === true)
  ok("desfazer duas vezes é recusado", !(await desfazerSincronizacao(logData!.id, P.adminId)).ok)

  secao("Editar os Dados Registrais depois do passo concluído")
  const ctx0 = await contextoDeEdicao(doc.id)
  ok("o contexto sabe que o passo já foi concluído e que o pedido ainda não saiu", ctx0?.passoConcluido === true && ctx0.requerimentoEnviadoEm === null)
  const fase0 = (await prisma.processo.findUniqueOrThrow({ where: { id: c.processoId }, select: { faseAtualKey: true } })).faseAtualKey
  const semMotivo = await editarDadosRegistrais({ documentoId: doc.id, autorId: P.adminId, valores: { data_evento: "1937-10-03" } })
  ok("MOTIVO OBRIGATÓRIO (o registro já foi localizado)", !semMotivo.ok && semMotivo.codigo === "MOTIVO_OBRIGATORIO")
  ok("nada foi gravado sem o motivo", dia((await prisma.documento.findUniqueOrThrow({ where: { id: doc.id } })).data_evento) === "1937-10-12")

  await prisma.solicitacaoDocumento.create({ data: { documentoId: doc.id, processoId: c.processoId, pessoaId: c.titularId, faseMacroKey: "emissao_documental", canal: "EMAIL", dataEnvio: new Date("2026-10-05T12:00:00Z"), chaveIdempotencia: `${MARCA}-sol-${doc.id}` } })
  const avisado = await editarDadosRegistrais({ documentoId: doc.id, autorId: P.adminId, valores: { data_evento: "1937-10-03" }, motivo: "a data do evento estava trocada com a do registro" })
  ok("REQUERIMENTO JÁ ENVIADO: avisa antes de salvar («o pedido ao cartório já saiu … com 12/10/1937») e NÃO grava ainda", !avisado.ok && avisado.codigo === "REQUERIMENTO_JA_ENVIADO" && /já saiu .* com 12\/10\/1937/.test(avisado.mensagem) && dia((await prisma.documento.findUniqueOrThrow({ where: { id: doc.id } })).data_evento) === "1937-10-12")

  const feito = await editarDadosRegistrais({ documentoId: doc.id, autorId: P.adminId, valores: { data_evento: "1937-10-03", data_registro: "1937-10-12" }, motivo: "a data do evento estava trocada com a do registro", confirmouRequerimentoEnviado: true })
  const docDepois = await prisma.documento.findUniqueOrThrow({ where: { id: doc.id } })
  ok("depois do aviso confirmado, a edição grava (evento 03/10 e data do registro 12/10)", feito.ok && dia(docDepois.data_evento) === "1937-10-03" && dia(docDepois.data_registro) === "1937-10-12")
  ok("editar NÃO reabre o passo, NÃO muda a fase e NÃO cancela nada", (await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: passo.id } })).status === "CONCLUIDO" && (await prisma.processo.findUniqueOrThrow({ where: { id: c.processoId }, select: { faseAtualKey: true } })).faseAtualKey === fase0 && (await prisma.tarefa.count({ where: { processoId: c.processoId, statusTarefa: "CANCELADA" } })) === 0)
  const logEd = await prisma.logAuditoria.findFirst({ where: { acao: "DADOS_REGISTRAIS_EDITADOS" }, select: { usuarioId: true, criadoEm: true, detalhes: true } })
  const de = (logEd?.detalhes ?? {}) as Record<string, unknown>
  ok("histórico: antes → depois, quem, quando, MOTIVO e «pedido já saiu»", !!logEd && logEd.usuarioId === P.adminId && JSON.stringify(de.mudancas).includes("1937-10-12") && JSON.stringify(de.mudancas).includes("1937-10-03") && de.motivo === "a data do evento estava trocada com a do registro" && de.requerimentoJaEnviado === true && de.passoJaConcluido === true)
  ok("a edição DISPARA a sincronização com a árvore (data do nascimento da árvore = 03/10 = o registro, sem divergência nova)", dia((await nasc()).data_nasc) === "1937-10-03" && feito.ok)
  const hist2 = JSON.stringify(await historicoDoProcesso(c.processoId))
  ok("o Histórico do processo mostra «corrigiu os dados registrais» com o motivo", /corrigiu os dados registrais/.test(hist2) && /trocada com a do registro/.test(hist2))
  ok("edição sem mudança é recusada (SEM_MUDANCA)", (await editarDadosRegistrais({ documentoId: doc.id, autorId: P.adminId, valores: { data_evento: "1937-10-03" }, motivo: "sem mudança nenhuma aqui" }) as { ok: boolean; codigo?: string }).codigo === "SEM_MUDANCA")

  secao("D) A tela (ligações, sem botão morto)")
  const { readFileSync } = await import("node:fs")
  const ler = (f: string) => readFileSync(f, "utf8")
  const gaveta = ler("src/components/kanban/DocumentoOperationalDrawer.tsx"), modal = ler("src/components/kanban/documento/EditarDadosRegistrais.tsx"), arv = ler("src/components/arvore/arvore-genealogica-view.tsx")
  ok("aba Dados Registrais: botão «Editar» em qualquer fase, para quem tem processos.editar", /pode\("processos\.editar"\) && \(/.test(gaveta) && /data-testid="editar-dados-registrais"/.test(gaveta) && /<EditarDadosRegistrais documentoId=\{doc\.id\}/.test(gaveta))
  ok("o modal edita evento, localidade e referência (o órgão continua pelo «alterar»)", ["data_evento", "data_registro", "pais_registro", "estado_registro", "cidade_registro", "cartorio", "livro", "folha", "termo"].every((k) => modal.includes("CAMPOS_EDITAVEIS")) && /o órgão emissor continua pelo “alterar”/.test(modal))
  ok("o modal pede o motivo (passo concluído), avisa o requerimento enviado e, se o valor difere da árvore, abre a escolha (árvore · cadastro · cancelar)", /Motivo da correção \(obrigatório/.test(modal) && /aviso-requerimento-enviado/.test(modal) && /ModalConfirmacaoArvore/.test(modal) && /divergenciasDaResposta/.test(modal) && /Salvar mesmo assim/.test(modal))
  ok("salvar chama a rota de edição e o Desfazer da árvore existe no resultado", /dados-registrais`, \{\s*method: "PATCH"/.test(modal) && /sincronizacao-registral\/\$\{logId\}\/desfazer/.test(modal))
  ok("modal do passo «Localizar registro»: campo «Data do registro» e a escolha árvore · cadastro · cancelar ao receber o 409", /label="Data do registro"/.test(ler("src/components/kanban/workflow/EditorRegistralModal.tsx")) && /ModalConfirmacaoArvore/.test(ler("src/components/kanban/workflow/EditorRegistralModal.tsx")))
  ok("árvore: o botão «Sincronizar com a Genealogia» NÃO existe mais (a sincronização é automática)", !/botao-sincronizar-genealogia|SincronizarComGenealogiaModal|Sincronizar com a Genealogia/.test(arv) && !existsSync("src/components/arvore/sincronizar-com-genealogia.tsx") && !existsSync("src/app/api/arvore/[arvoreid]/sincronizacao/route.ts"))
  ok("árvore: campo que veio do registro aparece «do registro» e não se edita (TravaDoRegistro nos campos de nascimento, óbito e casamento)", (arv.match(/<TravaDoRegistro travado=/g) ?? []).length >= 7 && /do registro/.test(arv))
  ok("Inteligência da árvore lista as divergências resolvidas (com Desfazer)", /<DivergenciasResolvidas/.test(ler("src/components/arvore/inteligencia/painel-inteligencia.tsx")) && /Divergências resolvidas/.test(ler("src/components/arvore/inteligencia/divergencias-resolvidas.tsx")))
  ok("ganchos: conclusão do «Localizar registro» e edição dos dados registrais disparam a sincronização", /p\.stepKey === "localizar_registro"[\s\S]{0,200}sincronizarDocumento/.test(ler("src/services/documento-operacao.ts")) && /sincronizarDocumento\(documentoAtualizado\.id/.test(ler("src/app/api/documentos/[id]/route.ts")))
  ok("a árvore nunca cria, remove nem religa pessoa/união por esta sincronização", !/\.(create|delete|deleteMany|createMany|upsert)\(/.test(ler("src/services/genealogia/sincronizar-com-registro.ts").replace(/logAuditoria\.create/g, "")))

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} SINCRONIZAÇÃO REGISTRAL — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
}
main().catch((e) => { console.log(`  ❌ ERRO: ${String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(-700)}`); process.exit(1) }).finally(() => prisma.$disconnect())
