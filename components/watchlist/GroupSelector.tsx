'use client';

import { useEffect, useState, useCallback } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createWatchlistGroup, getWatchlistGroups, setDefaultWatchlistGroup } from '@/lib/actions/watchlist-group.actions';

type Group = {
    _id: string;
    name: string;
    isDefault: boolean;
};

export default function GroupSelector() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [groups, setGroups] = useState<Group[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');

    const currentGroupId = searchParams.get('groupId') ?? '';
    const currentGroup = groups.find((g) => g._id === currentGroupId);

    const loadGroups = useCallback(async () => {
        const data = await getWatchlistGroups();
        setGroups(data);
    }, []);

    useEffect(() => {
        loadGroups();
    }, [loadGroups]);

    const handleCreate = async () => {
        const name = newGroupName.trim();
        if (!name) return;
        const result = await createWatchlistGroup(name);
        if ('error' in result) {
            alert(result.error);
            return;
        }
        setNewGroupName('');
        await loadGroups();
    };

    const handleSetDefault = async (groupId: string) => {
        await setDefaultWatchlistGroup(groupId);
        await loadGroups();
        // Sync URL so the choice is shareable and survives refresh
        const params = new URLSearchParams(searchParams.toString());
        params.set('groupId', groupId);
        router.push(`?${params.toString()}`);
    };

    return (
        <div className="flex items-center gap-3">
            <label className="text-[12px] text-faint uppercase tracking-wider">股票组合</label>
            <div className="relative inline-block">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-muted border border-line rounded-lg hover:bg-muted/80 transition-colors text-sm"
                >
                    {currentGroup?.name ?? '选择组合'}
                    <ChevronDown className="size-4" />
                </button>
                {isOpen && (
                    <div className="absolute z-10 mt-1 w-48 bg-popover border border-line rounded-lg shadow-lg py-1">
                        {groups.map((g) => (
                            <button
                                key={g._id}
                                onClick={() => handleSetDefault(g._id)}
                                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                                    g.isDefault
                                        ? 'bg-brand/10 text-brand-ink font-semibold'
                                        : 'text-foreground hover:bg-muted'
                                }`}
                            >
                                {g.name}
                                {g.isDefault && <span className="ml-auto text-[10px] text-faint">(默认)</span>}
                            </button>
                        ))}
                        <div className="border-t border-line pt-2 px-3">
                            <div className="flex gap-2 py-2">
                                <input
                                    value={newGroupName}
                                    onChange={(e) => setNewGroupName(e.target.value)}
                                    placeholder="新建组合…"
                                    className="flex-1 text-sm border-none bg-transparent focus:ring-0 placeholder:text-faint"
                                />
                                <button
                                    onClick={handleCreate}
                                    className="px-2 text-[11px] font-medium text-brand-ink"
                                >
                                    <Plus className="size-3 mr-1" /> 新建
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
