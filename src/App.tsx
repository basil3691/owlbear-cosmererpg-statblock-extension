import React, { useEffect, useMemo, useRef, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { createClient } from "@supabase/supabase-js";
import "./styles.css";

const SUPABASE_URL = "https://rjxygozhnslwwmomvzmz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_bwqFp94KYOA0RvpCgDjYGQ_cn6IbEl2";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const METADATA_KEY = "com.eli.statblocks/adversary";

type ActionCost = "free" | "reaction" | 1 | 2 | 3;
type ActiveTab = "preview" | "builder" | "library";
type OpenMenu = "library" | "token" | null;

// Canonical shape of a stat block. Nearly everything is optional because
// data can arrive from hand-written JSON, older saved entries, or the
// builder UI mid-edit — none of which are guaranteed to be complete.
type Adversary = {
  name?: string;
  tier?: string;
  type?: string;
  size?: string;
  species?: string;
  role?: string;

  source?: "Official" | "Homebrew";
  setting?: string;

  physical?: {
    str?: number;
    def?: number;
    spd?: number;
  };

  cognitive?: {
    int?: number;
    def?: number;
    wil?: number;
  };

  spiritual?: {
    awa?: number;
    def?: number;
    pre?: number;
  };

  health?: number;
  healthRange?: string;
  minHealth?: number;
  maxHealth?: number;
  focus?: number;
  investiture?: number;
  deflect?: number | string;
  movement?: string;
  senses?: string;
  languages?: string;
  immunities?: string;

  skills?: {
    physical?: string[];
    cognitive?: string[];
    spiritual?: string[];
  };

  investedSkills?: string[];

  features?: {
    name: string;
    text: string;
  }[];

  actions?: ParsedAction[];

  opportunitiesAndComplications?: {
    intro?: string;
    opportunity?: string;
    complication?: string;
  };

  tactics?: string;

  [key: string]: unknown;
};

type LibraryEntry = {
  id: string;
  name: string;
  summary: string;
  data: Adversary;
};

type FeatureLibraryEntry = {
  id: string;
  name: string;
  text: string;
  source: "Official" | "Homebrew";
};

// Structured action data used for rendering. Populated either directly
// (builder-created entries) or by parseActionText() below when an action
// comes in as a single freeform string (older/imported entries).
type ParsedAction = {
  name: string;
  text?: string;
  cost?: ActionCost;
  focusCost?: string;
  investitureCost?: string;
  actionType?: "attack" | "ability" | "reaction" | "free" | "other";
  attackBonus?: string;
  range?: string;
  reach?: string;
  target?: string;
  graze?: string;
  hit?: string;
  notes?: string;
};

// Best-effort parser for the old "one long string" action format, e.g.
// "Sword Strike — Attack +6, reach 5 ft., one target. Hit: 2d6 damage."
// Splits on the first " — " or ": " to get a name, then regexes the rest
// for attack bonus / range / reach / target / graze / hit. This is fragile —
// it assumes the source text roughly follows that pattern.
function parseActionText(raw: string): ParsedAction {
  const text = raw.trim();

  let name = text;
  let rest = "";

  if (text.includes(" — ")) {
    const parts = text.split(" — ");
    name = parts[0].trim();
    rest = parts.slice(1).join(" — ").trim();
  } else if (text.includes(": ")) {
    const parts = text.split(": ");
    name = parts[0].trim();
    rest = parts.slice(1).join(": ").trim();
  }

  // Remove duplicated name at start of rest
  if (rest.toLowerCase().startsWith(name.toLowerCase())) {
    rest = rest.slice(name.length).trim();

    if (rest.startsWith("—") || rest.startsWith("-")) {
      rest = rest.slice(1).trim();
    }
  }

  const attackBonus = rest.match(/Attack\s*\+(\d+)/i)?.[1];
  const range = rest.match(/range\s+([0-9/]+\s*ft\.?|[0-9/]+)/i)?.[1];
  const reach = rest.match(/reach\s+([0-9]+\s*ft\.?|[0-9]+)/i)?.[1];
  // Only matches a target phrase immediately after a reach/range clause,
  // e.g. "reach 5 ft., one target" — won't catch targets phrased differently.
  const targetMatch = rest.match(
  /(?:reach\s+[0-9]+\s*ft\.?|range\s+[0-9/]+\s*ft\.?)(?:,\s*)([^.]+?target[s]?)/i
);
const target = targetMatch?.[1]?.trim();

  const grazeMatch = rest.match(/Graze:\s*([^.;]+)/i);
  const hitMatch = rest.match(/Hit:\s*([^.;]+)/i);

  let actionType: ParsedAction["actionType"] = "other";
  if (/attack/i.test(rest) || grazeMatch || hitMatch) actionType = "attack";
  else if (/reaction/i.test(name) || /reaction/i.test(rest)) actionType = "reaction";
  else if (/free/i.test(name) || /free/i.test(rest)) actionType = "free";
  else if (rest) actionType = "ability";

  return {
    name,
    text: rest || text,
    actionType,
    attackBonus: attackBonus ? `+${attackBonus}` : undefined,
    range,
    reach,
    target,
    graze: grazeMatch ? grazeMatch[1].trim() : undefined,
    hit: hitMatch ? hitMatch[1].trim() : undefined,
    notes:
      !attackBonus && !range && !reach && !grazeMatch && !hitMatch && rest
        ? rest
        : undefined,
  };
}

// Coerces whatever shape "actions" arrives in (raw strings, partial
// objects from hand-edited JSON, or already-well-formed ParsedAction
// objects) into a consistent ParsedAction[]. Falls back to
// parseActionText() to fill in any field the object didn't already have.
function normalizeActions(actions: unknown): ParsedAction[] {
  if (!Array.isArray(actions)) return [];

  return actions
    .map((action) => {
      if (typeof action === "string") {
        return parseActionText(action);
      }

      if (action && typeof action === "object") {
        const a = action as Record<string, unknown>;

        const name = typeof a.name === "string" ? a.name : "";
        const text = typeof a.text === "string" ? a.text : "";
        const parsed = text.trim() ? parseActionText(text) : null;

        return {
  name,
  text,
  cost:
    a.cost === "free" ||
    a.cost === "reaction" ||
    a.cost === 1 ||
    a.cost === 2 ||
    a.cost === 3
      ? (a.cost as ActionCost)
      : undefined,
  focusCost: typeof a.focusCost === "string" ? a.focusCost : undefined,
  investitureCost: typeof a.investitureCost === "string" ? a.investitureCost : undefined,
  actionType:
    a.actionType === "attack" ||
    a.actionType === "ability" ||
    a.actionType === "reaction" ||
    a.actionType === "free" ||
    a.actionType === "other"
      ? (a.actionType as ParsedAction["actionType"])
      : parsed?.actionType,
  attackBonus: typeof a.attackBonus === "string" ? a.attackBonus : parsed?.attackBonus,
  range: typeof a.range === "string" ? a.range : parsed?.range,
  reach: typeof a.reach === "string" ? a.reach : parsed?.reach,
  target: typeof a.target === "string" ? a.target : parsed?.target,
  graze: typeof a.graze === "string" ? a.graze : parsed?.graze,
  hit: typeof a.hit === "string" ? a.hit : parsed?.hit,
  notes: typeof a.notes === "string" ? a.notes : "",
};
      }

      return null;
    })
    .filter((x): x is ParsedAction => Boolean(x));
}

// Default values for a brand-new adversary in the builder. DEF stats
// default to 10 (average), everything else to 0/empty.
const EMPTY_ADVERSARY: Adversary = {
  name: "",
  tier: "",
  type: "",
  species: "Humanoid",
  source: "Official",
  setting: "Stormlight",
  physical: { str: 0, def: 10, spd: 0 },
  cognitive: { int: 0, def: 10, wil: 0 },
  spiritual: { awa: 0, def: 10, pre: 0 },
  health: 0,
  healthRange: "",
  minHealth: 0,
  maxHealth: 0,
  focus: 0,
  investiture: 0,
  deflect: "0",
  movement: "",
  senses: "",
  languages: "none",
  immunities: "",
  skills: {
    physical: [],
    cognitive: [],
    spiritual: [],
  },
  investedSkills: [],
  features: [],
  actions: [],
  opportunitiesAndComplications: {
    intro: "",
    opportunity: "",
    complication: "",
  },
  tactics: "",
};

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, "")
    .trim()
    .replace(/[^a-z0-9]+/g, " ");
}

// One-line description shown in library rows and the preview header,
// e.g. "Tier 3 Elite • Large Chasmfiend". Falls back to role if size/species
// aren't set.
function makeSummary(a: Adversary) {
  const tier = a.tier ?? "—";
  const type = a.type ?? "—";

  const sizeSpecies =
    a.size && a.species
      ? `${a.size} ${a.species}`
      : a.size
      ? a.size
      : a.species
      ? a.species
      : a.role;

  let base = `Tier ${tier} ${type}`;

  if (sizeSpecies) {
    base += ` • ${sizeSpecies}`;
  }

  return base;
}

