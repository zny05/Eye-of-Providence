'use server';

import { connectToDatabase } from '@/database/mongoose';
import { WatchlistGroup } from '@/database/models/watchlist-group.model';
import { Watchlist } from '@/database/models/watchlist.model';
import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/better-auth/auth';

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.&:-]{0,24}$/;
const MAX_SYMBOLS_PER_GROUP = 50;
const MAX_GROUPS_PER_USER = 20;
const DEFAULT_GROUP_NAME = '我的自选';

/**
 * Ensure the current user has at least one default group. On first access,
 * migrate the legacy single Watchlist into a default group named "我的自选"
 * so existing stocks are never lost.
 */
async function ensureDefaultGroup(userId: string) {
    await connectToDatabase();
    const existing = await WatchlistGroup.findOne({ userId, isDefault: true });
    if (existing) return existing;

    const watchlist = await Watchlist.find({ userId }).lean();
    const symbols = watchlist.map((item) => String(item.symbol));

    return WatchlistGroup.create({
        userId,
        name: DEFAULT_GROUP_NAME,
        symbols,
        isDefault: true,
        sortOrder: 0,
    });
}

/** Get all watchlist groups for the current user. */
export async function getWatchlistGroups() {
    const userId = await requireUserId();
    await connectToDatabase();
    await ensureDefaultGroup(userId);
    const groups = await WatchlistGroup.find({ userId })
        .sort({ sortOrder: 1, createdAt: 1 })
        .lean();
    return JSON.parse(JSON.stringify(groups));
}

/** Get a specific group (or the default group when groupId omitted). */
export async function getWatchlistGroup(groupId?: string) {
    const userId = await requireUserId();
    await connectToDatabase();
    await ensureDefaultGroup(userId);

    const group = groupId
        ? await WatchlistGroup.findOne({ userId, _id: groupId }).lean()
        : await WatchlistGroup.findOne({ userId, isDefault: true }).lean();

    if (!group) return null;
    return JSON.parse(JSON.stringify(group));
}

/** Create a new watchlist group. */
export async function createWatchlistGroup(name: string) {
    const userId = await requireUserId();
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new Error('组合名称不能为空');
    if (trimmed.length > 50) throw new Error('组合名称不能超过 50 个字符');

    await connectToDatabase();
    const count = await WatchlistGroup.countDocuments({ userId });
    if (count >= MAX_GROUPS_PER_USER) {
        return { error: `最多只能创建 ${MAX_GROUPS_PER_USER} 个组合` };
    }

    const exists = await WatchlistGroup.findOne({ userId, name: trimmed });
    if (exists) return { error: '组合名称已存在' };

    const group = await WatchlistGroup.create({
        userId,
        name: trimmed,
        symbols: [],
        isDefault: false,
        sortOrder: count,
    });
    revalidatePath('/');
    return JSON.parse(JSON.stringify(group));
}

/** Rename a watchlist group. */
export async function renameWatchlistGroup(groupId: string, name: string) {
    const userId = await requireUserId();
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new Error('组合名称不能为空');
    if (trimmed.length > 50) throw new Error('组合名称不能超过 50 个字符');

    await connectToDatabase();
    const group = await WatchlistGroup.findOne({ userId, _id: groupId });
    if (!group) throw new Error('组合不存在');

    const duplicate = await WatchlistGroup.findOne({ userId, name: trimmed, _id: { $ne: groupId } });
    if (duplicate) return { error: '组合名称已存在' };

    group.name = trimmed;
    await group.save();
    revalidatePath('/');
    return { success: true };
}

/** Delete a watchlist group. Cannot delete the default group or the last group. */
export async function deleteWatchlistGroup(groupId: string) {
    const userId = await requireUserId();
    await connectToDatabase();
    const group = await WatchlistGroup.findOne({ userId, _id: groupId });
    if (!group) throw new Error('组合不存在');
    if (group.isDefault) throw new Error('不能删除默认组合');

    const count = await WatchlistGroup.countDocuments({ userId });
    if (count <= 1) throw new Error('至少保留一个组合');

    await WatchlistGroup.deleteOne({ userId, _id: groupId });
    revalidatePath('/');
    return { success: true };
}

/** Add a stock symbol to a group. */
export async function addStockToGroup(groupId: string, symbol: string, company: string) {
    const userId = await requireUserId();
    const ticker = String(symbol ?? '').trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(ticker)) throw new Error('无效的股票代码');
    const name = String(company ?? '').trim().slice(0, 120);

    await connectToDatabase();
    const group = await WatchlistGroup.findOne({ userId, _id: groupId });
    if (!group) throw new Error('组合不存在');

    if (group.symbols.includes(ticker)) {
        return { error: `${ticker} 已在组合中` };
    }
    if (group.symbols.length >= MAX_SYMBOLS_PER_GROUP) {
        return { error: `该组合最多包含 ${MAX_SYMBOLS_PER_GROUP} 只股票` };
    }

    group.symbols.push(ticker);
    await group.save();
    revalidatePath('/');
    return { success: true, symbol: ticker, company: name };
}

/** Remove a stock symbol from a group. */
export async function removeStockFromGroup(groupId: string, symbol: string) {
    const userId = await requireUserId();
    const ticker = String(symbol ?? '').trim().toUpperCase();

    await connectToDatabase();
    const group = await WatchlistGroup.findOne({ userId, _id: groupId });
    if (!group) throw new Error('组合不存在');

    group.symbols = group.symbols.filter((s) => s !== ticker);
    await group.save();
    revalidatePath('/');
    return { success: true };
}

/** Set a group as the default (shown on Dashboard first visit). */
export async function setDefaultWatchlistGroup(groupId: string) {
    const userId = await requireUserId();
    await connectToDatabase();
    const group = await WatchlistGroup.findOne({ userId, _id: groupId });
    if (!group) throw new Error('组合不存在');

    await WatchlistGroup.updateMany({ userId }, { $set: { isDefault: false } });
    group.isDefault = true;
    await group.save();
    revalidatePath('/');
    return { success: true };
}
