// src/app/api/gerenciamento/integracoes/route.ts
//
// STATUS DAS INTEGRAÇÕES (somente leitura). Não configura nada, não escreve nada:
// apenas reporta o estado REAL de cada integração já existente no sistema.
//
// SEGURANÇA: nunca devolve valor de variável de ambiente — só se está DEFINIDA.
//
// Integrações reportadas:
//   • Câmbio (Confidence)  — credencial configurada + última cotação vigente
//   • Armazenamento (R2)   — credenciais configuradas
//   • Motor de workflow    — MotorConfig (runtime v2 / execução automática)
//   • Agendamentos (cron)  — jobs declarados no vercel.json

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const definida = (k: string) => !!process.env[k] && String(process.env[k]).trim() !== ''

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const [ultimaCotacao, motor] = await Promise.all([
      prisma.cotacaoCambio.findFirst({
        where: { vigente: true },
        orderBy: [{ dataReferencia: 'desc' }, { criadoEm: 'desc' }],
        select: {
          moedaDe: true, moedaPara: true, taxa: true, dataReferencia: true, consultadoEm: true,
          origem: true, statusIntegracao: true, semNovaPublicacao: true, fonte: true,
        },
      }).catch(() => null),
      prisma.motorConfig.findUnique({ where: { id: 1 } }).catch(() => null),
    ])

    // O provider Confidence tem endpoint e credencial EMBUTIDOS (com override por
    // ambiente). Portanto "configurado" é sempre verdadeiro — o que informamos é se
    // há override de ambiente e qual foi o resultado da última consulta real.
    const overrideCambio = definida('CONFIDENCE_BASE_URL') || definida('CONFIDENCE_AUTH')
    const credenciaisStorage =
      definida('R2_ACCOUNT_ID') && definida('R2_ACCESS_KEY_ID') &&
      definida('R2_SECRET_ACCESS_KEY') && definida('R2_BUCKET')

    return NextResponse.json({
      ambiente: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'desconhecido',
      integracoes: [
        {
          chave: 'cambio',
          nome: 'Câmbio (Confidence)',
          descricao: 'Cotação diária EUR/USD → BRL usada pelo Financeiro.',
          configurado: true,
          estado: ultimaCotacao?.statusIntegracao ?? (ultimaCotacao ? 'ATUALIZADO' : 'SEM_DADOS'),
          detalhes: {
            overrideDeAmbiente: overrideCambio,
            ...(ultimaCotacao
              ? {
                  par: `${ultimaCotacao.moedaDe}→${ultimaCotacao.moedaPara}`,
                  taxa: Number(ultimaCotacao.taxa),
                  dataReferencia: ultimaCotacao.dataReferencia,
                  consultadoEm: ultimaCotacao.consultadoEm,
                  origem: ultimaCotacao.origem,
                  fonte: ultimaCotacao.fonte,
                  semNovaPublicacao: ultimaCotacao.semNovaPublicacao,
                }
              : {}),
          },
          ondeConfigurar: 'Variáveis de ambiente CONFIDENCE_* (opcionais — o provider tem endpoint padrão)',
          telaRelacionada: 'Financeiro › Moedas › Câmbio',
        },
        {
          chave: 'storage',
          nome: 'Armazenamento de arquivos (Cloudflare R2)',
          descricao: 'Guarda anexos de processos, documentos e comprovantes.',
          configurado: credenciaisStorage,
          estado: credenciaisStorage ? 'ATIVO' : 'CONFIGURACAO_PENDENTE',
          detalhes: { bucketDefinido: definida('R2_BUCKET'), urlPublicaDefinida: definida('R2_PUBLIC_URL') },
          ondeConfigurar: 'Variáveis de ambiente (R2_*)',
          telaRelacionada: null,
        },
        {
          chave: 'motor',
          nome: 'Motor de workflow (runtime)',
          descricao: 'Chave global do runtime v2 e execução automática ao avançar de fase.',
          configurado: !!motor,
          estado: motor ? (motor.runtimeV2Habilitado ? 'RUNTIME_V2_HABILITADO' : 'RUNTIME_V2_DESABILITADO') : 'SEM_DADOS',
          detalhes: motor
            ? {
                runtimeV2Habilitado: motor.runtimeV2Habilitado,
                autoExecutarAoAvancar: motor.autoExecutarAoAvancar,
                atualizadoEm: motor.atualizadoEm,
              }
            : null,
          ondeConfigurar: 'Workflow › Configurações › Executor do Motor',
          telaRelacionada: 'Workflow › Configurações',
        },
        {
          chave: 'cron',
          nome: 'Agendamentos (cron)',
          descricao: 'Rotinas executadas automaticamente pela plataforma.',
          configurado: definida('CRON_SECRET'),
          estado: definida('CRON_SECRET') ? 'DECLARADO' : 'SEGREDO_PENDENTE',
          detalhes: {
            segredoDefinido: definida('CRON_SECRET'),
            jobs: [{ path: '/api/cron/cambio', schedule: '0 12 * * *', descricao: 'Atualiza a cotação do dia' }],
          },
          ondeConfigurar: 'vercel.json (crons)',
          telaRelacionada: 'Financeiro › Moedas › Câmbio',
        },
      ],
    })
  } catch (e) {
    console.error('GET integracoes', e)
    return NextResponse.json({ error: 'Erro ao carregar o status das integrações.' }, { status: 500 })
  }
}
