import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Filter, RefreshCw, Search } from 'lucide-react'
import { useEstado } from '@/lib/store'
import { formatarRelativo, rotuloTipo } from '@/lib/format'
import type { StatusCPE, TipoEquipamento } from '@/lib/types'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'

const tipos: TipoEquipamento[] = ['roteador', 'ont', 'modem', 'mesh', 'switch']
const status: StatusCPE[] = ['online', 'offline', 'provisionando', 'atualizando', 'em-recuperacao']

export function Equipamentos() {
  const { equipamentos, clientes, perfis, registrarLog, atualizarEquipamento } = useEstado()
  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState<string>('todos')
  const [filtroStatus, setFiltroStatus] = useState<string>('todos')

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return equipamentos.filter((eq) => {
      const cliente = clientes.find((c) => c.id === eq.clienteId)
      const alvo = `${eq.serial} ${eq.modelo} ${eq.fabricante} ${eq.mac} ${cliente?.nome ?? ''} ${cliente?.contrato ?? ''}`.toLowerCase()
      if (termo && !alvo.includes(termo)) return false
      if (tipo !== 'todos' && eq.tipo !== tipo) return false
      if (filtroStatus !== 'todos' && eq.status !== filtroStatus) return false
      return true
    })
  }, [equipamentos, clientes, busca, tipo, filtroStatus])

  function sincronizar(id: string) {
    const eq = equipamentos.find((e) => e.id === id)
    if (!eq) return
    atualizarEquipamento(id, {
      status: 'provisionando',
      sincronizadoEm: null,
      configHash: Math.random().toString(16).slice(2, 10),
    })
    registrarLog({
      tipo: 'provisionamento',
      equipamentoId: id,
      mensagem: 'Sincronização manual disparada',
      detalhe: `Perfil reenviado para ${eq.modelo} (${eq.serial}).`,
      resultado: 'pendente',
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Equipamentos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Roteadores, ONTs, modems e meshes instalados em clientes.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="busca">Buscar</Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="busca"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Serial, modelo, MAC ou contrato"
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger id="tipo">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {tipos.map((t) => (
                    <SelectItem key={t} value={t}>
                      {rotuloTipo[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger id="status">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {status.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace('-', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="size-4" aria-hidden="true" />
            {lista.length} de {equipamentos.length} equipamentos
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Equipamento</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Último contato</TableHead>
                <TableHead>Config</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((eq) => {
                const cliente = clientes.find((c) => c.id === eq.clienteId)
                const perfil = perfis.find((p) => p.id === eq.perfilId)
                return (
                  <TableRow key={eq.id}>
                    <TableCell>
                      <Link
                        to={`/equipamentos/${eq.id}`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {eq.modelo}
                      </Link>
                      <p className="text-xs text-muted-foreground">{eq.serial}</p>
                    </TableCell>
                    <TableCell>
                      <p>{cliente?.nome ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{cliente?.contrato}</p>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-45 truncate">{perfil?.nome ?? '—'}</p>
                      <Badge variant="outline">{rotuloTipo[eq.tipo]}</Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={eq.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatarRelativo(eq.ultimoContato)}
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{eq.configHash}</code>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => sincronizar(eq.id)}
                          className="inline-flex size-8 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          aria-label={`Sincronizar ${eq.serial}`}
                          title="Reaplicar configuração"
                        >
                          <RefreshCw className="size-4" aria-hidden="true" />
                        </button>
                        <Link
                          to={`/equipamentos/${eq.id}`}
                          className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors hover:bg-accent"
                        >
                          Detalhes
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {lista.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Nenhum equipamento encontrado com esses filtros.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
