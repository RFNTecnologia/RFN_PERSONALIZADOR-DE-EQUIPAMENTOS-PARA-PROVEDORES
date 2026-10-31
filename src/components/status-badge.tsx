import { cn } from '@/lib/utils'
import { rotuloStatus } from '@/lib/store'
import type { StatusCPE } from '@/lib/types'
import { Badge } from '@/components/ui/badge'

const variantes: Record<StatusCPE, 'success' | 'secondary' | 'warning' | 'info' | 'danger'> = {
  online: 'success',
  offline: 'secondary',
  provisionando: 'info',
  atualizando: 'warning',
  'em-recuperacao': 'danger',
}

export function StatusBadge({ status, className }: { status: StatusCPE; className?: string }) {
  return (
    <Badge variant={variantes[status]} className={className}>
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'online' && 'bg-emerald-600',
          status === 'offline' && 'bg-slate-400',
          status === 'provisionando' && 'bg-blue-600',
          status === 'atualizando' && 'bg-amber-600',
          status === 'em-recuperacao' && 'bg-red-600',
        )}
        aria-hidden="true"
      />
      {rotuloStatus[status]}
    </Badge>
  )
}
