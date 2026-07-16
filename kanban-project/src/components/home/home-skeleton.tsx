"use client"

import { Skeleton } from "@/components/ui/skeleton"

// Skeleton da Central Operacional — mesma malha da página real, para evitar
// salto de layout durante o carregamento.
export function HomeSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 md:px-6" aria-busy="true" aria-label="Carregando central operacional">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-2 h-7 w-64" />
        <Skeleton className="mt-2 h-4 w-80" />
        <Skeleton className="mt-4 h-10 w-full" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <div className="space-y-5">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}
