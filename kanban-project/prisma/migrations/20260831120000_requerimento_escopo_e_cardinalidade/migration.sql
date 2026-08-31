-- ============================================================================
-- REQUERIMENTO: ESCOPO, NÚMERO DO PROCESSO E CARDINALIDADE
-- ----------------------------------------------------------------------------
-- ADITIVA. Nenhuma coluna é removida e nenhum dado é reescrito nesta migration;
-- as remoções (`Protocolo.requerenteId`, `InformacaoItalia`, enums `Tribunal` e
-- `Consulado`) vão numa migration própria, no deploy seguinte, depois que o
-- código parar de lê-las.
--
-- O QUE ENTRA:
--   1. `numeroProcesso` — o número que o ÓRGÃO dá ao dossiê (ruolo generale /
--      expediente). Diferente de `numeroProtocolo`, que prova a entrega.
--   2. `finalidade` e `situacao` — para quê o ato serve e o que o órgão respondeu.
--   3. `ProtocoloRequerente` — quem o protocolo cobre. Um só (Espanha, consular)
--      ou a família inteira (Itália, judicial): o MESMO modelo.
--   4. `ProtocoloExigencia` — o que o órgão pediu e até quando.
--   5. `ModalidadeLegal.cardinalidadeRequerimento` — a regra vira CADASTRO.
-- ============================================================================

ALTER TABLE "Protocolo" ADD COLUMN IF NOT EXISTS "numeroProcesso" VARCHAR(100);
ALTER TABLE "Protocolo" ADD COLUMN IF NOT EXISTS "finalidade" VARCHAR(30) NOT NULL DEFAULT 'REQUERIMENTO';
ALTER TABLE "Protocolo" ADD COLUMN IF NOT EXISTS "situacao" VARCHAR(30) NOT NULL DEFAULT 'PROTOCOLADO';
ALTER TABLE "Protocolo" ADD COLUMN IF NOT EXISTS "situacaoEm" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ProtocoloRequerente" (
    "protocoloId" INTEGER NOT NULL,
    "requerenteId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProtocoloRequerente_pkey" PRIMARY KEY ("protocoloId","requerenteId")
);

CREATE TABLE IF NOT EXISTS "ProtocoloExigencia" (
    "id" SERIAL NOT NULL,
    "protocoloId" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "prazo" TIMESTAMP(3),
    "cumpridaEm" TIMESTAMP(3),
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProtocoloExigencia_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ModalidadeLegal" ADD COLUMN IF NOT EXISTS "cardinalidadeRequerimento" VARCHAR(20) NOT NULL DEFAULT 'INDIVIDUAL';

-- ── Índices ────────────────────────────────────────────────────────────────
-- O relatório que a operação pede — "tudo que foi protocolado neste consulado
-- neste mês" — varre órgão + data juntos, para os dois países.
CREATE INDEX IF NOT EXISTS "Protocolo_orgaoId_dataProtocolo_idx" ON "Protocolo"("orgaoId", "dataProtocolo");
CREATE INDEX IF NOT EXISTS "Protocolo_finalidade_situacao_idx" ON "Protocolo"("finalidade", "situacao");
CREATE INDEX IF NOT EXISTS "ProtocoloRequerente_requerenteId_idx" ON "ProtocoloRequerente"("requerenteId");
CREATE INDEX IF NOT EXISTS "ProtocoloExigencia_protocoloId_idx" ON "ProtocoloExigencia"("protocoloId");
CREATE INDEX IF NOT EXISTS "ProtocoloExigencia_prazo_idx" ON "ProtocoloExigencia"("prazo");
CREATE INDEX IF NOT EXISTS "ProtocoloExigencia_cumpridaEm_idx" ON "ProtocoloExigencia"("cumpridaEm");

-- ── Integridade referencial ────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "ProtocoloRequerente" ADD CONSTRAINT "ProtocoloRequerente_protocoloId_fkey"
    FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProtocoloRequerente" ADD CONSTRAINT "ProtocoloRequerente_requerenteId_fkey"
    FOREIGN KEY ("requerenteId") REFERENCES "Requerente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProtocoloExigencia" ADD CONSTRAINT "ProtocoloExigencia_protocoloId_fkey"
    FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── INVARIANTES DO BANCO ───────────────────────────────────────────────────
-- Regras que o serviço também aplica, mas que precisam existir AQUI: serviço se
-- contorna com um script, banco não.

-- 1) DOIS REQUERIMENTOS PARA A MESMA PESSOA NO MESMO PROCESSO NÃO EXISTEM.
--    Na Espanha isso seria a mesma pessoa com dois expedientes; na Itália, a
--    mesma pessoa dentro de dois ricorsi. Erro caro e silencioso: só aparece
--    meses depois, quando um dos dois é indeferido.
--
--    É TRIGGER, e não índice único, porque a regra depende de uma coluna do
--    protocolo (`processoId`, `finalidade`) e não da linha de vínculo. Índice
--    parcial com subconsulta o Postgres recusa, e desnormalizar `processoId`
--    para dentro do vínculo criaria uma segunda fonte de verdade do mesmo fato.
CREATE OR REPLACE FUNCTION "protocolo_requerente_um_requerimento_por_processo"()
RETURNS TRIGGER AS $trg$
DECLARE
  v_processo   INTEGER;
  v_finalidade VARCHAR(30);
  v_conflito   INTEGER;
