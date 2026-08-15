/**
 * Parses PowerBuilder workspace files (.pbw) to extract project structure,
 * target definitions, and library lists for workspace-aware completions.
 */

import * as fs from 'fs';

export interface WorkspaceTarget {
  id: number;
  path: string;
}

export interface WorkspaceInfo {
  saveFormat: string;
  targets: WorkspaceTarget[];
  defaultTarget?: string;
  defaultRemoteTarget?: string;
  libraries: string[];
}

/**
 * Simple parser for .pbw (PowerBuilder Workspace) files.
 * Format is line-based with @begin/@end blocks.
 */
export function parseWorkspaceFile(text: string): WorkspaceInfo {
  const lines = text.split(/\r?\n/);
  const result: WorkspaceInfo = {
    saveFormat: '',
    targets: [],
    libraries: []
  };

  let inTargetsBlock = false;
  const librarySet = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();

    // Extract save format
    if (trimmed.startsWith('Save Format')) {
      result.saveFormat = trimmed;
      continue;
    }

    // Track @begin/@end blocks
    if (trimmed === '@begin Targets') {
      inTargetsBlock = true;
      continue;
    }
    if (trimmed === '@end;') {
      inTargetsBlock = false;
      continue;
    }

    // Parse target definitions: `<id> "<path>";`
    if (inTargetsBlock && trimmed.match(/^\d+\s+"[^"]+";/)) {
      const match = trimmed.match(/^(\d+)\s+"([^"]+)";/);
      if (match) {
        result.targets.push({
          id: parseInt(match[1], 10),
          path: match[2]
        });
      }
      continue;
    }

    // Extract DefaultTarget
    if (trimmed.startsWith('DefaultTarget')) {
      const match = trimmed.match(/DefaultTarget\s+"([^"]+)"/);
      if (match) {
        result.defaultTarget = match[1];
      }
      continue;
    }

    if (trimmed.startsWith('DefaultRemoteTarget')) {
      const match = trimmed.match(/DefaultRemoteTarget\s+"([^"]+)"/);
      if (match) {
        result.defaultRemoteTarget = match[1];
      }
      continue;
    }

    // Extract LibList from target files (in .pbt files, not .pbw)
    // This is parsed separately in parseTargetFile
  }

  return result;
}

/**
 * Parse a .pbt (PowerBuilder Target) file to extract library list and app info.
 */
export function parseTargetFile(text: string): { liblist: string[]; appname?: string } {
  const result = { liblist: [] as string[], appname: undefined as string | undefined };
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    // Extract app name: appname "powerplant";
    if (trimmed.startsWith('appname')) {
      const match = trimmed.match(/appname\s+"([^"]+)"/);
      if (match) {
        result.appname = match[1];
      }
      continue;
    }

    // Extract library list: LibList "lib1.pbl;lib2.pbl;...";
    if (trimmed.startsWith('LibList')) {
      const match = trimmed.match(/LibList\s+"([^"]+)"/);
      if (match) {
        const libs = match[1].split(';').map((lib) => lib.trim()).filter(Boolean);
        result.liblist = libs;
      }
      continue;
    }
  }

  return result;
}

/**
 * Discover and parse the workspace file for a given folder.
 */
export async function discoverWorkspace(folder: string): Promise<WorkspaceInfo | null> {
  try {
    // Look for .pbw files in the root
    const entries = await fs.promises.readdir(folder);
    const pbwFile = entries.find((f) => f.endsWith('.pbw'));

    if (!pbwFile) {
      return null;
    }

    const text = await fs.promises.readFile(`${folder}/${pbwFile}`, 'utf8');
    return parseWorkspaceFile(text);
  } catch {
    return null;
  }
}
