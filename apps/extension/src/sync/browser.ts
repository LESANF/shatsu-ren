import { isSyncableUrl } from 'shatsu-ren-protocol';

/** chrome.bookmarks 어댑터. 고정 루트는 숫자 ID 로 단정하지 않고 트리를 탐색해 판단한다. */
export type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

export interface LocalNode {
  id: string;
  parentId: string | null;
  index: number;
  kind: 'folder' | 'bookmark';
  title: string;
  url: string | null;
  /** 관리형/읽기전용 */
  unmodifiable: boolean;
  folderType?: string;
}

export interface LocalTree {
  rootId: string;
  nodes: Map<string, LocalNode>; // root 포함
  children: Map<string, string[]>; // parentId → ordered child ids
}

export async function getSubTree(rootId: string): Promise<LocalTree | null> {
  let arr: BookmarkNode[];
  try {
    arr = await chrome.bookmarks.getSubTree(rootId);
  } catch {
    return null;
  }
  const root = arr[0];
  if (!root) return null;
  const nodes = new Map<string, LocalNode>();
  const children = new Map<string, string[]>();
  const walk = (n: BookmarkNode, parentId: string | null) => {
    nodes.set(n.id, toLocal(n, parentId));
    if (n.children) {
      children.set(
        n.id,
        n.children.map((c) => c.id),
      );
      n.children.forEach((c) => walk(c, n.id));
    } else if (!n.url) children.set(n.id, []);
  };
  walk(root, null);
  return { rootId, nodes, children };
}

export function toLocal(n: BookmarkNode, parentId: string | null): LocalNode {
  const ft = (n as { folderType?: string }).folderType;
  return {
    id: n.id,
    parentId,
    index: n.index ?? 0,
    kind: n.url ? 'bookmark' : 'folder',
    title: n.title ?? '',
    url: n.url ?? null,
    unmodifiable: n.unmodifiable === 'managed',
    ...(ft ? { folderType: ft } : {}),
  };
}

export interface TreePickerNode {
  id: string;
  title: string;
  depth: number;
  count: number; // 하위 항목 수 (폴더+북마크)
  isRoot: boolean; // 브라우저 고정 최상위(선택 불가)
  unmodifiable: boolean;
  reason?: 'managed' | 'toplevel';
  children: TreePickerNode[];
}

/** 폴더 선택 UI 용 전체 트리. 북마크는 제외하고 폴더만. */
export async function getFolderTree(): Promise<TreePickerNode[]> {
  const [root] = await chrome.bookmarks.getTree();
  if (!root?.children) return [];
  const build = (n: BookmarkNode, depth: number, isTop: boolean): TreePickerNode => {
    const kids = (n.children ?? []).filter((c) => !c.url).map((c) => build(c, depth + 1, false));
    const count = countAll(n);
    const managed = n.unmodifiable === 'managed';
    return {
      id: n.id,
      title: n.title,
      depth,
      count,
      isRoot: isTop,
      unmodifiable: managed,
      ...(managed ? { reason: 'managed' as const } : isTop ? { reason: 'toplevel' as const } : {}),
      children: kids,
    };
  };
  // 최상위(북마크바/기타/모바일 등)는 폴더로 선택 가능. 그 부모(id 0)는 선택 불가.
  return root.children.filter((c) => !c.url).map((c) => build(c, 0, false));
}

function countAll(n: BookmarkNode): number {
  if (!n.children) return 0;
  return n.children.reduce((s, c) => s + 1 + countAll(c), 0);
}

export const isSyncable = (n: LocalNode) => n.kind === 'folder' || isSyncableUrl(n.url);

/** 실제 브라우저 변경 (journal 의 대상). 반환값은 실제 결과. */
export const api = {
  create: (p: { parentId: string; title: string; url?: string; index?: number }) =>
    chrome.bookmarks.create(p),
  update: (id: string, changes: { title?: string; url?: string }) =>
    chrome.bookmarks.update(id, changes),
  move: (id: string, dest: { parentId?: string; index?: number }) =>
    chrome.bookmarks.move(id, dest),
  removeTree: (id: string) => chrome.bookmarks.removeTree(id),
  remove: (id: string) => chrome.bookmarks.remove(id),
  get: async (id: string): Promise<BookmarkNode | null> => {
    try {
      const r = await chrome.bookmarks.get(id);
      return r[0] ?? null;
    } catch {
      return null;
    }
  },
  getChildren: async (id: string): Promise<BookmarkNode[]> => {
    try {
      return await chrome.bookmarks.getChildren(id);
    } catch {
      return [];
    }
  },
};

/** 특정 로컬 ID 가 rootId 아래에 있는지 (범위 밖 이동 판별) */
export async function isUnder(id: string, rootId: string): Promise<boolean> {
  let cur: string | undefined = id;
  for (let i = 0; i < 64 && cur; i++) {
    if (cur === rootId) return true;
    const n = await api.get(cur);
    if (!n) return false;
    cur = n.parentId;
  }
  return false;
}
