import React, { useEffect, useMemo, useRef, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";

const METADATA_KEY = "com.eli.statblocks/adversary";
const LIBRARY_STORAGE_KEY = "eli-statblocks-library";
const LIBRARY_BACKUP_KEY = "eli-statblocks-library-backup";

type ActionCost = "free" | "reaction" | 1 | 2 | 3;
type ActiveTab = "preview" | "builder" | "library";
type OpenMenu = "library" | "token" | null;

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

  surgeSkills?: string[];

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

const EMPTY_ADVERSARY: Adversary = {
  name: "",
  tier: "",
  type: "",
  source: "Official",
  setting: "Stormlight",
  physical: { str: 0, def: 10, spd: 0 },
  cognitive: { int: 0, def: 10, wil: 0 },
  spiritual: { awa: 0, def: 10, pre: 0 },
  health: 11,
  healthRange: "",
  focus: 4,
  investiture: 0,
  deflect: 0,
  movement: "",
  senses: "",
  languages: "",
  immunities: "",
  skills: {
    physical: [],
    cognitive: [],
    spiritual: [],
  },
  surgeSkills: [],
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

function splitLines(text: string): string[] {
  return text
    .split("\n")
}

function joinLines(items?: string[]): string {
  return (items ?? []).join("\n");
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, "")
    .trim()
    .replace(/[^a-z0-9]+/g, " ");
}

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

function ActionCostIcon({
  cost,
  inline = false,
}: {
  cost?: ActionCost;
  inline?: boolean;
}) {
  const color = "#1f3b67";
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
        stroke="#1f5fbf"
        strokeWidth="8"
      />
      <path
        d="M50 12 L56 28 L44 28 Z
           M88 50 L72 56 L72 44 Z
           M50 88 L44 72 L56 72 Z
           M12 50 L28 44 L28 56 Z"
        fill="#1f5fbf"
      />
      <path
        d="M50 26
           C58 34, 66 42, 74 50
           C66 58, 58 66, 50 74
           C42 66, 34 58, 26 50
           C34 42, 42 34, 50 26 Z"
        fill="white"
        stroke="#1f5fbf"
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
      <g fill="#b71c1c">
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
        color: "#1f3b67",
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
      type="number"
      value={value ?? 0}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        width,
        padding: "4px 6px",
        border: "1px solid #c69a3a",
        borderRadius: 4,
        fontSize: 14,
      }}
    />
  );
}

function BuilderTextInput({
  value,
  onChange,
  placeholder,
  width = "100%",
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number | string;
}) {
  return (
    <input
      type="text"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width,
        padding: "6px 8px",
        border: "1px solid #c69a3a",
        borderRadius: 4,
        fontSize: 14,
        boxSizing: "border-box",
      }}
    />
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
        border: "1px solid #c69a3a",
        borderRadius: 4,
        fontSize: 14,
        boxSizing: "border-box",
        resize: "vertical",
      }}
    />
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
        border: active ? "2px solid #c69a3a" : "1px solid #d8c08a",
        background: active ? "#efe3c9" : "#fffaf0",
        color: "#1f3b67",
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
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "#1f3b67",
          letterSpacing: 0.4,
          textTransform: "uppercase",
          minWidth: 70,
        }}
      >
        {label}:
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
            border: "1px solid #c69a3a",
            borderRadius: 8,
            background: "#fff7df",
            color: "#7a1f1f",
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

