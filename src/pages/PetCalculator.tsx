import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PawPrint,
  Heart,
  Hammer,
  Copy,
  AlertTriangle,
  Egg,
  Ruler,
  Beef,
  Clock,
  Users,
  Info,
  ChevronRight,
} from "lucide-react";
import { cn } from "../lib/utils";
import { copyText } from "../lib/clipboard";
import { ItemIcon } from "../components/ui/ItemIcon";
import { useValheimDataStore, getItemById } from "../stores/valheimDataStore";
import type { ValheimItem } from "../data/valheim-items";
import {
  ACCESS_PIECES,
  PET_SPECIES,
  TAMING,
  WALL_GROUPS,
  WALL_PIECES,
  breedingClusters,
  computePenGeometry,
  expectedDrop,
  formatMinutes,
  piecesPerCourse,
  projectHerd,
  type PenShape,
  type WallPiece,
} from "../data/petCalculator";

// ── Small shared bits ───────────────────────────────────────

function SectionTitle({ icon: Icon, children, hint }: { icon: typeof PawPrint; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <Icon className="w-4 h-4 text-brand-400 shrink-0 self-center" />
      <h2 className="font-norse font-bold text-xl text-zinc-200 tracking-wide">{children}</h2>
      {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "warn" | "good";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        tone === "warn"
          ? "border-amber-500/30 bg-amber-500/5"
          : tone === "good"
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-zinc-800 bg-zinc-900/50"
      )}
    >
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</p>
      <p className="text-lg font-bold text-zinc-100 mt-0.5 leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-brand-400 mt-0.5 leading-tight">{sub}</p>}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
      <span className="text-xs text-zinc-400 w-32 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1.5 accent-brand-500 cursor-pointer"
      />
      <span className="text-sm font-bold text-brand-400 w-16 text-right tabular-nums shrink-0">
        {value}
        {suffix}
      </span>
    </div>
  );
}

function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
            value === o.value
              ? "bg-brand-500 text-zinc-950 border-brand-500"
              : "bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:border-zinc-700"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Item row that links through to the item's Valheim Data page. */
function ItemLink({
  item,
  amount,
  onOpen,
  suffix,
}: {
  item: ValheimItem;
  amount?: number;
  onOpen: (id: string) => void;
  suffix?: React.ReactNode;
}) {
  return (
    <button
      onClick={() => onOpen(item.id)}
      title={`Open ${item.name} in Valheim Data`}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-zinc-800 bg-zinc-900/50 hover:border-brand-500/40 hover:bg-zinc-800/60 transition-all text-left group"
    >
      <ItemIcon id={item.id} type={item.type} size={28} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-zinc-200 truncate group-hover:text-brand-400 transition-colors">
          {item.name}
        </p>
        {suffix && <p className="text-[10px] text-zinc-500 leading-tight">{suffix}</p>}
      </div>
      {amount != null && (
        <span className="text-sm font-bold text-brand-400 tabular-nums shrink-0">×{amount}</span>
      )}
      <ChevronRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-brand-400 shrink-0 transition-colors" />
    </button>
  );
}

// ── Page ────────────────────────────────────────────────────

