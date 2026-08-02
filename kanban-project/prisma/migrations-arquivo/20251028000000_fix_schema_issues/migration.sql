-- Remove coluna incorreta requerenteId de ProjetoKanban
ALTER TABLE "public"."ProjetoKanban" DROP COLUMN IF EXISTS "requerenteId";

-- Remove foreign key incorreta se existir
ALTER TABLE "public"."ProjetoKanban" DROP CONSTRAINT IF EXISTS "ProjetoKanban_requerenteId_fkey";

-- Adiciona coluna arvore_id na tabela Atividade
ALTER TABLE "public"."Atividade" ADD COLUMN IF NOT EXISTS "arvore_id" INTEGER;

-- Adiciona foreign key para arvore_id
ALTER TABLE "public"."Atividade" ADD CONSTRAINT "Atividade_arvore_id_fkey" 
  FOREIGN KEY ("arvore_id") REFERENCES "public"."Arvore"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable ProjetoRequerente (Many-to-Many)
CREATE TABLE IF NOT EXISTS "public"."ProjetoRequerente" (
    "projetoId" INTEGER NOT NULL,
    "requerenteId" INTEGER NOT NULL,

    CONSTRAINT "ProjetoRequerente_pkey" PRIMARY KEY ("projetoId","requerenteId")
);

-- AddForeignKey para ProjetoRequerente
ALTER TABLE "public"."ProjetoRequerente" ADD CONSTRAINT "ProjetoRequerente_projetoId_fkey" 
  FOREIGN KEY ("projetoId") REFERENCES "public"."ProjetoKanban"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ProjetoRequerente" ADD CONSTRAINT "ProjetoRequerente_requerenteId_fkey" 
  FOREIGN KEY ("requerenteId") REFERENCES "public"."Requerente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
