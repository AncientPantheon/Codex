/**
 * pact-theme — cloned VERBATIM from OuronetUI `src/lang-pact/pact-theme.ts`.
 * No relative imports → no transforms needed (all imports are @codemirror/@lezer).
 */

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const pactEditorTheme = EditorView.theme(
  {
    "&": {
      color: "#d2d3d4",
      backgroundColor: "#18181B",
    },
    ".cm-content": {
      caretColor: "#ceac5f",
      fontFamily: "JetBrains Mono, Consolas, monospace",
    },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: "#ceac5f",
    },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "#264f78",
    },
    ".cm-gutters": {
      backgroundColor: "#0a0a0a",
      color: "#525252",
      border: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#18181B",
    },
    ".cm-activeLine": {
      backgroundColor: "#ffffff08",
    },
    ".cm-searchMatch": {
      backgroundColor: "#ceac5f33",
      outline: "1px solid #ceac5f66",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "#ceac5f55",
    },
  },
  { dark: true }
);

const pactHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "#c586c0" },
  { tag: t.definitionKeyword, color: "#c586c0", fontWeight: "bold" },
  { tag: t.typeName, color: "#4ec9b0" },
  { tag: t.variableName, color: "#9cdcfe" },
  { tag: t.string, color: "#ce9178" },
  { tag: t.number, color: "#b5cea8" },
  { tag: t.bool, color: "#569cd6" },
  { tag: t.comment, color: "#6a9955", fontStyle: "italic" },
  { tag: t.paren, color: "#ffd700" },
  { tag: t.squareBracket, color: "#da70d6" },
  { tag: t.brace, color: "#179fff" },
  { tag: t.atom, color: "#d7ba7d" },
  { tag: t.operator, color: "#d4d4d4" },
  { tag: t.meta, color: "#ceac5f" },
  { tag: t.propertyName, color: "#9cdcfe" },
]);

export const pactTheme = [pactEditorTheme, syntaxHighlighting(pactHighlightStyle)];