function AdversaryCard({ adversary }: { adversary: Adversary }) {
  return (
    <div
      style={{
        marginTop: 8,
        border: "2px solid #c69a3a",
        borderRadius: 8,
        padding: 12,
        background: "#f7f1e3",
        color: "#1f3b67",
        fontFamily: "Georgia, serif",
        textAlign: "left",
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
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
    color: "#222",
  }}
>
  {makeSummary(adversary)}
</p>

<p
  style={{
    margin: "0 0 10px 0",
    fontSize: 11,
    letterSpacing: 0.3,
    color: "#6b7280",
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
          border: "2px solid #c69a3a",
        }}
      >
        <div style={{ borderRight: "2px solid #c69a3a" }}>
          <div
            style={{
              background: "#c69a3a",
              color: "#fff",
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
              <div style={{ fontSize: 22 }}>{adversary.physical?.str ?? "—"}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontSize: 12, lineHeight: 1, marginBottom: 2 }}>DEF</div>
              <svg width="46" height="42" viewBox="0 0 46 42">
                <path
                  d="M2 2 H44 V26 L23 40 L2 26 Z"
                  fill="#f7f1e3"
                  stroke="#c69a3a"
                  strokeWidth="2"
                />
                <text
                  x="23"
                  y="24"
                  textAnchor="middle"
                  fontSize="18"
                  fontWeight="bold"
                  fill="#1f3b67"
                  fontFamily="Georgia, serif"
                >
                  {adversary.physical?.def ?? "—"}
                </text>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 12 }}>SPD</div>
              <div style={{ fontSize: 22 }}>{adversary.physical?.spd ?? "—"}</div>
            </div>
          </div>
        </div>

        <div style={{ borderRight: "2px solid #c69a3a" }}>
          <div
            style={{
              background: "#c69a3a",
              color: "#fff",
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
              <div style={{ fontSize: 22 }}>{adversary.cognitive?.int ?? "—"}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontSize: 12, lineHeight: 1, marginBottom: 2 }}>DEF</div>
              <svg width="46" height="42" viewBox="0 0 46 42">
                <path
                  d="M2 2 H44 V26 L23 40 L2 26 Z"
                  fill="#f7f1e3"
                  stroke="#c69a3a"
                  strokeWidth="2"
                />
                <text
                  x="23"
                  y="24"
                  textAnchor="middle"
                  fontSize="18"
                  fontWeight="bold"
                  fill="#1f3b67"
                  fontFamily="Georgia, serif"
                >
                  {adversary.cognitive?.def ?? "—"}
                </text>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 12 }}>WIL</div>
              <div style={{ fontSize: 22 }}>{adversary.cognitive?.wil ?? "—"}</div>
            </div>
          </div>
        </div>

        <div>
          <div
            style={{
              background: "#c69a3a",
              color: "#fff",
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
              <div style={{ fontSize: 22 }}>{adversary.spiritual?.awa ?? "—"}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontSize: 12, lineHeight: 1, marginBottom: 2 }}>DEF</div>
              <svg width="46" height="42" viewBox="0 0 46 42">
                <path
                  d="M2 2 H44 V26 L23 40 L2 26 Z"
                  fill="#f7f1e3"
                  stroke="#c69a3a"
                  strokeWidth="2"
                />
                <text
                  x="23"
                  y="24"
                  textAnchor="middle"
                  fontSize="18"
                  fontWeight="bold"
                  fill="#1f3b67"
                  fontFamily="Georgia, serif"
                >
                  {adversary.spiritual?.def ?? "—"}
                </text>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 12 }}>PRE</div>
              <div style={{ fontSize: 22 }}>{adversary.spiritual?.pre ?? "—"}</div>
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
          color: "#1f3b67",
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

      <div style={{ borderTop: "2px solid #c69a3a", margin: "6px 0" }} />

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

      <div style={{ borderTop: "2px solid #c69a3a", margin: "8px 0" }} />

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

        {(adversary.surgeSkills ?? []).length > 0 && (
          <p style={{ margin: "4px 0" }}>
            <strong>Surge Skills:</strong>{" "}
            {(adversary.surgeSkills ?? []).join(", ")}
          </p>
        )}
      </details>

      {(adversary.features ?? []).length > 0 && (
        <>
          <div style={{ borderTop: "2px solid #c69a3a", margin: "8px 0" }} />
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
          <div style={{ borderTop: "2px solid #c69a3a", margin: "8px 0" }} />
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
  (adversary.opportunitiesAndComplications.intro ||
    adversary.opportunitiesAndComplications.opportunity ||
    adversary.opportunitiesAndComplications.complication) && (
    <>
      <div style={{ borderTop: "2px solid #c69a3a", margin: "8px 0" }} />
      <details open>
        <SectionSummary title="OPPORTUNITIES AND COMPLICATIONS" />

        {adversary.opportunitiesAndComplications.intro && (
          <p style={{ margin: "4px 0" }}>
            <InlineRulesText text={adversary.opportunitiesAndComplications.intro} />
          </p>
        )}

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
          <div style={{ borderTop: "2px solid #c69a3a", margin: "8px 0" }} />
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
        background: "#fffaf0",
        border: "1px solid #d8c08a",
        borderRadius: 10,
        padding: 10,
        marginBottom: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      {children}
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [selectedTokenName, setSelectedTokenName] = useState("");
  const [attachedAdversary, setAttachedAdversary] = useState<Adversary | null>(null);

  const [builderAdversary, setBuilderAdversary] = useState<Adversary>(EMPTY_ADVERSARY);
  const [activeTab, setActiveTab] = useState<ActiveTab>("preview");
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");
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
    color: "#1f3b67",
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
    try {
      const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LibraryEntry[];
        setLibrary(parsed);
      }
    } catch {
      console.warn("Could not load adversary library");
    } finally {
      setLibraryLoaded(true);
    }
  }, []);

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

  useEffect(() => {
  if (!libraryLoaded) return;

  const payload = JSON.stringify(library);
  localStorage.setItem(LIBRARY_STORAGE_KEY, payload);

  const backup = {
    savedAt: new Date().toISOString(),
    count: library.length,
    library,
  };

  localStorage.setItem(LIBRARY_BACKUP_KEY, JSON.stringify(backup));
}, [library, libraryLoaded]);

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

