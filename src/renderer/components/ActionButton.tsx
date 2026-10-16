import { useEffect, useId, useState, type ComponentProps } from "react";

/** A wrapper receives hover/focus even when the native button is disabled. */
export function ActionButton({
  disabledReason,
  ...props
}: ComponentProps<"button"> & { disabledReason?: string }) {
  const id = useId();
  const [showHint, setShowHint] = useState(false);
  useEffect(() => {
    if (!showHint || !disabledReason) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowHint(false);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [showHint, disabledReason]);
  return (
    <span
      className="action-with-hint"
      tabIndex={disabledReason ? 0 : undefined}
      aria-describedby={disabledReason ? id : undefined}
      onMouseEnter={() => setShowHint(true)}
      onMouseLeave={() => setShowHint(false)}
      onFocus={() => setShowHint(true)}
      onBlur={() => setShowHint(false)}
    >
      <button
        {...props}
        disabled={!!disabledReason}
        aria-describedby={disabledReason ? id : undefined}
      />
      {disabledReason && showHint && (
        <span id={id} role="tooltip" className="action-hint">
          {disabledReason}
        </span>
      )}
    </span>
  );
}
