/**
 * lang-pact — cloned from OuronetUI `src/lang-pact/index.ts`.
 *
 * Build-seam swap (blueprint §7.7): OuronetUI imports `{ parser }` from the
 * Lezer source `./pact.grammar` (compiled by a Vite plugin). The package builds
 * with tsc only, so the parser is PRE-GENERATED (`npm run gen:pact-parser`) into
 * `./pact.parser.js` and imported from there. Everything else is verbatim.
 */

import { parser } from "./pact.parser.js";
import {
  LRLanguage,
  LanguageSupport,
  indentNodeProp,
  foldNodeProp,
  foldInside,
  delimitedIndent,
} from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";

export const pactLanguage = LRLanguage.define({
  parser: parser.configure({
    props: [
      indentNodeProp.add({
        Application: delimitedIndent({ closing: ")", align: false }),
        List: delimitedIndent({ closing: "]", align: false }),
        Object: delimitedIndent({ closing: "}", align: false }),
      }),
      foldNodeProp.add({
        Application: foldInside,
        List: foldInside,
        Object: foldInside,
      }),
      styleTags({
        Keyword: t.keyword,
        DefKeyword: t.definitionKeyword,
        TypeKeyword: t.typeName,
        Boolean: t.bool,
        String: t.string,
        Number: t.number,
        Decimal: t.number,
        LineComment: t.lineComment,
        Identifier: t.variableName,
        Symbol: t.atom,
        Operator: t.operator,
        MetaTag: t.meta,
        PropertyName: t.propertyName,
        "( )": t.paren,
        "[ ]": t.squareBracket,
        "{ }": t.brace,
      }),
    ],
  }),
  languageData: {
    commentTokens: { line: ";;" },
    closeBrackets: { brackets: ["(", "[", "{", '"'] },
  },
});

export function pact() {
  return new LanguageSupport(pactLanguage);
}
