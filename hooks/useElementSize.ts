import { useEffect, useRef, useState } from 'react';

// Width/height of an element from ResizeObserver; the chart reads its own container, not the viewport.
export function useElementSize<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return [ref, size] as const;
}
