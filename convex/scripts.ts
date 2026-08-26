// Private script operations invoked only by the sync gateway.
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const scriptFields = {
  title: v.string(),
  content: v.string(),
  googleDocUrl: v.optional(v.string()),
  tag: v.optional(v.string()),
};

function previewFor(content: string) {
  return content.substring(0, 40) + (content.length > 40 ? "..." : "");
}

function wordCountFor(content: string) {
  const trimmed = content.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}


/** Lists only the scripts belonging to the supplied gateway-derived owner. */
export const listByOwner = internalQuery({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("scripts")
      .withIndex("by_owner_updated_at", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .collect();
  },
});

/** Retrieves an owned script, returning null for absent, malformed, or foreign IDs. */
export const getByOwner = internalQuery({
  args: { ownerId: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("scripts", args.id);
    if (!id) return null;
    const script = await ctx.db.get(id);
    return script?.ownerId === args.ownerId ? script : null;
  },
});

/** Creates a script whose owner is supplied by the authenticated gateway. */
export const createForOwner = internalMutation({
  args: { ownerId: v.string(), ...scriptFields },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("scripts", {
      ownerId: args.ownerId,
      title: args.title,
      content: args.content,
      preview: previewFor(args.content),
      createdAt: now,
      updatedAt: now,
      googleDocUrl: args.googleDocUrl,
      wordCount: wordCountFor(args.content),
      isFavorite: false,
      tag: args.tag,
    });
    return await ctx.db.get(id);
  },
});

/** Applies only supplied fields to one owned script; foreign IDs remain invisible. */
export const updateForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    id: v.string(),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    googleDocUrl: v.optional(v.string()),
    tag: v.optional(v.string()),
    isFavorite: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("scripts", args.id);
    if (!id) return null;
    const existing = await ctx.db.get(id);
    if (!existing || existing.ownerId !== args.ownerId) return null;

    const updates: Record<string, string | number | boolean | undefined> = { updatedAt: Date.now() };
    if (args.title !== undefined) updates.title = args.title;
    if (args.content !== undefined) {
      updates.content = args.content;
      updates.preview = previewFor(args.content);
      updates.wordCount = wordCountFor(args.content);
    }
    if (args.googleDocUrl !== undefined) updates.googleDocUrl = args.googleDocUrl;
    if (args.tag !== undefined) updates.tag = args.tag;
    if (args.isFavorite !== undefined) updates.isFavorite = args.isFavorite;

    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

/** Clones one owned script with a new stable Convex document ID. */
export const duplicateForOwner = internalMutation({
  args: { ownerId: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    const sourceId = ctx.db.normalizeId("scripts", args.id);
    if (!sourceId) return null;
    const source = await ctx.db.get(sourceId);
    if (!source || source.ownerId !== args.ownerId) return null;

    const now = Date.now();
    const id = await ctx.db.insert("scripts", {
      ownerId: args.ownerId,
      title: `Copy of ${source.title}`,
      content: source.content,
      preview: source.preview,
      createdAt: now,
      updatedAt: now,
      googleDocUrl: source.googleDocUrl,
      wordCount: source.wordCount,
      isFavorite: source.isFavorite,
      tag: source.tag,
    });
    return await ctx.db.get(id);
  },
});

/** Deletes one owned script and returns false for absent, malformed, or foreign IDs. */
export const deleteForOwner = internalMutation({
  args: { ownerId: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("scripts", args.id);
    if (!id) return false;
    const existing = await ctx.db.get(id);
    if (!existing || existing.ownerId !== args.ownerId) return false;
    await ctx.db.delete(id);
    return true;
  },
});
