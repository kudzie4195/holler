'use client';

import { useId } from 'react';
import { Field } from './field';

/** Controlled range input with a live value readout. */
export function Slider({
  label,
  name,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = '',
  hint,
}: {
  label: string;
  name: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <Field id={id} label={label} hint={hint}>
      <div className="flex items-center gap-4">
        <input
          id={id}
          name={name}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="range-holler"
          aria-valuetext={`${value}${unit}`}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <output
          htmlFor={id}
          className="w-20 shrink-0 text-right font-mono text-base tabular-nums text-ink"
        >
          {value}
          {unit}
        </output>
      </div>
    </Field>
  );
}
