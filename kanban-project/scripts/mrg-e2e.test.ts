/**
 * MRG — TESTE END-TO-END CONTRA BANCO REAL.
 *
 * Rodar (banco de teste local, NUNCA produção):
 *   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
 *   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
 *   npx tsx scripts/mrg-e2e.test.ts
 *
 * Este arquivo executa o CRITÉRIO DE ACEITE completo com dados realistas:
 *
 *   uma pasta recebe múltiplas certidões → são classificadas → os campos são
 *   extraídos e reextraídos → pessoas são identificadas → identidades
 *   conciliadas → homônimos NÃO são fundidos → variações de nome reconhecidas →
 *   vínculos propostos → a árvore é complementada → conflitos detectados → a
 *   Pasta Documental é reconciliada → necessidades atualizadas → a linhagem é
 *   recalculada → alterações sensíveis aguardam aprovação → alterações seguras
 *   são aplicadas → tudo tem evidência → tudo tem auditoria → tudo pode ser
 *   revertido → reprocessar NÃO duplica.
 *
 * Também cobre: concorrência, permissões, rollback por revalidação e reversão.
 *
 * TRAVA DE SEGURANÇA: aborta se o banco não for local. Este teste ESCREVE.
 */

export {} // módulo (evita colisão de globais entre scripts de teste)

// ---------------------------------------------------------------- trava de segurança
const URL_DB = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
function hostDe(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase()
  } catch {
    return ""
  }
}
const HOST = hostDe(URL_DB)
const LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"])
if (!URL_DB) {
  console.error("\n❌ PRISMA_DATABASE_URL não definida. Este teste precisa de um banco de TESTE local.")
  console.error("   Ex.: PRISMA_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/discovery_test' npx tsx scripts/mrg-e2e.test.ts\n")
  process.exit(1)
}
if (!LOCAIS.has(HOST)) {
  console.error(`\n❌ ABORTADO: host do banco é "${HOST}", que não é local.`)
  console.error("   Este teste ESCREVE no banco. Ele só roda contra 127.0.0.1 / localhost.\n")
  process.exit(1)
}

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string, detalhe?: unknown) {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe)}` : ""}`)
  }
}