const effectiveLibraryId = selectedLibraryId ?? tokenMatchedLibraryId;

const selectedLibraryEntry = useMemo(
  () => library.find((entry) => entry.id === effectiveLibraryId) ?? null,
  [library, effectiveLibraryId]
);

  const sortedFilteredLibrary = useMemo(() => {
    return [...library]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((entry) => {
        const q = librarySearch.trim().toLowerCase();
        if (!q) return true;
        return (
          entry.name.toLowerCase().includes(q) ||
          entry.summary.toLowerCase().includes(q)
        );
      });
  }, [library, librarySearch]);

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

  function saveCurrentToLibrary() {
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
  setStatusMessage(editingLibraryId ? "Library entry updated." : "Library entry saved.");
  setOpenMenu(null);
}

  function saveAsNewToLibrary() {
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

  setLibrary((prev) => [...prev, entry]);
  setEditingLibraryId(entry.id);
  setSelectedLibraryId(entry.id);
  setActiveTab("library");
  setStatusMessage("Saved as new library entry.");
  setOpenMenu(null);
}

  function loadLibraryEntry(entry: LibraryEntry) {
  setSelectedLibraryId(entry.id);
  setEditingLibraryId(entry.id);
  setBuilderAdversary(entry.data);
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

  function setPhysical<K extends keyof NonNullable<Adversary["physical"]>>(key: K, value: number) {
    setBuilderAdversary((prev) => ({
      ...prev,
      physical: {
        str: prev.physical?.str ?? 0,
        def: prev.physical?.def ?? 10,
        spd: prev.physical?.spd ?? 0,
        [key]: value,
      },
    }));
  }

  function setCognitive<K extends keyof NonNullable<Adversary["cognitive"]>>(key: K, value: number) {
    setBuilderAdversary((prev) => ({
      ...prev,
      cognitive: {
        int: prev.cognitive?.int ?? 0,
        def: prev.cognitive?.def ?? 10,
        wil: prev.cognitive?.wil ?? 0,
        [key]: value,
      },
    }));
  }

  function setSpiritual<K extends keyof NonNullable<Adversary["spiritual"]>>(key: K, value: number) {
    setBuilderAdversary((prev) => ({
      ...prev,
      spiritual: {
        awa: prev.spiritual?.awa ?? 0,
        def: prev.spiritual?.def ?? 10,
        pre: prev.spiritual?.pre ?? 0,
        [key]: value,
      },
    }));
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

  function addFeature() {
    setBuilderAdversary((prev) => ({
      ...prev,
      features: [...(prev.features ?? []), { name: "", text: "" }],
    }));
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
          background: disabled ? "#f7f2e7" : "transparent",
          color: disabled ? "#9a9487" : "#1f3b67",
          border: "none",
          padding: "6px 8px",
          borderRadius: 6,
          cursor: disabled ? "default" : "pointer",
          fontSize: 12,
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = "#f3e6c7";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = disabled ? "#f7f2e7" : "transparent";
        }}
      >
        {children}
      </button>
    );
  }

  function getDropdownStyle(alignRight = false): React.CSSProperties {
  return {
    position: "absolute",
    top: "calc(100% + 6px)",
    ...(alignRight ? { right: 0 } : { left: 0 }),
    minWidth: 150,
    background: "#fffaf0",
    border: "1px solid #c69a3a",
    borderRadius: 8,
    boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
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
    background: "#fffaf0",
    border: "1px solid #c69a3a",
    borderRadius: 8,
    boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
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
        color: active ? "#1f3b67" : "#6b7a99",
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

function renderMenu(menu: Exclude<OpenMenu, null>) {
  const isOpen = openMenu === menu;
  const isDisabled = menu === "token" && selection.length === 0;

  const label = menu === "library" ? "File" : "Attach";
  const shouldOpenLeft = menu === "library";
  const shouldAlignDropdownRight = menu === "library" || menu === "token";

  return (
  <div style={{ position: "relative" }}>
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
  ? "1px solid #c69a3a"
  : "1px solid transparent",

background: isOpen
  ? "#efe3c9"
  : "transparent",
  color: isDisabled ? "#b0a58a" : "#24406e",
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
      style={{
        padding: 12,
        fontFamily: "sans-serif",
        background: "linear-gradient(180deg, #f7f1e3 0%, #efe4ca 100%)",
        minHeight: "100%",
        boxSizing: "border-box",
        width: "100%",
        maxWidth: "100%",
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

      <h2
  style={{
    margin: "0 0 8px 0",
    color: "#1f3b67",
    textAlign: "center",
  }}
>
  Cosmere Stat Blocks
</h2>

{statusMessage && (
  <div
    style={{
      marginBottom: 10,
      padding: "6px 10px",
      border: "1px solid #c69a3a",
      borderRadius: 6,
      background: "#fff7df",
      color: "#1f3b67",
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
    background: "#f7f1e3",
    padding: "12px 16px",
    marginBottom: 12,
    borderBottom: "1px solid #d8c08a",
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
    background: "#c69a3a",
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

      {selection.length > 0 && (
        <p style={{ marginBottom: 8, color: "#5b5670" }}>
          Selected tokens: {selection.length}
        </p>
      )}

      {autoMatchEntry && selection.length > 0 && !hasLinkedMetadata && (
        <div
          style={{
  marginBottom: 12,
  padding: 14,
  border: "1px solid #c69a3a",
  borderRadius: 12,
  background: "#fff7df",
  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
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
      border: "1px solid #c69a3a",
      background: "#fffaf0",
      color: "#1f3b67",
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
      border: "1px solid #1f3b67",
      background: "#1f3b67",
      color: "#fffaf0",
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
          border: "1px solid #c69a3a",
          borderRadius: 8,
          background: "#fffaf0",
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
        border: "1px solid #c69a3a",
        borderRadius: 8,
        padding: 12,
        background: "#fffaf0",
      }}
    >
          <div style={{ marginBottom: 10 }}>
            <BuilderTextInput
              value={librarySearch}
              onChange={setLibrarySearch}
              placeholder="Search adversaries..."
            />
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
                      background: activeLetter === letter ? "#1f3b67" : "transparent",
                      color: activeLetter === letter ? "#fff" : "#1f3b67",
                      cursor: "pointer",
                      padding: "2px 0",
                      width: 16,
                      height: 18,
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: activeLetter === letter ? 700 : 500,
                      lineHeight: 1,
                    }}
                  >
                    {letter}
                  </button>
                ))}
              </div>

              <div
                ref={libraryListRef}
                style={{
  display: "grid",
  gap: 10,
  maxHeight: 520,
  overflowY: "auto",
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
      ? "2px solid #1f3b67"
      : "1px solid #d8c08a",
  borderRadius: 8,
  padding: "10px 12px",
  background: selectedLibraryId === entry.id ? "#fff7df" : "#fff",
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
                          color: "#1f3b67",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {entry.name}
                      </div>
                      <div
                        style={{
                          color: "#5b5670",
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
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f3e6c7")}
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
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f3e6c7")}
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
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f3e6c7")}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          const confirmed = window.confirm(`Delete ${entry.name}?`);
                          if (!confirmed) return;

                          setLibrary((prev) => prev.filter((x) => x.id !== entry.id));

                          if (selectedLibraryId === entry.id) setSelectedLibraryId(null);
                          if (editingLibraryId === entry.id) setEditingLibraryId(null);

                          setStatusMessage("Library entry deleted.");

                          if (editingLibraryId === entry.id) setEditingLibraryId(null);
                        }}
                        style={iconButtonStyle}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f3e6c7")}
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
  <div style={{ animation: "fadeIn 0.18s ease" }}>
    <div
          style={{
            border: "1px solid #c69a3a",
            borderRadius: 8,
            padding: 12,
            background: "#fffaf0",
          }}
        >
          <BuilderCard>
  <details open>
    <SectionSummary title="BASIC INFO" />
    <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
      <BuilderChoiceRow label="Source">
        <BuilderChoiceButton
          label="Official"
          active={(builderAdversary.source ?? "Official") === "Official"}
          onClick={() => updateBuilderSource("Official")}
        />
        <BuilderChoiceButton
          label="Homebrew"
          active={builderAdversary.source === "Homebrew"}
          onClick={() => updateBuilderSource("Homebrew")}
        />
      </BuilderChoiceRow>

      <BuilderChoiceRow label="Setting">
        <BuilderChoiceButton
          label="Stormlight"
          active={(builderAdversary.setting ?? "Stormlight") === "Stormlight"}
          onClick={() => updateBuilderSetting("Stormlight")}
        />
        <BuilderChoiceButton
          label="Mistborn"
          active={builderAdversary.setting === "Mistborn"}
          onClick={() => updateBuilderSetting("Mistborn")}
        />
        <BuilderChoiceButton
          label="Other"
          active={
            Boolean(builderAdversary.setting) &&
            builderAdversary.setting !== "Stormlight" &&
            builderAdversary.setting !== "Mistborn"
          }
          onClick={() => {
            if (
              !builderAdversary.setting ||
              builderAdversary.setting === "Stormlight" ||
              builderAdversary.setting === "Mistborn"
            ) {
              updateBuilderSetting("");
            }
          }}
        />
      </BuilderChoiceRow>

      {((builderAdversary.setting ?? "Stormlight") !== "Stormlight" &&
        builderAdversary.setting !== "Mistborn") && (
        <BuilderTextInput
          value={builderAdversary.setting}
          placeholder="Custom setting"
          onChange={(value) => updateBuilderSetting(value)}
        />
      )}

      <BuilderTextInput
        value={builderAdversary.name}
        placeholder="Name"
        onChange={(value) => {
          setSelectedLibraryId(null);
          setBuilderAdversary((prev) => ({ ...prev, name: value }));
        }}
      />

      <BuilderTextInput
        value={builderAdversary.tier}
        placeholder="Tier"
        onChange={(value) => {
          setSelectedLibraryId(null);
          setBuilderAdversary((prev) => ({ ...prev, tier: value }));
        }}
      />

      <BuilderTextInput
        value={builderAdversary.type}
        placeholder="Type"
        onChange={(value) => {
          setSelectedLibraryId(null);
          setBuilderAdversary((prev) => ({ ...prev, type: value }));
        }}
      />
      
      <BuilderChoiceRow label="Size">
  {["Tiny", "Small", "Medium", "Large", "Huge"].map((s) => (
    <BuilderChoiceButton
      key={s}
      label={s}
      active={builderAdversary.size === s}
      onClick={() =>
        setBuilderAdversary((prev) => ({ ...prev, size: s }))
      }
    />
  ))}
</BuilderChoiceRow>

<div style={{ width: "100%" }}>
<BuilderTextInput
      value={builderAdversary.species}
      onChange={(v) =>
        setBuilderAdversary((prev) => ({ ...prev, species: v }))
      }
      placeholder="Species (e.g., Humanoid)"
      width="100%"
    />
    </div>

    </div>
  </details>
</BuilderCard>
          <BuilderCard>
          <details open>
            <SectionSummary title="STATS" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginBottom: 12 }}>
              <div style={{ border: "1px solid #c69a3a", borderRadius: 6, padding: 8 }}>
                <div style={{ fontWeight: "bold", marginBottom: 8, textAlign: "center" }}>PHYSICAL</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: 8, justifyContent: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <div>STR</div>
                    <BuilderNumberInput value={builderAdversary.physical?.str} onChange={(v) => setPhysical("str", v)} />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div>DEF</div>
                    <BuilderNumberInput value={builderAdversary.physical?.def} onChange={(v) => setPhysical("def", v)} />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div>SPD</div>
                    <BuilderNumberInput value={builderAdversary.physical?.spd} onChange={(v) => setPhysical("spd", v)} />
                  </div>
                </div>
              </div>

              <div style={{ border: "1px solid #c69a3a", borderRadius: 6, padding: 8 }}>
                <div style={{ fontWeight: "bold", marginBottom: 8, textAlign: "center" }}>COGNITIVE</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: 8, justifyContent: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <div>INT</div>
                    <BuilderNumberInput value={builderAdversary.cognitive?.int} onChange={(v) => setCognitive("int", v)} />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div>DEF</div>
                    <BuilderNumberInput value={builderAdversary.cognitive?.def} onChange={(v) => setCognitive("def", v)} />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div>WIL</div>
                    <BuilderNumberInput value={builderAdversary.cognitive?.wil} onChange={(v) => setCognitive("wil", v)} />
                  </div>
                </div>
              </div>

              <div style={{ border: "1px solid #c69a3a", borderRadius: 6, padding: 8 }}>
                <div style={{ fontWeight: "bold", marginBottom: 8, textAlign: "center" }}>SPIRITUAL</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: 8, justifyContent: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <div>AWA</div>
                    <BuilderNumberInput value={builderAdversary.spiritual?.awa} onChange={(v) => setSpiritual("awa", v)} />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div>DEF</div>
                    <BuilderNumberInput value={builderAdversary.spiritual?.def} onChange={(v) => setSpiritual("def", v)} />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div>PRE</div>
                    <BuilderNumberInput value={builderAdversary.spiritual?.pre} onChange={(v) => setSpiritual("pre", v)} />
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: 12, marginBottom: 12 }}>
              <div>
                <div>Health</div>
                <BuilderNumberInput
                  value={builderAdversary.health}
                  onChange={(value) => {
                    setSelectedLibraryId(null);
                    setBuilderAdversary((prev) => ({ ...prev, health: value }));
                  }}
                />
              </div>
              <div>
                <div>Focus</div>
                <BuilderNumberInput
                  value={builderAdversary.focus}
                  onChange={(value) => {
                    setSelectedLibraryId(null);
                    setBuilderAdversary((prev) => ({ ...prev, focus: value }));
                  }}
                />
              </div>
              <div>
                <div>Investiture</div>
                <BuilderNumberInput
                  value={builderAdversary.investiture}
                  onChange={(value) => {
                    setSelectedLibraryId(null);
                    setBuilderAdversary((prev) => ({ ...prev, investiture: value }));
                  }}
                />
              </div>
            </div>

            <BuilderTextInput
              value={builderAdversary.healthRange}
              placeholder="Health range, e.g. 32–48"
              onChange={(value) => {
                setSelectedLibraryId(null);
                setBuilderAdversary((prev) => ({ ...prev, healthRange: value }));
              }}
            />
          </details>
          </BuilderCard>

          <BuilderCard>
          <details open>
            <SectionSummary title="DETAILS" />
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              <div>
  <BuilderTextInput
    value={
      typeof builderAdversary.deflect === "string"
        ? builderAdversary.deflect
        : builderAdversary.deflect != null
        ? String(builderAdversary.deflect)
        : ""
    }
    placeholder="Deflect e.g. 1 (leather)"
    onChange={(value) => {
      setSelectedLibraryId(null);
      setBuilderAdversary((prev) => ({ ...prev, deflect: value }));
    }}
  />
</div>
              <BuilderTextInput
                value={builderAdversary.movement}
                placeholder="Movement"
                onChange={(value) => {
                  setSelectedLibraryId(null);
                  setBuilderAdversary((prev) => ({ ...prev, movement: value }));
                }}
              />
              <BuilderTextInput
                value={builderAdversary.senses}
                placeholder="Senses"
                onChange={(value) => {
                  setSelectedLibraryId(null);
                  setBuilderAdversary((prev) => ({ ...prev, senses: value }));
                }}
              />
              <BuilderTextInput
                value={builderAdversary.languages}
                placeholder="Languages"
                onChange={(value) => {
                  setSelectedLibraryId(null);
                  setBuilderAdversary((prev) => ({ ...prev, languages: value }));
                }}
              />
              <BuilderTextInput
                value={builderAdversary.immunities}
                placeholder="Immunities"
                onChange={(value) => {
                  setSelectedLibraryId(null);
                  setBuilderAdversary((prev) => ({ ...prev, immunities: value }));
                }}
              />
            </div>
          </details>
          </BuilderCard>
          
          <BuilderCard>
          <details open>
            <SectionSummary title="SKILLS" />
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              <div>
                <div>Physical Skills (one per line)</div>
                <BuilderTextArea
                  value={joinLines(builderAdversary.skills?.physical)}
                  onChange={(value) => {
                    setSelectedLibraryId(null);
                    setBuilderAdversary((prev) => ({
                      ...prev,
                      skills: {
                        physical: splitLines(value),
                        cognitive: prev.skills?.cognitive ?? [],
                        spiritual: prev.skills?.spiritual ?? [],
                      },
                    }));
                  }}
                  rows={4}
                />
              </div>

              <div>
                <div>Cognitive Skills (one per line)</div>
                <BuilderTextArea
                  value={joinLines(builderAdversary.skills?.cognitive)}
                  onChange={(value) => {
                    setSelectedLibraryId(null);
                    setBuilderAdversary((prev) => ({
                      ...prev,
                      skills: {
                        physical: prev.skills?.physical ?? [],
                        cognitive: splitLines(value),
                        spiritual: prev.skills?.spiritual ?? [],
                      },
                    }));
                  }}
                  rows={4}
                />
              </div>

              <div>
                <div>Spiritual Skills (one per line)</div>
                <BuilderTextArea
                  value={joinLines(builderAdversary.skills?.spiritual)}
                  onChange={(value) => {
                    setSelectedLibraryId(null);
                    setBuilderAdversary((prev) => ({
                      ...prev,
                      skills: {
                        physical: prev.skills?.physical ?? [],
                        cognitive: prev.skills?.cognitive ?? [],
                        spiritual: splitLines(value),
                      },
                    }));
                  }}
                  rows={4}
                />
              </div>

              <div>
                <div>Surge Skills (one per line)</div>
                <BuilderTextArea
                  value={joinLines(builderAdversary.surgeSkills)}
                  onChange={(value) => {
                    setSelectedLibraryId(null);
                    setBuilderAdversary((prev) => ({
                      ...prev,
                      surgeSkills: splitLines(value),
                    }));
                  }}
                  rows={3}
                />
              </div>
            </div>
          </details>
          </BuilderCard>

          <BuilderCard>
          <details open>
            <SectionSummary title="FEATURES" />
            <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
              {(builderAdversary.features ?? []).map((feature, index) => (
                <div
                  key={index}
                  style={{
                    border: "1px solid #c69a3a",
                    borderRadius: 6,
                    padding: 8,
                    background: "#fff",
                  }}
                >
                  <div style={{ marginBottom: 6 }}>
                    <BuilderTextInput
                      value={feature.name}
                      placeholder="Feature name"
                      onChange={(value) => updateFeature(index, "name", value)}
                    />
                  </div>
                  <BuilderTextArea
                    value={feature.text}
                    placeholder="Feature text"
                    onChange={(value) => updateFeature(index, "text", value)}
                    rows={3}
                  />
                  <button type="button" onClick={() => removeFeature(index)} style={{ marginTop: 8 }}>
                    Remove Feature
                  </button>
                </div>
              ))}
              <button type="button" onClick={addFeature}>Add Feature</button>
            </div>
          </details>
          </BuilderCard>

  <SectionSummary title="ACTIONS" />
  <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
    {(builderAdversary.actions ?? []).map((action, index) => (
      <div
        key={index}
        style={{
          border: "1px solid #c69a3a",
          borderRadius: 6,
          padding: 8,
          background: "#fff",
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <BuilderTextInput
            value={action.name ?? ""}
            placeholder="Action name"
            onChange={(value) => updateAction(index, "name", value)}
          />
        </div>

        <div style={{ marginBottom: 6 }}>
          <label style={{ display: "block", marginBottom: 4 }}>Action Cost</label>
          <select
            value={
              action.cost === "free"
                ? "free"
                : action.cost === "reaction"
                ? "reaction"
                : String(action.cost ?? 1)
            }
            onChange={(e) => updateAction(index, "cost", e.target.value)}
            style={{
              padding: "6px 8px",
              border: "1px solid #c69a3a",
              borderRadius: 4,
              fontSize: 14,
            }}
          >
            <option value="free">Free</option>
            <option value="reaction">Reaction</option>
            <option value="1">1 Action</option>
            <option value="2">2 Actions</option>
            <option value="3">3 Actions</option>
          </select>
        </div>

        <div style={{ marginBottom: 6 }}>
  <BuilderTextInput
    value={action.focusCost ?? ""}
    placeholder="Focus cost (example: 1)"
    onChange={(value) => updateAction(index, "focusCost", value)}
  />
</div>

<div style={{ marginBottom: 6 }}>
  <BuilderTextInput
    value={action.investitureCost ?? ""}
    placeholder="Investiture cost (example: 1)"
    onChange={(value) => updateAction(index, "investitureCost", value)}
  />
</div>

        <div style={{ marginBottom: 6 }}>
          <BuilderTextInput
            value={action.attackBonus ?? ""}
            placeholder="Attack bonus (example: +6)"
            onChange={(value) => updateAction(index, "attackBonus", value)}
          />
        </div>

        <div style={{ marginBottom: 6 }}>
          <BuilderTextInput
            value={action.reach ?? ""}
            placeholder="Reach (example: 5 ft.)"
            onChange={(value) => updateAction(index, "reach", value)}
          />
        </div>

        <div style={{ marginBottom: 6 }}>
          <BuilderTextInput
            value={action.range ?? ""}
            placeholder="Range (example: 150/600 ft.)"
            onChange={(value) => updateAction(index, "range", value)}
          />
        </div>

        <div style={{ marginBottom: 6 }}>
          <BuilderTextInput
            value={action.target ?? ""}
            placeholder="Target (example: one target)"
            onChange={(value) => updateAction(index, "target", value)}
          />
        </div>

        <div style={{ marginBottom: 6 }}>
          <BuilderTextArea
            value={action.graze ?? ""}
            placeholder="Graze text"
            onChange={(value) => updateAction(index, "graze", value)}
            rows={2}
          />
        </div>

        <div style={{ marginBottom: 6 }}>
          <BuilderTextArea
            value={action.hit ?? ""}
            placeholder="Hit text"
            onChange={(value) => updateAction(index, "hit", value)}
            rows={3}
          />
        </div>

        <div style={{ marginBottom: 6 }}>
          <BuilderTextArea
            value={action.notes ?? ""}
            placeholder="Notes"
            onChange={(value) => updateAction(index, "notes", value)}
            rows={3}
          />
        </div>

        <div style={{ marginBottom: 6 }}>
          <BuilderTextArea
            value={action.text ?? ""}
            placeholder="Main action text"
            onChange={(value) => updateAction(index, "text", value)}
            rows={4}
          />
        </div>

        <button
          type="button"
          onClick={() => removeAction(index)}
          style={{ marginTop: 8 }}
        >
          Remove Action
        </button>
      </div>
    ))}
    <button type="button" onClick={addAction}>Add Action</button>
  </div>
  <details open>
  <SectionSummary title="OPPORTUNITIES AND COMPLICATIONS" />

  <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
    <div>
      <div
        style={{
          fontWeight: 600,
          marginBottom: 4,
          color: "#1f3b67",
        }}
      >
        Intro
      </div>
      <BuilderTextArea
        value={builderAdversary.opportunitiesAndComplications?.intro ?? ""}
        onChange={(value) =>
          updateOpportunitiesAndComplications("intro", value)
        }
        placeholder="The following options are available when an enemy gains an Opportunity or Complication during a scene with this adversary:"
        rows={3}
      />
    </div>

    <div>
      <div
        style={{
          fontWeight: 600,
          marginBottom: 4,
          color: "#1f3b67",
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
          color: "#1f3b67",
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
        </div>
        </div>
      )}
    </div>
  );
}