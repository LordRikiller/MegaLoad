// Mirror: MegaApp/src/types/megaList.ts — keep in sync.

export interface MegaListItem {
  itemId: string;
  checked: boolean;
  addedAt: string;
  source: "export" | "manual";
}

export interface MegaListFilterSnapshot {
  query?: string;
  types?: string[];
  subcategories?: string[];
  biomes?: string[];
  stations?: string[];
  factories?: string[];
  vendors?: string[];
  onlyTameable?: boolean;
  exportedAt: string;
}

export interface MegaList {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  filterSnapshot?: MegaListFilterSnapshot;
  items: MegaListItem[];
}

export interface MegaListBlob {
  version: 1;
  device_id: string;
  updated_at: string;
  lists: MegaList[];
}

export function emptyBlob(deviceId: string): MegaListBlob {
  return {
    version: 1,
    device_id: deviceId,
    updated_at: new Date(0).toISOString(),
    lists: [],
  };
}
