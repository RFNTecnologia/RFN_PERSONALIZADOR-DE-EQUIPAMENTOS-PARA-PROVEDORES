# Guia do aplicativo

- Use React 19, TypeScript 5 estrito, Vite 7 e Tailwind CSS 4 com `@tailwindcss/vite`.
- Esta é uma SPA: mantenha as rotas em React Router 7 e configure fallback para `index.html` na hospedagem.
- `src/main.tsx` inicia React; `src/App.tsx` define as rotas; `src/index.css` guarda tema e estilos globais.
- Reutilize `src/components/ui` (shadcn/ui new-york), os primitivos Radix instalados e os ícones Lucide.
- Crie componentes shadcn à mão em `src/components/ui`, seguindo props tipadas, `data-slot`, variantes e acessibilidade dos existentes; não use CLI para instalar pacotes.
- Importe arquivos locais pelo alias `@/` e combine classes com `cn` de `@/lib/utils`.
- Preserve os tokens Branco · Cobalto em `src/index.css`; a classe `dark` no documento ativa o tema escuro.
- Preserve semântica, navegação por teclado, rótulos acessíveis e layouts responsivos.
- Não adicione dependências novas; use as bibliotecas já declaradas no `package.json`.
- `npm run build` executa `vite build`; `npm run typecheck` executa `tsc --noEmit` separadamente. A prévia atualiza após o build do servidor.
- A saída de produção é `dist`; mantenha `node_modules` e `dist` fora do versionamento.
