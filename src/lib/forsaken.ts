/**
 * The Forsaken, and how to count which of them a character has felled.
 *
 * This lives in one place on purpose. Dashboard and PlayerData each used to keep
 * their own copy of the trophy set, so when Valheim 1.0 added an eighth boss only
 * one of them was updated and the Dashboard sat on "1 / 7" for a release.
 */
import type { CharacterData } from "./tauri-api";

/**
 * Boss trophies for the first SEVEN Forsaken — used to derive bosses-defeated,
 * because the save file's own boss_kills counter is unreliable.
 *
 * Valheim 1.0's eighth, Kall Fimbulbringer (`ach_boss8frozenking`, "Defeat the
 * Shackled One"), is deliberately NOT in this set — **he drops no trophy at
 * all.** Every other Deep North creature has one (Moose, Seal, Barka, Writhan,
 * Elaking, both Jotun), but the boss himself does not, so a trophy count can
 * never see him.
 */
export const BOSS_TROPHY_IDS = new Set([
  "TrophyEikthyr",
  "TrophyTheElder",
  "TrophyBonemass",
  "TrophyDragonQueen", // Moder
  "TrophyGoblinKing", // Yagluth
  "TrophySeekerQueen",
  "TrophyFader",
]);

/**
 * Kall Fimbulbringer's kill markers, in preference order.
 *
 * He drops Sacrificial Blood (`FrozenKingDrop`) and a Crown Jewel, and the game
 * fires a Hugin tutorial labelled "Hugin: Kall Fimbulbringer defeated"
 * (`tutorial_sacrificialblood_*`). Known texts persist on the character, whereas
 * the blood itself is consumable — it is "the final key" — so the tutorial is the
 * durable signal and the items are only a fallback for a character still carrying
 * one.
 *
 * Matching is substring + case-insensitive on purpose: the exact known-text key
 * could not be confirmed against a real save, so this errs towards detecting
 * rather than missing him.
 */
const BOSS8_TEXT_PATTERN = /sacrificialblood|frozenking/i;
const BOSS8_ITEM_IDS = new Set(["FrozenKingDrop", "CrownJewel"]);

/** Eight Forsaken as of Valheim 1.0 — seven with trophies, plus Kall Fimbulbringer. */
export const TOTAL_BOSSES = BOSS_TROPHY_IDS.size + 1;

/**
 * Bosses this character has defeated: trophies for the first seven, plus a
 * separate check for the eighth, who leaves no trophy behind.
 */
export function countBossesDefeated(character: CharacterData | null): number {
  if (!character) return 0;
  const trophyKills = character.trophies.filter((t) => BOSS_TROPHY_IDS.has(t)).length;
  const sawHuginOnKill = (character.known_texts ?? []).some(
    (t) => BOSS8_TEXT_PATTERN.test(t.key) || BOSS8_TEXT_PATTERN.test(t.value),
  );
  const holdsBossDrop =
    character.inventory.some((i) => BOSS8_ITEM_IDS.has(i.name)) ||
    (character.uniques ?? []).some((u) => BOSS8_ITEM_IDS.has(u));
  return trophyKills + (sawHuginOnKill || holdsBossDrop ? 1 : 0);
}
