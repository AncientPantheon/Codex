/**
 * Minimal local clone of OuronetUI's `@/constants/functionAnnotation`
 * `FunctionMetaProp` type. Zone2Wrapper accepts a `functionMeta` prop of this
 * shape purely for the build-time annotation scanner OuronetUI runs over its
 * modals; the value is NEVER read at runtime by the zone itself. The package
 * carries the type so the cloned Zone2Wrapper + modal signatures stay
 * byte-identical to OuronetUI without pulling in OuronetUI's annotation
 * tooling.
 */

export interface FunctionMetaLiteral {
  locations: string[];
  name: string;
  description: string;
  icon: string;
  addedInVersion: string;
  addedDate: string;
  notes?: string[];
}

export interface FunctionMetaRecord extends FunctionMetaLiteral {
  functionName: string;
}

export type FunctionMetaProp = FunctionMetaLiteral | FunctionMetaRecord[];
