// lib/saude/verificacoes/organizacoes.ts
//
// ÓRGÃOS E ORGANIZAÇÕES — a fonte única das organizações do Discovery.
//
// A auditoria SUGERE consolidação; nunca funde nem exclui registro com vínculo.
// Fusão de cadastro é decisão humana com consequência jurídica e financeira.

import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import { chaveDeNome } from '@/src/services/organizacao-identidade'
import type { Achado, ResultadoVerificacao } from '../tipos'

const ROTA = '/administrator?screen=organs'

registrar({
  id: 'saude.organizacoes.sem-codigo',
  codigo: 'ORG-001',
  nome: 'Organização com código público',
  descricao: 'Toda organização precisa de código ORG-n para ser referenciada com segurança.',
  dominio: 'ORGANIZACOES',
  modulo: 'Órgãos e Organizações',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Rode o seed oficial (npm run seed:orgaos) — ele gera código para quem estiver sem.',
  rotaCorrecao: ROTA,
  correcaoAutomatica: 'gerar-codigo-organizacao',
  responsavel: 'Cadastros',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const n = await prisma.orgaoProtocolo.count({ where: { publicCode: null } })
    if (!n) return { achados: [], metricas: { semCodigo: 0 }, resumo: 'Toda organização tem código público.' }
    return {
      achados: [{
        chave: 'organizacao-sem-codigo',
        severidade: 'ALERTA',
        titulo: `${n} organização(ões) sem código público`,
        descricao: `${n} registro(s) do cadastro mestre estão sem código ORG-n.`,
        explicacao: 'O código público é a referência humana estável da organização em protocolos e documentos.',
        impacto: 'A organização não pode ser citada por código em protocolo, ofício ou relatório.',
        entidade: 'OrgaoProtocolo',
        quantidade: n,
        link: ROTA,
        recomendacao: 'Execute o seed oficial para gerar os códigos faltantes.',
        correcaoAutomatica: 'gerar-codigo-organizacao',
        evidencia: { semCodigo: n },
      }],
      metricas: { semCodigo: n },
    }
  },
})

registrar({
  id: 'saude.organizacoes.sem-funcao',
  codigo: 'ORG-002',
  nome: 'Organização com função declarada',
  descricao: 'Organização sem função não é órgão, nem fornecedor, nem parceiro — não se sabe o que ela é.',
  dominio: 'ORGANIZACOES',
  modulo: 'Órgãos e Organizações',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Marque as funções da organização (Órgão, Fornecedor, Parceiro, Correspondente, Cliente Corporativo).',
  rotaCorrecao: ROTA,
  responsavel: 'Cadastros',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.orgaoProtocolo.findMany({
      where: { funcoes: { isEmpty: true } },
      select: { id: true, publicCode: true, name: true }, take: 100,
    })
    if (!linhas.length) return { achados: [], metricas: { semFuncao: 0 }, resumo: 'Toda organização declara pelo menos uma função.' }
    return {
      achados: [{
        chave: 'organizacao-sem-funcao',
        severidade: 'ERRO',
        titulo: `${linhas.length} organização(ões) sem função`,
        descricao: `${linhas.length} organização(ões) não têm nenhuma função marcada.`,
        explicacao: 'A função é o que classifica a organização — inclusive se ela pode receber pagamento (Fornecedor).',
        impacto: 'A organização não aparece nos seletores por função e não pode ser usada no financeiro.',
        entidade: 'OrgaoProtocolo',
        registroId: String(linhas[0].id),
        registroNome: linhas[0].name,
        quantidade: linhas.length,
        link: ROTA,
        recomendacao: 'Marque as funções corretas em cada organização listada.',
        evidencia: { total: linhas.length, amostra: linhas.slice(0, 8) },
      }],
      metricas: { semFuncao: linhas.length },
    }
  },
})

