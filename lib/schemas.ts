// Strict tool schemas (additionalProperties:false + required everywhere).
const BBOX = {
  type: "object", additionalProperties: false,
  properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
  required: ["x", "y", "w", "h"],
};

export const PAGE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          text: { type: "string" },
          role: { type: "string", enum: ["title", "heading", "body", "list", "caption", "header", "footer", "page-number"] },
          heading_level: { type: "integer" },
          bbox: BBOX,
        },
        required: ["text", "role", "heading_level", "bbox"],
      },
    },
    figures: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { bbox: BBOX, caption: { type: "string" }, description: { type: "string" } },
        required: ["bbox", "caption", "description"],
      },
    },
    tables: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          bbox: BBOX, caption: { type: "string" },
          columns: { type: "array", items: { type: "string" } },
          rows: { type: "array", items: { type: "array", items: { type: "string" } } },
          extraction_ok: { type: "boolean" },
        },
        required: ["bbox", "caption", "columns", "rows", "extraction_ok"],
      },
    },
    confidence: { type: "number" },
    notes: { type: "string" },
  },
  required: ["blocks", "figures", "tables", "confidence", "notes"],
};

export const NORMALIZE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    headings: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { index: { type: "integer" }, keep: { type: "boolean" }, level: { type: "integer" } },
        required: ["index", "keep", "level"],
      },
    },
  },
  required: ["headings"],
};

export const SUMMARY_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { summary: { type: "string" } },
  required: ["summary"],
};

export const WHY_RELATED_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { why: { type: "string" } },
  required: ["why"],
};
