/**
 * PowerBuilder 2022 system functions catalog.
 * Extracted from the official Appeon PowerScript Reference (PB 2022) by
 * tools/docs-scraper/ — see server/data/pb2022_functions.json.
 *
 * https://docs.appeon.com/pb2022/powerscript_reference/
 */

import {
  EnumInfo,
  EventInfo,
  FunctionInfo,
  PropertyInfo,
  buildEventIndex,
  buildFunctionIndex,
  formatHover,
  formatSignature,
  loadEnumCatalog,
  loadEventCatalog,
  loadFunctionCatalog,
  loadPropertyCatalog
} from './builtins';
import catalog2022 from './data/pb2022_functions.json';
import events2022 from './data/pb2022_events.json';
import properties2022 from './data/pb2022_properties.json';
import enums2022 from './data/pb2022_enums.json';

// Re-export common formatting functions for use by both versions
export { formatSignature, formatHover };

export const builtinFunctions2022: FunctionInfo[] = loadFunctionCatalog(catalog2022);
export const builtinEvents2022: EventInfo[] = loadEventCatalog(events2022);

const builtinIndex2022 = buildFunctionIndex(builtinFunctions2022);
const eventIndex2022 = buildEventIndex(builtinEvents2022);

export function findBuiltin2022(name: string): FunctionInfo | undefined {
  return builtinIndex2022.get(name.toLowerCase());
}

export function findBuiltinEvent2022(name: string): EventInfo | undefined {
  return eventIndex2022.get(name.toLowerCase());
}

export const propertyMap2022: Map<string, PropertyInfo[]> = loadPropertyCatalog(properties2022);
export const enumMap2022: Map<string, EnumInfo> = loadEnumCatalog(enums2022);