registrar({
  id: 'saude.organizacoes.duplicidade',
  codigo: 'ORG-003',
  nome: 'Organização sem duplicidade',
  descricao: 'Detecta a mesma entidade cadastrada duas vezes por nome normalizado + país, nome fantasia ou identificação fiscal.',
  dominio: 'DUPLICIDADES',
  modulo: 'Órgãos e Organizações',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 30_000,
  orientacao: 'Consolide manualmente: escolha o registro que fica, mova as funções e categorias, e só então inative o outro. A auditoria NUNCA funde sozinha.',
  rotaCorrecao: ROTA,
  responsavel: 'Cadastros',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const todas = await prisma.orgaoProtocolo.findMany({
      select: {
        id: true, publicCode: true, name: true, nomeFantasia: true, identificacaoFiscal: true,
        paisId: true, pais: { select: { countryLabel: true } },
      },
    })
    const achados: Achado[] = []

    // 1) nome oficial normalizado + país (pega acento, caixa, pontuação)
    const porChave = new Map<string, typeof todas>()
    for (const o of todas) {
      // Agrupa pela IDENTIDADE do país. Antes, duas grafias do mesmo país
      // ("Italia" e "Itália") escondiam a duplicata em vez de mostrá-la.
      const k = `${chaveDeNome(o.name)}::${o.paisId ?? ''}`
      const l = porChave.get(k) ?? []
      l.push(o)
      porChave.set(k, l)
    }
    for (const [, grupo] of porChave) {
      if (grupo.length < 2) continue
      achados.push({
        chave: `org-duplicada-nome:${grupo.map((g) => g.id).sort().join('-')}`,
        severidade: 'ERRO',
        titulo: `${grupo.length} cadastros da mesma organização: "${grupo[0].name}"`,
        descricao: `Os registros ${grupo.map((g) => g.publicCode ?? `#${g.id}`).join(', ')} têm o mesmo nome oficial (normalizado) no mesmo país.`,
        explicacao: 'A organização é única no Discovery: a mesma entidade cadastrada duas vezes divide histórico, protocolos e financeiro.',
        impacto: 'Protocolos e custos ficam espalhados entre registros diferentes; relatórios por organização ficam errados.',
        entidade: 'OrgaoProtocolo',
        registroId: String(grupo[0].id),
        registroNome: grupo[0].name,
        quantidade: grupo.length,
        link: ROTA,
        recomendacao: 'Consolide manualmente: mantenha um registro, transfira funções/categorias e inative o outro. Nunca exclua registro com vínculo.',
        evidencia: { registros: grupo.map((g) => ({ id: g.id, codigo: g.publicCode, nome: g.name, pais: g.pais?.countryLabel ?? null })) },
      })
    }

    // 2) mesma identificação fiscal (o banco já barra, mas variação de máscara em
    //    dados antigos pode ter escapado)
    const porFiscal = new Map<string, typeof todas>()
    for (const o of todas) {
      if (!o.identificacaoFiscal) continue
      const l = porFiscal.get(o.identificacaoFiscal) ?? []
      l.push(o)
      porFiscal.set(o.identificacaoFiscal, l)
    }
    for (const [fiscal, grupo] of porFiscal) {
      if (grupo.length < 2) continue
      achados.push({
        chave: `org-duplicada-fiscal:${fiscal}`,
        severidade: 'CRITICO',
        titulo: `${grupo.length} cadastros com a mesma identificação fiscal`,
        descricao: `Os registros ${grupo.map((g) => g.publicCode ?? `#${g.id}`).join(', ')} compartilham a identificação fiscal ${fiscal}.`,
        explicacao: 'Identificação fiscal é a chave forte de identidade: mesma inscrição = mesma pessoa jurídica.',
        impacto: 'Pagamentos e notas podem ser emitidos contra cadastros diferentes da mesma empresa.',
        entidade: 'OrgaoProtocolo',
        registroId: String(grupo[0].id),
        quantidade: grupo.length,
        link: ROTA,
        recomendacao: 'Consolide os cadastros manualmente e mantenha uma única identificação fiscal.',
        evidencia: { identificacaoFiscal: fiscal, registros: grupo.map((g) => ({ id: g.id, codigo: g.publicCode, nome: g.name })) },
      })
    }

    return {
      achados,
      metricas: { organizacoes: todas.length, gruposDuplicados: achados.length },
      resumo: `${todas.length} organizações sem duplicidade detectada.`,
    }
  },
})

