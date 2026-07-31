import type { PostUnit } from '../blog/types.js';
import type { State } from '../state/store.js';
import { postedUnitIds } from '../state/store.js';

export interface UnitChoice {
  readonly unit: PostUnit;
  /** Havuz tukendigi icin daha once paylasilmis bir bolum yeniden kullaniliyor mu? */
  readonly isRecycled: boolean;
}

/**
 * Siradaki gonderiyi secer.
 *
 * Bolumler yazi sirasina gore degil, yazilar arasinda donusumlu secilir.
 * Ayni yazinin on bolumunu ust uste paylasmak feed'i tekdüze yapar ve
 * takipcinin ayni konuyu on gun boyunca gormesine yol acar.
 */
export function selectNextUnit(units: readonly PostUnit[], state: State): UnitChoice {
  if (units.length === 0) throw new Error('Icerik havuzu bos — blog yazilari cekilemedi.');

  const posted = postedUnitIds(state);
  const pending = units.filter((unit) => !posted.has(unit.id));

  if (pending.length > 0) {
    return { unit: pickLeastRecentlyCoveredArticle(pending, state), isRecycled: false };
  }

  // Havuz tukendi: en uzun suredir paylasilmamis bolum yeniden dolasima girer.
  // Gorsel ve caption yeniden uretildigi icin gonderi birebir tekrar olmaz.
  const oldestFirst = [...units].sort((a, b) => lastPostedIndex(a.id, state) - lastPostedIndex(b.id, state));
  return { unit: oldestFirst[0]!, isRecycled: true };
}

/**
 * Bekleyen bolumler arasindan, en uzun suredir gonderi almamis yaziya ait
 * olani secer. Esitlik durumunda yazi icindeki sira korunur.
 */
function pickLeastRecentlyCoveredArticle(pending: readonly PostUnit[], state: State): PostUnit {
  const lastSeen = new Map<string, number>();
  state.posts.forEach((post, index) => lastSeen.set(post.articleSlug, index));

  const scored = pending.map((unit) => ({
    unit,
    // Hic paylasilmamis yazi en yuksek onceligi alir.
    recency: lastSeen.get(unit.articleSlug) ?? -1,
    order: unit.id,
  }));

  scored.sort((a, b) => a.recency - b.recency || a.order.localeCompare(b.order));
  return scored[0]!.unit;
}

function lastPostedIndex(unitId: string, state: State): number {
  for (let i = state.posts.length - 1; i >= 0; i--) {
    if (state.posts[i]!.unitId === unitId) return i;
  }
  return -1;
}
