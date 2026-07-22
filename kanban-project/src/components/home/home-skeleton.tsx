"use client"

// Skeleton do Centro Operacional — mesma malha da página real (glass/dark),
// para não haver salto de layout durante o carregamento.
export function HomeSkeleton() {
  const bloco = "animate-pulse rounded-xl border border-white/10 bg-white/[0.05] backdrop-blur-md"
  return (
    <div
      className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6"
      aria-busy="true"
      aria-label="Carregando o centro operacional"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="h-7 w-64 animate-pulse rounded bg-white/10" />
          <div className="h-4 w-48 animate-pulse rounded bg-white/10" />
          <div className="h-4 w-56 animate-pulse rounded bg-white/10" />
        </div>
        <div className="h-10 w-full animate-pulse rounded-lg bg-white/10 lg:w-96" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className={`${bloco} h-[420px] lg:col-span-2`} />
        <div className="space-y-5">
          <div className={`${bloco} h-56`} />
          <div className={`${bloco} h-40`} />
        </div>
      </div>

      <div className={`${bloco} h-28`} />
    </div>
  )
}
