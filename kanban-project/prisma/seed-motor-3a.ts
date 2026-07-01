/**
 * FASE 3A — Seed dos Modos Internos das Fases (instâncias padrão).
 * 19 modos GLOBAIS por fase (tipoProcessoId = null → valem p/ qualquer processo):
 *   retificacao 5 · protocolado 7 · traducao 3 · apostilamento 4
 * Re-rodável: upsert por modeUid (`all::{phaseKey}::{key}`). Não duplica.
 * phaseKey do mockup 'protocolo' → 'protocolado' (consistente com a 2A).
 *
 * Rodar:  npx tsx prisma/seed-motor-3a.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Def = { phaseKey: string; key: string; label: string; description?: string };

const DEFS: Def[] = [
  // ===== Retificação de Registros (5) =====
  { phaseKey: 'retificacao', key: 'pending_definition', label: 'A definir', description: 'Modo ainda não definido.' },
  { phaseKey: 'retificacao', key: 'administrative', label: 'Administrativa', description: 'Retificação por via administrativa (cartório).' },
  { phaseKey: 'retificacao', key: 'judicial', label: 'Judicial', description: 'Retificação por via judicial.' },
  { phaseKey: 'retificacao', key: 'mixed', label: 'Mista', description: 'Retificação por via judicial e administrativa.' },
  { phaseKey: 'retificacao', key: 'not_required', label: 'Não necessária', description: 'Sem necessidade de retificação.' },
  // ===== Protocolado (7) — mockup 'protocolo' =====
  { phaseKey: 'protocolado', key: 'per_applicant', label: 'Por requerente' },
  { phaseKey: 'protocolado', key: 'per_family', label: 'Por família/processo' },
  { phaseKey: 'protocolado', key: 'judicial_case', label: 'Processo judicial' },
  { phaseKey: 'protocolado', key: 'consular_case', label: 'Consular' },
  { phaseKey: 'protocolado', key: 'comune_case', label: 'Comune' },
  { phaseKey: 'protocolado', key: 'conservatoria_case', label: 'Conservatória' },
  { phaseKey: 'protocolado', key: 'administrative_case', label: 'Administrativo' },
  // ===== Tradução (3) =====
  { phaseKey: 'traducao', key: 'full_package_translation', label: 'Pacote completo' },
  { phaseKey: 'traducao', key: 'partial_translation', label: 'Parcial' },
  { phaseKey: 'traducao', key: 'not_required', label: 'Não necessária' },
  // ===== Apostilamento (4) =====
  { phaseKey: 'apostilamento', key: 'full_package_apostille', label: 'Pacote completo' },
  { phaseKey: 'apostilamento', key: 'partial_apostille', label: 'Parcial' },
  { phaseKey: 'apostilamento', key: 'legalization_required', label: 'Legalização' },
  { phaseKey: 'apostilamento', key: 'not_required', label: 'Não necessário' },
];

const uid = (d: Def) => `all::${d.phaseKey}::${d.key}`;

async function main() {
  let created = 0;
  let backfilled = 0;
  for (const d of DEFS) {
    const modeUid = uid(d);
    const existing = await prisma.phaseInternalMode.findUnique({ where: { modeUid } });
    if (existing) {
      backfilled++; // já existe — não mexe (preserva edições do usuário)
    } else {
      await prisma.phaseInternalMode.create({
        data: {
          modeUid,
          templateId: null,
          tipoProcessoId: null,
          phaseKey: d.phaseKey,
          key: d.key,
          label: d.label,
          description: d.description || null,
          active: true,
        },
      });
      created++;
    }
  }
  console.log(`✓ Modos Internos das Fases: ${created} criados, ${backfilled} já existiam. Total esperado: ${DEFS.length}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });