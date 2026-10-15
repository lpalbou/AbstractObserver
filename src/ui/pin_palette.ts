/**
 * PIN PALETTE — a VERBATIM MIRROR of AbstractFlow's pin vocabulary
 * (abstractflow/src/types/flow.ts lines 6-85 at abstractflow c5961d1:
 * `PinType` and `PIN_COLORS`), so the Observer draws a flow's pins with the
 * editor's exact colours (backlog 0003 §Agent page, wave 3).
 *
 * TO BE PROMOTED into @abstractframework/ui-kit (design W3, `AfPinList`):
 * once the kit exports the palette, Flow and the Observer import it from
 * there and this file is deleted. Until then: do NOT edit the block between
 * the markers by hand — re-copy it from flow.ts. These colours are DATA
 * (a pin type's identity), the one place the Observer carries colour
 * literals (agent_page.css stays tokens-only).
 *
 * `src/ui/pin_legend.tsx` still carries an older private subset of this
 * map; it should import from here (not changed by this lane).
 */

// ---- BEGIN verbatim copy of abstractflow/src/types/flow.ts:6-85 ----
// Pin types with their colors (Blueprint-inspired)
export type PinType =
  | 'execution' // White #FFFFFF - Flow control
  | 'string'    // Magenta #FF00FF - Text data
  | 'number'    // Green #00FF00 - Integer/Float
  | 'boolean'   // Red #FF0000 - True/False
  | 'object'    // Cyan #00FFFF - JSON objects
  | 'json_schema' // Cyan #00FFFF - JSON Schema objects
  | 'artifact'  // Generic saved artifact reference object
  | 'artifact_image' // Image artifact reference object
  | 'artifact_audio' // Audio artifact reference object (voice/music/sound)
  | 'artifact_text'  // Text/transcript artifact reference object
  | 'artifact_video' // Video artifact reference object
  | 'artifacts' // Ordered list of generic saved artifact reference objects
  | 'artifacts_image' // Ordered list of image artifact refs
  | 'artifacts_audio' // Ordered list of audio artifact refs (voice/music/sound)
  | 'artifacts_text' // Ordered list of text/transcript artifact refs
  | 'artifacts_video' // Ordered list of video artifact refs
  | 'workspace_file' // Canonical workspace-scoped server file path (string-backed)
  | 'workspace_folder' // Canonical workspace-scoped server folder path (string-backed)
  | 'memory'    // Mint - Memory configuration object (KG/span/session controls)
  | 'assertion' // Teal - KG assertion object (subject/predicate/object + metadata)
  | 'assertions' // Teal - List of KG assertion objects (assertion[])
  | 'array'     // Orange #FF8800 - Collections
  | 'tools'     // Orange - Tool allowlist (string[])
  | 'provider'  // Legacy text/LLM provider id/name (string-like)
  | 'model'     // Model id/name (string-like; scoped by the selected provider pin)
  | 'provider_text'  // Text/LLM provider id/name (string-like)
  | 'model_text'     // Compatibility alias for old saved flows; new flows use `model`
  | 'provider_image' // Image provider/backend id (string-like)
  | 'model_image'    // Compatibility alias for old saved flows; new flows use `model`
  | 'provider_video' // Video provider/backend id (string-like)
  | 'model_video'    // Compatibility alias for old saved flows; new flows use `model`
  | 'provider_voice' // Voice/TTS/STT provider/backend id (string-like)
  | 'model_voice'    // Compatibility alias for old saved flows; new flows use `model`
  | 'provider_music' // Music-generation provider/backend id (string-like)
  | 'model_music'    // Compatibility alias for old saved flows; new flows use `model`
  | 'agent'     // Blue #4488FF - Agent reference
  | 'any';      // Gray #888888 - Accepts any type

// Pin colors
export const PIN_COLORS: Record<PinType, string> = {
  execution: '#FFFFFF',
  string: '#FF00FF',
  number: '#00FF00',
  boolean: '#FF0000',
  object: '#00FFFF',
  json_schema: '#00FFFF',
  artifact: '#5EEAD4',
  artifact_image: '#19D3B8',
  artifact_audio: '#22D3EE',
  artifact_text: '#D946EF',
  artifact_video: '#A855F7',
  artifacts: '#2DD4BF',
  artifacts_image: '#0F766E',
  artifacts_audio: '#0891B2',
  artifacts_text: '#C026D3',
  artifacts_video: '#7C3AED',
  workspace_file: '#84CC16',
  workspace_folder: '#65A30D',
  memory: '#00C49A',
  assertion: '#00B8D4',
  assertions: '#00B8D4',
  array: '#FF8800',
  tools: '#FF8800',
  provider: '#00D2FF',
  model: '#9D4EDD',
  provider_text: '#00D2FF',
  model_text: '#9D4EDD',
  provider_image: '#19D3B8',
  model_image: '#9D4EDD',
  provider_video: '#A855F7',
  model_video: '#9D4EDD',
  provider_voice: '#22D3EE',
  model_voice: '#9D4EDD',
  provider_music: '#F59E0B',
  model_music: '#9D4EDD',
  agent: '#4488FF',
  any: '#888888',
};
// ---- END verbatim copy ----

/** Every type the editor knows, in its declaration order. */
export const PIN_TYPES = Object.keys(PIN_COLORS) as PinType[];

export function is_pin_type(value: unknown): value is PinType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PIN_COLORS, value);
}

/** The editor's colour for a pin type; an undeclared or unknown type draws as `any`. */
export function pin_color(type: unknown): string {
  return is_pin_type(type) ? PIN_COLORS[type] : PIN_COLORS.any;
}

/** The glyph family the editor draws (abstractflow/src/components/pins/PinShape.tsx). */
export type PinShapeKind = "triangle" | "diamond" | "square" | "hexagon" | "circle";

export function pin_shape_kind(type: unknown): PinShapeKind {
  switch (type) {
    case "execution":
      return "triangle";
    case "boolean":
      return "diamond";
    case "array":
    case "tools":
    case "assertions":
      return "square";
    case "agent":
      return "hexagon";
    default:
      return "circle";
  }
}
