import { useMemo } from "react";

type DebugScalarControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  formatValue?: (value: number) => string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return 0;
  }
  const text = String(step);
  const dot = text.indexOf(".");
  return dot >= 0 ? text.length - dot - 1 : 0;
}

function snapToStep(value: number, min: number, max: number, step: number): number {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const clamped = clamp(value, min, max);
  const snapped = min + Math.round((clamped - min) / safeStep) * safeStep;
  const decimals = resolveDecimals(safeStep);
  return Number(clamp(snapped, min, max).toFixed(decimals));
}

export function DebugScalarControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
}: DebugScalarControlProps) {
  const displayValue = useMemo(() => {
    if (formatValue) {
      return formatValue(value);
    }
    const decimals = resolveDecimals(step);
    return value.toFixed(decimals);
  }, [formatValue, step, value]);

  const applyDelta = (delta: number) => {
    onChange(snapToStep(value + delta, min, max, step));
  };

  return (
    <label className="controlLabel">
      <span>{label}</span>
      <div className="controlRow controlRowStepper">
        <button
          type="button"
          className="controlStepperButton"
          onClick={() => applyDelta(-step)}
          aria-label={`${label} decrease`}
        >
          -
        </button>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(snapToStep(Number(event.target.value), min, max, step))}
          aria-label={label}
        />
        <button
          type="button"
          className="controlStepperButton"
          onClick={() => applyDelta(step)}
          aria-label={`${label} increase`}
        >
          +
        </button>
      </div>
      <span className="controlValueChip">{displayValue}</span>
    </label>
  );
}
