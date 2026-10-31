import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Activity,
  Cpu,
  LayoutDashboard,
  LifeBuoy,
  Palette,
  RotateCcw,
  Radar,
  Server,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ItemNav {
  para: string
  rotulo: string
  icone: typeof LayoutDashboard
  descricao: string
}

const itens: ItemNav[] = [
  { para: '/', rotulo: 'Painel', icone: LayoutDashboard, descricao: 'Visão geral da frota' },
  { para: '/equipamentos', rotulo: 'Equipamentos', icone: Cpu, descricao: 'Roteadores, ONTs e meshes' },
  { para: '/personalizacao', rotulo: 'Personalização', icone: Palette, descricao: 'Tela de login do cliente' },
  { para: '/perfis', rotulo: 'Perfis de config.', icone: SlidersHorizontal, descricao: 'Templates por modelo' },
  { para: '/restauracao', rotulo: 'Restauração', icone: LifeBuoy, descricao: 'Política pós-reset' },
  { para: '/simulador', rotulo: 'Simulador', icone: RotateCcw, descricao: 'Teste de reset do cliente' },
  { para: '/auditoria', rotulo: 'Auditoria', icone: Activity, descricao: 'Histórico de provisionamento' },
  { para: '/conexao', rotulo: 'Conexão', icone: Server, descricao: 'ACS, bootstrap e provisionamento' },
  { para: '/varredura', rotulo: 'Varredura', icone: Radar, descricao: 'Localizar equipamentos na rede' },
]

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card lg:flex">
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            FS
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">FibraSul Control</p>
            <p className="truncate text-xs text-muted-foreground">Personalizador de equipamentos</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {itens.map((item) => (
            <NavLink
              key={item.para}
              to={item.para}
              end={item.para === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-start gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <item.icone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block font-medium">{item.rotulo}</span>
                <span className="block truncate text-xs opacity-70">{item.descricao}</span>
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t p-4 text-xs text-muted-foreground">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" />
            Painel + ACS no mesmo servidor
          </p>
          <p className="mt-1">Configure a URL e o token em “Conexão” para operar em campo.</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b bg-card">
          <div className="flex items-center justify-between gap-4 px-4 py-3 lg:px-8">
            <div className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground lg:hidden">
                FS
              </span>
              <div>
                <p className="text-sm font-semibold">FibraSul Telecom</p>
                <p className="text-xs text-muted-foreground">Painel do provedor</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="hidden rounded-full border bg-muted px-2.5 py-1 sm:inline">
                Personalização ativa
              </span>
              <span className="rounded-full border bg-muted px-2.5 py-1">Amostra · 8 CPEs</span>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:hidden">
            {itens.map((item) => (
              <NavLink
                key={item.para}
                to={item.para}
                end={item.para === '/'}
                className={({ isActive }) =>
                  cn(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium',
                    isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                  )
                }
              >
                {item.rotulo}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