export function PetCalculator() {
  const navigate = useNavigate();
  const setSelectedItem = useValheimDataStore((s) => s.setSelectedItem);
  const setReturnPath = useValheimDataStore((s) => s.setReturnPath);
  const clearNavHistory = useValheimDataStore((s) => s.clearNavHistory);
  // Re-render after a remote data hot-swap so costs/drops track the dataset.
  const dataVersion = useValheimDataStore((s) => s.dataVersion);

  const [speciesKey, setSpeciesKey] = useState(PET_SPECIES[0].key);
  const [shape, setShape] = useState<PenShape>("octagon");
  const [spanA, setSpanA] = useState(20);
  const [spanB, setSpanB] = useState(12);
  const [wallGroup, setWallGroup] = useState("Stone");
  const [wallPieceId, setWallPieceId] = useState("stone_wall_4x2");
  const [wallHeight, setWallHeight] = useState(2);
  const [gateId, setGateId] = useState("wood_gate");
  const [gateCount, setGateCount] = useState(1);
  const [tameCount, setTameCount] = useState(2);
  const [brew, setBrew] = useState(false);
  const [startAdults, setStartAdults] = useState(2);
  const [windowHours, setWindowHours] = useState(6);
  const [eggsPerHenHour, setEggsPerHenHour] = useState(3);

  const species = PET_SPECIES.find((s) => s.key === speciesKey) ?? PET_SPECIES[0];
  const piece = WALL_PIECES.find((p) => p.id === wallPieceId) ?? WALL_PIECES[0];
  const gate = ACCESS_PIECES.find((g) => g.id === gateId) ?? ACCESS_PIECES[0];

  const openItem = (id: string) => {
    const item = getItemById(id);
    if (!item) return;
    setReturnPath("/pets");
    clearNavHistory();
    setSelectedItem(item);
    navigate("/valheim-data");
  };

  const selectGroup = (group: string) => {
    setWallGroup(group);
    const first = WALL_PIECES.find((p) => p.group === group);
    if (first) setWallPieceId(first.id);
  };

  // ── Live dataset lookups ──
  const creature = useMemo(() => getItemById(species.creatureId), [species.creatureId, dataVersion]);
  const pieceItem = useMemo(() => getItemById(piece.id), [piece.id, dataVersion]);
  const gateItem = useMemo(() => getItemById(gate.id), [gate.id, dataVersion]);
  const foods = useMemo(
    () =>
      (creature?.tameFoods ?? [])
        .map((id) => getItemById(id))
        .filter((i): i is ValheimItem => i != null),
    [creature, dataVersion]
  );

  // ── Pen geometry ──
  const geo = useMemo(
    () => computePenGeometry(shape, spanA, spanB, piece.thickness),
    [shape, spanA, spanB, piece.thickness]
  );

  const courses = Math.max(1, Math.ceil(wallHeight / piece.height));
  const gateSpan = gate.width * gateCount;
  // Gates replace wall at ground level only — upper courses run straight over.
  const groundPieces = Math.max(
    0,
    piecesPerCourse(geo.sides, piece.width) - Math.ceil(gateSpan / piece.width)
  );
  const upperPieces = piecesPerCourse(geo.sides, piece.width) * (courses - 1);
  const wallPieceCount = groundPieces + upperPieces;

  const materials = useMemo(() => {
    const totals = new Map<string, { item: ValheimItem; amount: number }>();
    const add = (id: string, amount: number) => {
      const item = getItemById(id);
      if (!item) return;
      const prev = totals.get(id);
      totals.set(id, { item, amount: (prev?.amount ?? 0) + amount });
    };
    for (const ing of pieceItem?.recipe ?? []) add(ing.id, ing.amount * wallPieceCount);
    for (const ing of gateItem?.recipe ?? []) add(ing.id, ing.amount * gateCount);
    return [...totals.values()].sort((a, b) => b.amount - a.amount);
  }, [pieceItem, gateItem, wallPieceCount, gateCount, dataVersion]);

  // ── Density ──
  const clusters = breedingClusters(geo.innerArea, species.popRadius);
  const herdCap = species.popCap * clusters;
  const spacePerAnimal = herdCap > 0 ? geo.innerArea / herdCap : 0;
  const cramped = spacePerAnimal > 0 && spacePerAnimal < 4;

  // ── Taming ──
  const tameMinutes = brew ? TAMING.brewMinutes : TAMING.minutes;
  const feedsPerAnimal = Math.ceil(tameMinutes / TAMING.fedMinutes);
  const tameFoodTotal = feedsPerAnimal * tameCount;
  const tameFoodBuffered = Math.ceil(tameFoodTotal * 1.5);
  const primaryFood = foods[0];
  const foodStack = primaryFood?.stack ?? 50;

  // ── Breeding projection ──
  // Clamp the seed herd — shrinking the pen can drop the cap below whatever the
  // slider was last set to, and a herd that starts over cap reads as nonsense.
  const seedAdults = Math.min(startAdults, herdCap);
  const projection = useMemo(
    () => projectHerd(species, seedAdults, herdCap, windowHours * 60),
    [species, seedAdults, herdCap, windowHours]
  );

  // ── Yields ──
  const drops = useMemo(() => {
    return (creature?.drops ?? []).map((d) => {
      const item = getItemById(d.id);
      return {
        id: d.id,
        item,
        name: item?.name ?? d.name,
        per: expectedDrop(d.min, d.max, d.chance),
        chance: d.chance,
      };
    });
  }, [creature, dataVersion]);

  const cullSize = Math.max(0, projection.finalTotal - startAdults);
  const eggItem = species.key === "hen" ? getItemById("ChickenEgg") : species.key === "asksvin" ? getItemById("AsksvinEgg") : null;

  const materialsText = useMemo(() => {
    const lines = [
      `${species.label} pen — ${shape === "octagon" ? `octagonal, ${spanA} m across` : shape === "square" ? `${spanA} m square` : `${spanA} m × ${spanB} m`}`,
      `${pieceItem?.name ?? piece.id} × ${wallPieceCount}${gateCount > 0 ? ` · ${gateItem?.name ?? gate.id} × ${gateCount}` : ""}`,
      "",
      ...materials.map((m) => `${m.item.name} × ${m.amount}`),
    ];
    return lines.join("\n");
  }, [species.label, shape, spanA, spanB, pieceItem, piece.id, wallPieceCount, gateItem, gate.id, gateCount, materials]);

  const groupPieces = WALL_PIECES.filter((p) => p.group === wallGroup);

  return (
    <div className="relative space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[1200px]">
      {/* Header */}
      <div>
        <h1 className="font-norse font-bold text-4xl text-zinc-100 tracking-wide">Pet Calculator</h1>
        <p className="text-zinc-500 mt-1">
          Taming clocks, breeding density and pen materials — costs read live from the Valheim data
          set.
        </p>
      </div>

      {/* 1 — Livestock */}
      <div className="glass rounded-xl p-4">
        <SectionTitle icon={PawPrint} hint="tap a beast to switch the whole calculator">
          1 · Livestock
        </SectionTitle>
        <div className="flex flex-wrap gap-2">
          {PET_SPECIES.map((s) => {
            const active = s.key === speciesKey;
            return (
              <button
                key={s.key}
                onClick={() => {
                  setSpeciesKey(s.key);
                  setWallHeight(s.wallHeight);
                }}
                className={cn(
                  "flex items-center gap-2.5 pl-2 pr-3.5 py-2 rounded-xl border transition-all",
                  active
                    ? "bg-brand-500/15 border-brand-500/60 shadow-sm"
                    : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
                )}
              >
                <ItemIcon id={s.creatureId} type="Creature" size={32} />
                <div className="text-left">
                  <p className={cn("text-sm font-bold leading-tight", active ? "text-brand-400" : "text-zinc-300")}>
                    {s.label}
                  </p>
                  <p className="text-[10px] text-zinc-500 leading-tight">
                    cap {s.popCap} / {s.popRadius} m
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Species snapshot */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <Stat
            label="Taming"
            value={species.hatchOnly ? "Hatched tame" : formatMinutes(tameMinutes)}
            sub={species.hatchOnly ? `Egg hatches in ${species.eggHatchMinutes} min (kept warm)` : `${TAMING.ticks} ticks · ${TAMING.tickSeconds} s each`}
          />
          <Stat label="Feed range" value={`${species.feedRange} m`} sub={`Fed for ${TAMING.fedMinutes} min per item`} />
          <Stat
            label="Breeding cap"
            value={`${species.popCap} per ${species.popRadius} m`}
            sub={`${species.lovePoints} love points · partner ${species.partnerRange} m`}
          />
          <Stat
            label="Pregnancy → adult"
            value={`${species.pregnancyMinutes} min → ${formatMinutes(species.growthMinutes)}`}
            sub="Newborns count against the cap"
          />
        </div>

        {/* Foods */}
        {foods.length > 0 && (
          <div className="mt-4">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">
              Accepted food
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {foods.map((f) => (
                <ItemLink key={f.id} item={f} onOpen={openItem} suffix={`stacks to ${f.stack}`} />
              ))}
            </div>
          </div>
        )}
        {creature && (
          <button
            onClick={() => openItem(creature.id)}
            className="mt-3 text-xs text-brand-400 hover:text-brand-300 transition-colors inline-flex items-center gap-1"
          >
            Open {creature.name} in Valheim Data
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* 2 — Taming plan */}
      <div className="glass rounded-xl p-4">
        <SectionTitle icon={Heart} hint="one food item buys 10 minutes of taming">
          2 · Taming plan
        </SectionTitle>
        {species.hatchOnly ? (
          <p className="text-sm text-zinc-400">
            {species.label} can't be tamed in the wild — hatch an egg beside a fire and it's born
            tame. Budget {species.eggHatchMinutes} minutes per egg, then {formatMinutes(species.growthMinutes)}{" "}
            before it can breed.
          </p>
        ) : (
          <>
            <div className="grid md:grid-cols-2 gap-3">
              <Slider label="Animals to tame" value={tameCount} min={1} max={20} suffix="" onChange={setTameCount} />
              <button
                onClick={() => setBrew(!brew)}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-3 py-2.5 text-xs font-semibold transition-all",
                  brew
                    ? "border-brand-500/60 bg-brand-500/15 text-brand-400"
                    : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700"
                )}
              >
                <span>Brew of Animal Whispers</span>
                <span>{brew ? "ON — 15 min" : "OFF — 30 min"}</span>
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <Stat label="Time per animal" value={formatMinutes(tameMinutes)} sub="uninterrupted" />
              <Stat label="Food per animal" value={`${feedsPerAnimal} items`} sub={`one per ${TAMING.fedMinutes} min`} />
              <Stat label="Food for the batch" value={`${tameFoodTotal} items`} sub={`${tameCount} animals`} />
              <Stat
                label="Carry this much"
                value={`${tameFoodBuffered} items`}
                sub={`${(tameFoodBuffered / foodStack).toFixed(1)} stacks — 50% spook buffer`}
              />
            </div>
            <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
              Taming only ticks while the creature is fed and not fleeing. Stay within{" "}
              {species.feedRange} m of the food, out of its line of sight — every scare resets the
              tick, not the whole bar.
            </p>
          </>
        )}
      </div>

      {/* 3 — Pen designer */}
      <div className="glass rounded-xl p-4">
        <SectionTitle icon={Ruler} hint="outer dimensions, walls priced from the live data set">
          3 · Pen designer
        </SectionTitle>

        <div className="space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Shape</p>
            <Chips<PenShape>
              options={[
                { value: "octagon", label: "Octagonal" },
                { value: "rectangle", label: "Rectangular" },
                { value: "square", label: "Square" },
              ]}
              value={shape}
              onChange={setShape}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <Slider
              label={shape === "octagon" ? "Span across flats" : shape === "square" ? "Outer side" : "Outer length"}
              value={spanA}
              min={4}
              max={100}
              suffix=" m"
              onChange={setSpanA}
            />
            {shape === "rectangle" && (
              <Slider label="Outer width" value={spanB} min={4} max={100} suffix=" m" onChange={setSpanB} />
            )}
            <Slider label="Wall height" value={wallHeight} min={1} max={8} suffix=" m" onChange={setWallHeight} />
          </div>

          {/* Wall material */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">
              Wall material
            </p>
            <Chips options={WALL_GROUPS.map((g) => ({ value: g, label: g }))} value={wallGroup} onChange={selectGroup} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              {groupPieces.map((p) => (
                <WallPieceCard
                  key={p.id}
                  piece={p}
                  active={p.id === wallPieceId}
                  onSelect={() => setWallPieceId(p.id)}
                  onOpen={openItem}
                />
              ))}
            </div>
            {piece.note && (
              <p className="text-[11px] text-brand-400/90 mt-2 flex items-start gap-1.5">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                {piece.note}
              </p>
            )}
            {piece.damaging && (
              <p className="text-[11px] text-red-400 mt-2 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                This piece deals damage on contact — it will kill the livestock it's meant to hold.
              </p>
            )}
          </div>

          {/* Access */}
          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 flex items-center gap-3">
              <span className="text-xs text-zinc-400 w-24 shrink-0">Access</span>
              <select
                value={gateId}
                onChange={(e) => setGateId(e.target.value)}
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-brand-500/50"
              >
                {ACCESS_PIECES.map((g) => (
                  <option key={g.id} value={g.id}>
                    {getItemById(g.id)?.name ?? g.short} ({g.width} m)
                  </option>
                ))}
              </select>
            </div>
            <Slider label="Gates / doors" value={gateCount} min={0} max={4} suffix="" onChange={setGateCount} />
          </div>
        </div>

        {/* Pen results */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <Stat label="Usable inner area" value={`${Math.round(geo.innerArea)} m²`} sub={geo.innerLabel} />
          <Stat
            label="Wall to build"
            value={`${geo.perimeter.toFixed(1)} m`}
            sub={`${geo.sides.length} runs · ${courses} course${courses > 1 ? "s" : ""} high`}
          />
          <Stat
            label={pieceItem?.name ?? piece.short}
            value={`${wallPieceCount} pieces`}
            sub={`${piece.width}×${piece.height} m each`}
          />
          <Stat
            label="Herd this holds"
            value={`${herdCap} ${species.label}`}
            sub={`${clusters} breeding cluster${clusters > 1 ? "s" : ""} · ${spacePerAnimal.toFixed(1)} m² each`}
            tone={cramped ? "warn" : "good"}
          />
        </div>

        {cramped && (
          <p className="text-[11px] text-amber-400 mt-3 flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            Under 4 m² per animal — livestock shove each other through walls and get stuck in
            corners. Widen the pen or accept fewer beasts.
          </p>
        )}
        {clusters > 1 && (
          <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
            The density check only counts creatures within {species.popRadius} m, so a pen this size
            can run {clusters} independent clusters — that's how you beat the {species.popCap}-head
            cap. Treat it as an upper bound: herds huddle, and huddled beasts see each other.
          </p>
        )}

        {/* Materials */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Materials required
            </p>
            <button
              onClick={(e) => copyText(materialsText, e)}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-zinc-400 hover:text-brand-400 hover:bg-zinc-800/60 transition-colors"
            >
              <Copy className="w-3 h-3" />
              Copy list
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {materials.length === 0 && (
              <p className="text-xs text-zinc-500">No recipe on the selected pieces.</p>
            )}
            {materials.map((m) => (
              <ItemLink key={m.item.id} item={m.item} amount={m.amount} onOpen={openItem} />
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
            {pieceItem && (
              <ItemLink
                item={pieceItem}
                amount={wallPieceCount}
                onOpen={openItem}
                suffix={pieceItem.station ? `${pieceItem.station}${pieceItem.stationLevel > 1 ? ` lv ${pieceItem.stationLevel}` : ""}` : "Hammer"}
              />
            )}
            {gateItem && gateCount > 0 && (
              <ItemLink
                item={gateItem}
                amount={gateCount}
                onOpen={openItem}
                suffix={gateItem.station || "Hammer"}
              />
            )}
          </div>
        </div>
      </div>

      {/* 4 — Breeding projection */}
      <div className="glass rounded-xl p-4">
        <SectionTitle icon={Users} hint="one newborn per pair per pregnancy, capped by density">
          4 · Breeding projection
        </SectionTitle>
        <div className="grid md:grid-cols-2 gap-3">
          <Slider label="Starting adults" value={startAdults} min={1} max={Math.max(2, herdCap)} suffix="" onChange={setStartAdults} />
          <Slider label="Time window" value={windowHours} min={1} max={48} suffix=" h" onChange={setWindowHours} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <Stat
            label="Fills the pen in"
            value={projection.minutesToCap != null ? formatMinutes(projection.minutesToCap) : "not within window"}
            sub={`cap ${herdCap} head`}
            tone={projection.minutesToCap != null ? "good" : "default"}
          />
          <Stat label={`After ${windowHours} h`} value={`${projection.finalTotal} head`} sub={`from ${startAdults} adults`} />
          <Stat
            label="Food burned"
            value={`${projection.foodEaten} items`}
            sub={primaryFood ? `${(projection.foodEaten / foodStack).toFixed(1)} stacks of ${primaryFood.name}` : undefined}
          />
          <Stat
            label="Cycle length"
            value={`${species.pregnancyMinutes} min`}
            sub={`+ ${formatMinutes(species.growthMinutes)} to adulthood`}
          />
        </div>

        {/* Timeline */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="py-1.5 pr-3 font-semibold">Time</th>
                <th className="py-1.5 pr-3 font-semibold">Adults</th>
                <th className="py-1.5 pr-3 font-semibold">Growing</th>
                <th className="py-1.5 pr-3 font-semibold">Total</th>
                <th className="py-1.5 font-semibold">Fill</th>
              </tr>
            </thead>
            <tbody>
              {projection.samples.map((s) => (
                <tr key={s.minute} className="border-t border-zinc-800/60">
                  <td className="py-1.5 pr-3 text-zinc-400 tabular-nums">{formatMinutes(s.minute)}</td>
                  <td className="py-1.5 pr-3 text-zinc-200 tabular-nums">{s.adults}</td>
                  <td className="py-1.5 pr-3 text-zinc-500 tabular-nums">{s.young}</td>
                  <td className="py-1.5 pr-3 font-bold text-zinc-100 tabular-nums">{s.total}</td>
                  <td className="py-1.5">
                    <div className="h-1.5 w-24 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full bg-brand-500 rounded-full"
                        style={{ width: `${Math.min(100, (s.total / Math.max(1, herdCap)) * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
          Assumes food stays in the pen: each animal eats one item every {TAMING.fedMinutes} minutes
          and a fed pair conceives every {species.pregnancyMinutes} minute
          {species.pregnancyMinutes > 1 ? "s" : ""} while the head count sits under the cap. Empty
          the trough and both the breeding and the burn stop.
        </p>
      </div>

      {/* 5 — Yield */}
      <div className="glass rounded-xl p-4">
        <SectionTitle icon={Beef} hint="expected drops, chance-weighted, from the live data set">
          5 · Yield
        </SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Surplus to cull" value={`${cullSize} head`} sub={`keeping ${seedAdults} breeders`} />
          <Stat label="Herd at cap" value={`${herdCap} head`} sub={`${clusters} cluster${clusters > 1 ? "s" : ""}`} />
          {eggItem && (
            <Stat
              label="Eggs per hour"
              value={`${Math.round(eggsPerHenHour * herdCap)}`}
              sub={`${eggsPerHenHour}/head/h × ${herdCap}`}
            />
          )}
          <Stat
            label="Food burn at cap"
            value={`${Math.round((herdCap / TAMING.fedMinutes) * 60)} items/h`}
            sub="keep the trough stocked or breeding stalls"
          />
        </div>

        {eggItem && (
          <div className="mt-3">
            <Slider
              label="Eggs per head / hour"
              value={eggsPerHenHour}
              min={1}
              max={10}
              suffix=""
              onChange={setEggsPerHenHour}
            />
            <p className="text-[11px] text-zinc-500 mt-1.5 flex items-start gap-1.5">
              <Egg className="w-3 h-3 mt-0.5 shrink-0" />
              Lay rate isn't in the game data — tune this from what your own coop produces.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3">
          {drops.map((d) =>
            d.item ? (
              <ItemLink
                key={d.id}
                item={d.item}
                amount={Math.round(d.per * cullSize * 10) / 10}
                onOpen={openItem}
                suffix={`${d.per.toFixed(2)} per kill${d.chance < 1 ? ` · ${Math.round(d.chance * 100)}% chance` : ""}`}
              />
            ) : null
          )}
        </div>
      </div>

      {/* 6 — Pen notes */}
      <div className="glass rounded-xl p-4">
        <SectionTitle icon={Hammer}>6 · Building notes</SectionTitle>
        <ul className="space-y-2">
          {species.notes.map((n) => (
            <li key={n} className="text-xs text-zinc-400 flex items-start gap-2 leading-relaxed">
              <Clock className="w-3 h-3 text-brand-400/70 mt-0.5 shrink-0" />
              {n}
            </li>
          ))}
          <li className="text-xs text-zinc-400 flex items-start gap-2 leading-relaxed">
            <Clock className="w-3 h-3 text-brand-400/70 mt-0.5 shrink-0" />
            Piece footprints are the build-grid nominal sizes; wall thickness ({piece.thickness} m
            here) only feeds the inner-area subtraction, so treat inner dimensions as ±half a metre.
          </li>
        </ul>
      </div>
    </div>
  );
}

// ── Wall piece card ─────────────────────────────────────────

function WallPieceCard({
  piece,
  active,
  onSelect,
  onOpen,
}: {
  piece: WallPiece;
  active: boolean;
  onSelect: () => void;
  onOpen: (id: string) => void;
}) {
  const item = getItemById(piece.id);
  // Cheapest-first sorting isn't useful here, but cost-per-m² is: it's the one
  // number that separates stone_wall_4x2 (6 stone / 8 m²) from stone_wall_1x1.
  const totalCost = (item?.recipe ?? []).reduce((sum, r) => sum + r.amount, 0);
  const face = piece.width * piece.height;
  const perSqm = face > 0 ? totalCost / face : 0;

  return (
    <div
      className={cn(
        "rounded-lg border transition-all",
        active ? "border-brand-500/60 bg-brand-500/10" : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
      )}
    >
      <button onClick={onSelect} className="w-full flex items-center gap-2 p-2 text-left">
        <ItemIcon id={piece.id} type="BuildPiece" size={28} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-[11px] font-semibold truncate", active ? "text-brand-400" : "text-zinc-300")}>
            {item?.name ?? piece.short}
          </p>
          <p className="text-[10px] text-zinc-500 leading-tight">
            {piece.width}×{piece.height} m · {perSqm.toFixed(1)}/m²
            {piece.seeThrough ? " · see-through" : ""}
          </p>
        </div>
      </button>
      <button
        onClick={() => onOpen(piece.id)}
        className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[10px] text-zinc-500 hover:text-brand-400 border-t border-zinc-800/60 transition-colors"
      >
        {(item?.recipe ?? []).map((r) => `${r.amount} ${r.name}`).join(" + ") || "no recipe"}
        <ChevronRight className="w-2.5 h-2.5" />
      </button>
    </div>
  );
}
