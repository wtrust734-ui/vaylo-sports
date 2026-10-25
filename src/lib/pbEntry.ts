// ============================================================================
// PB TEXT — turn "5K in 22:14" into a record the wall can store
// ----------------------------------------------------------------------------
// The wall used to ask for three fields: metric, value, unit. That is a form
// for somebody who already knows how the app stores a record, not for an
// athlete who just wants to say what they did. This parser is the one place
// that reads the sentence and decides what was measured:
//
//   "5K in 22:14"          → 5K, 1334 seconds (a lower number is better)
//   "bench press 120 kg"   → Bench press, 120 kg (a higher number is better)
//   "40m sprint 5.1s"      → 40m sprint, 5.1 seconds
//   "20 pull ups"          → Pull ups, 20 reps
//
// It never guesses a value that is not in the text: an unreadable sentence
// returns null and the screen asks again rather than saving a confident zero.
// ============================================================================

export interface ParsedPb {
  metric: string;
  /** Seconds for a time, the measured number for everything else. */
  value: number;
  /** "time" for a timed effort; otherwise kg, lb, cm, m, reps, W… */
  unit: string;
  /** What the card and wall show: "22:14", "120 kg", "20 reps". */
  display: string;
  /** Timed efforts improve downward; lifts, jumps and reps improve upward. */
  lowerIsBetter: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatPbSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  // Sprints are measured to the tenth, so do not round 11.2s into 11s.
  if (seconds < 60 && !Number.isInteger(seconds)) {
    return `${seconds.toFixed(2).replace(/\.?0+$/, "")}s`;
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const isTimedMetric = (metric: string): boolean =>
  /(\d+(?:\.\d+)?\s*(?:k|km|m|mi|mile|yd)\b|half[\s-]?marathon|marathon|\b(?:run|sprint|swim|ride|time trial)\b)/i.test(
    metric,
  );

export function formatPbValue(record: { metric: string; value: number; unit: string }): string {
  if (record.unit === "time" || (!record.unit && isTimedMetric(record.metric))) {
    return formatPbSeconds(record.value);
  }
  const rounded = Number.isInteger(record.value) ? String(record.value) : String(record.value);
  return record.unit ? `${rounded} ${record.unit}` : rounded;
}

const clockToSeconds = (clock: string): number | null => {
  const parts = clock.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
};

const titleCase = (value: string): string => {
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : cleaned;
};

const cleanMetric = (value: string): string => {
  return titleCase(
    value
      .replace(/\b(?:i|my|the|did|do|for|new pb|personal best|pb|best|record|set|logged|today)\b[\s,:-]*/gi, " ")
      .replace(/[\s,:-]*\b(?:pb|personal best|record|today)\b\s*$/i, " ")
      .replace(/^(?:in|at|of)\s+/i, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s,:-]+|[\s,:-]+$/g, ""),
  );
};

const distanceFrom = (text: string): string | null => {
  if (/\bhalf[\s-]?marathon\b/i.test(text)) return "Half marathon";
  if (/\bmarathon\b/i.test(text)) return "Marathon";
  const named = text.match(/\b(?:one|1)\s*mile\b/i);
  if (named) return "1 mile";
  const match = text.match(
    /\b(\d+(?:\.\d+)?)\s*(k|km|kilomet(?:er|re)s?|mi|mile|miles?|m|met(?:er|re)s?|y|yd|yards?)\b/i,
  );
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = (match[2] ?? "").toLowerCase();
  const suffix = /\bsprint\b/i.test(text) ? " sprint" : "";
  if (/^(k|km|kilomet)/.test(unit)) return `${amount}K${suffix}`;
  if (/^(mi|mile)/.test(unit)) return `${amount} mile${amount === 1 ? "" : "s"}${suffix}`;
  if (/^(y|yd|yard)/.test(unit)) return `${amount} yd${suffix}`;
  return `${amount}m${suffix}`;
};

const inferUnit = (metric: string, value: number): string => {
  if (/\b(jump)\b/i.test(metric)) return value > 10 ? "cm" : "m";
  if (/\b(pull[- ]?ups?|chin[- ]?ups?|push[- ]?ups?|sit[- ]?ups?|burpees?|reps?|repetitions?|squats?)\b/i.test(metric)) {
    return "reps";
  }
  if (/\b(bench|squat|deadlift|lift|press|clean|snatch|row|curl)\b/i.test(metric)) return "kg";
  return "reps";
};

const lowerIsBetterTime = (metric: string, distance: string | null): boolean => {
  // A clock is not automatically a race: a plank, a dead hang and a hold are
  // timed efforts where longer is better. Only a distance or an explicit
  // movement whose clock is a speed test improves downward.
  if (distance) return true;
  return /\b(run|sprint|swim|ride|cycle|row|time trial|marathon|mile|triathlon)\b/i.test(metric);
};

const finish = (
  metric: string,
  value: number,
  unit: string,
  lowerIsBetter: boolean,
): ParsedPb | null => {
  if (!metric || !Number.isFinite(value) || value <= 0) return null;
  const display = unit === "time" ? formatPbSeconds(value) : `${value} ${unit}`.trim();
  return { metric, value, unit, display, lowerIsBetter };
};

export function parsePbText(raw: string): ParsedPb | null {
  const input = raw.trim().replace(/\s+/g, " ");
  if (!input) return null;

  const distance = distanceFrom(input);

  // A clock is the clearest signal: "5K in 22:14", "marathon 3:15:00".
  const clock = input.match(/\b(\d{1,3}:\d{2}(?::\d{2})?)\b/);
  if (clock) {
    const seconds = clockToSeconds(clock[1]);
    if (seconds && seconds > 0) {
      const remainder = input.replace(clock[0], " ").replace(/\b(?:in|at|time|of)\b/gi, " ");
      const metric = distance ?? cleanMetric(remainder) ?? "";
      return finish(metric || "Timed effort", seconds, "time", lowerIsBetterTime(metric, distance));
    }
  }

  // Explicit time units: "40m sprint 5.1s", "5K 22 min".
  const timed = input.match(/\b(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|min)\b/i);
  if (timed) {
    const amount = Number(timed[1]);
    if (Number.isFinite(amount) && amount > 0) {
      const unit = /^min/i.test(timed[2]) ? "min" : "s";
      const seconds = unit === "min" ? amount * 60 : amount;
      const remainder = input.replace(timed[0], " ").replace(/\b(?:in|at|time|of)\b/gi, " ");
      const metric = distance ?? cleanMetric(remainder) ?? "";
      return finish(metric || "Timed effort", seconds, "time", lowerIsBetterTime(metric, distance));
    }
  }

  // A measurement with an explicit unit: "bench press 120 kg", "jump 65 cm".
  const measured = input.match(
    /\b(\d+(?:\.\d+)?)\s*(kg|kgs|kilograms?|lb|lbs|pounds?|cm|centimet(?:er|re)s?|mm|m|met(?:er|re)s?|w|watts?|reps?|repetitions?)\b/i,
  );
  if (measured) {
    const value = Number(measured[1]);
    if (Number.isFinite(value) && value > 0) {
      const rawUnit = (measured[2] ?? "").toLowerCase();
      const unit = /^(kg|kilogram)/.test(rawUnit)
        ? "kg"
        : /^(lb|pound)/.test(rawUnit)
          ? "lb"
          : /^(cm|centimet)/.test(rawUnit)
            ? "cm"
            : /^(mm)/.test(rawUnit)
              ? "mm"
              : /^(w|watt)/.test(rawUnit)
                ? "W"
                : /^(rep)/.test(rawUnit)
                  ? "reps"
                  : "m";
      const remainder = input.replace(measured[0], " ");
      const metric = distance ?? cleanMetric(remainder) ?? "";
      return finish(metric || "Personal best", value, unit, false);
    }
  }

  // A bare number: the words around it are the metric, the exercise decides
  // whether it is reps or kilos. "20 pull ups" / "deadlift 180".
  const bare = input.match(/\b(\d+(?:\.\d+)?)\b/);
  if (bare) {
    const value = Number(bare[1]);
    if (Number.isFinite(value) && value > 0) {
      const remainder = input.replace(bare[0], " ");
      const metric = distance ?? cleanMetric(remainder) ?? "";
      if (metric) return finish(metric, value, inferUnit(metric, value), false);
    }
  }

  return null;
}
