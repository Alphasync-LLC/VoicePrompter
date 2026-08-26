// Schema for VoicePrompter teleprompter app.
// Script records are private to their gateway-verified owner.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  scripts: defineTable({
    ownerId: v.string(),
    title: v.string(),
    content: v.string(),
    preview: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    googleDocUrl: v.optional(v.string()),
    wordCount: v.number(),
    isFavorite: v.boolean(),
    tag: v.optional(v.string()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_updated_at", ["ownerId", "updatedAt"]),
});