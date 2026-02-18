const PREFERRED_DEFAULT_SKIN_ID = "gemini-light-marble";
const PREFERRED_DEFAULT_SKIN_LABEL = "Gemini Light Marble";

export type MarbleSkinOption = {
  id: string;
  label: string;
  url?: string;
};

const discoveredSkinUrls = import.meta.glob<string>(
  "../assets/skins/*.{png,jpg,jpeg,webp}",
  {
    eager: true,
    import: "default",
  },
);

function toSkinId(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "skin";
}

function toSkinLabel(input: string): string {
  const cleaned = input
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!cleaned) {
    return "Skin";
  }
  return cleaned.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

const discoveredSkins: MarbleSkinOption[] = (() => {
  const usedIds = new Set<string>();
  const options: MarbleSkinOption[] = [];
  const paths = Object.keys(discoveredSkinUrls).sort((a, b) => a.localeCompare(b));
  for (const path of paths) {
    const filename = path.split("/").pop() ?? "";
    const basename = filename.replace(/\.[^.]+$/, "");
    let id = toSkinId(basename);
    if (usedIds.has(id)) {
      let dedupeIndex = 2;
      while (usedIds.has(`${id}-${dedupeIndex}`)) {
        dedupeIndex += 1;
      }
      id = `${id}-${dedupeIndex}`;
    }
    usedIds.add(id);
    options.push({
      id,
      label: toSkinLabel(basename),
      url: discoveredSkinUrls[path],
    });
  }
  return options;
})();

const skinCatalog: MarbleSkinOption[] =
  discoveredSkins.length > 0
    ? discoveredSkins
    : [{ id: PREFERRED_DEFAULT_SKIN_ID, label: PREFERRED_DEFAULT_SKIN_LABEL }];

const fallbackSkin: MarbleSkinOption =
  skinCatalog.find((entry) => entry.id === PREFERRED_DEFAULT_SKIN_ID) ?? skinCatalog[0]!;

export function getSkinCatalog(): MarbleSkinOption[] {
  return skinCatalog;
}

export function getDefaultSkinId(): string {
  return fallbackSkin.id;
}

export function resolveSkinById(skinId: string | undefined | null): MarbleSkinOption {
  if (!skinId) {
    return fallbackSkin;
  }
  return skinCatalog.find((entry) => entry.id === skinId) ?? fallbackSkin;
}
