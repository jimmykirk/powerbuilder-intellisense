/**
 * PowerBuilder 2025 system functions catalog.
 * Extracted from the official Appeon PowerScript Reference (PB 2025) by
 * tools/docs-scraper/ — see server/data/pb2025_functions.json.
 *
 * https://docs.appeon.com/pb2025/powerscript_reference/
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
  loadDataWindowCatalog,
  loadEnumCatalog,
  loadEventCatalog,
  loadFunctionCatalog,
  loadPropertyCatalog
} from './builtins';
import catalog2025 from './data/pb2025_functions.json';
import events2025 from './data/pb2025_events.json';
import properties2025 from './data/pb2025_properties.json';
import enums2025 from './data/pb2025_enums.json';
import datawindow2025 from './data/pb2025_datawindow.json';

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

export const propertyMap2025: Map<string, PropertyInfo[]> = loadPropertyCatalog(properties2025);
export const enumMap2025: Map<string, EnumInfo> = loadEnumCatalog(enums2025);

const dw2025 = loadDataWindowCatalog(datawindow2025);
export const dwMethods2025: FunctionInfo[] = dw2025.methods;
export const dwEvents2025: EventInfo[] = dw2025.events;

const dwMethodIndex2025 = buildFunctionIndex(dwMethods2025);
const dwEventIndex2025 = buildEventIndex(dwEvents2025);

export function findDWMethod2025(name: string): FunctionInfo | undefined {
  return dwMethodIndex2025.get(name.toLowerCase());
}

export function findDWEvent2025(name: string): EventInfo | undefined {
  return dwEventIndex2025.get(name.toLowerCase());
}
