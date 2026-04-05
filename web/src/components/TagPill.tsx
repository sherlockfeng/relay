import { tagHue } from '../lib/format';

export function TagPill({ name, onRemove }: { name: string; onRemove?: () => void }) {
  const h = tagHue(name);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white shadow-sm"
      style={{
        background: `linear-gradient(135deg, hsl(${h}, 55%, 42%), hsl(${(h + 40) % 360}, 50%, 36%))`,
      }}
    >
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full px-1 hover:bg-white/20"
          aria-label={`Remove ${name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