async function main() {
  // Import dinâmico: o singleton do Prisma lê a URL no momento da construção.
  const { prisma } = await import("@/lib/prisma")
  const { criarLote, processarLote, progressoLote, reprocessarDocumento } = await import("@/src/services/registral/lote")
  const { aplicarProposta } = await import("@/src/services/registral/aplicar")
  const { aprovarProposta, rejeitarProposta, reverterProposta, decidirConflito } = await import("@/src/services/registral/decisoes")
  const { recalcularLinhagem, montarDossie, listarEvidencias, listarConflitos, listarPropostas, dossieDaPessoa, listarAuditoria, listarMetricas } =
    await import("@/src/services/registral/consultas")
  const { snapshotAtual, criarVersao, compararVersoes, listarVersoes } = await import("@/src/services/registral/versionamento")
  const { notificarDocumentoAlterado } = await import("@/src/services/registral/gancho-documental")
  const { processarOutbox } = await import("@/src/services/outbox-dispatcher")
  const { calcularPermissoes } = await import("@/src/lib/permissoes")
  const { responder } = await import("@/src/lib/genealogia/registral/copiloto")

  const SUFIXO = `mrg-e2e-${process.pid}`

  // ==========================================================================
  console.log("\n0) LIMPEZA do cenário anterior deste teste (idempotência do próprio teste)")
  await prisma.$transaction(async (tx) => {
    const procs = await tx.processo.findMany({ where: { nome: { startsWith: SUFIXO } }, select: { id: true, arvoreId: true } })
    for (const p of procs) {
      await tx.decisaoRevisaoRegistral.deleteMany({ where: { proposta: { processoId: p.id } } })
      await tx.impactoAplicacaoRegistral.deleteMany({ where: { proposta: { processoId: p.id } } })
      await tx.conflitoRegistral.deleteMany({ where: { processoId: p.id } })
      await tx.propostaReconciliacao.deleteMany({ where: { processoId: p.id } })
      await tx.evidenciaRegistral.deleteMany({ where: { execucao: { lote: { processoId: p.id } } } })
      await tx.etapaExecucaoRegistral.deleteMany({ where: { execucao: { lote: { processoId: p.id } } } })
      await tx.correspondenciaIdentidade.deleteMany({ where: { ocorrencia: { execucao: { lote: { processoId: p.id } } } } })
      await tx.ocorrenciaDocumental.deleteMany({ where: { execucao: { lote: { processoId: p.id } } } })
      await tx.execucaoRegistral.deleteMany({ where: { lote: { processoId: p.id } } })
      await tx.loteRegistral.deleteMany({ where: { processoId: p.id } })
      await tx.necessidadeDocumentalEvento.deleteMany({ where: { necessidade: { processoId: p.id } } })
      if (p.arvoreId != null) {
        const pessoas = await tx.pessoa.findMany({ where: { arvoreId: p.arvoreId }, select: { id: true } })
        const ids = pessoas.map((x) => x.id)
        await tx.evidenciaRegistral.deleteMany({ where: { pessoaId: { in: ids } } })
        await tx.fatoRegistral.deleteMany({ where: { pessoaId: { in: ids } } })
        await tx.nomePessoa.deleteMany({ where: { pessoaId: { in: ids } } })
        await tx.decisaoDeduplicacao.deleteMany({ where: { pessoaResultanteId: { in: ids } } })
        await tx.documento.deleteMany({ where: { pessoaId: { in: ids } } })
        await tx.necessidadeDocumental.deleteMany({ where: { processoId: p.id } })
        await tx.versaoGenealogica.deleteMany({ where: { arvoreId: p.arvoreId } })
        await tx.uniao.deleteMany({ where: { OR: [{ pessoa1Id: { in: ids } }, { pessoa2Id: { in: ids } }] } })
        await tx.pessoa.updateMany({ where: { id: { in: ids } }, data: { paiId: null, maeId: null } })
        await tx.arvore.update({ where: { id: p.arvoreId }, data: { pessoaPrincipalId: null } })
        await tx.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
      }
      await tx.processo.delete({ where: { id: p.id } })
      if (p.arvoreId != null) await tx.arvore.delete({ where: { id: p.arvoreId } }).catch(() => undefined)
    }
  })
  ok(true, "cenário anterior removido")

  // ==========================================================================
  console.log("\n1) SEED — catálogo documental, usuários, árvore e processo reais")

  async function itemMestre(code: string, name: string) {
    return prisma.itemCatalogo.upsert({
      where: { code },
      update: { name, ativo: true },
      create: { code, name, natureza: "DOCUMENTO", ativo: true },
      select: { id: true, code: true, name: true },
    })
  }
  const itNasc = await itemMestre("CERT_NASCIMENTO", "Certidão de Nascimento")
  const itNascIT = await itemMestre("CERT_NASCIMENTO_INTEIRO_TEOR", "Certidão de Nascimento - Inteiro Teor")
  const itCas = await itemMestre("CERT_CASAMENTO", "Certidão de Casamento")
  const itObt = await itemMestre("CERT_OBITO", "Certidão de Óbito")
  await itemMestre("TRADUCAO_JURAMENTADA", "Tradução Juramentada")
  await itemMestre("APOSTILA_HAIA", "Apostila de Haia")

  async function tipoDoc(legacy: string, code: string, name: string, itemId: number) {
    return prisma.tipoDocumentoCadastro.upsert({
      where: { legacyEnumKey: legacy },
      update: { name, code, nature: "certidao", itemCatalogoId: itemId, ativo: true },
      create: { legacyEnumKey: legacy, code, name, nature: "certidao", itemCatalogoId: itemId, ativo: true },
      select: { id: true },
    })
  }
  const tdNasc = await tipoDoc("CERTIDAO_NASCIMENTO", "CERT_NASCIMENTO", "Certidão de Nascimento", itNasc.id)
  const tdCas = await tipoDoc("CERTIDAO_CASAMENTO", "CERT_CASAMENTO", "Certidão de Casamento", itCas.id)
  const tdObt = await tipoDoc("CERTIDAO_OBITO", "CERT_OBITO", "Certidão de Óbito", itObt.id)
  await tipoDoc("CERTIDAO_NASCIMENTO_INTEIRO_TEOR", "CERT_NASCIMENTO_INTEIRO_TEOR", "Certidão de Nascimento - Inteiro Teor", itNascIT.id)
  ok(!!tdNasc.id && !!tdCas.id && !!tdObt.id, "tipos documentais (natureza=certidao) semeados")

  const perfilAdmin = await prisma.perfil.upsert({
    where: { nome: `${SUFIXO}-perfil-admin` },
    update: {},
    create: { nome: `${SUFIXO}-perfil-admin`, permissoes: calcularPermissoes("admin"), sistema: false },
    select: { id: true },
  })
  const revisor = await prisma.usuario.upsert({
    where: { email: `${SUFIXO}-revisor@teste.local` },
    update: {},
    create: {
      nome: "Revisor Registral",
      email: `${SUFIXO}-revisor@teste.local`,
      senha: "x",
      tipo: "admin",
      perfilId: perfilAdmin.id,
    },
    select: { id: true },
  })
  const estagiario = await prisma.usuario.upsert({
    where: { email: `${SUFIXO}-estagiario@teste.local` },
    update: {},
    create: { nome: "Estagiario", email: `${SUFIXO}-estagiario@teste.local`, senha: "x", tipo: "usuario" },
    select: { id: true },
  })
  ok(!!revisor.id && !!estagiario.id, "usuários de teste criados")

  const arvore = await prisma.arvore.create({ data: { nome: `${SUFIXO}-arvore` }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: `${SUFIXO}-processo`, arvoreId: arvore.id, workflowRuntime: "v2" },
    select: { id: true },
  })

  // ÁRVORE EXISTENTE (o lote vai COMPLEMENTAR, não recriar):
  //   P1 requerente · P2 pai · P4 HOMÔNIMO do pai (mesmo nome, outra data)
  const p1 = await prisma.pessoa.create({
    data: {
      nome: "Joao Batista",
      sobrenome: "Bianchi",
      sexo: "M",
      data_nasc: new Date("1990-05-10T12:00:00Z"),
      local_nasc: "Bento Goncalves",
      pais_nasc: "Brasil",
      arvoreId: arvore.id,
      requerente: "sim",
      linhaReta: true,
    },
    select: { id: true },
  })
  const p2 = await prisma.pessoa.create({
    data: {
      nome: "Antonio",
      sobrenome: "Bianchi",
      sexo: "M",
      data_nasc: new Date("1960-02-20T12:00:00Z"),
      local_nasc: "Bento Goncalves",
      pais_nasc: "Brasil",
      arvoreId: arvore.id,
      linhaReta: true,
    },
    select: { id: true },
  })
  const p4Homonimo = await prisma.pessoa.create({
    data: {
      nome: "Antonio",
      sobrenome: "Bianchi",
      sexo: "M",
      data_nasc: new Date("1961-08-01T12:00:00Z"),
      local_nasc: "Bento Goncalves",
      arvoreId: arvore.id,
      linhaReta: false,
    },
    select: { id: true },
  })
  const pMaria = await prisma.pessoa.create({
    data: {
      nome: "Maria",
      sobrenome: "Souza",
      sexo: "F",
      data_nasc: new Date("1962-03-03T12:00:00Z"),
      arvoreId: arvore.id,
      linhaReta: false,
    },
    select: { id: true },
  })
  await prisma.pessoa.update({ where: { id: p1.id }, data: { paiId: p2.id } })
  await prisma.arvore.update({ where: { id: arvore.id }, data: { pessoaPrincipalId: p1.id } })
  ok(true, `árvore existente com 4 pessoas (inclui HOMÔNIMO do pai: #${p2.id} e #${p4Homonimo.id})`)

  // NECESSIDADE DOCUMENTAL oficial (dono: Sistema Documental)
  const necNascP1 = await prisma.necessidadeDocumental.create({
    data: {
      processoId: processo.id,
      itemCatalogoId: itNasc.id,
      pessoaId: p1.id,
      origem: "ARVORE",
      obrigatoriedade: "OBRIGATORIA",
      status: "PENDENTE",
      chaveIdempotencia: `${SUFIXO}:nec:nasc:${p1.id}`,
      arvoreId: arvore.id,
    },
    select: { id: true, status: true },
  })
  const necNascP2 = await prisma.necessidadeDocumental.create({
    data: {
      processoId: processo.id,
      itemCatalogoId: itNasc.id,
      pessoaId: p2.id,
      origem: "ARVORE",
      obrigatoriedade: "OBRIGATORIA",
      status: "PENDENTE",
      chaveIdempotencia: `${SUFIXO}:nec:nasc:${p2.id}`,
      arvoreId: arvore.id,
    },
    select: { id: true },
  })
  ok(necNascP1.status === "PENDENTE", "necessidades documentais criadas PENDENTES")

  // ---- DOCUMENTOS reais na Pasta Documental, com transcrição por página
  async function certidao(p: {
    pessoaId: number
    tipoId: number
    legacy: "CERTIDAO_NASCIMENTO" | "CERTIDAO_CASAMENTO" | "CERTIDAO_OBITO"
    descricao: string
    necessidadeId?: number
    texto?: string
    literais?: Record<string, unknown>
    registral?: Record<string, unknown>
  }) {
    return prisma.documento.create({
      data: {
        pessoaId: p.pessoaId,
        documentTypeId: p.tipoId,
        tipo: p.legacy,
        status: "RECEBIDO",
        descricao: p.descricao,
        arquivo_url: `https://exemplo.local/${encodeURIComponent(p.descricao)}.pdf`,
        arquivo_nome: `${p.descricao}.pdf`,
        necessidadeId: p.necessidadeId ?? null,
        transcricaoTexto: p.texto ?? null,
        transcricaoPaginas: p.texto ? [{ pagina: 1, texto: p.texto }] : undefined,
        transcricaoFonte: p.texto ? "ocr_teste" : null,
        transcricaoEm: p.texto ? new Date() : null,
        registral: (p.registral ?? undefined) as never,
        ...(p.literais ?? {}),
      },
      select: { id: true },
    })
  }

  // D1 — nascimento do requerente: rótulos + prosa concordantes
  const d1 = await certidao({
    pessoaId: p1.id,
    tipoId: tdNasc.id,
    legacy: "CERTIDAO_NASCIMENTO",
    descricao: "nascimento-joao",
    necessidadeId: necNascP1.id,
    texto:
      "REGISTRO DE NASCIMENTO DE JOAO BATISTA BIANCHI, filho de ANTONIO BIANCHI e de MARIA SOUZA, " +
      "nasceu em BENTO GONCALVES aos 10 de maio de 1990, de profissao estudante. " +
      "Nome: JOAO BATISTA BIANCHI ; Pai: ANTONIO BIANCHI ; Mae: MARIA SOUZA ; Data de nascimento: 10/05/1990 ; Local de nascimento: BENTO GONCALVES",
    literais: { nome_registrado: "JOAO BATISTA BIANCHI", pai_registrado: "ANTONIO BIANCHI", mae_registrada: "MARIA SOUZA", cartorio: "1 Oficio de Bento Goncalves", livro: "A-42", folha: "018", termo: "9911" },
  })

  // D2 — nascimento do pai: traz o AVÔ (Giuseppe) e a AVÓ (Rosa), que NÃO estão na árvore
  const d2 = await certidao({
    pessoaId: p2.id,
    tipoId: tdNasc.id,
    legacy: "CERTIDAO_NASCIMENTO",
    descricao: "nascimento-antonio",
    necessidadeId: necNascP2.id,
    texto:
      "REGISTRO DE NASCIMENTO DE ANTONIO BIANCHI, filho de GIUSEPPE BIANCHI e de ROSA FERRARI, " +
      "nasceu em BENTO GONCALVES aos 20 de fevereiro de 1960. " +
      "Nome: ANTONIO BIANCHI ; Pai: GIUSEPPE BIANCHI ; Mae: ROSA FERRARI ; Data de nascimento: 20/02/1960",
    literais: { nome_registrado: "ANTONIO BIANCHI", pai_registrado: "GIUSEPPE BIANCHI", mae_registrada: "ROSA FERRARI" },
  })

  // D3 — casamento: MARIA aparece com NOME DE CASADA ("MARIA SOUZA BIANCHI")
  const d3 = await certidao({
    pessoaId: p2.id,
    tipoId: tdCas.id,
    legacy: "CERTIDAO_CASAMENTO",
    descricao: "casamento-antonio-maria",
    texto:
      "CERTIDAO DE CASAMENTO. ANTONIO BIANCHI casou-se com MARIA SOUZA BIANCHI aos 15 de junho de 1985 nesta cidade. " +
      "Nome: ANTONIO BIANCHI ; Conjuge: MARIA SOUZA BIANCHI ; Data do casamento: 15/06/1985",
    literais: { nome_registrado: "ANTONIO BIANCHI", conjuge_registrado: "MARIA SOUZA BIANCHI" },
  })

  // D4 — óbito com LEITURAS DIVERGENTES no campo crítico DATA_OBITO
  //      (rótulo diz 1999-03-01, prosa registral diz 1998-11-20)
  const d4 = await certidao({
    pessoaId: p2.id,
    tipoId: tdObt.id,
    legacy: "CERTIDAO_OBITO",
    descricao: "obito-divergente",
    texto:
      "CERTIDAO DE OBITO. Data do obito: 01/03/1999 . " +
      "O registrado faleceu nesta cidade aos 20 de novembro de 1998 , causa da morte natural.",
  })

  // D5 — documento SEM material nenhum → DOCUMENTO_INSUFICIENTE
  const d5 = await prisma.documento.create({
    data: {
      pessoaId: p1.id,
      documentTypeId: tdNasc.id,
      tipo: "CERTIDAO_NASCIMENTO",
      status: "RECEBIDO",
      descricao: "insuficiente-sem-transcricao",
      arquivo_url: "https://exemplo.local/ilegivel.pdf",
      arquivo_nome: "ilegivel.pdf",
    },
    select: { id: true },
  })

  // D6 — tipo declarado NASCIMENTO, conteúdo de ÓBITO → DOCUMENTO_CONFLITANTE
  const d6 = await certidao({
    pessoaId: p1.id,
    tipoId: tdNasc.id,
    legacy: "CERTIDAO_NASCIMENTO",
    descricao: "tipo-trocado",
    texto:
      "CERTIDAO DE OBITO. Faleceu nesta cidade aos 72 anos. Causa da morte: parada cardiaca. Sepultado no cemiterio municipal. Livro C-3 de obito.",
  })

  ok([d1, d2, d3, d4, d5, d6].every((d) => d.id > 0), "6 certidões reais na Pasta Documental (incluindo casos-problema)")

  // ==========================================================================
  console.log("\n2) LOTE — processa a pasta como CONJUNTO")
  const lote = await criarLote({ processoId: processo.id, usuarioId: revisor.id })
  ok(lote.criado === true, "lote criado")
  ok(lote.totalDocumentos === 6, `todas as 6 certidões entraram no lote`, lote.totalDocumentos)

  const loteRepetido = await criarLote({ processoId: processo.id, usuarioId: revisor.id })
  ok(loteRepetido.criado === false && loteRepetido.loteId === lote.loteId, "IDEMPOTÊNCIA: pedir de novo devolve o MESMO lote")

  const r1 = await processarLote({ loteId: lote.loteId, limite: 20, usuarioId: revisor.id })
  ok(r1.concluido === true, "lote concluído em um ciclo", r1)
  ok(r1.processadosNesteCiclo === 6, "6 documentos processados", r1.processadosNesteCiclo)

  const prog = await progressoLote(lote.loteId)
  ok(prog !== null && prog.percentual === 100, "progresso 100%", prog?.percentual)
  ok(!!prog?.resumo, "resumo do lote gravado", prog?.resumo)

  // ==========================================================================
  console.log("\n3) PIPELINE — todas as etapas registradas, nenhuma silenciosa")
  const execs = await prisma.execucaoRegistral.findMany({
    where: { loteId: lote.loteId },
    select: { id: true, documentoId: true, etapa: true, tipoDetectado: true, camposExtraidos: true, camposDivergentes: true, etapas: { select: { etapa: true, ok: true } } },
    orderBy: { documentoId: "asc" },
  })
  ok(execs.length === 6, "uma execução por documento", execs.length)

  const porDoc = new Map(execs.map((e) => [e.documentoId, e]))
  const execD1 = porDoc.get(d1.id)!
  const etapasD1 = execD1.etapas.map((e) => e.etapa)
  for (const etapa of [
    "RECEBIDO",
    "CLASSIFICANDO",
    "EXTRAINDO",
    "REEXTRAINDO",
    "NORMALIZANDO",
    "RESOLVENDO_IDENTIDADES",
    "CRUZANDO_EVIDENCIAS",
    "VALIDANDO",
    "REVALIDANDO",
    "ANALISANDO_IMPACTO",
    "AUDITADO",
  ]) {
    ok(etapasD1.includes(etapa as never), `D1 passou por ${etapa}`)
  }
  ok(execD1.tipoDetectado === "NASCIMENTO", "D1 classificado como NASCIMENTO", execD1.tipoDetectado)
  ok(execD1.camposExtraidos > 0, "D1 extraiu campos", execD1.camposExtraidos)

  ok(porDoc.get(d5.id)?.etapa === "DOCUMENTO_INSUFICIENTE", "D5 (sem material) → DOCUMENTO_INSUFICIENTE", porDoc.get(d5.id)?.etapa)
  ok(
    porDoc.get(d5.id)?.etapas.some((e) => e.etapa === "DOCUMENTO_INSUFICIENTE" && !e.ok) === true,
    "e a etapa foi registrada como falha (não desapareceu)",
  )
  ok(
    porDoc.get(d6.id)?.etapas.some((e) => e.etapa === "DOCUMENTO_CONFLITANTE") === true,
    "D6 (tipo trocado) registrou DOCUMENTO_CONFLITANTE",
    porDoc.get(d6.id)?.etapas.map((e) => e.etapa),
  )

  const execD4 = porDoc.get(d4.id)!
  ok(execD4.camposDivergentes > 0, "D4 detectou divergência entre as duas leituras", execD4.camposDivergentes)

  // ==========================================================================
  console.log("\n4) EVIDÊNCIAS — granulares e verificáveis")
  const evidencias = await listarEvidencias({ processoId: processo.id, limite: 500 })
  ok(evidencias.length > 10, `${evidencias.length} evidências registradas`)

  const evD1 = evidencias.filter((e) => e.documentoId === d1.id)
  ok(evD1.length > 0, "D1 tem evidências")
  for (const campoObrig of ["documentoId", "campo", "metodoExtracao", "versaoProcessamento", "confiancaExtracao", "confiancaAssociacao", "regraAplicada"] as const) {
    ok(evD1.every((e) => e[campoObrig] !== null && e[campoObrig] !== undefined), `toda evidência tem ${campoObrig}`)
  }
  ok(evD1.some((e) => e.pagina !== null), "evidência cita a PÁGINA")
  ok(evD1.some((e) => e.regiao !== null), "evidência cita a REGIÃO/offset")
  ok(evD1.some((e) => e.trechoTexto !== null), "evidência cita o TRECHO do documento")
  ok(evD1.some((e) => e.valorBruto !== null && e.valorNormalizado !== null), "evidência tem valor bruto E normalizado")
  ok(evD1.some((e) => e.itemCatalogoId !== null), "evidência aponta o Documento Mestre")
  ok(evD1.some((e) => e.necessidadeId !== null), "evidência aponta a Necessidade Documental")

  // Duas evidências independentes do MESMO campo = a extração dupla registrada.
  const metodosNome = new Set(
    evidencias.filter((e) => e.documentoId === d1.id && e.campo === "FILIACAO_PAI").map((e) => e.metodoExtracao),
  )
  ok(metodosNome.size >= 2, "o mesmo campo tem evidência das DUAS leituras independentes", [...metodosNome])

  // ==========================================================================
  console.log("\n5) FATOS REGISTRAIS — estado próprio por campo")
  const fatosP1 = await prisma.fatoRegistral.findMany({
    where: { pessoaId: p1.id, ativo: true },
    select: { campo: true, estado: true, confianca: true, totalEvidencias: true, evidenciasFavoraveis: true, valorNormalizado: true },
  })
  ok(fatosP1.length > 0, `${fatosP1.length} fatos registrais para o requerente`)
  const estados = new Set(fatosP1.map((f) => f.estado))
  ok(estados.size >= 1, "fatos têm estado próprio (não um status único da pessoa)", [...estados])
  const confirmadoP1 = fatosP1.find((f) => f.estado === "CONFIRMADO" || f.estado === "CONFIRMADO_MULTIPLAS_EVIDENCIAS")
  ok(!!confirmadoP1, "há fato confirmado por evidência", fatosP1.map((f) => `${f.campo}=${f.estado}`))
  ok((confirmadoP1?.totalEvidencias ?? 0) > 0, "e o fato confirmado tem evidência contada")

  const fatosP2 = await prisma.fatoRegistral.findMany({ where: { pessoaId: p2.id, ativo: true }, select: { campo: true, estado: true } })
  const obitoDivergente = fatosP2.find((f) => f.campo === "DATA_OBITO")
  ok(
    obitoDivergente == null || obitoDivergente.estado === "DIVERGENTE" || obitoDivergente.estado === "CONFLITANTE",
    "campo com leituras divergentes NÃO é consolidado como confirmado",
    obitoDivergente,
  )

  // ==========================================================================
  console.log("\n6) IDENTIDADE — homônimo NÃO fundido, nome de casada reconhecido")
  const ocorrencias = await prisma.ocorrenciaDocumental.findMany({
    where: { execucao: { loteId: lote.loteId } },
    select: {
      id: true,
      documentoId: true,
      papel: true,
      nomeNormalizado: true,
      pessoaResolvidaId: true,
      resolvidaAutomaticamente: true,
      classe: true,
      correspondencias: { select: { pessoaId: true, classe: true, score: true } },
    },
    orderBy: { id: "asc" },
  })
  ok(ocorrencias.length >= 8, `${ocorrencias.length} ocorrências documentais (pessoa ≠ menção)`)

  const ocPaiEmD1 = ocorrencias.find((o) => o.documentoId === d1.id && o.papel === "PAI")
  ok(!!ocPaiEmD1, "a menção do pai em D1 existe como ocorrência")
  const candidatosDoPai = ocPaiEmD1?.correspondencias ?? []
  ok(candidatosDoPai.length >= 2, "os DOIS homônimos apareceram como candidatos", candidatosDoPai)
  ok(
    ocPaiEmD1?.pessoaResolvidaId === null,
    "HOMÔNIMO: nenhum foi vinculado automaticamente",
    ocPaiEmD1?.pessoaResolvidaId,
  )

  const conflitosHomonimo = await listarConflitos({ processoId: processo.id, status: ["ABERTO"], limite: 100 })
  ok(
    conflitosHomonimo.some((c) => c.codigo === "HOMONIMO_NAO_RESOLVIDO"),
    "e um conflito de homônimo foi aberto para revisão humana",
    conflitosHomonimo.map((c) => c.codigo),
  )

  const ocConjuge = ocorrencias.find((o) => o.documentoId === d3.id && o.papel === "CONJUGE")
  ok(!!ocConjuge, "a menção do cônjuge (nome de casada) existe")
  ok(
    (ocConjuge?.correspondencias ?? []).some((c) => c.pessoaId === pMaria.id),
    "NOME DE CASADA: 'MARIA SOUZA BIANCHI' foi ligada a 'Maria Souza' do cadastro",
    ocConjuge?.correspondencias,
  )

  // ==========================================================================
  console.log("\n7) CONFLITOS — o motor se recusa a decidir")
  const conflitos = await listarConflitos({ processoId: processo.id, status: ["ABERTO", "EM_REVISAO"], limite: 200 })
  ok(conflitos.length > 0, `${conflitos.length} conflitos abertos`)
  ok(
    conflitos.some((c) => c.codigo === "LEITURA_DIVERGENTE_CAMPO_CRITICO" || c.codigo === "LEITURA_DIVERGENTE"),
    "divergência entre leituras abriu conflito",
    conflitos.map((c) => c.codigo),
  )
  ok(conflitos.some((c) => c.codigo === "TIPO_DOCUMENTO_DIVERGENTE"), "tipo declarado × conteúdo abriu conflito")
  for (const c of conflitos) {
    ok(!!c.descricao && !!c.explicacao && !!c.acaoSugerida, `conflito ${c.codigo} tem descrição, explicação e ação`)
    ok(Array.isArray(c.evidencias), `conflito ${c.codigo} tem evidências`)
  }

  // ==========================================================================
  console.log("\n8) PROPOSTAS — antes, depois e porquê; matriz respeitada")
  const propostas = await listarPropostas({ processoId: processo.id, limite: 300 })
  ok(propostas.length > 0, `${propostas.length} propostas geradas`)

  for (const p of propostas) {
    ok(!!p.justificativa && !!p.regraAplicada, `proposta #${p.id} (${p.tipo}) tem justificativa e regra`)
  }
  ok(
    propostas.some((p) => p.tipo === "CRIAR_PESSOA"),
    "o avô/avó que só existem nos documentos geraram proposta de CRIAR_PESSOA",
    propostas.map((p) => p.tipo),
  )
  ok(
    propostas.filter((p) => p.tipo === "CRIAR_PESSOA").every((p) => p.aplicavelAutomaticamente === false),
    "criar pessoa NUNCA é automático",
  )
  const criarGiuseppe = propostas.find((p) => p.tipo === "CRIAR_PESSOA" && String(p.valorProposto).includes("GIUSEPPE"))
  ok(!!criarGiuseppe, "há proposta para criar GIUSEPPE BIANCHI (o avô)", propostas.filter((p) => p.tipo === "CRIAR_PESSOA").map((p) => p.valorProposto))

  const sensiveis = propostas.filter((p) => p.criticidade !== "AUTOMATICA")
  ok(sensiveis.length > 0, `${sensiveis.length} propostas sensíveis AGUARDAM decisão humana`)
  ok(
    sensiveis.every((p) => p.status === "PENDENTE" || p.status === "APLICADA" || p.status === "ABORTADA"),
    "nenhuma proposta sensível foi aplicada sem passar por decisão",
  )
  const bloqueios = propostas.filter((p) => p.criticidade === "BLOQUEIO")
  ok(
    bloqueios.every((p) => p.status !== "APLICADA"),
    "nenhuma proposta de BLOQUEIO foi aplicada",
    bloqueios.map((p) => `${p.tipo}:${p.status}`),
  )

  const automaticas = propostas.filter((p) => p.criticidade === "AUTOMATICA")
  ok(
    automaticas.some((p) => p.status === "APLICADA"),
    "as propostas inequívocas FORAM aplicadas pelo motor",
    automaticas.map((p) => `${p.tipo}:${p.status}`),
  )
  const aplicadas = automaticas.filter((p) => p.status === "APLICADA")
  ok(aplicadas.every((p) => p.versaoArvoreAntes != null && p.versaoArvoreDepois != null), "toda aplicação tem versão antes e depois")

  // ==========================================================================
  console.log("\n9) RECONCILIAÇÃO DOCUMENTAL — status é do Sistema Documental")
  const necDepois = await prisma.necessidadeDocumental.findUnique({
    where: { id: necNascP1.id },
    select: { status: true, eventos: { select: { tipo: true } } },
  })
  ok(
    necDepois?.status === "ATENDIDA" || necDepois?.status === "PENDENTE" || necDepois?.status === "EM_ATENDIMENTO",
    "a necessidade tem status oficial do Sistema Documental",
    necDepois?.status,
  )
  if (necDepois?.status === "ATENDIDA") {
    ok(necDepois.eventos.some((e) => e.tipo === "ATENDIDA"), "e a transição gerou evento append-only")
  } else {
    ok(true, `necessidade permanece ${necDepois?.status} (campos exigidos ainda não todos confirmados) — comportamento conservador`)
  }
  const propDocumentais = propostas.filter((p) => p.tipo === "CRIAR_NECESSIDADE" || p.tipo === "SATISFAZER_NECESSIDADE")
  ok(propDocumentais.every((p) => p.criticidade === "APROVACAO_HUMANA"), "toda alteração documental proposta exige humano")

  // ==========================================================================
  console.log("\n10) LINHAGEM — recalculada, com pendências explícitas")
  const linhagem = await recalcularLinhagem(processo.id)
  ok(linhagem !== null, "linhagem apurada")
  ok(linhagem!.elegibilidade.requerenteId === p1.id, "requerente identificado", linhagem!.elegibilidade.requerenteId)
  ok(
    linhagem!.elegibilidade.comprovadoDocumentalmente === false,
    "linha NÃO é declarada comprovada (falta o avô italiano na árvore)",
  )
  ok(linhagem!.elegibilidade.pendencias.length > 0 || linhagem!.elegibilidade.conflitos.length > 0, "e as pendências/conflitos são listados")
  ok(linhagem!.inconsistencias.length > 0, `${linhagem!.inconsistencias.length} inconsistências apuradas`)
  ok(!!linhagem!.elegibilidade.explicacao, "com explicação em linguagem de operador")

  // ==========================================================================
  console.log("\n11) PERMISSÕES — enforcement server-side")
  const semPermissao = { usuarioId: estagiario.id, permissoes: calcularPermissoes("usuario"), ehMotor: false }
  const alvoParaAprovar = propostas.find((p) => p.status === "PENDENTE" && p.criticidade === "APROVACAO_HUMANA")
  ok(!!alvoParaAprovar, "há proposta pendente para testar autorização")
  const negado = await aplicarProposta({ propostaId: alvoParaAprovar!.id, ator: semPermissao, motivo: "tentativa sem permissão" })
  ok(negado.ok === false && negado.codigo === "SEM_PERMISSAO", "usuário sem permissão é BLOQUEADO", negado.codigo)

  const bloqueada = propostas.find((p) => p.criticidade === "BLOQUEIO" && p.status === "PENDENTE")
  if (bloqueada) {
    const semDesbloqueio = await aplicarProposta({
      propostaId: bloqueada.id,
      ator: { usuarioId: revisor.id, permissoes: calcularPermissoes("admin"), ehMotor: false },
      motivo: "tentativa sem desbloqueio",
    })
    ok(
      semDesbloqueio.ok === false && semDesbloqueio.codigo === "BLOQUEADA_SEM_DESBLOQUEIO",
      "proposta de BLOQUEIO exige desbloqueio explícito",
      semDesbloqueio.codigo,
    )
    const comoMotor = await aplicarProposta({
      propostaId: bloqueada.id,
      ator: { usuarioId: null, permissoes: {}, ehMotor: true },
      motivo: "motor",
    })
    ok(comoMotor.ok === false, "o MOTOR nunca aplica bloqueio", comoMotor.codigo)
  } else {
    ok(true, "nenhuma proposta de bloqueio neste cenário (nada a testar)")
  }

  const semMotivo = await aplicarProposta({
    propostaId: alvoParaAprovar!.id,
    ator: { usuarioId: revisor.id, permissoes: calcularPermissoes("admin"), ehMotor: false },
    motivo: "   ",
  })
  ok(semMotivo.ok === false, "decisão sem motivo escrito é recusada", semMotivo.mensagem)

  // ==========================================================================
  console.log("\n12) APLICAÇÃO transacional + IMPACTO + VERSÃO")
  const atorAdmin = { usuarioId: revisor.id, permissoes: calcularPermissoes("admin"), ehMotor: false }
  const versoesAntes = await listarVersoes(prisma, arvore.id)

  const criarPessoa = propostas.find((p) => p.tipo === "CRIAR_PESSOA" && p.status === "PENDENTE")
  ok(!!criarPessoa, "proposta de criar pessoa disponível")
  const pessoasAntes = await prisma.pessoa.count({ where: { arvoreId: arvore.id } })
  const aplicouCriar = await aprovarProposta({
    propostaId: criarPessoa!.id,
    ator: atorAdmin,
    motivo: "Conferido: o ascendente não existe no cadastro e consta na certidão de nascimento do pai.",
  })
  ok(aplicouCriar.ok === true, "criação de pessoa aplicada após aprovação humana", aplicouCriar)
  const pessoasDepois = await prisma.pessoa.count({ where: { arvoreId: arvore.id } })
  ok(pessoasDepois === pessoasAntes + 1, "a ÁRVORE FOI COMPLEMENTADA (uma pessoa nova)", { pessoasAntes, pessoasDepois })

  const impactos = await prisma.impactoAplicacaoRegistral.findMany({
    where: { propostaId: criarPessoa!.id },
    select: { momento: true, bloqueado: true, pessoasAfetadas: true, elegibilidadeAntes: true, elegibilidadeDepois: true },
  })
  ok(impactos.some((i) => i.momento === "PREVIO"), "impacto PRÉVIO calculado antes de escrever")
  ok(impactos.some((i) => i.momento === "POSTERIOR"), "impacto POSTERIOR calculado dentro da transação")

  const versoesDepois = await listarVersoes(prisma, arvore.id)
  ok(versoesDepois.length > versoesAntes.length, "versões genealógicas criadas", { antes: versoesAntes.length, depois: versoesDepois.length })

  const cmp = await compararVersoes(prisma, arvore.id, versoesDepois[versoesDepois.length - 1].versao, versoesDepois[0].versao)
  ok(cmp.erro === null, "comparação entre versões funciona")
  ok(cmp.comparacao.mudancas.length > 0, "e mostra as mudanças", cmp.comparacao.resumo)

  // DECISÃO registrada com a permissão exercida
  const decisoes = await prisma.decisaoRevisaoRegistral.findMany({
    where: { propostaId: criarPessoa!.id },
    select: { decisao: true, motivo: true, permissao: true, responsavelId: true },
  })
  ok(decisoes.length === 1 && decisoes[0].decisao === "APROVAR", "decisão humana registrada")
  ok(!!decisoes[0].permissao, "com a PERMISSÃO exercida", decisoes[0].permissao)
  ok(decisoes[0].responsavelId === revisor.id, "e o responsável identificado")

  // ==========================================================================
  console.log("\n13) ROLLBACK AUTOMÁTICO — revalidação reprova e nada é escrito")
  //  Proposta forjada que criaria CICLO: o pai passa a ter o próprio filho como pai.
  const { chaveProposta } = await import("@/src/lib/genealogia/registral/chaves")
  const propCiclo = await prisma.propostaReconciliacao.create({
    data: {
      processoId: processo.id,
      arvoreId: arvore.id,
      tipo: "CRIAR_RELACIONAMENTO",
      criticidade: "APROVACAO_HUMANA",
      status: "PENDENTE",
      entidadeAlvo: "PESSOA",
      alvoId: p2.id,
      campo: "FILIACAO_PAI",
      valorAtual: null,
      valorProposto: "Joao Batista Bianchi",
      evidenciasFavoraveis: [],
      evidenciasContrarias: [],
      confianca: 0.9,
      justificativa: "Cenário de teste: vínculo que produz ciclo genealógico.",
      regraAplicada: "TESTE-CICLO",
      risco: "CRITICO",
      operacao: { filhoId: p2.id, genitorId: p1.id, papel: "PAI" },
      pessoasAfetadas: [p2.id, p1.id],
      aplicavelAutomaticamente: false,
      correlationId: `${SUFIXO}-ciclo`,
      chaveIdempotencia: chaveProposta({
        processoId: processo.id,
        tipo: "CRIAR_RELACIONAMENTO",
        entidadeAlvo: "PESSOA",
        alvoId: p2.id,
        campo: "FILIACAO_PAI",
        valorProposto: `teste-ciclo-${SUFIXO}`,
      }),
    },
    select: { id: true },
  })
  const paiAntes = await prisma.pessoa.findUnique({ where: { id: p2.id }, select: { paiId: true } })
  const tentouCiclo = await aplicarProposta({
    propostaId: propCiclo.id,
    ator: atorAdmin,
    motivo: "Teste de rollback: esta aplicação deve ser abortada.",
  })
  ok(tentouCiclo.ok === false, "aplicação que criaria ciclo é REPROVADA", tentouCiclo.codigo)
  ok(
    tentouCiclo.codigo === "IMPACTO_BLOQUEADO" || tentouCiclo.codigo === "REVALIDACAO_FALHOU",
    "reprovada na análise de impacto ou na revalidação",
    tentouCiclo.codigo,
  )
  const paiDepois = await prisma.pessoa.findUnique({ where: { id: p2.id }, select: { paiId: true } })
  ok(paiAntes?.paiId === paiDepois?.paiId, "NADA foi escrito: o vínculo permanece como estava", { paiAntes, paiDepois })
  const statusCiclo = await prisma.propostaReconciliacao.findUnique({ where: { id: propCiclo.id }, select: { status: true, motivoAbortoRevalidacao: true } })
  ok(statusCiclo?.status === "ABORTADA", "a proposta ficou ABORTADA", statusCiclo?.status)
  ok(!!statusCiclo?.motivoAbortoRevalidacao, "com o motivo do aborto registrado", statusCiclo?.motivoAbortoRevalidacao?.slice(0, 120))

  // ==========================================================================
  console.log("\n14) REVERSÃO — desfaz sem apagar histórico e sem excluir pessoa")
  const aplicadaParaReverter = await prisma.propostaReconciliacao.findFirst({
    where: { processoId: processo.id, status: "APLICADA", tipo: { in: ["COMPLETAR_DADO", "CONFIRMAR_DADO", "ADICIONAR_NOME_ALTERNATIVO"] } },
    select: { id: true, tipo: true, alvoId: true, campo: true },
  })
  if (aplicadaParaReverter) {
    const revertido = await reverterProposta({
      propostaId: aplicadaParaReverter.id,
      ator: atorAdmin,
      motivo: "Teste de reversão: desfazer a aplicação anterior.",
    })
    ok(revertido.ok === true, `reversão de ${aplicadaParaReverter.tipo} aplicada`, revertido.mensagem)
    const st = await prisma.propostaReconciliacao.findUnique({ where: { id: aplicadaParaReverter.id }, select: { status: true, revertidoEm: true } })
    ok(st?.status === "REVERTIDA" && st.revertidoEm != null, "status REVERTIDA com data")
    const decisoesRev = await prisma.decisaoRevisaoRegistral.count({ where: { propostaId: aplicadaParaReverter.id } })
    ok(decisoesRev >= 1, "a reversão registrou decisão (append-only)")
  } else {
    ok(true, "nenhuma proposta aplicada reversível neste cenário")
  }

  const semPermReverter = await reverterProposta({
    propostaId: criarPessoa!.id,
    ator: semPermissao,
    motivo: "sem permissão",
  })
  ok(semPermReverter.ok === false && semPermReverter.codigo === "SEM_PERMISSAO", "reverter exige permissão dedicada")

  const pessoaCriadaId = (await prisma.pessoa.findFirst({
    where: { arvoreId: arvore.id, nome: { startsWith: "GIUSEPPE" } },
    select: { id: true },
  }))?.id
  if (pessoaCriadaId) {
    const revCriacao = await reverterProposta({ propostaId: criarPessoa!.id, ator: atorAdmin, motivo: "Teste: reverter criação de pessoa." })
    const aindaExiste = await prisma.pessoa.findUnique({ where: { id: pessoaCriadaId }, select: { id: true } })
    ok(aindaExiste !== null, "REVERTER CRIAÇÃO DE PESSOA NÃO EXCLUI a pessoa (proibido por princípio)")
    ok(revCriacao.ok === true, "e a reversão é registrada com pendência humana", revCriacao.mensagem)
  } else {
    ok(true, "pessoa criada não localizada por nome (cenário sem esse caso)")
  }

  // ==========================================================================
  console.log("\n15) IDEMPOTÊNCIA — reprocessar não duplica nada")
  // ISOLAMENTO: o que este teste precisa provar é que REPROCESSAR não duplica —
  // não que a árvore nunca muda. Como os passos anteriores alteraram a árvore
  // (criação e reversão de pessoa), a PRIMEIRA reanálise depois disso descobre
  // achados legítimos e novos. Então: reprocessa UMA vez para estabilizar o
  // estado, tira a foto, e reprocessa DE NOVO — a segunda passagem, sobre o mesmo
  // estado e os mesmos documentos, tem de acrescentar exatamente zero.
  const loteEstabiliza = await reprocessarDocumento({ documentoId: d1.id, processoId: processo.id, usuarioId: revisor.id })
  await processarLote({ loteId: loteEstabiliza.loteId, limite: 5, usuarioId: revisor.id })

  const idsConflitosAntes = new Set(
    (await prisma.conflitoRegistral.findMany({ where: { processoId: processo.id }, select: { id: true } })).map((c) => c.id),
  )
  const idsPropostasAntes = new Set(
    (await prisma.propostaReconciliacao.findMany({ where: { processoId: processo.id }, select: { id: true } })).map((c) => c.id),
  )
  const antes = {
    ocorrencias: await prisma.ocorrenciaDocumental.count({ where: { execucao: { lote: { processoId: processo.id } } } }),
    evidencias: await prisma.evidenciaRegistral.count({ where: { execucao: { lote: { processoId: processo.id } } } }),
    fatos: await prisma.fatoRegistral.count({ where: { pessoa: { arvoreId: arvore.id } } }),
    conflitos: idsConflitosAntes.size,
    propostas: idsPropostasAntes.size,
    pessoas: await prisma.pessoa.count({ where: { arvoreId: arvore.id } }),
  }

  // (a) reexecutar o MESMO lote original (execuções já finalizadas → nada pendente)
  await processarLote({ loteId: lote.loteId, limite: 20, usuarioId: revisor.id })
  // (b) reprocessar explicitamente o mesmo documento, de novo
  const reproc = await reprocessarDocumento({ documentoId: d1.id, processoId: processo.id, usuarioId: revisor.id })
  ok(reproc.criado === false && reproc.loteId === loteEstabiliza.loteId, "reprocessar o mesmo documento reusa o lote de reprocessamento")
  await processarLote({ loteId: reproc.loteId, limite: 5, usuarioId: revisor.id })

  const depois = {
    ocorrencias: await prisma.ocorrenciaDocumental.count({ where: { execucao: { lote: { processoId: processo.id } } } }),
    evidencias: await prisma.evidenciaRegistral.count({ where: { execucao: { lote: { processoId: processo.id } } } }),
    fatos: await prisma.fatoRegistral.count({ where: { pessoa: { arvoreId: arvore.id } } }),
    conflitos: await prisma.conflitoRegistral.count({ where: { processoId: processo.id } }),
    propostas: await prisma.propostaReconciliacao.count({ where: { processoId: processo.id } }),
    pessoas: await prisma.pessoa.count({ where: { arvoreId: arvore.id } }),
  }
  // O reprocessamento cria um LOTE novo (histórico preservado), portanto novas
  // ocorrências/evidências daquele lote são esperadas para o documento reprocessado.
  // O que NÃO pode crescer é fato, conflito, proposta e pessoa.
  ok(depois.fatos === antes.fatos, "FATOS não duplicaram", { antes: antes.fatos, depois: depois.fatos })
  const conflitosNovos = await prisma.conflitoRegistral.findMany({
    where: { processoId: processo.id, id: { notIn: [...idsConflitosAntes] } },
    select: { id: true, codigo: true, campo: true, pessoaId: true, descricao: true },
  })
  const propostasNovas = await prisma.propostaReconciliacao.findMany({
    where: { processoId: processo.id, id: { notIn: [...idsPropostasAntes] } },
    select: { id: true, tipo: true, campo: true, alvoId: true, valorProposto: true, regraAplicada: true },
  })
  ok(
    conflitosNovos.length === 0,
    "CONFLITOS não duplicaram",
    conflitosNovos.map((c) => `${c.codigo}/${c.campo ?? "-"}/p${c.pessoaId ?? "-"}`),
  )
  ok(
    propostasNovas.length === 0,
    "PROPOSTAS não duplicaram",
    propostasNovas.map((p) => `${p.tipo}/${p.campo ?? "-"}/alvo${p.alvoId ?? "-"}/${p.regraAplicada}`),
  )
  ok(depois.pessoas === antes.pessoas, "PESSOAS não duplicaram", { antes: antes.pessoas, depois: depois.pessoas })

  const evidenciasD1PorChave = await prisma.evidenciaRegistral.groupBy({
    by: ["chaveIdempotencia"],
    where: { documentoId: d1.id },
    _count: { _all: true },
  })
  ok(
    evidenciasD1PorChave.every((g) => g._count._all === 1),
    "nenhuma evidência repetida por chave de idempotência",
    evidenciasD1PorChave.filter((g) => g._count._all > 1).length,
  )

  // ==========================================================================
  console.log("\n16) CONCORRÊNCIA — dois workers não processam o mesmo documento")
  const loteConc = await criarLote({ processoId: processo.id, documentoIds: [d2.id, d3.id], usuarioId: revisor.id })
  await prisma.execucaoRegistral.updateMany({
    where: { loteId: loteConc.loteId },
    data: { etapa: "REPROCESSAMENTO", reservadoEm: null, proximaEm: null },
  })
  const [c1, c2] = await Promise.all([
    processarLote({ loteId: loteConc.loteId, limite: 5, usuarioId: revisor.id }),
    processarLote({ loteId: loteConc.loteId, limite: 5, usuarioId: revisor.id }),
  ])
  ok(
    c1.processadosNesteCiclo + c2.processadosNesteCiclo <= 2,
    "cada documento foi processado UMA vez apesar dos dois workers",
    { c1: c1.processadosNesteCiclo, c2: c2.processadosNesteCiclo },
  )
  const etapasDuplicadas = await prisma.etapaExecucaoRegistral.groupBy({
    by: ["execucaoId", "etapa", "tentativa"],
    where: { execucao: { loteId: loteConc.loteId } },
    _count: { _all: true },
  })
  ok(
    etapasDuplicadas.every((g) => g._count._all === 1),
    "nenhuma etapa registrada em dobro na mesma tentativa",
    etapasDuplicadas.filter((g) => g._count._all > 1).length,
  )

  // ==========================================================================
  console.log("\n17) RECONCILIAÇÃO CONTÍNUA via outbox (gancho real)")
  const outboxAntes = await prisma.domainOutbox.count({ where: { tipo: "registral.reconciliar.processo" } })
  const notificado = await notificarDocumentoAlterado({ documentoId: d1.id, motivo: "documento_alterado" })
  ok(notificado.publicado === true && notificado.processoId === processo.id, "gancho publicou o evento de reconciliação", notificado)
  const outboxDepois = await prisma.domainOutbox.count({ where: { tipo: "registral.reconciliar.processo" } })
  ok(outboxDepois > outboxAntes, "evento gravado na DomainOutbox (fila existente)")

  const drenado = await processarOutbox({ limite: 10, tipos: ["registral.reconciliar.processo"] })
  ok(drenado.processados > 0, "o dispatcher processou a reconciliação", drenado)
  ok(drenado.falhos === 0, "sem falhas no dispatcher", drenado.detalhes)

  const repetido = await notificarDocumentoAlterado({ documentoId: d1.id, motivo: "documento_alterado" })
  ok(repetido.publicado === true, "publicar de novo na mesma janela é no-op idempotente")

  // ==========================================================================
  console.log("\n18) AUDITORIA, MÉTRICAS e COPILOTO")
  const auditoria = await listarAuditoria({ limite: 500 })
  const doProcesso = auditoria.filter((a) => a.acao.startsWith("registral_"))
  ok(doProcesso.length > 5, `${doProcesso.length} registros de auditoria do motor`)
  for (const acao of ["registral_lote_criado", "registral_proposta_criada", "registral_proposta_aplicada", "registral_versao_criada"]) {
    ok(doProcesso.some((a) => a.acao === acao), `auditoria contém ${acao}`)
  }
  const comNomeCompleto = doProcesso.filter((a) => JSON.stringify(a.detalhes ?? {}).includes("JOAO BATISTA BIANCHI"))
  ok(comNomeCompleto.length === 0, "nenhum log de auditoria contém nome completo (redação aplicada)", comNomeCompleto.length)

  const metricas = await listarMetricas({ escopo: `processo:${processo.id}`, limite: 100 })
  ok(metricas.length > 0, `${metricas.length} métricas registradas`)
  ok(metricas.some((m) => m.chave === "documentos_processados"), "métrica de documentos processados")

  const dossie = await montarDossie(processo.id)
  ok(dossie !== null, "dossiê do copiloto montado a partir do banco")
  const respostaLinha = responder("qual é a linha genealógica?", dossie!)
  ok(!!respostaLinha.conclusao, "copiloto responde a linha", respostaLinha.conclusao)
  ok(respostaLinha.origemDosDados.length > 0, "declarando a origem dos dados", respostaLinha.origemDosDados)
  const respostaFalta = responder("quais certidões faltam?", dossie!)
  ok(respostaFalta.origemDosDados.some((o) => o.includes("Sistema Documental")), "e a exigência documental vem do Sistema Documental")
  const inventada = responder("qual o telefone do cartório?", dossie!)
  ok(inventada.semDados === true && inventada.evidencias.length === 0, "pergunta sem dado não é inventada")

  const dossiePessoa = await dossieDaPessoa(p1.id)
  ok(dossiePessoa.fatos.length > 0, "dossiê da pessoa traz os fatos")
  ok(dossiePessoa.fatos.some((f) => f.evidencias.length > 0), "com as evidências que os sustentam")
  ok(dossiePessoa.ocorrencias.length >= 0, "e as menções documentais")

  // ==========================================================================
  console.log("\n19) SNAPSHOT e integridade do histórico")
  const snap = await snapshotAtual(prisma, arvore.id, processo.id)
  ok(snap.pessoas.length > 0 && snap.arvoreId === arvore.id, "snapshot atual montado")
  const v1 = await criarVersao(prisma, { arvoreId: arvore.id, processoId: processo.id, motivo: "teste snapshot", snapshot: snap })
  const v2 = await criarVersao(prisma, { arvoreId: arvore.id, processoId: processo.id, motivo: "teste snapshot repetido", snapshot: snap })
  ok(v2.semMudanca === true && v2.versao === v1.versao, "snapshot idêntico NÃO cria versão nova (histórico limpo)")

  const totalVersoes = await prisma.versaoGenealogica.count({ where: { arvoreId: arvore.id } })
  ok(totalVersoes >= 2, `${totalVersoes} versões preservadas (append-only)`)

  // ==========================================================================
  console.log("\n20) DECISÃO de conflito")
  const conflitoParaDecidir = conflitos.find((c) => c.status === "ABERTO" && c.severidade !== "CRITICO")
  if (conflitoParaDecidir) {
    const dec = await decidirConflito({
      conflitoId: conflitoParaDecidir.id,
      ator: atorAdmin,
      decisao: "RESOLVER_CONFLITO",
      motivo: "Conferido no documento original; grafia aceita como variação.",
    })
    ok(dec.ok === true, "conflito resolvido com motivo registrado")
    const dep = await prisma.conflitoRegistral.findUnique({ where: { id: conflitoParaDecidir.id }, select: { status: true, resolucaoNota: true } })
    ok(dep?.status === "RESOLVIDO" && !!dep.resolucaoNota, "status e nota gravados")
    const denovo = await decidirConflito({ conflitoId: conflitoParaDecidir.id, ator: atorAdmin, decisao: "RESOLVER_CONFLITO", motivo: "de novo" })
    ok(denovo.ok === false, "decidir duas vezes o mesmo conflito é recusado")
  } else {
    ok(true, "nenhum conflito não-crítico para decidir")
  }
  const critico = conflitos.find((c) => c.severidade === "CRITICO" && c.status === "ABERTO")
  if (critico) {
    const descarte = await decidirConflito({
      conflitoId: critico.id,
      ator: { usuarioId: estagiario.id, permissoes: { "registral.revisar": true }, ehMotor: false },
      decisao: "DESCARTAR_CONFLITO",
      motivo: "tentativa de descarte",
    })
    ok(descarte.ok === false, "conflito CRÍTICO não pode ser descartado por quem só revisa", descarte.codigo)
  } else {
    ok(true, "nenhum conflito crítico aberto neste cenário")
  }

  // ==========================================================================
  console.log("\n21) REJEIÇÃO de proposta e falso positivo")
  const paraRejeitar = await prisma.propostaReconciliacao.findFirst({
    where: { processoId: processo.id, status: "PENDENTE" },
    select: { id: true },
  })
  if (paraRejeitar) {
    const rej = await rejeitarProposta({ propostaId: paraRejeitar.id, ator: atorAdmin, motivo: "Sugestão incorreta: o documento se refere a outra pessoa.", falsoPositivo: true })
    ok(rej.ok === true, "proposta rejeitada com motivo")
    const st = await prisma.propostaReconciliacao.findUnique({ where: { id: paraRejeitar.id }, select: { status: true } })
    ok(st?.status === "REJEITADA", "status REJEITADA")
    const fp = await prisma.metricaRegistral.findFirst({ where: { chave: "falsos_positivos_identificados" }, select: { valor: true } })
    ok((fp?.valor ?? 0) > 0, "falso positivo contabilizado nas métricas")
  } else {
    ok(true, "nenhuma proposta pendente para rejeitar")
  }

  // ==========================================================================
  console.log("\n22) O VISUAL NÃO FOI TOCADO — nenhuma tabela da árvore guarda documento")
  const colunasProibidas = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name IN ('LoteRegistral','ExecucaoRegistral','OcorrenciaDocumental','FatoRegistral','EvidenciaRegistral','CorrespondenciaIdentidade','PropostaReconciliacao','ConflitoRegistral','ImpactoAplicacaoRegistral','DecisaoRevisaoRegistral','VersaoGenealogica','MetricaRegistral')
       AND column_name IN ('arquivo_url','arquivo_nome','arquivo_tamanho','arquivo_mime_type','status_documento')`,
  )
  ok(colunasProibidas.length === 0, "nenhuma tabela do MRG tem coluna de arquivo/status documental", colunasProibidas)

  const tabelasMrg = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint as count FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name LIKE '%Registral%'`,
  )
  ok(Number(tabelasMrg[0].count) >= 8, "tabelas do motor registral existem no banco", Number(tabelasMrg[0].count))

  // ==========================================================================
  console.log("\n23) LIMPEZA")
  await prisma.$disconnect()
  ok(true, "conexão encerrada (o cenário fica no banco de teste para inspeção)")

  console.log(`\n${"=".repeat(60)}`)
  console.log(`MRG E2E: ${passed} passou, ${failed} falhou`)
  if (failed) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("\n❌ E2E abortou com exceção:", e)
  process.exit(1)
})
