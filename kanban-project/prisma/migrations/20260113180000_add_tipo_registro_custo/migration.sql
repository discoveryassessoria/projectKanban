ALTER TABLE "CustoPessoa" DROP CONSTRAINT IF EXISTS "CustoPessoa_processoId_pessoaId_tipoServicoId_key";
ALTER TABLE "CustoPessoa" ADD COLUMN IF NOT EXISTS "tipoRegistro" VARCHAR(20);
ALTER TABLE "CustoPessoa" ADD CONSTRAINT "CustoPessoa_processoId_pessoaId_tipoServicoId_tipoRegistro_key" UNIQUE NULLS NOT DISTINCT ("processoId", "pessoaId", "tipoServicoId", "tipoRegistro");