registrar({
  id: 'saude.organizacoes.fornecedor-sem-minimo',
  codigo: 'ORG-004',
  nome: 'Fornecedor com configuração mínima',
  descricao: 'Organização marcada como Fornecedor deveria ter ao menos moeda definida para receber pagamento.',
  dominio: 'ORGANIZACOES',
  modulo: 'Órgãos e Organizações',
  severidadePadrao: 'INFORMATIVO',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Complete moeda e forma de pagamento do fornecedor quando ele for efetivamente pago.',
  rotaCorrecao: ROTA,
  responsavel: 'Financeiro',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const n = await prisma.orgaoProtocolo.count({ where: { funcoes: { has: 'FORNECEDOR' }, ativo: true, moeda: null } })
    if (!n) return { achados: [], metricas: { fornecedoresSemMoeda: 0 }, resumo: 'Todo fornecedor ativo tem moeda definida.' }
    return {
      achados: [{
        chave: 'fornecedor-sem-moeda',
        severidade: 'INFORMATIVO',
        titulo: `${n} fornecedor(es) sem moeda definida`,
        descricao: `${n} organização(ões) com função Fornecedor não têm moeda padrão.`,
        explicacao: 'A moeda do fornecedor orienta o lançamento do custo e a conversão cambial.',
        impacto: 'Não bloqueia: o custo assume a moeda do processo. Mas a conferência fica manual.',
        entidade: 'OrgaoProtocolo',
        quantidade: n,
        link: ROTA,
        recomendacao: 'Defina a moeda ao efetivamente contratar o fornecedor.',
        evidencia: { fornecedoresSemMoeda: n },
      }],
      metricas: { fornecedoresSemMoeda: n },
    }
  },
})

registrar({
  id: 'saude.organizacoes.vinculo-categoria-orfao',
  codigo: 'ORG-005',
  nome: 'Vínculo de categoria íntegro',
  descricao: 'Vínculo apontando para organização ou categoria inexistente é referência quebrada.',
  dominio: 'INTEGRIDADE',
  modulo: 'Órgãos e Organizações',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Remova os vínculos órfãos ou recrie a categoria/organização faltante.',
  rotaCorrecao: ROTA,
  responsavel: 'Cadastros',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "OrganizacaoCategoria" v
        WHERE NOT EXISTS (SELECT 1 FROM "OrgaoProtocolo" o WHERE o.id = v."orgaoId")
           OR NOT EXISTS (SELECT 1 FROM "CategoriaOrganizacao" c WHERE c.id = v."categoriaId")`,
    )
    const n = r?.[0]?.n ?? 0
    if (!n) return { achados: [], metricas: { orfaos: 0 }, resumo: 'Todo vínculo de categoria aponta para registros existentes.' }
    return {
      achados: [{
        chave: 'vinculo-categoria-orfao',
        severidade: 'ERRO',
        titulo: `${n} vínculo(s) de categoria órfão(s)`,
        descricao: `${n} vínculo(s) apontam para organização ou categoria que não existe mais.`,
        explicacao: 'A tabela de vínculo tem FK com cascade; órfãos indicam escrita fora do fluxo oficial.',
        impacto: 'A classificação da organização fica incorreta e filtros por categoria perdem registros.',
        entidade: 'OrganizacaoCategoria',
        quantidade: n,
        link: ROTA,
        recomendacao: 'Remova os vínculos órfãos após confirmar a origem.',
        evidencia: { orfaos: n },
      }],
      metricas: { orfaos: n },
    }
  },
})
