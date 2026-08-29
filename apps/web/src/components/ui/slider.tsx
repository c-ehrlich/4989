import { Slider as BaseSlider } from "@base-ui/react/slider";
import type * as React from "react";

import { cn } from "@/lib/cn";

export type RangeSliderValue = readonly [number, number];

export type SingleSliderProps = {
  className?: string;
  disabled?: boolean;
  getAriaLabel?: () => string;
  max: number;
  min: number;
  onValueChange?: (value: number) => void;
  step?: number;
  value: number;
};

export function SingleSlider({
  className,
  disabled,
  getAriaLabel,
  max,
  min,
  onValueChange,
  step = 1,
  value,
}: SingleSliderProps) {
  return (
    <BaseSlider.Root
      className={cn("grid w-full gap-2", className)}
      disabled={disabled}
      max={max}
      min={min}
      onValueChange={(nextValue) =>
        onValueChange?.(typeof nextValue === "number" ? nextValue : (nextValue[0] ?? min))
      }
      step={step}
      value={value}
    >
      <BaseSlider.Control className="flex h-6 touch-none items-center">
        <BaseSlider.Track className="relative h-2 w-full rounded-full bg-muted">
          <BaseSlider.Indicator className="absolute h-full rounded-full bg-secondary" />
          <BaseSlider.Thumb
            className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-secondary bg-background shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[dragging]:bg-secondary"
            getAriaLabel={getAriaLabel}
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}

export type RangeSliderProps = {
  className?: string;
  disabled?: boolean;
  getAriaLabel?: (index: number) => string;
  max: number;
  min: number;
  minStepsBetweenValues?: number;
  onValueChange?: (value: RangeSliderValue) => void;
  step?: number;
  value: RangeSliderValue;
};

export function RangeSlider({
  className,
  disabled,
  getAriaLabel,
  max,
  min,
  minStepsBetweenValues = 0,
  onValueChange,
  step = 1,
  value,
}: RangeSliderProps) {
  return (
    <BaseSlider.Root<RangeSliderValue>
      className={cn("grid w-full gap-2", className)}
      disabled={disabled}
      max={max}
      min={min}
      minStepsBetweenValues={minStepsBetweenValues}
      onValueChange={(nextValue) =>
        onValueChange?.(normalizeRangeValue(nextValue))
      }
      step={step}
      thumbCollisionBehavior="none"
      value={value}
    >
      <BaseSlider.Control className="flex h-6 touch-none items-center">
        <BaseSlider.Track className="relative h-2 w-full rounded-full bg-muted">
          <BaseSlider.Indicator className="absolute h-full rounded-full bg-primary" />
          <SliderThumb getAriaLabel={getAriaLabel} index={0} />
          <SliderThumb getAriaLabel={getAriaLabel} index={1} />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}

function SliderThumb({
  getAriaLabel,
  index,
}: Readonly<{
  getAriaLabel?: (index: number) => string;
  index: number;
}>) {
  return (
    <BaseSlider.Thumb
      className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[dragging]:bg-primary"
      getAriaLabel={getAriaLabel}
      index={index}
    />
  );
}

function normalizeRangeValue(value: number | readonly number[]): RangeSliderValue {
  if (Array.isArray(value) && value.length >= 2) {
    return [value[0] ?? 0, value[1] ?? value[0] ?? 0];
  }

  if (typeof value === "number") {
    return [value, value];
  }

  return [0, 0];
}
