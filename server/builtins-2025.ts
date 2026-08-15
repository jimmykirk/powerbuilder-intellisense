/**
 * PowerBuilder 2025 system functions catalog.
 * Extracted from the official Appeon PowerScript Reference (PB 2025) by
 * tools/docs-scraper/ — see server/data/pb2025_functions.json.
 *
 * https://docs.appeon.com/pb2025/powerscript_reference/
 */

import {
  EventInfo,
  FunctionInfo,
  buildEventIndex,
  buildFunctionIndex,
  formatHover,
  formatSignature,
  loadEventCatalog,
  loadFunctionCatalog
} from './builtins';
import catalog2025 from './data/pb2025_functions.json';
import events2025 from './data/pb2025_events.json';

// Re-export common formatting functions for use by both versions
export { formatSignature, formatHover };

export const builtinFunctions2025: FunctionInfo[] = loadFunctionCatalog(catalog2025);
export const builtinEvents2025: EventInfo[] = loadEventCatalog(events2025);

const builtinIndex2025 = buildFunctionIndex(builtinFunctions2025);
const eventIndex2025 = buildEventIndex(builtinEvents2025);

export function findBuiltin2025(name: string): FunctionInfo | undefined {
  return builtinIndex2025.get(name.toLowerCase());
}

export function findBuiltinEvent2025(name: string): EventInfo | undefined {
  return eventIndex2025.get(name.toLowerCase());
}