function exportJsonFile(adversary: Adversary) {
  const json = JSON.stringify(adversary, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName =
    (adversary.name || "adversary")
      .trim()
      .replace(/[^\w\- ]+/g, "")
      .replace(/\s+/g, "_") || "adversary";
  a.href = url;
  a.download = `${safeName}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Renders the little cost glyph next to an action: a triangle per action
// point (1–3), a hollow triangle for free actions, and a custom hooked
// arrow for reactions. `cost` values map 1:1 to the game's action economy.
function ActionCostIcon({
  cost,
  inline = false,
}: {
  cost?: ActionCost;
  inline?: boolean;
}) {
  const color = "var(--theme-action)";
  const marginRight = inline ? 0 : 8;
  const commonStyle = {
    marginRight,
    verticalAlign: "middle" as const,
    display: "inline-block",
  };

  if (cost === "free") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        style={commonStyle}
        aria-hidden="true"
      >
        <polygon
          points="3,2 15,9 3,16"
          fill="none"
          stroke={color}
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (cost === "reaction") {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 64 64"
      style={commonStyle}
      aria-hidden="true"
    >
      {/* tail / return stroke */}
      <path
        d="
          M 22 24
          C 39 24, 53 27, 53 38
          C 53 49, 40 53, 14 53
        "
        fill="none"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="butt"
        strokeLinejoin="round"
      />

      {/* arrow head */}
      <path
      transform="translate(22 24) scale(1.9) translate(-15 -24)"
        d="
          M 22 17
          Q 22 15.2, 20.6 16.1
          L 8.4 23.3
          Q 6.9 24.2, 8.4 25.1
          L 20.6 32.3
          Q 22 33.2, 22 31.4
          Z
        "
        fill={color}
      />
    </svg>
  );
}

  const count = cost === 2 ? 2 : cost === 3 ? 3 : 1;
  const step = 8;
  const width = 14 + (count - 1) * step;

  return (
    <svg
      width={width}
      height="18"
      viewBox={`0 0 ${width} 18`}
      style={commonStyle}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => {
        const offset = i * step;
        return (
          <polygon
            key={i}
            points={`${1 + offset},2 ${13 + offset},9 ${1 + offset},16`}
            fill={color}
          />
        );
      })}
    </svg>
  );
}

function OpportunityIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 100 100"
      style={{ verticalAlign: "middle", margin: "0 2px" }}
      aria-hidden="true"
    >
      <circle
        cx="50"
        cy="50"
        r="34"
        fill="none"
        stroke="var(--rules-opportunity)"
        strokeWidth="8"
      />
      <path
        d="M50 12 L56 28 L44 28 Z
           M88 50 L72 56 L72 44 Z
           M50 88 L44 72 L56 72 Z
           M12 50 L28 44 L28 56 Z"
        fill="var(--rules-opportunity)"
      />
      <path
        d="M50 26
           C58 34, 66 42, 74 50
           C66 58, 58 66, 50 74
           C42 66, 34 58, 26 50
           C34 42, 42 34, 50 26 Z"
        fill="white"
        stroke="var(--rules-opportunity)"
        strokeWidth="6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ComplicationIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 100 100"
      style={{ verticalAlign: "middle", margin: "0 2px" }}
      aria-hidden="true"
    >
      <g fill="var(--rules-complication)">
        <polygon points="50,6 59,26 41,26" />
        <polygon points="71,12 67,30 53,22" />
        <polygon points="88,28 72,39 67,24" />
        <polygon points="94,50 74,55 74,45" />
        <polygon points="88,72 67,76 72,61" />
        <polygon points="71,88 53,78 67,70" />
        <polygon points="50,94 41,74 59,74" />
        <polygon points="29,88 33,70 47,78" />
        <polygon points="12,72 28,61 33,76" />
        <polygon points="6,50 26,45 26,55" />
        <polygon points="12,28 33,24 28,39" />
        <polygon points="29,12 47,22 33,30" />
      </g>
    </svg>
  );
}

// Renders rules text that may contain inline markup tokens like [free],
// [action], [double], [opportunity], [complication], plus basic **bold**
// and *italic* markdown. This is the shared renderer used anywhere rules
// text is displayed (features, actions, opportunities/complications, tactics).
function InlineRulesText({ text }: { text: string }) {
  const lines = text.split("\n");

  function renderInline(line: string, lineIndex: number) {
    const tokenParts = line.split(
      /(\[free\]|\[action\]|\[double\]|\[triple\]|\[double action\]|\[triple action\]|\[reaction\]|\[opportunity\]|\[complication\])/g
    );

    return tokenParts.map((part, tokenIndex) => {
      const key = `${lineIndex}-${tokenIndex}`;

      if (part === "[free]") return <ActionCostIcon key={key} cost="free" inline />;
      if (part === "[action]") return <ActionCostIcon key={key} cost={1} inline />;
      if (part === "[double]" || part === "[double action]") {
        return <ActionCostIcon key={key} cost={2} inline />;
      }
      if (part === "[triple]" || part === "[triple action]") {
        return <ActionCostIcon key={key} cost={3} inline />;
      }
      if (part === "[reaction]") {
        return <ActionCostIcon key={key} cost="reaction" inline />;
      }
      if (part === "[opportunity]") return <OpportunityIcon key={key} />;
      if (part === "[complication]") return <ComplicationIcon key={key} />;

      const richParts = part.split(/(\*\*.*?\*\*|\*.*?\*)/g);

return richParts.map((chunk, richIndex) => {
  const richKey = `${key}-${richIndex}`;

  // bold
  if (chunk.startsWith("**") && chunk.endsWith("**") && chunk.length >= 4) {
    return <strong key={richKey}>{chunk.slice(2, -2)}</strong>;
  }

  // italics
  if (chunk.startsWith("*") && chunk.endsWith("*") && chunk.length >= 2 && !chunk.startsWith("**")) {
    return <em key={richKey}>{chunk.slice(1, -1)}</em>;
  }

  return <span key={richKey}>{chunk}</span>;
});
    });
  }

  return (
  <>
    {lines.map((line, i) => (
      <span key={i} style={{ display: "inline" }}>
        {i > 0 && <br />}
        {renderInline(line, i)}
      </span>
    ))}
  </>
);
}

function SectionSummary({ title }: { title: string }) {
  return (
    <summary
      style={{
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        width: "100%",
        textAlign: "center",
        fontWeight: "bold",
        letterSpacing: 1,
        marginBottom: 6,
        color: "var(--theme-text-primary)",
        listStyle: "none",
      }}
    >
      <span>{title}</span>
      <span
        style={{
          display: "inline-block",
          transition: "transform 0.2s ease",
        }}
        className="arrow"
      >
        ▶
      </span>
    </summary>
  );
}

  function focusNextBuilderField(
  current: HTMLElement,
  e?: React.KeyboardEvent
) {
  if (e) {
    e.preventDefault();
  }

  const builder =
    current.closest('[data-builder-root="true"]');

  if (!builder) return;

  const fields = Array.from(
    builder.querySelectorAll<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled])'
    )
  ).filter((el) => {
    const style = window.getComputedStyle(el);

    return (
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  });

  const currentIndex = fields.indexOf(current);

  if (currentIndex >= 0 && currentIndex < fields.length - 1) {
    fields[currentIndex + 1]?.focus();
  }
}

function BuilderNumberInput({
  value,
  onChange,
  width = 56,
}: {
  value: number | undefined;
  onChange: (value: number) => void;
  width?: number;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value ?? 0}
      onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
        const raw = e.target.value;

        if (!/^-?\d*$/.test(raw)) return;
        if (raw === "" || raw === "-") return;

        onChange(Number(raw));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          focusNextBuilderField(e.currentTarget, e);
        }
      }}
      style={{
        width,
        padding: "4px 6px",
        border: "1px solid var(--theme-accent)",
        borderRadius: 4,
        fontSize: 14,
        textAlign: "center",
        boxSizing: "border-box",
      }}
    />
  );
}

function BuilderTextInput({
  value,
  onChange,
  placeholder,
  width = "100%",
  onKeyDown,
  dataActionIndex,
  dataActionFocusIndex,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number | string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  dataActionIndex?: number;
  dataActionFocusIndex?: number;
}) {
  return (
    <input
      type="text"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
        onKeyDown?.(e);

        if (e.defaultPrevented) return;

        if (e.key === "Enter") {
          focusNextBuilderField(e.currentTarget, e);
        }
      }}
      data-action-index={dataActionIndex}
      data-action-focus-index={dataActionFocusIndex}
      style={{
        width,
        padding: "6px 8px",
        border: "1px solid var(--theme-accent)",
        borderRadius: 4,
        fontSize: 14,
        boxSizing: "border-box",
      }}
    />
  );
}

function BuilderLabeledInput({
  label,
  value,
  onChange,
  placeholder,
  labelWidth = 90,
  onKeyDown,
  dataActionIndex,
  dataActionFocusIndex,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  labelWidth?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  dataActionIndex?: number;
  dataActionFocusIndex?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "var(--theme-text-primary)",
          letterSpacing: 0.4,
          textTransform: "uppercase",
          width: labelWidth,
          flexShrink: 0,
        }}
      >
        {label}:
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <BuilderTextInput
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          width="100%"
          onKeyDown={onKeyDown}
          dataActionIndex={dataActionIndex}
          dataActionFocusIndex={dataActionFocusIndex}
        />
      </div>
    </div>
  );
}

function BuilderSkillList({
  values,
  onChange,
  addLabel = "Add Skill",
  listId,
}: {
  values: string[] | undefined;
  onChange: (values: string[]) => void;
  addLabel?: string;
  listId: string;
}) {
  const displayValues = values && values.length > 0 ? values : [""];

  function updateSkill(index: number, value: string) {
    const next = [...displayValues];
    next[index] = value;
    onChange(next);
  }

  function addSkill(afterIndex?: number) {
    const next = [...displayValues];

    const insertIndex =
      afterIndex === undefined ? next.length : afterIndex + 1;

    next.splice(insertIndex, 0, "");
    onChange(next);

    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLInputElement>(
        `[data-skill-list="${listId}"][data-skill-index="${insertIndex}"]`
      );

      target?.focus();
    });
  }

  function removeBlankSkill(index: number) {
    if (index === 0) return;
    if (displayValues[index]?.trim()) return;

    const next = displayValues.filter((_, i) => i !== index);
    onChange(next);
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {displayValues.map((skill, index) => (
        <input
          key={index}
          type="text"
          value={skill}
          data-skill-list={listId}
          data-skill-index={index}
          onChange={(e) => updateSkill(index, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addSkill(index);
            }
          }}
          onBlur={() => removeBlankSkill(index)}
          style={{
            width: "100%",
            padding: "6px 8px",
            border: "1px solid var(--theme-accent)",
            borderRadius: 4,
            fontSize: 14,
            boxSizing: "border-box",
          }}
        />
      ))}

      <button
        type="button"
        onClick={() => addSkill()}
        style={{
          justifySelf: "start",
          padding: "4px 10px",
          border: "1px solid var(--theme-border)",
          borderRadius: 6,
          background: "var(--theme-panel)",
          color: "var(--theme-text-primary)",
          fontWeight: 600,
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        + {addLabel}
      </button>
    </div>
  );
}

function BuilderTextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      placeholder={placeholder}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "6px 8px",
        border: "1px solid var(--theme-accent)",
        borderRadius: 4,
        fontSize: 14,
        boxSizing: "border-box",
        resize: "vertical",
      }}
    />
  );
}

function BuilderLabeledTextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  labelWidth = 90,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  labelWidth?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        width: "100%",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "var(--theme-text-primary)",
          letterSpacing: 0.4,
          textTransform: "uppercase",
          width: labelWidth,
          flexShrink: 0,
          paddingTop: 7,
        }}
      >
        {label}:
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <BuilderTextArea
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          rows={rows}
        />
      </div>
    </div>
  );
}

function BuilderChoiceButton({
  active,
  label,
  onClick,
  compact = false,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: compact ? "2px 8px" : "7px 12px",
        minHeight: compact ? 30 : 0,
        borderRadius: compact ? 6 : 8,
        border: active
        ? "2px solid var(--theme-accent)"
        : "1px solid var(--theme-border)",
      background: active
        ? "var(--theme-panel-active)"
        : "var(--theme-panel)",
      color: "var(--theme-text-primary)",
        fontWeight: active ? 700 : 600,
        cursor: "pointer",
        fontSize: compact ? 11 : 13,
        whiteSpace: "nowrap",
        transition: "all 0.15s ease",
      }}
    >
      {label}
    </button>
  );
}

function BuilderChoiceRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "var(--theme-text-primary)",
          letterSpacing: 0.4,
          textTransform: "uppercase",
          minWidth: 62,
        }}
      >
        {label}:
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );
}

type PreviewBoundaryProps = {
  children: React.ReactNode;
};

type PreviewBoundaryState = {
  hasError: boolean;
};

// Catches render errors from malformed/imported stat blocks so one bad
// entry doesn't crash the whole extension. Resets itself automatically
// when the underlying adversary data changes (componentDidUpdate below).
class PreviewErrorBoundary extends React.Component<
  PreviewBoundaryProps,
  PreviewBoundaryState
> {
  constructor(props: PreviewBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Preview render failed:", error);
  }

  componentDidUpdate(prevProps: PreviewBoundaryProps) {
    if (prevProps.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: 12,
            border: "1px solid var(--theme-accent)",
            borderRadius: 8,
            background: "var(--theme-warning-background)",
            color: "var(--status-error-text)",
          }}
        >
          <strong>Preview Error</strong>
          <div style={{ fontSize: 13 }}>
            Something in this stat block broke rendering.
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Read-only rendered stat block — this is the "final" display shown in
// the Preview tab and used when a token has a linked adversary.
function AdversaryCard({ adversary }: { adversary: Adversary }) {
  return (
    <div
      className="adversary-card"
      style={{
        marginTop: 8,
        border: "2px solid var(--theme-accent)",
        borderRadius: 8,
        padding: 12,
        background: "var(--theme-background)",
        color: "var(--theme-card-text)",
        fontFamily: "var(--theme-font)",
        textAlign: "left",
        boxShadow: "var(--shadow-medium)",
        }}
      >
      <h2
        style={{
          margin: "0 0 4px 0",
          textAlign: "left",
          fontSize: 24,
          letterSpacing: 0.5,
        }}
      >
        {adversary.name ?? "Unnamed"}
      </h2>

      <p
  style={{
    margin: "0 0 2px 0",
    fontStyle: "italic",
    color: "var(--theme-text)",
  }}
>
  {makeSummary(adversary)}
</p>

<p
  style={{
    margin: "0 0 10px 0",
    fontSize: 11,
    letterSpacing: 0.3,
    color: "var(--theme-text-muted)",
    textTransform: "uppercase",
  }}
>
  {adversary.source ?? "Official"} {adversary.setting ?? "Stormlight"}
</p>

            <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 0,
          marginBottom: 10,
          border: "2px solid var(--theme-accent)",
        }}
      >
        <div style={{ borderRight: "2px solid var(--theme-accent)" }}>
          <div
            style={{
              background: "var(--theme-stat-header)",
              color: "var(--theme-text-on-accent)",
              textAlign: "center",
              fontWeight: "bold",
              padding: "2px 0",
              fontSize: 12,
              letterSpacing: 0.5,
            }}
          >
            PHYSICAL
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto auto auto",
              columnGap: 3,
              justifyContent: "center",
              textAlign: "center",
              padding: "6px 0",
            }}
          >
            <div>
              <div style={{ fontSize: 12 }}>STR</div>
              <div style={{ fontSize: 22 }}>
                {adversary.physical?.str ?? "—"}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 12, lineHeight: 1, marginBottom: 2 }}>
                DEF
              </div>

              <svg width="46" height="42" viewBox="0 0 46 42">
                <path
                  d="M2 2 H44 V26 L23 40 L2 26 Z"
                  fill="var(--theme-background)"
                  stroke="var(--theme-accent)"
                  strokeWidth="2"
                />
                <text
                  x="23"
                  y="24"
                  textAnchor="middle"
                  fontSize="18"
                  fontWeight="bold"
                  fill="var(--theme-text-primary)"
                  fontFamily="var(--theme-font)"
                >
                  {adversary.physical?.def ?? "—"}
                </text>
              </svg>
            </div>

            <div>
              <div style={{ fontSize: 12 }}>SPD</div>
              <div style={{ fontSize: 22 }}>
                {adversary.physical?.spd ?? "—"}
              </div>
            </div>
          </div>
        </div>

        <div style={{ borderRight: "2px solid var(--theme-accent)" }}>
          <div
            style={{
              background: "var(--theme-stat-header)",
              color: "var(--theme-text-on-accent)",
              textAlign: "center",
              fontWeight: "bold",
              padding: "2px 0",
              fontSize: 12,
              letterSpacing: 0.5,
            }}
          >
            COGNITIVE
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto auto auto",
              columnGap: 3,
              justifyContent: "center",
              textAlign: "center",
              padding: "6px 0",
            }}
          >
            <div>
              <div style={{ fontSize: 12 }}>INT</div>
              <div style={{ fontSize: 22 }}>
                {adversary.cognitive?.int ?? "—"}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 12, lineHeight: 1, marginBottom: 2 }}>
                DEF
              </div>

              <svg width="46" height="42" viewBox="0 0 46 42">
                <path
                  d="M2 2 H44 V26 L23 40 L2 26 Z"
                  fill="var(--theme-background)"
                  stroke="var(--theme-accent)"
                  strokeWidth="2"
                />
                <text
                  x="23"
                  y="24"
                  textAnchor="middle"
                  fontSize="18"
                  fontWeight="bold"
                  fill="var(--theme-text-primary)"
                  fontFamily="var(--theme-font)"
                >
                  {adversary.cognitive?.def ?? "—"}
                </text>
              </svg>
            </div>

            <div>
              <div style={{ fontSize: 12 }}>WIL</div>
              <div style={{ fontSize: 22 }}>
                {adversary.cognitive?.wil ?? "—"}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div
            style={{
              background: "var(--theme-stat-header)",
              color: "var(--theme-text-on-accent)",
              textAlign: "center",
              fontWeight: "bold",
              padding: "2px 0",
              fontSize: 12,
              letterSpacing: 0.5,
            }}
          >
            SPIRITUAL
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto auto auto",
              columnGap: 3,
              justifyContent: "center",
              textAlign: "center",
              padding: "6px 0",
            }}
          >
            <div>
              <div style={{ fontSize: 12 }}>AWA</div>
              <div style={{ fontSize: 22 }}>
                {adversary.spiritual?.awa ?? "—"}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 12, lineHeight: 1, marginBottom: 2 }}>
                DEF
              </div>

              <svg width="46" height="42" viewBox="0 0 46 42">
                <path
                  d="M2 2 H44 V26 L23 40 L2 26 Z"
                  fill="var(--theme-background)"
                  stroke="var(--theme-accent)"
                  strokeWidth="2"
                />
                <text
                  x="23"
                  y="24"
                  textAnchor="middle"
                  fontSize="18"
                  fontWeight="bold"
                  fill="var(--theme-text-primary)"
                  fontFamily="var(--theme-font)"
                >
                  {adversary.spiritual?.def ?? "—"}
                </text>
              </svg>
            </div>

            <div>
              <div style={{ fontSize: 12 }}>PRE</div>
              <div style={{ fontSize: 22 }}>
                {adversary.spiritual?.pre ?? "—"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 18,
          margin: "6px 0",
          color: "var(--theme-text-primary)",
          fontWeight: 600,
          fontSize: 15,
          flexWrap: "wrap",
        }}
      >
        <span style={{ whiteSpace: "nowrap" }}>
          <strong>Health:</strong> {adversary.health ?? "—"}{" "}
          {adversary.healthRange ? `(${adversary.healthRange})` : ""}
        </span>

        <span style={{ whiteSpace: "nowrap" }}>
          <strong>Focus:</strong> {adversary.focus ?? "—"}
        </span>

        <span style={{ whiteSpace: "nowrap" }}>
          <strong>Investiture:</strong> {adversary.investiture ?? "—"}
        </span>
      </div>

      <div style={{ borderTop: "2px solid var(--theme-accent)", margin: "6px 0" }} />

      <details open>
        <SectionSummary title="DETAILS" />

        <p style={{ margin: "6px 0" }}>
          <strong>Deflect:</strong> {adversary.deflect ?? "—"}
        </p>

        <p style={{ margin: "6px 0" }}>
          <strong>Movement:</strong> {adversary.movement ?? "—"}
        </p>

        <p style={{ margin: "6px 0" }}>
          <strong>Senses:</strong> {adversary.senses ?? "—"}
        </p>

        {adversary.immunities && (
          <p style={{ margin: "6px 0" }}>
            <strong>Immunities:</strong> {adversary.immunities}
          </p>
        )}

        <p style={{ margin: "6px 0" }}>
          <strong>Languages:</strong> {adversary.languages ?? "—"}
        </p>
      </details>

      <div style={{ borderTop: "2px solid var(--theme-accent)", margin: "8px 0" }} />

      <details open>
        <SectionSummary title="SKILLS" />

        <p style={{ margin: "4px 0" }}>
          <strong>Physical:</strong>{" "}
          {(adversary.skills?.physical ?? []).join(", ") || "—"}
        </p>

        <p style={{ margin: "4px 0" }}>
          <strong>Cognitive:</strong>{" "}
          {(adversary.skills?.cognitive ?? []).join(", ") || "—"}
        </p>

        <p style={{ margin: "4px 0" }}>
          <strong>Spiritual:</strong>{" "}
          {(adversary.skills?.spiritual ?? []).join(", ") || "—"}
        </p>

        {(adversary.investedSkills ?? []).length > 0 && (
          <p style={{ margin: "4px 0" }}>
            <strong>Invested Skills:</strong>{" "}
            {(adversary.investedSkills ?? []).join(", ")}
          </p>
        )}
      </details>

      {(adversary.features ?? []).length > 0 && (
        <>
          <div style={{ borderTop: "2px solid var(--theme-accent)", margin: "8px 0" }} />
          <details open>
            <SectionSummary title="FEATURES" />

            {(adversary.features ?? []).map((feature, i) => (
  <p key={`f-${i}`} style={{ margin: "4px 0" }}>
    <strong>{feature.name}.</strong> <InlineRulesText text={feature.text} />
  </p>
))}
          </details>
        </>
      )}

      {(adversary.actions ?? []).length > 0 && (
        <>
          <div style={{ borderTop: "2px solid var(--theme-accent)", margin: "8px 0" }} />
          <details open>
            <SectionSummary title="ACTIONS" />

            {(adversary.actions ?? []).map((action, i) => (
              <div
                key={`a-${i}`}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  margin: "6px 0",
                }}
              >
                <div style={{ flex: "0 0 auto", marginTop: 2 }}>
                  <ActionCostIcon cost={action.cost} />
                </div>

                <p style={{ margin: 0 }}>
  <strong>
  {action.name}
  {(action.focusCost || action.investitureCost) &&
    ` (Costs ${[
      action.focusCost ? `${action.focusCost} Focus` : null,
      action.investitureCost ? `${action.investitureCost} Investiture` : null,
    ]
      .filter(Boolean)
      .join(", ")})`}
  .
</strong>{" "}

  {(() => {
    const headerParts = [
      action.attackBonus ? `Attack ${action.attackBonus}` : null,
      action.reach ? `reach ${action.reach}` : null,
      action.range ? `range ${action.range}` : null,
      action.target ? action.target : null,
    ].filter(Boolean);

    return headerParts.length > 0
      ? `${headerParts.join(", ")}. `
      : null;
  })()}

  {action.graze && (
    <>
      <em>Graze:</em>{" "}
      <InlineRulesText text={action.graze} />.{" "}
    </>
  )}

  {action.hit && (
    <>
      <em>Hit:</em>{" "}
      <InlineRulesText text={action.hit} />.{" "}
    </>
  )}

  {action.text &&
 action.text.trim() &&
 action.text !== action.notes &&
 action.text !== action.graze &&
 action.text !== action.hit && (
  <>
    <InlineRulesText text={action.text} />
    {" "}
  </>
)}

  {action.notes && action.notes !== action.text && (
    <>
      {" "}
      <InlineRulesText text={action.notes} />
    </>
  )}
</p>
              </div>
            ))}
          </details>
        </>
      )}

      {adversary.opportunitiesAndComplications &&
      (adversary.opportunitiesAndComplications.opportunity ||
       adversary.opportunitiesAndComplications.complication) && (
    <>
      <div style={{ borderTop: "2px solid var(--theme-accent)", margin: "8px 0" }} />
      <details open>
        <SectionSummary title="OPPORTUNITIES AND COMPLICATIONS" />

                <p style={{ margin: "4px 0" }}>
          The following options are available when an enemy gains an Opportunity or Complication during a scene with this adversary:
        </p>

        {adversary.opportunitiesAndComplications.opportunity && (
          <p style={{ margin: "4px 0" }}>
            <strong>Opportunity.</strong>{" "}
            <InlineRulesText text={adversary.opportunitiesAndComplications.opportunity} />
          </p>
        )}

        {adversary.opportunitiesAndComplications.complication && (
          <p style={{ margin: "4px 0" }}>
            <strong>Complication.</strong>{" "}
            <InlineRulesText text={adversary.opportunitiesAndComplications.complication} />
          </p>
        )}
      </details>
    </>
)}

      {adversary.tactics && (
        <>
          <div style={{ borderTop: "2px solid var(--theme-accent)", margin: "8px 0" }} />
          <details>
            <SectionSummary title="TACTICS" />
            <p style={{ margin: "4px 0" }}>
              <InlineRulesText text={adversary.tactics} />
            </p>
          </details>
        </>
      )}
    </div>
  );
}

function BuilderCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--theme-panel)",
        border: "1px solid var(--theme-border)",
        borderRadius: 10,
        padding: 10,
        marginBottom: 12,
        boxShadow: "var(--shadow-small)",
      }}
    >
      {children}
    </div>
  );
}

type ThemeInfo = {
  id: string;
  className: string;
  name: string;
  previewPrimary: string;
  previewSecondary: string;
  previewBackground: string;
};

function discoverThemes(): ThemeInfo[] {
  const themeClassNames = new Set<string>();

  for (const styleSheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;

    try {
      rules = styleSheet.cssRules;
    } catch {
      // Ignore stylesheets whose rules the browser does not allow us to inspect.
      continue;
    }

    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;

      const selectors = rule.selectorText.split(",");

      for (const selector of selectors) {
        const match = selector.trim().match(/^\.theme-([a-z0-9_-]+)$/i);

        if (match) {
          themeClassNames.add(`theme-${match[1]}`);
        }
      }
    }
  }

  return Array.from(themeClassNames).map((className) => {
    const probe = document.createElement("div");
    probe.className = className;
    probe.style.display = "none";
    document.body.appendChild(probe);

    const styles = getComputedStyle(probe);

    const name = styles
      .getPropertyValue("--theme-name")
      .trim()
      .replace(/^["']|["']$/g, "");

    const theme: ThemeInfo = {
      id: className.replace(/^theme-/, ""),
      className,
      name: name || className.replace(/^theme-/, ""),
      previewPrimary: styles
        .getPropertyValue("--theme-preview-primary")
        .trim(),
      previewSecondary: styles
        .getPropertyValue("--theme-preview-secondary")
        .trim(),
      previewBackground: styles
        .getPropertyValue("--theme-preview-background")
        .trim(),
    };

    probe.remove();

    return theme;
  });
}

export default function App() {
  const [ready, setReady] = useState(false);
  // Tracks the OBR scene selection and whatever adversary data (if any)
  // is linked to the metadata of the currently selected token.
  const [selection, setSelection] = useState<string[]>([]);
  const [selectedTokenName, setSelectedTokenName] = useState("");
  const [attachedAdversary, setAttachedAdversary] = useState<Adversary | null>(null);

  const [builderAdversary, setBuilderAdversary] = useState<Adversary>(EMPTY_ADVERSARY);

  const [activeTab, setActiveTab] = useState<ActiveTab>("preview");

  const appTitle = "Cosmere Stat Blocks";

  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [activeTheme, setActiveTheme] = useState("stormlight");
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
 // The adversary library, loaded from Supabase.
// editingLibraryId tracks which entry the builder is currently
// modifying vs. creating new.
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [featureLibrary, setFeatureLibrary] = useState<FeatureLibraryEntry[]>([]);
  const [commonFeaturesOpen, setCommonFeaturesOpen] = useState(false);
  const [selectedCommonFeatureIds, setSelectedCommonFeatureIds] = useState<string[]>([]);
  const [editingCommonFeatureId, setEditingCommonFeatureId] = useState<string | null>(null);
  const [editingCommonFeatureName, setEditingCommonFeatureName] = useState("");
  const [editingCommonFeatureText, setEditingCommonFeatureText] = useState("");

  const [pendingCommonFeature, setPendingCommonFeature] = useState<{
  name: string;
  text: string;
} | null>(null);

  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");

const LIBRARY_SETTINGS = ["Stormlight", "Mistborn"] as const;

type LibrarySettingFilter =
  | (typeof LIBRARY_SETTINGS)[number]
  | "Other";

const [libraryTierFilters, setLibraryTierFilters] = useState<string[]>([]);
const [libraryTypeFilters, setLibraryTypeFilters] = useState<string[]>([]);

const [librarySettingFilters, setLibrarySettingFilters] = useState<
  LibrarySettingFilter[]
>([]);

const [librarySourceFilters, setLibrarySourceFilters] = useState<
  ("Official" | "Homebrew")[]
>([]);

const [libraryFiltersOpen, setLibraryFiltersOpen] = useState(false);
const [libraryTierOpen, setLibraryTierOpen] = useState(false);
const [libraryTypeOpen, setLibraryTypeOpen] = useState(false);
const [librarySettingOpen, setLibrarySettingOpen] = useState(false);
const [librarySourceOpen, setLibrarySourceOpen] = useState(false);

const [activeLetter, setActiveLetter] = useState<string | null>(null);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [hasLinkedMetadata, setHasLinkedMetadata] = useState(false);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  const libraryListRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const importLibraryInputRef = useRef<HTMLInputElement | null>(null);
  const menuBarRef = useRef<HTMLDivElement | null>(null);
  const tabRowRef = useRef<HTMLDivElement | null>(null);
  const libraryHeaderRef = useRef<HTMLDivElement | null>(null);
  const [libraryHeaderHeight, setLibraryHeaderHeight] = useState(0);
  useEffect(() => {
  const header = libraryHeaderRef.current;
  if (!header) return;

  const updateHeight = () => {
    setLibraryHeaderHeight(header.getBoundingClientRect().height);
  };

  updateHeight();

  const observer = new ResizeObserver(updateHeight);
  observer.observe(header);

  return () => observer.disconnect();
}, [activeTab]);

  // When a selected token has NO linked metadata, we try to auto-match it
  // to a library entry by name (see the selection effect below) so the GM
  // can quickly attach the right stat block.
  const [tokenMatchedLibraryId, setTokenMatchedLibraryId] = useState<string | null>(null);

  const iconButtonStyle = {
    width: 28,
    height: 28,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    color: "var(--theme-text-primary)",
    transition: "background 0.15s ease",
  } as const;

  const tabRefs = useRef<Record<ActiveTab, HTMLButtonElement | null>>({
  preview: null,
  builder: null,
  library: null,
});

const tabLabelRefs = useRef<Record<ActiveTab, HTMLSpanElement | null>>({
  preview: null,
  builder: null,
  library: null,
});

const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0 });

useEffect(() => {
  setThemes(discoverThemes());
}, []);

  // Load the adversary library from Supabase.
  useEffect(() => {
    async function loadLibrary() {
      const { data, error } = await supabase
        .from("adversaries")
        .select("library_id, name, summary, setting, tier, type, data");

      if (error) {
        console.error("Could not load adversary library from Supabase:", error);
        return;
      }

      const entries: LibraryEntry[] = data.map((row) => ({
        id: row.library_id,
        name: row.name,
        summary: row.summary,
        data: {
          ...(row.data as Adversary),
          setting: row.setting ?? (row.data as Adversary)?.setting,
        },
      }));

      setLibrary(entries);

      console.log(`Loaded ${entries.length} adversaries from Supabase.`);
    }

    loadLibrary();
  }, []);

  // Load reusable features from Supabase.
useEffect(() => {
  async function loadFeatureLibrary() {
    const { data, error } = await supabase
      .from("features")
      .select("feature_id, name, text, source");

    if (error) {
      console.error("Could not load feature library from Supabase:", error);
      return;
    }

    const entries: FeatureLibraryEntry[] = data.map((row) => ({
      id: row.feature_id,
      name: row.name,
      text: row.text,
      source: row.source === "Homebrew" ? "Homebrew" : "Official",
    }));

    setFeatureLibrary(entries);

    console.log(`Loaded ${entries.length} reusable features from Supabase.`);
  }

  loadFeatureLibrary();
}, []);

  // Measures the active tab label's position/width so the sliding
  // underline bar can animate to it. Recalculated on tab change and window
  // resize since label widths aren't fixed.
  useEffect(() => {
  const updateIndicator = () => {
    const activeLabel = tabLabelRefs.current[activeTab];
    const container = tabRowRef.current;
    if (!activeLabel || !container) return;

    const labelRect = activeLabel.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    setTabIndicator({
      left: labelRect.left - containerRect.left,
      width: labelRect.width,
    });
  };

  updateIndicator();
  const id = requestAnimationFrame(updateIndicator);

  window.addEventListener("resize", updateIndicator);
  return () => {
    cancelAnimationFrame(id);
    window.removeEventListener("resize", updateIndicator);
  };
}, [activeTab]);

  // Boilerplate OBR startup: wait for the extension to be ready, then
  // track the player's current selection going forward.
  useEffect(() => {
    OBR.onReady(async () => {
      setReady(true);

      const sel = (await OBR.player.getSelection()) ?? [];
      setSelection(sel);

      OBR.player.onChange(async () => {
        const newSel = (await OBR.player.getSelection()) ?? [];
        setSelection(newSel);
      });
    });
  }, []);

  // Closes the File/Attach dropdown menus (and any open submenu) when the
  // user clicks anywhere outside the menu bar.
  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuBarRef.current) return;
      if (!menuBarRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
        setOpenSubmenu(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  // Runs whenever the token selection changes. Priority order:
  //   1. If the selected token already has adversary metadata attached,
  //      load it straight into preview.
  //   2. Otherwise, try to auto-match the token's name against the saved
  //      library (case/parenthetical-insensitive) and surface that match
  //      in the "Match found" banner instead of auto-attaching it.
  // Clearing selection resets all of the above.
  useEffect(() => {
    if (selection.length === 0) {
  setAttachedAdversary(null);
  setTokenMatchedLibraryId(null);
  setSelectedTokenName("");
  setHasLinkedMetadata(false);
  return;
}

    OBR.scene.items.getItems(selection).then((items) => {
      const first = items[0] as any;
      const tokenName = first?.name ?? "";
      setSelectedTokenName(tokenName);

      // Older saved tokens may have used the key "monster" instead of
      // "adversary" — support both so old tokens don't silently break.
      const data = first?.metadata?.[METADATA_KEY] as
        | { version: number; adversary: Adversary }
        | { version: number; monster: Adversary }
        | undefined;

      let loaded: Adversary | undefined;

      if (data && "adversary" in data) {
        loaded = data.adversary;
      } else if (data && "monster" in data) {
        loaded = data.monster;
      }

      setHasLinkedMetadata(Boolean(loaded));

      if (loaded) {
  setAttachedAdversary(loaded);
  setSelectedLibraryId(null);
  setTokenMatchedLibraryId(null);
  setActiveTab("preview");
  return;
}

const normalizedTokenName = normalizeName(tokenName);
const matchedEntry =
  library.find((entry) => normalizeName(entry.name) === normalizedTokenName) ?? null;

setAttachedAdversary(null);
setTokenMatchedLibraryId(matchedEntry?.id ?? null);

setActiveTab("library");
    });
  }, [selection, library]);


  useEffect(() => {
  if (!statusMessage) return;

  const timer = window.setTimeout(() => {
    setStatusMessage(null);
  }, 3000);

  return () => window.clearTimeout(timer);
}, [statusMessage]);

// These derived values resolve "what adversary are we actually looking at
// right now" across three overlapping sources of truth: a manually
// selected library entry, an auto-matched one from the token name,
// whatever's attached to the token, and whatever's in the builder.
// currentWorkingAdversary (defined further below) = what "Attach"/"Save"
// act on. previewAdversary = what the Preview tab actually renders
// (token data wins over everything else there).
const effectiveLibraryId = selectedLibraryId ?? tokenMatchedLibraryId;

const selectedLibraryEntry = useMemo(
  () => library.find((entry) => entry.id === effectiveLibraryId) ?? null,
  [library, effectiveLibraryId]
);

  const sortedFilteredLibrary = useMemo(() => {
  return [...library]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((entry) => {
      const search = librarySearch.trim().toLowerCase();

      const matchesSearch =
        !search ||
        entry.name.toLowerCase().includes(search) ||
        entry.summary.toLowerCase().includes(search);

      const entryTier = entry.data.tier ?? "";
      const entryType = entry.data.type ?? "";
      const entrySetting = entry.data.setting ?? "Stormlight";
      const entrySource = entry.data.source ?? "Official";

      const matchesTier =
        libraryTierFilters.length === 0 ||
        libraryTierFilters.includes(entryTier);

      const matchesType =
      libraryTypeFilters.length === 0 ||
      libraryTypeFilters.some(
        (type) => entryType.toLowerCase() === type.toLowerCase()
      );

const matchesSetting =
  librarySettingFilters.length === 0 ||
  librarySettingFilters.some((setting) =>
    setting === "Other"
      ? !LIBRARY_SETTINGS.includes(
          entrySetting as (typeof LIBRARY_SETTINGS)[number]
        )
      : entrySetting === setting
  );

const matchesSource =
  librarySourceFilters.length === 0 ||
  librarySourceFilters.includes(
    entrySource as "Official" | "Homebrew"
  );

      return (
        matchesSearch &&
        matchesTier &&
        matchesType &&
        matchesSetting &&
        matchesSource
      );
    });
}, [
  library,
  librarySearch,
  libraryTierFilters,
  libraryTypeFilters,
  librarySettingFilters,
  librarySourceFilters,
]);

  const availableLetters = useMemo(() => {
    const letters = new Set<string>();

    for (const entry of sortedFilteredLibrary) {
      const first = entry.name?.trim()?.[0]?.toUpperCase();
      if (first && /[A-Z]/.test(first)) {
        letters.add(first);
      }
    }

    return Array.from(letters).sort();
  }, [sortedFilteredLibrary]);

  const autoMatchEntry = useMemo(() => {
    if (!selectedTokenName.trim()) return null;
    const norm = normalizeName(selectedTokenName);
    return library.find((entry) => normalizeName(entry.name) === norm) ?? null;
  }, [library, selectedTokenName]);

 const currentWorkingAdversary = useMemo(() => {
  if (activeTab === "builder") return builderAdversary;
  if (selectedLibraryEntry) return selectedLibraryEntry.data;
  return attachedAdversary ?? builderAdversary;
}, [activeTab, builderAdversary, selectedLibraryEntry, attachedAdversary]);

    const previewAdversary =
    attachedAdversary ?? selectedLibraryEntry?.data ?? currentWorkingAdversary;  function getEntryLetter(name: string) {
    const first = name.trim()?.[0]?.toUpperCase();
    return first && /[A-Z]/.test(first) ? first : "#";
  }

  // Writes/removes the adversary JSON directly into the selected token's
  // OBR metadata under METADATA_KEY, so the stat block travels with the
  // token even if the library entry is later edited or deleted.
  async function attachAdversaryData(parsed: Adversary) {
    if (selection.length === 0) return;

    await OBR.scene.items.updateItems(selection, (items) => {
      for (const item of items) {
        item.metadata[METADATA_KEY] = {
          version: 1,
          adversary: parsed,
        };
      }
    });

    setAttachedAdversary(parsed);
    setHasLinkedMetadata(true);
    setStatusMessage("Token linked.");
    setOpenMenu(null);
  }

  async function detachAdversaryData() {
    if (selection.length === 0) return;

    await OBR.scene.items.updateItems(selection, (items) => {
      for (const item of items) {
        delete item.metadata[METADATA_KEY];
      }
    });

    setAttachedAdversary(null);
    setHasLinkedMetadata(false);
    setStatusMessage("Token unlinked.");
    setOpenMenu(null);
  }

  // A-Z quick-jump sidebar for the library list. jumpToLetter scrolls to
  // the first matching entry; the useEffect below tracks whichever entry
  // is currently closest to the top of the scroll container, so the
  // sidebar highlight stays in sync while scrolling.
  function jumpToLetter(letter: string) {
    const match = sortedFilteredLibrary.find(
      (entry) => getEntryLetter(entry.name) === letter
    );

    if (!match) return;

    rowRefs.current[match.id]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    setActiveLetter(letter);
  }

  useEffect(() => {
    if (sortedFilteredLibrary.length === 0) {
      setActiveLetter(null);
      return;
    }

    const container = libraryListRef.current;
    if (!container) return;

    function updateActiveLetter() {
      const currentContainer = libraryListRef.current;
      if (!currentContainer) return;

      const containerTop = currentContainer.getBoundingClientRect().top;
      let bestLetter: string | null = null;
      let bestDistance = Infinity;

      for (const entry of sortedFilteredLibrary) {
        const el = rowRefs.current[entry.id];
        if (!el) continue;

        const rect = el.getBoundingClientRect();
        const distance = Math.abs(rect.top - containerTop);

        if (distance < bestDistance) {
          bestDistance = distance;
          bestLetter = getEntryLetter(entry.name);
        }
      }

      setActiveLetter(bestLetter);
    }

    updateActiveLetter();
    container.addEventListener("scroll", updateActiveLetter);

    return () => {
      container.removeEventListener("scroll", updateActiveLetter);
    };
  }, [sortedFilteredLibrary]);

  // "Save" updates the entry currently being edited (or creates one if
  // none is being edited); "Save As New" (below) always creates a fresh
  // entry even if we're mid-edit of an existing one — used for cloning
  // variants of an adversary.
    async function saveCurrentToLibrary() {
    const current = builderAdversary;

    if (!current.name || !current.name.trim()) {
      setStatusMessage("Please give the adversary a name first.");
      return;
    }

    const existingId = editingLibraryId ?? makeId();

    const entry: LibraryEntry = {
      id: existingId,
      name: current.name.trim(),
      summary: makeSummary(current),
      data: {
        ...current,
        actions: normalizeActions(current.actions),
      },
    };

    const { error } = await supabase
      .from("adversaries")
      .upsert(
        {
          library_id: entry.id,
          name: entry.name,
          summary: entry.summary,
          setting: entry.data.setting ?? null,
          tier: entry.data.tier ?? null,
          type: entry.data.type ?? null,
          data: entry.data,
        },
        {
          onConflict: "library_id",
        }
      );

    if (error) {
      console.error("Could not save adversary to Supabase:", error);
      setStatusMessage("Could not save library entry.");
      return;
    }

    setLibrary((prev) => {
      const exists = prev.some((x) => x.id === existingId);

      if (exists) {
        return prev.map((x) => (x.id === existingId ? entry : x));
      }

      return [...prev, entry];
    });

    setEditingLibraryId(entry.id);
    setSelectedLibraryId(entry.id);
    setActiveTab("library");
    setStatusMessage(
      editingLibraryId ? "Library entry updated." : "Library entry saved."
    );
    setOpenMenu(null);
  }

    async function saveAsNewToLibrary() {
    const current = builderAdversary;

    if (!current.name || !current.name.trim()) {
      setStatusMessage("Please give the adversary a name first.");
      return;
    }

    const entry: LibraryEntry = {
      id: makeId(),
      name: current.name.trim(),
      summary: makeSummary(current),
      data: {
        ...current,
        actions: normalizeActions(current.actions),
      },
    };

    const { error } = await supabase
      .from("adversaries")
      .insert({
        library_id: entry.id,
        name: entry.name,
        summary: entry.summary,
        setting: entry.data.setting ?? null,
        tier: entry.data.tier ?? null,
        type: entry.data.type ?? null,
        data: entry.data,
      });

    if (error) {
      console.error("Could not save new adversary to Supabase:", error);
      setStatusMessage("Could not save new library entry.");
      return;
    }

    setLibrary((prev) => [...prev, entry]);
    setEditingLibraryId(entry.id);
    setSelectedLibraryId(entry.id);
    setActiveTab("library");
    setStatusMessage("Saved as new library entry.");
    setOpenMenu(null);
  }

  function normalizeHealth(adversary: Adversary): Adversary {
  // New-format entry already has Min/Max Health.
  if (
    adversary.minHealth != null &&
    adversary.maxHealth != null
  ) {
    return adversary;
  }

  // Older entries stored the range as a string such as "32–48".
  const range = adversary.healthRange?.trim();

  if (range) {
    const match = range.match(/^\s*(\d+)\s*[-–—]\s*(\d+)\s*$/);

    if (match) {
      const minHealth = Number(match[1]);
      const maxHealth = Number(match[2]);

      return {
        ...adversary,
        minHealth,
        maxHealth,
        health: Math.round((minHealth + maxHealth) / 2),
      };
    }
  }

  // If there is no usable old range, preserve the old Health value.
  return adversary;
}

  function loadLibraryEntry(entry: LibraryEntry) {
  setSelectedLibraryId(entry.id);
  setEditingLibraryId(entry.id);
  setBuilderAdversary(normalizeHealth(entry.data));
}

  function startNewBuilderAdversary() {
  setSelectedLibraryId(null);
  setEditingLibraryId(null);
  setBuilderAdversary(EMPTY_ADVERSARY);
  setActiveTab("builder");
  setOpenMenu(null);
}

  function updateBuilderSource(value: "Official" | "Homebrew") {
  setBuilderAdversary((prev) => ({
    ...prev,
    source: value,
  }));
}

function updateBuilderSetting(value: string) {
  setBuilderAdversary((prev) => ({
    ...prev,
    setting: value,
  }));
}

  function setPhysical(
  key: "str" | "spd",
  value: number
) {
  setBuilderAdversary((prev) => {
    const str = key === "str" ? value : prev.physical?.str ?? 0;
    const spd = key === "spd" ? value : prev.physical?.spd ?? 0;

    return {
      ...prev,
      physical: {
        str,
        spd,
        def: str + spd + 10,
      },
    };
  });
}

function setCognitive(
  key: "int" | "wil",
  value: number
) {
  setBuilderAdversary((prev) => {
    const int = key === "int" ? value : prev.cognitive?.int ?? 0;
    const wil = key === "wil" ? value : prev.cognitive?.wil ?? 0;

    return {
      ...prev,
      cognitive: {
        int,
        wil,
        def: int + wil + 10,
      },
    };
  });
}

function setSpiritual(
  key: "awa" | "pre",
  value: number
) {
  setBuilderAdversary((prev) => {
    const awa = key === "awa" ? value : prev.spiritual?.awa ?? 0;
    const pre = key === "pre" ? value : prev.spiritual?.pre ?? 0;

    return {
      ...prev,
      spiritual: {
        awa,
        pre,
        def: awa + pre + 10,
      },
    };
  });
}

function setHealthRange(
  key: "minHealth" | "maxHealth",
  value: number
) {
  setBuilderAdversary((prev) => {
    const minHealth =
      key === "minHealth" ? value : prev.minHealth ?? 0;

    const maxHealth =
      key === "maxHealth" ? value : prev.maxHealth ?? 0;

    const health = Math.round((minHealth + maxHealth) / 2);

    return {
      ...prev,
      minHealth,
      maxHealth,
      health,
      healthRange: `${minHealth}–${maxHealth}`,
    };
  });
}

  function updateOpportunitiesAndComplications(
  field: "intro" | "opportunity" | "complication",
  value: string
) {
  setBuilderAdversary((prev) => ({
    ...prev,
    opportunitiesAndComplications: {
      intro: prev.opportunitiesAndComplications?.intro ?? "",
      opportunity: prev.opportunitiesAndComplications?.opportunity ?? "",
      complication: prev.opportunitiesAndComplications?.complication ?? "",
      [field]: value,
    },
  }));
}

function updateTactics(value: string) {
  setBuilderAdversary((prev) => ({
    ...prev,
    tactics: value,
  }));
}

  function updateFeature(index: number, field: "name" | "text", value: string) {
    setBuilderAdversary((prev) => {
      const features = [...(prev.features ?? [])];
      features[index] = { ...features[index], [field]: value };
      return { ...prev, features };
    });
  }

  function addFeature(afterIndex?: number) {
  const currentFeatures = builderAdversary.features ?? [];

  // Look for an existing completely blank feature,
  // but do NOT count the feature we're currently leaving.
  const blankIndex = currentFeatures.findIndex(
    (feature, index) =>
      index !== afterIndex &&
      !feature.name.trim() &&
      !feature.text.trim()
  );

  // If another blank feature already exists,
  // move to that one instead of creating another.
  if (blankIndex !== -1) {
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLInputElement>(
        `[data-feature-index="${blankIndex}"]`
      );

      target?.focus();
    });

    return;
  }

  // Otherwise create one new blank feature.
  const insertIndex =
    afterIndex === undefined
      ? currentFeatures.length
      : afterIndex + 1;

  const next = [...currentFeatures];

  next.splice(insertIndex, 0, {
    name: "",
    text: "",
  });

  setBuilderAdversary((prev) => ({
    ...prev,
    features: next,
  }));

  requestAnimationFrame(() => {
    const target = document.querySelector<HTMLInputElement>(
      `[data-feature-index="${insertIndex}"]`
    );

    target?.focus();
  });
}

function saveAsCommonFeature(feature: {
  name: string;
  text: string;
}) {
  const name = feature.name.trim();
  const text = feature.text.trim();

  if (!name) {
    setStatusMessage("Please give the feature a name first.");
    return;
  }

  setPendingCommonFeature({
    name,
    text,
  });
}

async function confirmSaveAsCommonFeature(
  source: "Official" | "Homebrew"
) {
  if (!pendingCommonFeature) return;

  const entry: FeatureLibraryEntry = {
    id: makeId(),
    name: pendingCommonFeature.name,
    text: pendingCommonFeature.text,
    source,
  };

  const { error } = await supabase
    .from("features")
    .insert({
      feature_id: entry.id,
      name: entry.name,
      text: entry.text,
      source: entry.source,
    });

  if (error) {
    console.error("Could not save common feature to Supabase:", error);
    setStatusMessage("Could not save common feature.");
    return;
  }

  setFeatureLibrary((prev) => [...prev, entry]);
  setPendingCommonFeature(null);

  setStatusMessage(
    `Saved "${entry.name}" as an ${entry.source} common feature.`
  );
}

function startEditingCommonFeature(feature: FeatureLibraryEntry) {
  setEditingCommonFeatureId(feature.id);
  setEditingCommonFeatureName(feature.name);
  setEditingCommonFeatureText(feature.text);
}

function cancelEditingCommonFeature() {
  setEditingCommonFeatureId(null);
  setEditingCommonFeatureName("");
  setEditingCommonFeatureText("");
}

async function saveCommonFeatureEdit() {
  if (!editingCommonFeatureId) return;

  const name = editingCommonFeatureName.trim();
  const text = editingCommonFeatureText.trim();

  if (!name) {
    setStatusMessage("Please give the feature a name.");
    return;
  }

  const { error } = await supabase
    .from("features")
    .update({
      name,
      text,
    })
    .eq("feature_id", editingCommonFeatureId);

  if (error) {
    console.error("Could not update common feature:", error);
    setStatusMessage("Could not update common feature.");
    return;
  }

  setFeatureLibrary((prev) =>
    prev.map((feature) =>
      feature.id === editingCommonFeatureId
        ? { ...feature, name, text }
        : feature
    )
  );

  setStatusMessage(`Updated "${name}".`);
  cancelEditingCommonFeature();
}

async function deleteCommonFeature(feature: FeatureLibraryEntry) {
  const confirmed = window.confirm(
    `Delete "${feature.name}" from Common Features?`
  );

  if (!confirmed) return;

  const { error } = await supabase
    .from("features")
    .delete()
    .eq("feature_id", feature.id);

  if (error) {
    console.error("Could not delete common feature:", error);
    setStatusMessage("Could not delete common feature.");
    return;
  }

  setFeatureLibrary((prev) =>
    prev.filter((item) => item.id !== feature.id)
  );

  setSelectedCommonFeatureIds((prev) =>
    prev.filter((id) => id !== feature.id)
  );

  if (editingCommonFeatureId === feature.id) {
    cancelEditingCommonFeature();
  }

  setStatusMessage(`Deleted "${feature.name}".`);
}

function toggleCommonFeature(id: string) {
  setSelectedCommonFeatureIds((prev) =>
    prev.includes(id)
      ? prev.filter((featureId) => featureId !== id)
      : [...prev, id]
  );
}

function addSelectedCommonFeatures() {
  const selected = featureLibrary.filter((feature) =>
    selectedCommonFeatureIds.includes(feature.id)
  );

  if (selected.length === 0) return;

  setSelectedLibraryId(null);

  setBuilderAdversary((prev) => ({
    ...prev,
    features: [
      ...(prev.features ?? []),
      ...selected.map((feature) => ({
        name: feature.name,
        text: feature.text,
      })),
    ],
  }));

  setSelectedCommonFeatureIds([]);
  setCommonFeaturesOpen(false);
}

  function removeFeature(index: number) {
    setBuilderAdversary((prev) => ({
      ...prev,
      features: (prev.features ?? []).filter((_, i) => i !== index),
    }));
  }

  function updateAction(
  index: number,
  field:
    | "name"
    | "text"
    | "cost"
    | "focusCost"
    | "investitureCost"
    | "attackBonus"
    | "reach"
    | "range"
    | "target"
    | "graze"
    | "hit"
    | "notes",
  value: string
) {
  setBuilderAdversary((prev) => {
    const actions = [...(prev.actions ?? [])];
    const current = actions[index] ?? {
      name: "",
      text: "",
      cost: 1 as ActionCost,
      focusCost: "",
      investitureCost: "",
      attackBonus: "",
      reach: "",
      range: "",
      target: "",
      graze: "",
      hit: "",
      notes: "",
    };

    let parsedCost: ActionCost | undefined = current.cost;
    if (field === "cost") {
      if (value === "free" || value === "reaction") parsedCost = value;
      else if (value === "1" || value === "2" || value === "3") {
        parsedCost = Number(value) as 1 | 2 | 3;
      } else {
        parsedCost = undefined;
      }
    }

    actions[index] = {
      ...current,
      ...(field === "name" ? { name: value } : {}),
      ...(field === "text" ? { text: value } : {}),
      ...(field === "cost" ? { cost: parsedCost } : {}),
      ...(field === "focusCost" ? { focusCost: value } : {}),
      ...(field === "investitureCost" ? { investitureCost: value } : {}),
      ...(field === "attackBonus" ? { attackBonus: value } : {}),
      ...(field === "reach" ? { reach: value } : {}),
      ...(field === "range" ? { range: value } : {}),
      ...(field === "target" ? { target: value } : {}),
      ...(field === "graze" ? { graze: value } : {}),
      ...(field === "hit" ? { hit: value } : {}),
      ...(field === "notes" ? { notes: value } : {}),
    };

    return { ...prev, actions };
  });
}

  function addAction() {
  const currentActions = builderAdversary.actions ?? [];

  const blankIndex = currentActions.findIndex((action) => {
    return (
      !action.name?.trim() &&
      !action.text?.trim() &&
      !action.focusCost?.trim() &&
      !action.investitureCost?.trim() &&
      !action.attackBonus?.trim() &&
      !action.reach?.trim() &&
      !action.range?.trim() &&
      !action.target?.trim() &&
      !action.graze?.trim() &&
      !action.hit?.trim() &&
      !action.notes?.trim()
    );
  });

  if (blankIndex !== -1) {
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLInputElement>(
        `[data-action-index="${blankIndex}"]`
      );

      target?.focus();
    });

    return;
  }

  const insertIndex = currentActions.length;

  setBuilderAdversary((prev) => ({
    ...prev,
    actions: [
      ...(prev.actions ?? []),
      {
        name: "",
        text: "",
        cost: 1,
        focusCost: "",
        investitureCost: "",
        attackBonus: "",
        reach: "",
        range: "",
        target: "",
        graze: "",
        hit: "",
        notes: "",
      },
    ],
  }));

  requestAnimationFrame(() => {
    const target = document.querySelector<HTMLInputElement>(
      `[data-action-index="${insertIndex}"]`
    );

    target?.focus();
  });
}

  function removeAction(index: number) {
    setBuilderAdversary((prev) => ({
      ...prev,
      actions: (prev.actions ?? []).filter((_, i) => i !== index),
    }));
  }

  function exportLibrary() {
    const dataStr = JSON.stringify(library, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "adversary library owlbear.json";
    a.click();

    URL.revokeObjectURL(url);
    setStatusMessage("Library exported.");
    setOpenMenu(null);
  }

  // Accepts several possible import shapes for backward-compatibility:
  //   - an array of {id, name, summary, data} library entries (our own export format)
  //   - a bare array of adversary blocks (no wrapper)
  //   - a single adversary object
  // Existing entries are matched/overwritten by id; everything else is added.
  function runLibraryImport(parsed: any) {
  try {
    let entries: LibraryEntry[] = [];

    if (Array.isArray(parsed) && parsed[0]?.data) {
      entries = parsed.map((entry: any) => ({
        id: entry.id ?? makeId(),
        name: entry.name ?? "Unnamed",
        summary:
          typeof entry.summary === "string" && entry.summary.trim()
            ? entry.summary.trim()
            : makeSummary(entry.data as Adversary),
        data: {
          ...(entry.data as Adversary),
          actions: normalizeActions((entry.data as Adversary)?.actions),
        },
      }));
    } else if (Array.isArray(parsed)) {
      entries = parsed.map((block: any) => ({
        id: makeId(),
        name: block.name ?? "Unnamed",
        summary: makeSummary(block as Adversary),
        data: {
          ...(block as Adversary),
          actions: normalizeActions((block as Adversary)?.actions),
        },
      }));
    } else if (parsed && typeof parsed === "object") {
      entries = [
        {
          id: makeId(),
          name: parsed.name ?? "Unnamed",
          summary: makeSummary(parsed as Adversary),
          data: {
            ...(parsed as Adversary),
            actions: normalizeActions((parsed as Adversary)?.actions),
          },
        },
      ];
    } else {
      setStatusMessage("Invalid JSON format.");
      return;
    }

    let added = 0;
    let updated = 0;

    setLibrary((prev) => {
      const next = [...prev];

      for (const entry of entries) {
        const existingIndex = entry.id
  ? next.findIndex((e) => e.id === entry.id)
  : -1;

if (existingIndex >= 0) {
  next[existingIndex] = entry;
  updated++;
} else {
  next.push({
    ...entry,
    id: entry.id ?? makeId(),
  });
  added++;
}
      }

      next.sort((a, b) => a.name.localeCompare(b.name));
      return next;
    });

    setStatusMessage(`Import complete: ${added} added, ${updated} updated`);
  } catch (err) {
    console.error(err);
    setStatusMessage("Import failed.");
  }
}

  async function importLibraryFromFile(file: File) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    runLibraryImport(parsed);
  } catch (error) {
    console.error(error);
    setStatusMessage("Could not import that file.");
  }
}

  async function importFromText() {
  const input = prompt("Paste your JSON array here:");
  if (!input) return;

  try {
    const parsed = JSON.parse(input);
    runLibraryImport(parsed);
  } catch (error) {
    console.error(error);
    setStatusMessage("Invalid pasted JSON.");
  }
}

  function MenuAction({
    children,
    onClick,
    disabled = false,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
  }) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          background: disabled ? "var(--theme-panel-soft)" : "transparent",
          color: disabled ? "var(--theme-text-subtle)" : "var(--theme-text-primary)",
          border: "none",
          padding: "6px 8px",
          borderRadius: 6,
          cursor: disabled ? "default" : "pointer",
          fontSize: 12,
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = "var(--theme-panel-muted)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = disabled
          ? "var(--theme-panel-soft)"
          : "transparent";
        }}
      >
        {children}
      </button>
    );
  }

  // Dropdown menus flip to align/open on the opposite side near the edge
  // of the panel (library menu on the left, token menu on the right) so
  // they don't get clipped by the extension's narrow width.
  function getDropdownStyle(alignRight = false): React.CSSProperties {
  return {
    position: "absolute",
    top: "calc(100% + 6px)",
    ...(alignRight ? { right: 0 } : { left: 0 }),
    minWidth: 150,
    background: "var(--theme-panel)",
    border: "1px solid var(--theme-accent)",
    borderRadius: 6,
    boxShadow: "var(--shadow-menu)",
    padding: 4,
    zIndex: 50,
  };
}

  function getFlyoutStyle(openLeft = false): React.CSSProperties {
  return {
    position: "absolute",
    top: 0,
    ...(openLeft
      ? { right: "calc(100% + 6px)" }
      : { left: "calc(100% + 6px)" }),
    minWidth: 130,
    background: "var(--theme-panel)",
    border: "1px solid var(--theme-accent)",
    borderRadius: 6,
    boxShadow: "var(--shadow-menu)",
    padding: 4,
    zIndex: 60,
  };
}

 function TopNavTab({
  active,
  label,
  onClick,
  buttonRef,
  labelRef,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  labelRef?: (el: HTMLSpanElement | null) => void;
}) {
  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      style={{
        border: "none",
        background: "transparent",
        padding: "6px 10px 10px 10px",
        cursor: "pointer",
        color: active
          ? "var(--theme-text-primary)"
          : "var(--theme-secondary)",
        fontWeight: active ? 800 : 600,
        fontSize: 13,
        letterSpacing: 0.8,
        textTransform: "uppercase",
        transition: "color 0.18s ease",
      }}
    >
      <span ref={labelRef}>{label}</span>
    </button>
  );
}

// Shared renderer for both the "File" (library) and "Attach" (token)
// dropdown menus in the top bar — driven by the `menu` param rather than
// duplicating the open/close/submenu logic twice.
function renderMenu(menu: Exclude<OpenMenu, null>) {
  const isOpen = openMenu === menu;
  const isDisabled = menu === "token" && selection.length === 0;

  const label = menu === "library" ? "File" : "Attach";
  const shouldOpenLeft = menu === "library";
  const shouldAlignDropdownRight = menu === "library" || menu === "token";

  return (
  <div
    style={{
  position: "relative",
  paddingLeft: 10,
  marginLeft: -10,
  paddingBottom: 6,
}}
    onMouseLeave={() => {
      setOpenMenu(null);
      setOpenSubmenu(null);
    }}
  >
      <button
        onClick={() => {
          if (isDisabled) return;
          setOpenSubmenu(null);
          setOpenMenu(isOpen ? null : menu);
        }}
        style={{
  padding: "3px 8px",
  borderRadius: 6,
  border: isOpen
  ? "1px solid var(--theme-accent)"
  : "1px solid transparent",

background: isOpen
  ? "var(--theme-panel-active)"
  : "transparent",
  color: isDisabled
  ? "var(--theme-border-muted)"
  : "var(--theme-primary-dark)",
  fontWeight: 700,
  cursor: isDisabled ? "not-allowed" : "pointer",
  minHeight: 22,
  width: "100%",
  minWidth: 100,
  whiteSpace: "nowrap",
  opacity: isDisabled ? 0.65 : 0.85,
  fontSize: 12,
  boxSizing: "border-box",
}}
      >
        {label} ▾
      </button>

      {isOpen && !isDisabled && (
  <div style={getDropdownStyle(shouldAlignDropdownRight)}>
          {menu === "library" && (
  <>
    <MenuAction onClick={saveCurrentToLibrary}>Save</MenuAction>

    <MenuAction onClick={saveAsNewToLibrary}>Save As New</MenuAction>

    <MenuAction onClick={startNewBuilderAdversary}>
      New Adversary
    </MenuAction>

    <div style={{ position: "relative" }}>
      <MenuAction
        onClick={() =>
          setOpenSubmenu(
            openSubmenu === "library-import" ? null : "library-import"
          )
        }
      >
        Import ▸
      </MenuAction>

      {openSubmenu === "library-import" && (
        <div style={getFlyoutStyle(shouldOpenLeft)}>
          <MenuAction onClick={() => importLibraryInputRef.current?.click()}>
            From File
          </MenuAction>
          <MenuAction onClick={importFromText}>
            Paste JSON
          </MenuAction>
        </div>
      )}
    </div>

    <div style={{ position: "relative" }}>
      <MenuAction
        onClick={() =>
          setOpenSubmenu(
            openSubmenu === "library-export" ? null : "library-export"
          )
        }
      >
        Export ▸
      </MenuAction>

      {openSubmenu === "library-export" && (
        <div style={getFlyoutStyle(shouldOpenLeft)}>
          <MenuAction
            onClick={() => {
              if (!currentWorkingAdversary) {
                setStatusMessage("Nothing to export.");
                return;
              }
              exportJsonFile(currentWorkingAdversary);
              setStatusMessage("Current JSON exported.");
              setOpenMenu(null);
              setOpenSubmenu(null);
            }}
          >
            JSON
          </MenuAction>

          <MenuAction
            onClick={() => {
              exportLibrary();
              setOpenSubmenu(null);
            }}
          >
            Library
          </MenuAction>
        </div>
      )}
    </div>
  </>
)}

{menu === "token" && (
  <>
    <MenuAction
      onClick={() => {
        if (!currentWorkingAdversary) {
          setStatusMessage("No adversary selected.");
          return;
        }
        attachAdversaryData(currentWorkingAdversary);
      }}
      disabled={!currentWorkingAdversary || selection.length === 0}
    >
      Attach to Token
    </MenuAction>

    <MenuAction
      onClick={detachAdversaryData}
      disabled={selection.length === 0 || !hasLinkedMetadata}
    >
      Unlink Token
    </MenuAction>
  </>
)}

        </div>
      )}
    </div>
  );
}


  if (!ready) return <div>Loading...</div>;

  return (
    <div
      className={`theme-${activeTheme}`}
      style={{
        padding: 12,
        fontFamily: "var(--theme-ui-font)",
        background: "var(--theme-app-background)",
        height: "100vh",
        boxSizing: "border-box",
        width: "100%",
        maxWidth: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <input
        ref={importLibraryInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          await importLibraryFromFile(file);
          e.currentTarget.value = "";
        }}
      />

      <style>
  {`
    details[open] .arrow {
      transform: rotate(90deg);
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(3px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `}
</style>

      <div
  style={{
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    zIndex: 10000,
  }}
>
  <h2
    style={{
      margin: 0,
      color: "var(--theme-text-primary)",
      textAlign: "center",
    }}
  >
    {appTitle}
  </h2>

  <div
  onMouseLeave={() => setThemeMenuOpen(false)}
  style={{
    position: "absolute",
    right: 0,
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 10001,
    paddingBottom: 6,
    paddingLeft: 50,
    marginLeft: -50,
  }}
>
    <button
      type="button"
      title="Change theme"
      aria-label="Change theme"
      onClick={() => setThemeMenuOpen((open) => !open)}
      style={{
        width: 32,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        fontSize: 18,
      }}
    >
      <span
  style={{
    width: 22,
    height: 22,
    borderRadius: "50%",
    background:
      "conic-gradient(#e53935, #fb8c00, #fdd835, #43a047, #1e88e5, #8e24aa, #e53935)",
    display: "block",
  }}
/>
    </button>

    {themeMenuOpen && (
      <div
        style={{
          position: "absolute",
          top: 38,
          right: 0,
          width: 230,
          padding: 8,
          display: "grid",
          gap: 8,
          background: "var(--theme-panel)",
          border: "1px solid var(--theme-border)",
          borderRadius: 8,
          boxShadow: "var(--shadow-large)",
          zIndex: 10002,
        }}
      >
        {themes.map((theme) => {
          const isActive = activeTheme === theme.id;

          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => {
                setActiveTheme(theme.id);
                setThemeMenuOpen(false);
              }}
              style={{
                padding: 0,
                overflow: "hidden",
                textAlign: "left",
                border: isActive
                  ? `2px solid ${theme.previewPrimary}`
                  : `1px solid ${theme.previewSecondary}`,
                borderRadius: 6,
                background: theme.previewBackground,
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  padding: "7px 9px",
                  background: theme.previewPrimary,
                  color: "#fff",
                  fontWeight: 700,
                }}
              >
                {theme.name}
              </div>

              <div
                style={{
                  padding: "7px 9px",
                  color: theme.previewPrimary,
                  fontFamily: "Georgia, serif",
                  fontSize: 12,
                }}
              >
                <strong>THEME PREVIEW</strong>

                <div
                  style={{
                    borderTop: `2px solid ${theme.previewSecondary}`,
                    marginTop: 4,
                  }}
                />

                <div
                  style={{
                    marginTop: 5,
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: theme.previewPrimary,
                    }}
                  />

                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: theme.previewSecondary,
                    }}
                  />

                  <span>{appTitle}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    )}
  </div>
</div>

{statusMessage && (
  <div
    style={{
      marginBottom: 10,
      padding: "6px 10px",
      border: "1px solid var(--theme-accent)",
borderRadius: 6,
background: "var(--theme-warning-background)",
color: "var(--theme-text-primary)",
      fontSize: 13,
    }}
  >
    {statusMessage}
  </div>
)}

{selectedLibraryId && activeTab === "builder" && (
  <div style={{ marginBottom: 8, fontWeight: "bold" }}>
    Editing: {selectedLibraryEntry?.name ?? "Unknown"}
  </div>
)}

<div
  ref={menuBarRef}
  style={{
    position: "sticky",
    top: 0,
    zIndex: 100,
    background: "var(--theme-background)",
    padding: "12px 16px",
    marginBottom: 12,
    borderBottom: "1px solid var(--theme-border)",
    boxShadow: openMenu ? "0 4px 10px rgba(0,0,0,0.06)" : "0 2px 6px rgba(0,0,0,0.04)",
    overflow: "visible",
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
  }}
>
  <div
  style={{
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto 90px",
    alignItems: "center",
    minHeight: 64,
    columnGap: 8,
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
  }}
>
  <div />

  <div
    ref={tabRowRef}
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minWidth: 100,
      flexWrap: "nowrap",
      position: "relative",
    }}
  >
    <TopNavTab
  label="Builder"
  active={activeTab === "builder"}
  onClick={() => setActiveTab("builder")}
  buttonRef={(el) => {
    tabRefs.current.builder = el;
  }}
  labelRef={(el) => {
    tabLabelRefs.current.builder = el;
  }}
/>

<TopNavTab
  label="Library"
  active={activeTab === "library"}
  onClick={() => setActiveTab("library")}
  buttonRef={(el) => {
    tabRefs.current.library = el;
  }}
  labelRef={(el) => {
    tabLabelRefs.current.library = el;
  }}
/>

<TopNavTab
  label="Preview"
  active={activeTab === "preview"}
  onClick={() => setActiveTab("preview")}
  buttonRef={(el) => {
    tabRefs.current.preview = el;
  }}
  labelRef={(el) => {
    tabLabelRefs.current.preview = el;
  }}
/>
<div
  style={{
    position: "absolute",
    bottom: 0,
    left: tabIndicator.left,
    width: tabIndicator.width,
    height: 4,
    borderRadius: 3,
    background: "var(--theme-accent)",
    transition: "left 0.22s ease, width 0.22s ease",
    pointerEvents: "none",
  }}
/>
  </div>

  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: 6,
      alignItems: "center",
      justifySelf: "end",
      width: 82,
    }}
  >
    {renderMenu("library")}
    {renderMenu("token")}
  </div>
</div>
</div>

<div
  ref={libraryListRef}
  style={{
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
  }}
>

      {selection.length > 0 && (
        <p style={{ marginBottom: 8, color: "var(--theme-text-secondary)" }}>
          Selected tokens: {selection.length}
        </p>
      )}

      {autoMatchEntry && selection.length > 0 && !hasLinkedMetadata && (
        <div
          style={{
  marginBottom: 12,
  padding: 14,
  border: "1px solid var(--theme-accent)",
  borderRadius: 12,
  background: "var(--theme-warning-background)",
  boxShadow: "var(--shadow-small)",
}}
        >
          <div style={{ marginBottom: 6 }}>
            Match found for token <strong>{selectedTokenName}</strong>:{" "}
            <strong>{autoMatchEntry.name}</strong>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
  <button
    onClick={() => {
      loadLibraryEntry(autoMatchEntry);
      setActiveTab("preview");
    }}
    style={{
      padding: "8px 14px",
      borderRadius: 8,
      border: "1px solid var(--theme-accent)",
      background: "var(--theme-panel)",
      color: "var(--theme-text-primary)",
      fontWeight: 700,
      cursor: "pointer",
      fontSize: 14,
      boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
    }}
  >
    Preview Match
  </button>

  <button
    onClick={() => attachAdversaryData(autoMatchEntry.data)}
    style={{
      padding: "8px 14px",
      borderRadius: 8,
      border: "1px solid var(--theme-primary)",
      background: "var(--theme-primary)",
      color: "var(--theme-text-on-accent)",
      fontWeight: 700,
      cursor: "pointer",
      fontSize: 14,
      boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
    }}
  >
    Attach Match
  </button>
</div>
        </div>
      )}

      {activeTab === "preview" && (
  <div style={{ animation: "fadeIn 0.18s ease" }}>
    {previewAdversary ? (
      <PreviewErrorBoundary>
        <AdversaryCard adversary={previewAdversary} />
      </PreviewErrorBoundary>
    ) : (
      <div
        style={{
          padding: 12,
          border: "1px solid var(--theme-accent)",
          borderRadius: 8,
          background: "var(--theme-panel)",
        }}
      >
        No adversary selected yet.
      </div>
    )}
  </div>
)}

      {activeTab === "library" && (
  <div style={{ animation: "fadeIn 0.18s ease" }}>
    <div
      style={{
        border: "1px solid var(--theme-accent)",
        borderTop: "none",
        borderRadius: 8,
        padding: 12,
        background: "var(--theme-panel)",
      }}
    >
          <div
  ref={libraryHeaderRef}
  style={{
    position: "sticky",
    top: 0,
    zIndex: 3,
    background: "var(--theme-panel)",
    margin: "-12px -12px 0",
  padding: "12px 12px 10px",
  borderTop: "1px solid var(--theme-accent)",
  borderRadius: "8px 8px 0 0",
  }}
>
  <div
  style={{
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 40px",
    gap: 8,
    alignItems: "center",
  }}
>
  {/* Search box */}
  <div style={{ position: "relative", minWidth: 0 }}>
    <input
      type="text"
      value={librarySearch}
      onChange={(e) => setLibrarySearch(e.target.value)}
      placeholder="Search adversaries..."
      style={{
        width: "100%",
        padding: "6px 32px 6px 8px",
        border: "1px solid var(--theme-accent)",
        borderRadius: 4,
        fontSize: 14,
        boxSizing: "border-box",
      }}
    />

    {librarySearch && (
      <button
        type="button"
        onClick={() => setLibrarySearch("")}
        aria-label="Clear search"
        title="Clear search"
        style={{
          position: "absolute",
          right: 6,
          top: "50%",
          transform: "translateY(-50%)",
          width: 22,
          height: 22,
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--theme-text-secondary)",
          fontSize: 20,
          lineHeight: "20px",
          cursor: "pointer",
        }}
      >
        ×
      </button>
    )}
  </div>

  {/* Filter button and dropdown */}
<div
  style={{
  position: "relative",
  paddingLeft: 50,
  marginLeft: -50,
  paddingBottom: 6,
}}
  onMouseLeave={() => setLibraryFiltersOpen(false)}
>
  <button
    type="button"
    onClick={() => setLibraryFiltersOpen((open) => !open)}
    aria-label="Filter adversaries"
    title="Filter adversaries"
    style={{
      width: 40,
      height: 34,
      padding: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: "1px solid var(--theme-accent)",
      borderRadius: 6,
      background:
        libraryTierFilters.length > 0 ||
        libraryTypeFilters.length > 0 ||
        librarySettingFilters.length > 0 ||
        librarySourceFilters.length > 0
          ? "var(--theme-primary)"
          : "#fff",
      color:
        libraryTierFilters.length > 0 ||
        libraryTypeFilters.length > 0 ||
        librarySettingFilters.length > 0 ||
        librarySourceFilters.length > 0
          ? "#fff"
          : "var(--theme-text-primary)",
      cursor: "pointer",
    }}
  >
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5h16l-6 7v5l-4 2v-7L4 5z" />
    </svg>
  </button>

  {libraryFiltersOpen && (
    <div
      style={{
        position: "absolute",
        top: "calc(100%)",
        right: 0,
        zIndex: 20,
        width: 135,
        padding: 12,
        border: "1px solid var(--theme-accent)",
        borderRadius: 8,
        background: "var(--theme-panel)",
        boxShadow: "var(--shadow-large)",
        boxSizing: "border-box",
      }}
    >

      {/* Tier filter */}
<button
  type="button"
  onClick={() => setLibraryTierOpen((open) => !open)}
  style={{
    width: "100%",
    padding: "4px 0",
    border: "none",
    background: "transparent",
    color: "var(--theme-text-primary)",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    textAlign: "left",
  }}
>
  <span>
    Tier
    {libraryTierFilters.length > 0 &&
      ` (${libraryTierFilters.length})`}
  </span>
  <span
  style={{
    display: "inline-block",
    transition: "transform 0.2s ease",
    transform: libraryTierOpen ? "rotate(90deg)" : "rotate(0deg)",
  }}
>
  ▶
</span>
</button>

{libraryTierOpen && (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: 4,
      marginTop: 6,
      marginBottom: 10,
      paddingLeft: 4,
    }}
  >
    {["1", "2", "3", "4"].map((tier) => {
      const checked = libraryTierFilters.includes(tier);

      return (
        <label
          key={tier}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "3px 2px",
            color: "var(--theme-text-primary)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={() => {
              setLibraryTierFilters((current) =>
                current.includes(tier)
                  ? current.filter((item) => item !== tier)
                  : [...current, tier]
              );
            }}
          />
          <span>{tier}</span>
        </label>
      );
    })}
  </div>
)}

{/* Type filter */}
<button
  type="button"
  onClick={() => setLibraryTypeOpen((open) => !open)}
  style={{
    width: "100%",
    padding: "4px 0",
    border: "none",
    background: "transparent",
    color: "var(--theme-text-primary)",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    textAlign: "left",
  }}
>
  <span>
    Type
    {libraryTypeFilters.length > 0 &&
      ` (${libraryTypeFilters.length})`}
  </span>
  <span
  style={{
    display: "inline-block",
    transition: "transform 0.2s ease",
    transform: libraryTypeOpen ? "rotate(90deg)" : "rotate(0deg)",
  }}
>
  ▶
</span>
</button>

{libraryTypeOpen && (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: 4,
      marginTop: 6,
      marginBottom: 10,
      paddingLeft: 4,
    }}
  >
    {["Minion", "Rival", "Boss", "Companion"].map((type) => {
      const checked = libraryTypeFilters.includes(type);

      return (
        <label
          key={type}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "3px 2px",
            color: "var(--theme-text-primary)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={() => {
              setLibraryTypeFilters((current) =>
                current.includes(type)
                  ? current.filter((item) => item !== type)
                  : [...current, type]
              );
            }}
          />
          <span>{type}</span>
        </label>
      );
    })}
  </div>
)}

      {/* Setting filter */}
      <button
        type="button"
        onClick={() => setLibrarySettingOpen((open) => !open)}
        style={{
          width: "100%",
          padding: "4px 0",
          border: "none",
          background: "transparent",
          color: "var(--theme-text-primary)",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          textAlign: "left",
        }}
      >
        <span>
          Setting
          {librarySettingFilters.length > 0 &&
            ` (${librarySettingFilters.length})`}
        </span>
        <span
  style={{
    display: "inline-block",
    transition: "transform 0.2s ease",
    transform: librarySettingOpen ? "rotate(90deg)" : "rotate(0deg)",
  }}
>
  ▶
</span>
      </button>

      {librarySettingOpen && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            marginTop: 6,
            marginBottom: 10,
            paddingLeft: 4,
          }}
        >
          {([...LIBRARY_SETTINGS, "Other"] as const).map(
            (setting) => {
              const checked = librarySettingFilters.includes(setting);

              return (
                <label
                  key={setting}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "3px 2px",
                    color: "var(--theme-text-primary)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setLibrarySettingFilters((current) =>
                        current.includes(setting)
                          ? current.filter((item) => item !== setting)
                          : [...current, setting]
                      );
                    }}
                  />
                  <span>{setting}</span>
                </label>
              );
            }
          )}
        </div>
      )}

      {/* Source filter */}
      <button
        type="button"
        onClick={() => setLibrarySourceOpen((open) => !open)}
        style={{
          width: "100%",
          padding: "4px 0",
          border: "none",
          background: "transparent",
          color: "var(--theme-text-primary)",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          textAlign: "left",
        }}
      >
        <span>
          Source
          {librarySourceFilters.length > 0 &&
            ` (${librarySourceFilters.length})`}
        </span>
        <span
  style={{
    display: "inline-block",
    transition: "transform 0.2s ease",
    transform: librarySourceOpen ? "rotate(90deg)" : "rotate(0deg)",
  }}
>
  ▶
</span>
      </button>

      {librarySourceOpen && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            marginTop: 6,
            paddingLeft: 4,
          }}
        >
          {(["Official", "Homebrew"] as const).map((source) => {
            const checked = librarySourceFilters.includes(source);

            return (
              <label
                key={source}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "3px 2px",
                  color: "var(--theme-text-primary)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setLibrarySourceFilters((current) =>
                      current.includes(source)
                        ? current.filter((item) => item !== source)
                        : [...current, source]
                    );
                  }}
                />
                <span>{source}</span>
              </label>
            );
          })}
        </div>
      )}

      {(libraryTierFilters.length > 0 ||
        libraryTypeFilters.length > 0 ||
        librarySettingFilters.length > 0 ||
        librarySourceFilters.length > 0) && (
        <button
          type="button"
          onClick={() => {
            setLibrarySettingFilters([]);
            setLibrarySourceFilters([]);
          }}
          style={{
            width: "100%",
            marginTop: 12,
            padding: "6px 8px",
            border: "none",
            borderTop: "1px solid var(--theme-border)",
            background: "transparent",
            color: "var(--theme-text-secondary)",
            cursor: "pointer",
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  )}
</div>
</div>
</div>

          {sortedFilteredLibrary.length === 0 ? (
            <p style={{ margin: 0 }}>No saved adversaries found.</p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "18px minmax(0, 1fr)",
                gap: 8,
                alignItems: "start",
              }}
            >
              <div
                style={{
                  position: "sticky",
                  top: libraryHeaderHeight,
                  alignSelf: "start",
                  zIndex: 2,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  alignItems: "center",
                  paddingTop: 6,
                }}
              >
                {availableLetters.map((letter) => (
                  <button
                    key={letter}
                    onClick={() => jumpToLetter(letter)}
                    style={{
                      border: "none",
                      background: activeLetter === letter ? "var(--theme-primary)" : "transparent",
                      color: activeLetter === letter ? "var(--theme-text-on-accent)" : "var(--theme-text-primary)",
                      cursor: "pointer",
                      padding: "0",
                      width: 16,
                      height: 13,
                      borderRadius: 3,
                      fontSize: 9,
                      fontWeight: activeLetter === letter ? 700 : 500,
                      lineHeight: 1,
                    }}
                  >
                    {letter}
                  </button>
                ))}
              </div>

              <div
                style={{
  display: "grid",
  gap: 10,
  paddingRight: 8,
  minWidth: 130,
  boxSizing: "border-box",
}}
              >
                {sortedFilteredLibrary.map((entry) => (
                  <div
                    key={entry.id}
                    ref={(el) => {
                      rowRefs.current[entry.id] = el;
                    }}
                    data-letter={getEntryLetter(entry.name)}
                    style={{
  border:
    selectedLibraryId === entry.id
      ? "2px solid var(--theme-primary)"
      : "1px solid var(--theme-border)",
  borderRadius: 8,
  padding: "10px 12px",
  background: selectedLibraryId === entry.id
  ? "var(--theme-warning-background)"
  : "var(--theme-panel)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  cursor: "pointer",
  minHeight: 52,
  minWidth: 130,
  boxSizing: "border-box",
}}
                    onClick={() => {
                      loadLibraryEntry(entry);
                      setActiveTab("preview");
                    }}
                  >
                    <div style={{ minWidth: 100, flex: 1, lineHeight: 1.2, paddingRight: 4 }}>                      <div
                        style={{
                          fontWeight: "bold",
                          color: "var(--theme-text-primary)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {entry.name}
                      </div>
                      <div
                        style={{
                          color: "var(--theme-text-secondary)",
                          fontSize: 13,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {entry.summary}
                      </div>
                    </div>

                    <div
                      style={{
  display: "grid",
  gridTemplateColumns: "repeat(2, 26px)",
  gridTemplateRows: "repeat(2, 26px)",
  gap: 2,
  flexShrink: 0,
  marginLeft: 6,
}}
                    >
                      <button
                        title="Preview"
                        onClick={(e) => {
                          e.stopPropagation();
                          loadLibraryEntry(entry);
                          setActiveTab("preview");
                        }}
                        style={iconButtonStyle}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--theme-panel-muted)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d="M1 12C1 12 5 5 12 5C19 5 23 12 23 12C23 12 19 19 12 19C5 19 1 12 1 12Z"
                            stroke="currentColor"
                            strokeWidth="2"
                          />
                          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                        </svg>
                      </button>

                      <button
                        title="Edit"
                        onClick={(e) => {
                          e.stopPropagation();
                          loadLibraryEntry(entry);
                          setActiveTab("builder");
                        }}
                        style={iconButtonStyle}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--theme-panel-muted)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d="M4 20l3.5-.8L19 7.7a1.5 1.5 0 0 0 0-2.1l-1.6-1.6a1.5 1.5 0 0 0-2.1 0L3.8 15.5 4 20Z"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M14 6l4 4"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>

                      <button
                        title="Attach to Token"
                        onClick={(e) => {
                          e.stopPropagation();
                          attachAdversaryData(entry.data);
                        }}
                        style={iconButtonStyle}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--theme-panel-muted)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        disabled={selection.length === 0}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d="M8 12.5l6.5-6.5a3 3 0 1 1 4.2 4.2l-8.9 8.9a5 5 0 1 1-7.1-7.1l8.5-8.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>

                      <button
                        title="Delete"
                        onClick={async (e) => {
                          e.stopPropagation();

                          const confirmed = window.confirm(`Delete ${entry.name}?`);
                          if (!confirmed) return;

                          const { error } = await supabase
                            .from("adversaries")
                            .delete()
                            .eq("library_id", entry.id);

                          if (error) {
                            console.error("Could not delete adversary from Supabase:", error);
                            setStatusMessage("Could not delete library entry.");
                            return;
                          }

                          setLibrary((prev) => prev.filter((x) => x.id !== entry.id));

                          if (selectedLibraryId === entry.id) {
                            setSelectedLibraryId(null);
                          }

                          if (editingLibraryId === entry.id) {
                            setEditingLibraryId(null);
                          }

                          setStatusMessage("Library entry deleted.");
                        }}
                        style={iconButtonStyle}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--theme-panel-muted)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M9 7V5h6v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M7 7l1 12h8l1-12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M10 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M14 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>  
          )}
        </div>
        </div>
      )}

      {activeTab === "builder" && (
  <div
  data-builder-root="true"
  style={{ animation: "fadeIn 0.18s ease" }}
>
    <div
          style={{
            border: "1px solid var(--theme-accent)",
            borderRadius: 8,
            padding: 12,
            background: "var(--theme-panel)",
          }}
        >
          <BuilderCard>
  <details open>
    <SectionSummary title="BASIC INFO" />
    <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
      <BuilderChoiceRow label="Source">
        <BuilderChoiceButton
          compact
          label="Official"
          active={(builderAdversary.source ?? "Official") === "Official"}
          onClick={() => updateBuilderSource("Official")}
        />
        <BuilderChoiceButton
          compact
          label="Homebrew"
          active={builderAdversary.source === "Homebrew"}
          onClick={() => updateBuilderSource("Homebrew")}
        />
      </BuilderChoiceRow>

      <BuilderChoiceRow label="Setting">
  {LIBRARY_SETTINGS.map((setting) => (
    <BuilderChoiceButton
      compact
      key={setting}
      label={setting}
      active={(builderAdversary.setting ?? "Stormlight") === setting}
      onClick={() => updateBuilderSetting(setting)}
    />
  ))}

  <BuilderChoiceButton
    compact
    label="Other"
    active={
      Boolean(builderAdversary.setting) &&
      !LIBRARY_SETTINGS.includes(
        builderAdversary.setting as (typeof LIBRARY_SETTINGS)[number]
      )
    }
    onClick={() => {
      if (
        !builderAdversary.setting ||
        LIBRARY_SETTINGS.includes(
          builderAdversary.setting as (typeof LIBRARY_SETTINGS)[number]
        )
      ) {
        updateBuilderSetting("");
      }
    }}
  />
</BuilderChoiceRow>

{!LIBRARY_SETTINGS.includes(
  (builderAdversary.setting ?? "Stormlight") as
    (typeof LIBRARY_SETTINGS)[number]
) && (
  <BuilderTextInput
    value={builderAdversary.setting}
    placeholder="Custom setting"
    onChange={(value) => updateBuilderSetting(value)}
  />
)}

      <BuilderLabeledInput
  label="Name"
  labelWidth={76}
  value={builderAdversary.name}
  onChange={(value) => {
    setSelectedLibraryId(null);
    setBuilderAdversary((prev) => ({ ...prev, name: value }));
  }}
/>

      <BuilderChoiceRow label="Tier">
        {["1", "2", "3", "4"].map((tier) => (
          <BuilderChoiceButton
            compact
            key={tier}
            label={tier}
            active={builderAdversary.tier === tier}
            onClick={() => {
              setSelectedLibraryId(null);
              setBuilderAdversary((prev) => ({ ...prev, tier }));
            }}
          />
        ))}
      </BuilderChoiceRow>

      <BuilderChoiceRow label="Type">
        {["Minion", "Rival", "Boss", "Companion"].map((type) => (
          <BuilderChoiceButton
            compact
            key={type}
            label={type}
            active={builderAdversary.type === type}
            onClick={() => {
              setSelectedLibraryId(null);
              setBuilderAdversary((prev) => ({ ...prev, type }));
            }}
          />
        ))}
      </BuilderChoiceRow>
      
      <BuilderChoiceRow label="Size">
  {["Tiny", "Small", "Medium", "Large", "Huge"].map((s) => (
    <BuilderChoiceButton
      compact
      key={s}
      label={s}
      active={builderAdversary.size === s}
      onClick={() =>
        setBuilderAdversary((prev) => ({ ...prev, size: s }))
      }
    />
  ))}
</BuilderChoiceRow>

<BuilderLabeledInput
  label="Species"
  labelWidth={76}
  value={builderAdversary.species || "Humanoid"}
  onChange={(v) =>
    setBuilderAdversary((prev) => ({ ...prev, species: v }))
  }
/>

    </div>
  </details>
</BuilderCard>
          <BuilderCard>
          <details open>
            <SectionSummary title="STATS" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginBottom: 12 }}>
              <div style={{ border: "1px solid var(--theme-accent)", borderRadius: 6, padding: 8 }}>
                <div style={{ fontWeight: "bold", marginBottom: 8, textAlign: "center" }}>PHYSICAL</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: 8, justifyContent: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <div>STR</div>
                    <BuilderNumberInput value={builderAdversary.physical?.str} onChange={(v) => setPhysical("str", v)} />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div>DEF</div>
                    <div
                      style={{
                        width: 56,
                        padding: "4px 6px",
                        fontSize: 14,
                        fontWeight: "bold",
                        textAlign: "center",
                        boxSizing: "border-box",
                      }}
                    >
                      {(builderAdversary.physical?.str ?? 0) +
                        (builderAdversary.physical?.spd ?? 0) +
                        10}
                    </div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div>SPD</div>
                    <BuilderNumberInput value={builderAdversary.physical?.spd} onChange={(v) => setPhysical("spd", v)} />
                  </div>
                </div>
              </div>

              <div style={{ border: "1px solid var(--theme-accent)", borderRadius: 6, padding: 8 }}>
                <div style={{ fontWeight: "bold", marginBottom: 8, textAlign: "center" }}>COGNITIVE</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: 8, justifyContent: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <div>INT</div>
                    <BuilderNumberInput value={builderAdversary.cognitive?.int} onChange={(v) => setCognitive("int", v)} />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div>DEF</div>
                    <div
                      style={{
                        width: 56,
                        padding: "4px 6px",
                        fontSize: 14,
                        fontWeight: "bold",
                        textAlign: "center",
                        boxSizing: "border-box",
                      }}
                    >
                      {(builderAdversary.cognitive?.int ?? 0) +
                        (builderAdversary.cognitive?.wil ?? 0) +
                        10}
                    </div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div>WIL</div>
                    <BuilderNumberInput value={builderAdversary.cognitive?.wil} onChange={(v) => setCognitive("wil", v)} />
                  </div>
                </div>
              </div>

              <div style={{ border: "1px solid var(--theme-accent)", borderRadius: 6, padding: 8 }}>
                <div style={{ fontWeight: "bold", marginBottom: 8, textAlign: "center" }}>SPIRITUAL</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: 8, justifyContent: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <div>AWA</div>
                    <BuilderNumberInput value={builderAdversary.spiritual?.awa} onChange={(v) => setSpiritual("awa", v)} />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div>DEF</div>
                    <div
                      style={{
                        width: 56,
                        padding: "4px 6px",
                        fontSize: 14,
                        fontWeight: "bold",
                        textAlign: "center",
                        boxSizing: "border-box",
                      }}
                    >
                      {(builderAdversary.spiritual?.awa ?? 0) +
                        (builderAdversary.spiritual?.pre ?? 0) +
                        10}
                    </div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div>PRE</div>
                    <BuilderNumberInput value={builderAdversary.spiritual?.pre} onChange={(v) => setSpiritual("pre", v)} />
                  </div>
                </div>
              </div>
            </div>

<div
  style={{
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 16,
    alignItems: "start",
    marginBottom: 12,
  }}
>
  {/* HEALTH */}
  <div style={{ textAlign: "center" }}>
    <div
      style={{
        fontWeight: 600,
        marginBottom: 6,
      }}
    >
      Health
    </div>

    <div
      style={{
        display: "flex",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <div>
        <div style={{ fontSize: 12, marginBottom: 3 }}>MIN</div>
        <BuilderNumberInput
          value={builderAdversary.minHealth}
          onChange={(value) => {
            setSelectedLibraryId(null);
            setHealthRange("minHealth", value);
          }}
        />
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 3 }}>MAX</div>
        <BuilderNumberInput
          value={builderAdversary.maxHealth}
          onChange={(value) => {
            setSelectedLibraryId(null);
            setHealthRange("maxHealth", value);
          }}
        />
      </div>
    </div>
  </div>

  {/* FOCUS */}
  <div style={{ textAlign: "center" }}>
    <div
      style={{
        fontWeight: 600,
        marginBottom: 21,
      }}
    >
      Focus
    </div>

    <BuilderNumberInput
      value={builderAdversary.focus}
      onChange={(value) => {
        setSelectedLibraryId(null);
        setBuilderAdversary((prev) => ({
          ...prev,
          focus: value,
        }));
      }}
    />
  </div>

  {/* INVESTITURE */}
  <div style={{ textAlign: "center" }}>
    <div
      style={{
        fontWeight: 600,
        marginBottom: 21,
      }}
    >
      Investiture
    </div>

    <BuilderNumberInput
      value={builderAdversary.investiture}
      onChange={(value) => {
        setSelectedLibraryId(null);
        setBuilderAdversary((prev) => ({
          ...prev,
          investiture: value,
        }));
      }}
    />
  </div>
</div>          </details>
          </BuilderCard>

          <BuilderCard>
          <details open>
            <SectionSummary title="DETAILS" />
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
  <BuilderLabeledInput
  label="Deflect"
  labelWidth={90}
  value={
    typeof builderAdversary.deflect === "string"
      ? builderAdversary.deflect
      : builderAdversary.deflect != null
      ? String(builderAdversary.deflect)
      : ""
  }
  onChange={(value) => {
    setSelectedLibraryId(null);
    setBuilderAdversary((prev) => ({
      ...prev,
      deflect: value,
    }));
  }}
  placeholder="e.g. 1 (leather)"
/>

<BuilderLabeledInput
  label="Movement"
  labelWidth={90}
  value={builderAdversary.movement}
  onChange={(value) => {
    setSelectedLibraryId(null);
    setBuilderAdversary((prev) => ({
      ...prev,
      movement: value,
    }));
  }}
/>

<BuilderLabeledInput
  label="Senses"
  labelWidth={90}
  value={builderAdversary.senses}
  onChange={(value) => {
    setSelectedLibraryId(null);
    setBuilderAdversary((prev) => ({
      ...prev,
      senses: value,
    }));
  }}
/>

<BuilderLabeledInput
  label="Languages"
  labelWidth={90}
  value={builderAdversary.languages}
  onChange={(value) => {
    setSelectedLibraryId(null);
    setBuilderAdversary((prev) => ({
      ...prev,
      languages: value,
    }));
  }}
/>

<BuilderLabeledInput
  label="Immunities"
  labelWidth={90}
  value={builderAdversary.immunities || "None"}
  onChange={(value) => {
    setSelectedLibraryId(null);
    setBuilderAdversary((prev) => ({
      ...prev,
      immunities: value,
    }));
  }}
/>
            </div>
          </details>
          </BuilderCard>
          
          <BuilderCard>
            <details open>
              <SectionSummary title="SKILLS" />

              <div style={{ display: "grid", gap: 14, marginBottom: 12 }}>
                <div>
                  <div style={{ marginBottom: 4 }}>Physical Skills</div>
                  <BuilderSkillList
                    listId="physical"
                    values={builderAdversary.skills?.physical}
                    onChange={(values) => {
                      setSelectedLibraryId(null);
                      setBuilderAdversary((prev) => ({
                        ...prev,
                        skills: {
                          physical: values,
                          cognitive: prev.skills?.cognitive ?? [],
                          spiritual: prev.skills?.spiritual ?? [],
                        },
                      }));
                    }}
                  />
                </div>

                <div>
                  <div style={{ marginBottom: 4 }}>Cognitive Skills</div>
                  <BuilderSkillList
                    listId="cognitive"
                    values={builderAdversary.skills?.cognitive}
                    onChange={(values) => {
                      setSelectedLibraryId(null);
                      setBuilderAdversary((prev) => ({
                        ...prev,
                        skills: {
                          physical: prev.skills?.physical ?? [],
                          cognitive: values,
                          spiritual: prev.skills?.spiritual ?? [],
                        },
                      }));
                    }}
                  />
                </div>

                <div>
                  <div style={{ marginBottom: 4 }}>Spiritual Skills</div>
                  <BuilderSkillList
                    listId="spiritual"
                    values={builderAdversary.skills?.spiritual}
                    onChange={(values) => {
                      setSelectedLibraryId(null);
                      setBuilderAdversary((prev) => ({
                        ...prev,
                        skills: {
                          physical: prev.skills?.physical ?? [],
                          cognitive: prev.skills?.cognitive ?? [],
                          spiritual: values,
                        },
                      }));
                    }}
                  />
                </div>

                <div>
                  <div style={{ marginBottom: 4 }}>Invested Skills</div>
                  <BuilderSkillList
                    listId="invested"
                    values={builderAdversary.investedSkills}
                    onChange={(values) => {
                      setSelectedLibraryId(null);
                      setBuilderAdversary((prev) => ({
                        ...prev,
                        investedSkills: values,
                      }));
                    }}
                  />
                </div>
              </div>
            </details>
          </BuilderCard>

          <BuilderCard>
  <details open>
    <SectionSummary title="FEATURES" />
        
        <div
  style={{
    position: "relative",
    marginBottom: 12,
    textAlign: "left",
  }}
>
  <button
    type="button"
    onClick={() => setCommonFeaturesOpen((prev) => !prev)}
    style={{
      padding: "6px 10px",
      border: "1px solid var(--theme-accent)",
      borderRadius: 6,
      background: "var(--theme-panel)",
      color: "var(--theme-text-primary)",
      fontWeight: 600,
      cursor: "pointer",
      fontSize: 12,
    }}
  >
    Common Features
<span
  style={{
    display: "inline-block",
    marginLeft: 6,
    transform: commonFeaturesOpen ? "rotate(90deg)" : "rotate(0deg)",
    transition: "transform 0.2s ease",
  }}
>
  ▶
</span>
  </button>

{/* Common Features dropdown menu */}
  {commonFeaturesOpen && (
    <div
      style={{
        marginTop: 6,
        border: "1px solid var(--theme-accent)",
        borderRadius: 6,
        background: "var(--theme-panel)",
        padding: 8,
        maxHeight: 220,
        overflowY: "auto",
      }}
    >
      {featureLibrary.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--theme-text-muted)",
            padding: 4,
          }}
        >
          No common features saved yet.
        </div>
      ) : (
        <>
          {[...featureLibrary]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((feature) => (
    <div
      key={feature.id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 4px",
        fontSize: 13,
        color: "var(--theme-text-primary)",
      }}
    >
      {editingCommonFeatureId === feature.id ? (
        <div
          style={{
            display: "grid",
            gap: 6,
            width: "100%",
          }}
        >
          <input
            type="text"
            value={editingCommonFeatureName}
            onChange={(e) =>
              setEditingCommonFeatureName(e.target.value)
            }
            placeholder="Feature name"
            style={{
              width: "100%",
              padding: "6px 8px",
              border: "1px solid var(--theme-accent)",
              borderRadius: 4,
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />

          <textarea
            value={editingCommonFeatureText}
            onChange={(e) =>
              setEditingCommonFeatureText(e.target.value)
            }
            placeholder="Feature text"
            rows={3}
            style={{
              width: "100%",
              padding: "6px 8px",
              border: "1px solid var(--theme-accent)",
              borderRadius: 4,
              fontSize: 13,
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 6,
            }}
          >
            <button
              type="button"
              onClick={cancelEditingCommonFeature}
              style={{
                padding: "4px 8px",
                border: "1px solid var(--theme-border)",
                borderRadius: 5,
                background: "var(--theme-panel)",
                color: "var(--theme-text-primary)",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={saveCommonFeatureEdit}
              style={{
                padding: "4px 8px",
                border: "1px solid var(--theme-accent)",
                borderRadius: 5,
                background: "var(--theme-panel)",
                color: "var(--theme-text-primary)",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 11,
              }}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              flex: 1,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={selectedCommonFeatureIds.includes(
                feature.id
              )}
              onChange={() =>
                toggleCommonFeature(feature.id)
              }
            />

            <span style={{ flex: 1 }}>
              {feature.name}
            </span>

            <span
              style={{
                fontSize: 10,
                color: "var(--theme-text-muted)",
              }}
            >
              {feature.source}
            </span>
          </label>

            <>
              <button
                type="button"
                onClick={() =>
                  startEditingCommonFeature(feature)
                }
                style={{
                  border: "none",
                  background: "transparent",
                  padding: "2px 4px",
                  color: "var(--theme-text-primary)",
                  cursor: "pointer",
                  fontSize: 11,
                  textDecoration: "underline",
                }}
              >
                Edit
              </button>

              <button
                type="button"
                onClick={() =>
                  deleteCommonFeature(feature)
                }
                style={{
                  border: "none",
                  background: "transparent",
                  padding: "2px 4px",
                  color: "var(--status-danger)",
                  cursor: "pointer",
                  fontSize: 11,
                  textDecoration: "underline",
                }}
              >
                Delete
              </button>
            </>
        </>
      )}
    </div>
  ))}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 8,
              paddingTop: 8,
              borderTop: "1px solid var(--disabled-border)",
            }}
          >
            <button
              type="button"
              onClick={addSelectedCommonFeatures}
              disabled={selectedCommonFeatureIds.length === 0}
              style={{
                padding: "5px 10px",
                border: "1px solid var(--theme-accent)",
                borderRadius: 6,
                background:
                  selectedCommonFeatureIds.length === 0
                    ? "var(--disabled-background)"
                    : "var(--theme-panel)",
                color:
                  selectedCommonFeatureIds.length === 0
                    ? "var(--disabled-text)"
                    : "var(--theme-text-primary)",
                fontWeight: 600,
                cursor:
                  selectedCommonFeatureIds.length === 0
                    ? "default"
                    : "pointer",
                fontSize: 12,
              }}
            >
              Add Selected
            </button>
          </div>
        </>
      )}
    </div>
  )}
</div>
    <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>

      {(
        builderAdversary.features &&
        builderAdversary.features.length > 0
          ? builderAdversary.features
          : [{ name: "", text: "" }]
      ).map((feature, index) => (
        <div
          key={index}
          style={{
            marginBottom:12,
          }}
        >
          <div style={{ marginBottom: 6 }}>
            <input
              type="text"
              value={feature.name}
              placeholder="Feature name"
              data-feature-index={index}
              onChange={(e) =>
                updateFeature(index, "name", e.target.value)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();

                  const textField =
                    document.querySelector<HTMLTextAreaElement>(
                      `[data-feature-text-index="${index}"]`
                    );

                  textField?.focus();
                }
              }}
              style={{
                width: "100%",
                padding: "6px 8px",
                border: "1px solid var(--theme-accent)",
                borderRadius: 4,
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>

          <textarea
            value={feature.text}
            placeholder="Feature text"
            data-feature-text-index={index}
            rows={3}
            onChange={(e) =>
              updateFeature(index, "text", e.target.value)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();

                // If this entire feature is blank, do not create another one.
                if (!feature.name.trim() && !feature.text.trim()) {
                  return;
                }

                const nextName =
                  document.querySelector<HTMLInputElement>(
                    `[data-feature-index="${index + 1}"]`
                  );

                if (nextName) {
                  nextName.focus();
                } else {
                  addFeature(index);
                }
              }
            }}
            style={{
              width: "100%",
              padding: "6px 8px",
              border: "1px solid var(--theme-accent)",
              borderRadius: 4,
              fontSize: 14,
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />

          {(feature.name.trim() || feature.text.trim()) && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 6,
              }}
            >
              <button
                type="button"
                onClick={() => saveAsCommonFeature(feature)}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  color: "var(--theme-accent)",
                  cursor: "pointer",
                  fontSize: 12,
                  textDecoration: "underline",
                }}
              >
                save as common feature
              </button>

              <button
                type="button"
                onClick={() => removeFeature(index)}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  color: "var(--status-error-text)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                remove
              </button>
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={() => addFeature()}
        style={{
          justifySelf: "start",
          padding: "4px 10px",
          border: "1px solid var(--theme-border)",
          borderRadius: 6,
          background: "var(--theme-panel)",
          color: "var(--theme-text-primary)",
          fontWeight: 600,
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        + Add Feature
      </button>

    </div>
  </details>
</BuilderCard>

<BuilderCard>
  <details open>
    <SectionSummary title="ACTIONS" />

    <div style={{ display: "grid", gap: 14, marginBottom: 12 }}>
  {(
    builderAdversary.actions && builderAdversary.actions.length > 0
      ? builderAdversary.actions
      : [
          {
            name: "",
            text: "",
            cost: 1 as ActionCost,
            focusCost: "",
            investitureCost: "",
            attackBonus: "",
            reach: "",
            range: "",
            target: "",
            graze: "",
            hit: "",
            notes: "",
          },
        ]
  ).map((action, index) => (
      <div
        key={index}
        style={{
          marginBottom: 12,
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <BuilderLabeledInput
            label="Name"
            value={action.name ?? ""}
            dataActionIndex={index}
            onChange={(value) => updateAction(index, "name", value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();

                const actionCost =
                  document.querySelector<HTMLSelectElement>(
                    `[data-action-cost-index="${index}"]`
                  );

                actionCost?.focus();
              }
            }}
          />
        </div>

                <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            width: "100%",
            marginBottom: 6,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--theme-text-primary)",
              letterSpacing: 0.4,
              textTransform: "uppercase",
              width: 90,
              flexShrink: 0,
            }}
          >
            Action Cost:
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <select
              data-action-cost-index={index}
              value={
                action.cost === "free"
                  ? "free"
                  : action.cost === "reaction"
                  ? "reaction"
                  : String(action.cost ?? 1)
              }
              onChange={(e) =>
                updateAction(index, "cost", e.target.value)
              }
              onKeyDown={(e) => {
                let newCost: string | null = null;

                if (e.key === "0") {
                  newCost = "free";
                } else if (e.key === "1") {
                  newCost = "1";
                } else if (e.key === "2") {
                  newCost = "2";
                } else if (e.key === "3") {
                  newCost = "3";
                } else if (e.key.toLowerCase() === "r") {
                  newCost = "reaction";
                }

                if (newCost !== null) {
                  e.preventDefault();
                  updateAction(index, "cost", newCost);
                  return;
                }

                if (e.key === "Enter") {
                  e.preventDefault();

                  const nextField =
                    document.querySelector<HTMLInputElement>(
                      `[data-action-focus-index="${index}"]`
                    );

                  nextField?.focus();
                }
              }}
              style={{
                width: "100%",
                padding: "6px 8px",
                border: "1px solid var(--theme-accent)",
                borderRadius: 4,
                fontSize: 14,
                boxSizing: "border-box",
              }}
            >
              <option value="free">Free</option>
              <option value="reaction">Reaction</option>
              <option value="1">1 Action</option>
              <option value="2">2 Actions</option>
              <option value="3">3 Actions</option>
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gap: 6, marginBottom: 6 }}>
          <BuilderLabeledInput
            label="Focus Cost"
            value={action.focusCost ?? ""}
            placeholder="e.g. 1"
            onChange={(value) =>
              updateAction(index, "focusCost", value)
            }
            dataActionFocusIndex={index}
          />

          <BuilderLabeledInput
            label="Investiture Cost"
            value={action.investitureCost ?? ""}
            placeholder="e.g. 1"
            onChange={(value) =>
              updateAction(index, "investitureCost", value)
            }
          />

          <BuilderLabeledInput
            label="Attack Bonus"
            value={action.attackBonus ?? ""}
            placeholder="e.g. +6"
            onChange={(value) =>
              updateAction(index, "attackBonus", value)
            }
          />

          <BuilderLabeledInput
            label="Reach"
            value={action.reach ?? ""}
            placeholder="e.g. 5 ft."
            onChange={(value) =>
              updateAction(index, "reach", value)
            }
          />

          <BuilderLabeledInput
            label="Range"
            value={action.range ?? ""}
            placeholder="e.g. 150/600 ft."
            onChange={(value) =>
              updateAction(index, "range", value)
            }
          />

          <BuilderLabeledInput
            label="Target"
            value={action.target ?? ""}
            placeholder="e.g. one target"
            onChange={(value) =>
              updateAction(index, "target", value)
            }
          />

          <BuilderLabeledInput
            label="Graze"
            value={action.graze ?? ""}
            placeholder="e.g. 2 (1d4) keen damage"
            onChange={(value) =>
              updateAction(index, "graze", value)
            }
          />
        </div>

        <div style={{ display: "grid", gap: 6, marginBottom: 6 }}>
  <BuilderLabeledTextArea
    label="Hit"
    value={action.hit ?? ""}
    placeholder="e.g. 9 (1d4 + 7) keen damage"
    onChange={(value) =>
      updateAction(index, "hit", value)
    }
    rows={1}
  />

  <BuilderLabeledTextArea
    label="Effect"
    value={action.text ?? ""}
    placeholder="e.g. Kaiana makes a Knife attack (no action required). On a hit, the target also loses 1 Investiture"
    onChange={(value) =>
      updateAction(index, "text", value)
    }
    rows={4}
  />

  <BuilderLabeledTextArea
    label="Notes"
    value={action.notes ?? ""}
    placeholder="e.g. Kaiana only gains this action if she is wielding a raysium knife."
    onChange={(value) =>
      updateAction(index, "notes", value)
    }
    rows={3}
  />
</div>

        <div
  style={{
    display: "flex",
    justifyContent: "flex-end",
    marginTop: 6,
  }}
>
          <button
            type="button"
            onClick={() => removeAction(index)}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              color: "var(--status-error-text)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            remove
          </button>
        </div>
      </div>
    ))}
    <button
        type="button"
        onClick={addAction}
        style={{
          justifySelf: "start",
          padding: "4px 10px",
          border: "1px solid var(--theme-border)",
          borderRadius: 6,
          background: "var(--theme-panel)",
          color: "var(--theme-text-primary)",
          fontWeight: 600,
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        + Add Action
      </button>
      </div>
  </details>
</BuilderCard>

<BuilderCard>
<details open>
  <SectionSummary title="OPPORTUNITIES AND COMPLICATIONS" />

  <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
    <div>
      <div
        style={{
          fontWeight: 600,
          marginBottom: 4,
          color: "var(--theme-text-primary)",
        }}
      >
        Opportunity
      </div>
      <BuilderTextArea
        value={builderAdversary.opportunitiesAndComplications?.opportunity ?? ""}
        onChange={(value) =>
          updateOpportunitiesAndComplications("opportunity", value)
        }
        placeholder="An enemy can spend [opportunity] ..."
        rows={4}
      />
    </div>

    <div>
      <div
        style={{
          fontWeight: 600,
          marginBottom: 4,
          color: "var(--theme-text-primary)",
        }}
      >
        Complication
      </div>
      <BuilderTextArea
        value={builderAdversary.opportunitiesAndComplications?.complication ?? ""}
        onChange={(value) =>
          updateOpportunitiesAndComplications("complication", value)
        }
        placeholder="The GM can spend [complication] ..."
        rows={4}
      />
    </div>
  </div>
</details>
</BuilderCard>

<BuilderCard>
<details open>
  <SectionSummary title="TACTICS" />

  <div style={{ marginBottom: 12 }}>
    <BuilderTextArea
      value={builderAdversary.tactics ?? ""}
      onChange={updateTactics}
      placeholder="Tactics"
      rows={5}
    />
  </div>
</details>
</BuilderCard>
        </div>
        </div>
      )}
        </div>

    {pendingCommonFeature && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--overlay-background)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          padding: 16,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 320,
            background: "var(--theme-panel)",
            border: "2px solid var(--theme-accent)",
            borderRadius: 10,
            padding: 16,
            boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
            color: "var(--theme-text-primary)",
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              marginBottom: 10,
              textAlign: "center",
            }}
          >
            Save Common Feature
          </div>

          <div
            style={{
              fontSize: 13,
              marginBottom: 14,
              textAlign: "center",
            }}
          >
            Save <strong>"{pendingCommonFeature.name}"</strong> as:
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <button
              type="button"
              onClick={() =>
                confirmSaveAsCommonFeature("Official")
              }
              style={{
                padding: "6px 12px",
                border: "2px solid var(--theme-accent)",
                borderRadius: 6,
                background: "var(--theme-panel-active)",
                color: "var(--theme-text-primary)",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Official
            </button>

            <button
              type="button"
              onClick={() =>
                confirmSaveAsCommonFeature("Homebrew")
              }
              style={{
                padding: "6px 12px",
                border: "1px solid var(--theme-border)",
                borderRadius: 6,
                background: "var(--theme-panel)",
                color: "var(--theme-text-primary)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Homebrew
            </button>
          </div>

          <button
            type="button"
            onClick={() => setPendingCommonFeature(null)}
            style={{
              display: "block",
              margin: "0 auto",
              border: "none",
              background: "transparent",
              color: "var(--theme-text-muted)",
              cursor: "pointer",
              fontSize: 12,
              textDecoration: "underline",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    )}

    </div>
  );
}