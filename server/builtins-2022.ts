/**
 * PowerBuilder 2022 system functions catalog.
 * Extracted from the official Appeon PowerScript Reference (PB 2022) by
 * tools/docs-scraper/ — see server/data/pb2022_functions.json.
 *
 * https://docs.appeon.com/pb2022/powerscript_reference/
 */

import {
  FunctionInfo,
  buildFunctionIndex,
  formatHover,
  formatSignature,
  loadFunctionCatalog
} from './builtins';
import catalog2022 from './data/pb2022_functions.json';

// Re-export common formatting functions for use by both versions
export { formatSignature, formatHover };

export const builtinFunctions2022: FunctionInfo[] = loadFunctionCatalog(catalog2022);

const builtinIndex2022 = buildFunctionIndex(builtinFunctions2022);

export function findBuiltin2022(name: string): FunctionInfo | undefined {
  return builtinIndex2022.get(name.toLowerCase());
}
