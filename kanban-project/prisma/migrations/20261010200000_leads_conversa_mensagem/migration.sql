-- LEADS — primeiro atendimento pelo WhatsApp (agente de IA) e tela de Leads.
-- Mandato: docs/leads-mandato.md.
--
-- Duas tabelas NOVAS (LeadConversa, LeadMensagem). Nada existente é alterado: sem coluna nova em
-- tabela antiga, sem backfill, sem DROP. Lead não é Tarefa, Processo, Contratante nem Requerente.
--
-- ADITIVA e IDEMPOTENTE (IF NOT EXISTS; FKs em bloco guardado).
-- Rollback: DROP TABLE "LeadMensagem"; DROP TABLE "LeadConversa"; (nenhuma outra tabela depende delas).

-- CreateTable
CREATE TABLE IF NOT EXISTS "LeadConversa" (
    "id" SERIAL NOT NULL,
    "telefone" VARCHAR(32) NOT NULL,
    "nomeWhats" VARCHAR(200),
    "estado" VARCHAR(12) NOT NULL DEFAULT 'AGENTE',
    "motivoPassagem" VARCHAR(300),
    "ficha" JSONB,
    "linhagem" JSONB,
    "resumo" TEXT,
    "contextoIa" JSONB,
    "ultimaDoLeadEm" TIMESTAMP(3),
    "ultimaDoLeadWamid" VARCHAR(200),
    "ultimaAtividadeEm" TIMESTAMP(3),
    "passouEm" TIMESTAMP(3),
    "encerradaEm" TIMESTAMP(3),
    "motivoEncerramento" VARCHAR(300),
    "processandoAte" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadConversa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LeadMensagem" (
    "id" SERIAL NOT NULL,
    "conversaId" INTEGER NOT NULL,
    "de" VARCHAR(12) NOT NULL,
    "autorId" INTEGER,
    "texto" TEXT NOT NULL,
    "wamid" VARCHAR(200),
    "midiaId" VARCHAR(200),
    "midiaTipo" VARCHAR(20),
    "midiaNome" VARCHAR(300),
    "aguardaAgente" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadMensagem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LeadConversa_telefone_key" ON "LeadConversa"("telefone");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeadConversa_estado_ultimaAtividadeEm_idx" ON "LeadConversa"("estado", "ultimaAtividadeEm");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LeadMensagem_wamid_key" ON "LeadMensagem"("wamid");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeadMensagem_conversaId_criadoEm_idx" ON "LeadMensagem"("conversaId", "criadoEm");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeadMensagem_conversaId_aguardaAgente_idx" ON "LeadMensagem"("conversaId", "aguardaAgente");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadMensagem_conversaId_fkey') THEN
    ALTER TABLE "LeadMensagem" ADD CONSTRAINT "LeadMensagem_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "LeadConversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadMensagem_autorId_fkey') THEN
    ALTER TABLE "LeadMensagem" ADD CONSTRAINT "LeadMensagem_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
