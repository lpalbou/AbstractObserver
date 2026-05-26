import React, { useState } from "react";

type PinType =
  | "execution"
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "tools"
  | "provider"
  | "model"
  | "provider_text"
  | "model_text"
  | "provider_image"
  | "model_image"
  | "provider_voice"
  | "model_voice"
  | "agent"
  | "any";

const PIN_COLORS: Record<PinType, string> = {
  execution: "#FFFFFF",
  string: "#FF00FF",
  number: "#00FF00",
  boolean: "#FF0000",
  object: "#00FFFF",
  array: "#FF8800",
  tools: "#FF8800",
  provider: "#00D2FF",
  model: "#9D4EDD",
  provider_text: "#00D2FF",
  model_text: "#9D4EDD",
  provider_image: "#19D3B8",
  model_image: "#8B5CF6",
  provider_voice: "#22D3EE",
  model_voice: "#A855F7",
  agent: "#4488FF",
  any: "#888888",
};

type PinInfo = {
  type: PinType;
  label: string;
  shape: string;
  description: string;
};

const PIN_INFO: PinInfo[] = [
  { type: "execution", label: "Execution", shape: "▷", description: "Controls flow order" },
  { type: "string", label: "String", shape: "●", description: "Text data" },
  { type: "number", label: "Number", shape: "●", description: "Integer or float" },
  { type: "boolean", label: "Boolean", shape: "◇", description: "True/False" },
  { type: "object", label: "Object", shape: "●", description: "JSON objects" },
  { type: "array", label: "Array", shape: "■", description: "Collections" },
  { type: "tools", label: "Tools", shape: "■", description: "Tool allowlist (string[])" },
  { type: "provider_text", label: "Text Provider", shape: "●", description: "Text/LLM provider id/name" },
  { type: "provider_image", label: "Image Provider", shape: "●", description: "Image-generation provider id" },
  { type: "provider_voice", label: "Voice Provider", shape: "●", description: "Voice/TTS/STT provider id" },
  { type: "provider", label: "Provider (legacy)", shape: "●", description: "Legacy unscoped provider id/name" },
  { type: "model", label: "Model", shape: "●", description: "Model id/name scoped by the selected provider" },
  { type: "agent", label: "Agent", shape: "⬢", description: "Agent reference" },
  { type: "any", label: "Any", shape: "●", description: "Accepts any type" },
];

export function PinLegend(): React.ReactElement {
  const [collapsed, set_collapsed] = useState(true);

  return (
    <div className="pin-legend">
      <button className="pin-legend-toggle mono" type="button" onClick={() => set_collapsed((v) => !v)} title="Pin Type Legend">
        {collapsed ? "?" : "×"} Pin Types
      </button>

      {!collapsed ? (
        <div className="pin-legend-content">
          {PIN_INFO.map((info) => (
            <div key={info.type} className="pin-legend-row">
              <span className="pin-legend-shape" style={{ color: PIN_COLORS[info.type] }}>
                {info.shape}
              </span>
              <span className="pin-legend-label mono">{info.label}</span>
              <span className="pin-legend-desc mono">{info.description}</span>
            </div>
          ))}

          <div className="pin-legend-rules mono">
            <strong>Connection Rules:</strong>
            <ul>
              <li>Execution connects to Execution only</li>
              <li>"Any" type accepts all data types</li>
              <li>Same types always compatible</li>
              <li>Array and Object are interchangeable</li>
              <li>"Tools" is compatible with Array (specialized string[])</li>
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
