import { useEffect, useId, useState } from "react";

/** A compact color swatch with an editable hex value. */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return (
    <div className="diff-color-field">
      <label htmlFor={id}>{label}</label>
      <div className="diff-color-input">
        <span className="diff-color-swatch" style={{ backgroundColor: value }}>
          <input
            type="color"
            aria-label={`Choose ${label.toLowerCase()} color`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </span>
        <input
          id={id}
          type="text"
          aria-label={`${label} hex color`}
          value={hex}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          onChange={(event) => {
            const next = event.target.value;
            setHex(next);
            if (/^#[\da-f]{6}$/i.test(next)) onChange(next);
          }}
          onBlur={() => setHex(value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setHex(value);
              event.stopPropagation();
            }
          }}
        />
      </div>
    </div>
  );
}
