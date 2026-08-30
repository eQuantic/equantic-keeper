import type { Editor, Range } from "@tiptap/core";

/** One slash-menu entry — the same set the legacy `SLASH` array offers. */
export interface SlashItem {
  label: string;
  hint: string;
  /** Runs the insert/convert command after clearing the typed `/query`. */
  run: (editor: Editor, range: Range) => void;
}

/** Delete the `/query` range, then run `fn` on the resulting chain. */
const at = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

export const SLASH_ITEMS: SlashItem[] = [
  { label: "Texto", hint: "Parágrafo simples", run: (e, r) => at(e, r).setNode("paragraph").run() },
  { label: "Título 1", hint: "# Cabeçalho grande", run: (e, r) => at(e, r).setNode("heading", { level: 1 }).run() },
  { label: "Título 2", hint: "## Cabeçalho médio", run: (e, r) => at(e, r).setNode("heading", { level: 2 }).run() },
  { label: "Título 3", hint: "### Cabeçalho menor", run: (e, r) => at(e, r).setNode("heading", { level: 3 }).run() },
  { label: "Lista", hint: "- Item com marcador", run: (e, r) => at(e, r).toggleBulletList().run() },
  { label: "Lista numerada", hint: "1. Item numerado", run: (e, r) => at(e, r).toggleOrderedList().run() },
  { label: "To-do", hint: "[] Caixa de seleção", run: (e, r) => at(e, r).toggleTaskList().run() },
  { label: "Alternável", hint: "Bloco retrátil com filhos", run: (e, r) => at(e, r).setToggle().run() },
  { label: "Citação", hint: "> Bloco de citação", run: (e, r) => at(e, r).toggleBlockquote().run() },
  { label: "Código", hint: "``` Bloco de código", run: (e, r) => at(e, r).setCodeBlockShiki().run() },
  { label: "Destaque", hint: "Nota colorida", run: (e, r) => at(e, r).setCallout().run() },
  { label: "Tabela", hint: "Grade de células", run: (e, r) => at(e, r).insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run() },
  { label: "Imagem", hint: "URL ou upload", run: (e, r) => at(e, r).setImage({ src: "" }).run() },
  { label: "Arquivo", hint: "Anexar um arquivo", run: (e, r) => at(e, r).setFileBlock().run() },
  { label: "Diagrama", hint: "Mermaid (graph, flow…)", run: (e, r) => at(e, r).setMermaid().run() },
  { label: "Equação", hint: "LaTeX (KaTeX)", run: (e, r) => at(e, r).setEquation().run() },
  { label: "Embed", hint: "YouTube, Vimeo, Figma…", run: (e, r) => at(e, r).setEmbed().run() },
  { label: "Divisor", hint: "--- Linha horizontal", run: (e, r) => at(e, r).setHorizontalRule().run() },
];
