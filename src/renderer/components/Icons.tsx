import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Move,
  Pencil,
  LoaderCircle,
} from "lucide-react";
import type { Operation } from "../../shared/model";
import logo from "../../shared/logo.json";
export function LayerIcon({ layer }: { layer: "top" | "bottom" | "both" }) {
  return (
    <svg
      width="25"
      height="25"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 17 14 23 25 17 14 11Z"
        fill={layer !== "top" ? "#15dfd8" : "#455763"}
        stroke={layer !== "top" ? "#15dfd8" : "#788895"}
        strokeWidth="1.2"
      />
      <path
        d="M3 10 14 16 25 10 14 4Z"
        fill={layer !== "bottom" ? "#15dfd8" : "#18252e"}
        stroke={layer !== "bottom" ? "#15dfd8" : "#788895"}
        strokeWidth="1.2"
      />
    </svg>
  );
}
export function DryRunIcon() {
  return (
    <svg
      width="23"
      height="23"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M8 3h8v9l-4 5-4-5Z" />
      <path d="M2 21h3m3 0h3m3 0h3m3 0h2" />
    </svg>
  );
}
export function OperationIcon({
  operation,
  size = 22,
}: {
  operation: Operation;
  size?: number;
}) {
  const Icon =
    operation === "lift"
      ? ArrowUpFromLine
      : operation === "lower"
        ? ArrowDownToLine
        : operation === "travel"
          ? Move
          : Pencil;
  return <Icon size={size} strokeWidth={2} />;
}
export function PrinterIcon({ state }: { state: string }) {
  if (state === "connecting")
    return <LoaderCircle size={20} className="spin" />;
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="5"
        fill={state === "disconnected" ? "none" : "currentColor"}
      />
    </svg>
  );
}
export function Logo() {
  return (
    <svg
      width="29"
      height="31"
      viewBox={logo.viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={logo.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={logo.path} />
      {logo.pads.map(([cx, cy]) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r={logo.padRadius}
          fill="#102129"
        />
      ))}
    </svg>
  );
}

export function CornerIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      {[
        [5, 5],
        [15, 5],
        [5, 15],
        [15, 15],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.4" />
      ))}
    </svg>
  );
}
