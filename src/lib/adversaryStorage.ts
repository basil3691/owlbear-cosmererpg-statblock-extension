export type AdversaryTier = "minion" | "rival" | "nemesis";

export interface AdversaryRecord {
  id: string;
  name: string;
  type: AdversaryTier;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  data: Record<string, unknown>; // full stat block JSON
}

interface AdversaryLibraryData {
  version: 1;
  adversaries: AdversaryRecord[];
}

const STORAGE_KEY = "obr-adversary-library";

const emptyLibrary = (): AdversaryLibraryData => ({
  version: 1,
  adversaries: [],
});

function safeParseLibrary(raw: string | null): AdversaryLibraryData {
  if (!raw) return emptyLibrary();

  try {
    const parsed = JSON.parse(raw);

    if (
      parsed &&
      parsed.version === 1 &&
      Array.isArray(parsed.adversaries)
    ) {
      return parsed as AdversaryLibraryData;
    }

    return emptyLibrary();
  } catch {
    return emptyLibrary();
  }
}

function writeLibrary(library: AdversaryLibraryData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}

export function getAdversaryLibrary(): AdversaryRecord[] {
  return safeParseLibrary(localStorage.getItem(STORAGE_KEY))
    .adversaries
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getAdversaryById(id: string): AdversaryRecord | null {
  const library = safeParseLibrary(localStorage.getItem(STORAGE_KEY));
  return library.adversaries.find((item) => item.id === id) ?? null;
}

export function saveAdversary(input: {
  id?: string;
  name: string;
  type: AdversaryTier;
  tags?: string[];
  data: Record<string, unknown>;
}): AdversaryRecord {
  const library = safeParseLibrary(localStorage.getItem(STORAGE_KEY));
  const now = new Date().toISOString();
  const id = input.id ?? crypto.randomUUID();
  const existingIndex = library.adversaries.findIndex((item) => item.id === id);

  const record: AdversaryRecord = {
    id,
    name: input.name.trim(),
    type: input.type,
    tags: (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
    createdAt:
      existingIndex >= 0 ? library.adversaries[existingIndex].createdAt : now,
    updatedAt: now,
    data: input.data,
  };

  if (existingIndex >= 0) {
    library.adversaries[existingIndex] = record;
  } else {
    library.adversaries.push(record);
  }

  writeLibrary(library);
  return record;
}

export function deleteAdversary(id: string): boolean {
  const library = safeParseLibrary(localStorage.getItem(STORAGE_KEY));
  const next = library.adversaries.filter((item) => item.id !== id);

  if (next.length === library.adversaries.length) {
    return false;
  }

  writeLibrary({ ...library, adversaries: next });
  return true;
}

export function duplicateAdversary(id: string): AdversaryRecord | null {
  const existing = getAdversaryById(id);
  if (!existing) return null;

  return saveAdversary({
    name: `${existing.name} Copy`,
    type: existing.type,
    tags: [...existing.tags],
    data: structuredClone(existing.data),
  });
}

export function searchAdversaries(query: string): AdversaryRecord[] {
  const normalized = query.trim().toLowerCase();
  const all = getAdversaryLibrary();

  if (!normalized) return all;

  return all.filter((item) => {
    return (
      item.name.toLowerCase().includes(normalized) ||
      item.type.toLowerCase().includes(normalized) ||
      item.tags.some((tag) => tag.toLowerCase().includes(normalized))
    );
  });
}

export function exportAdversaryLibrary(): string {
  const library = safeParseLibrary(localStorage.getItem(STORAGE_KEY));
  return JSON.stringify(library, null, 2);
}

export function importAdversaryLibrary(json: string): {
  success: boolean;
  imported: number;
} {
  try {
    const parsed = JSON.parse(json) as Partial<AdversaryLibraryData>;

    if (parsed.version !== 1 || !Array.isArray(parsed.adversaries)) {
      return { success: false, imported: 0 };
    }

    const sanitized: AdversaryLibraryData = {
      version: 1,
      adversaries: parsed.adversaries.filter(
        (item): item is AdversaryRecord =>
          !!item &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.type === "string" &&
          Array.isArray(item.tags) &&
          typeof item.createdAt === "string" &&
          typeof item.updatedAt === "string" &&
          typeof item.data === "object" &&
          item.data !== null,
      ),
    };

    writeLibrary(sanitized);
    return { success: true, imported: sanitized.adversaries.length };
  } catch {
    return { success: false, imported: 0 };
  }
}