BEGIN
  SELECT p."processoId", p."finalidade" INTO v_processo, v_finalidade
    FROM "Protocolo" p WHERE p."id" = NEW."protocoloId";

  -- Só o REQUERIMENTO é único. Retificação, certidão e complementação podem
  -- repetir quantas vezes a operação precisar.
  IF v_finalidade IS DISTINCT FROM 'REQUERIMENTO' THEN
    RETURN NEW;
  END IF;

  SELECT pr."protocoloId" INTO v_conflito
    FROM "ProtocoloRequerente" pr
    JOIN "Protocolo" p2 ON p2."id" = pr."protocoloId"
   WHERE pr."requerenteId" = NEW."requerenteId"
     AND pr."protocoloId" <> NEW."protocoloId"
     AND p2."processoId" = v_processo
     AND p2."finalidade" = 'REQUERIMENTO'
     AND p2."situacao" <> 'ARQUIVADO'
   LIMIT 1;

  IF v_conflito IS NOT NULL THEN
    RAISE EXCEPTION 'REQUERENTE_JA_TEM_REQUERIMENTO: requerente % ja e coberto pelo protocolo % neste processo',
      NEW."requerenteId", v_conflito
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$trg$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_protocolo_requerente_unico" ON "ProtocoloRequerente";
CREATE TRIGGER "trg_protocolo_requerente_unico"
  BEFORE INSERT OR UPDATE ON "ProtocoloRequerente"
  FOR EACH ROW EXECUTE FUNCTION "protocolo_requerente_um_requerimento_por_processo"();

-- 2) O NÚMERO DO PROCESSO É ÚNICO DENTRO DO ÓRGÃO.
--    Dois processos com o mesmo R.G. no mesmo tribunal é digitação errada, não
--    realidade. Parcial: só quando o número existe.
CREATE UNIQUE INDEX IF NOT EXISTS "Protocolo_numeroProcesso_por_orgao"
  ON "Protocolo"("orgaoId", "numeroProcesso")
  WHERE "numeroProcesso" IS NOT NULL AND "orgaoId" IS NOT NULL;

-- 3) CATÁLOGOS FECHADOS. Texto livre em coluna de classificação é como o
--    sistema ganha um sexto significado que ninguém declarou.
DO $$ BEGIN
  ALTER TABLE "Protocolo" ADD CONSTRAINT "Protocolo_finalidade_check"
    CHECK ("finalidade" IN ('REQUERIMENTO','RETIFICACAO','CERTIDAO','COMPLEMENTACAO','RECURSO','OUTRO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Protocolo" ADD CONSTRAINT "Protocolo_situacao_check"
    CHECK ("situacao" IN ('PROTOCOLADO','EM_ANALISE','EXIGENCIA','DEFERIDO','INDEFERIDO','ARQUIVADO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ModalidadeLegal" ADD CONSTRAINT "ModalidadeLegal_cardinalidade_check"
    CHECK ("cardinalidadeRequerimento" IN ('INDIVIDUAL','COLETIVO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
