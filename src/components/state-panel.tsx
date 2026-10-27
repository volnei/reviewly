import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type StateKind = "empty" | "error";

function StatePicture({ kind }: { kind: StateKind }) {
  const isError = kind === "error";

  return (
    <svg
      aria-hidden="true"
      className="h-auto w-full max-w-[220px] overflow-visible"
      viewBox="0 0 220 156"
      fill="none"
    >
      <path
        d="M25 87c13-38 45-61 85-61 39 0 72 22 86 56"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="3 7"
        className="text-edge"
      />
      <circle cx="27" cy="84" r="3" className="fill-ink-3" />
      <circle cx="194" cy="80" r="3" className={isError ? "fill-del" : "fill-[#df7542]"} />

      <rect x="58" y="38" width="106" height="77" rx="13" className="fill-sink stroke-edge" />
      <rect x="72" y="52" width="78" height="48" rx="8" className="fill-raise stroke-edge" />
      <path
        d="M86 66h34M86 77h49M86 88h27"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="text-ink-3"
      />

      {isError ? (
        <>
          <path
            d="m126 63 14 14m0-14-14 14"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className="text-del"
          />
          <path
            d="M66 112 45 132m112-20 20 20"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="text-del"
          />
        </>
      ) : (
        <>
          <path
            d="M44 36v13M37.5 42.5h13"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="text-[#df7542]"
          />
          <path
            d="m172 35 2.8 6.2L181 44l-6.2 2.8L172 53l-2.8-6.2L163 44l6.2-2.8L172 35Z"
            className="fill-[#df7542]"
          />
          <path
            d="M78 115v7c0 7 6 12 13 12h39c7 0 13-5 13-12v-7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="text-ink-3"
          />
          <circle cx="110" cy="122" r="3" className="fill-[#df7542]" />
        </>
      )}

      <rect x="35" y="107" width="22" height="16" rx="5" className="fill-card stroke-edge" />
      <rect x="164" y="103" width="27" height="19" rx="6" className="fill-card stroke-edge" />
      <path
        d="M41 115h10M171 111h13M171 116h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-ink-3"
      />
    </svg>
  );
}

export function StatePanel({
  kind = "empty",
  title,
  description,
  action,
  className,
}: {
  kind?: StateKind;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "mx-auto my-10 flex min-h-[360px] max-w-[620px] flex-col items-center justify-center px-8 py-10 text-center",
        className,
      )}
    >
      <div className="order-2 flex max-w-[440px] flex-col items-center">
        <p
          className={cn(
            "mb-3 text-[10px] font-medium uppercase tracking-[0.16em]",
            kind === "error" ? "text-del" : "text-[#df7542]",
          )}
        >
          {kind === "error" ? "Connection interrupted" : "All clear"}
        </p>
        <h2 className="text-[20px] font-medium leading-tight tracking-[-0.025em] text-ink">
          {title}
        </h2>
        {description ? (
          <div className="mt-2 max-w-[400px] text-[13px] leading-5 text-ink-2">{description}</div>
        ) : null}
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
      <div className="pointer-events-none order-1 mb-5 flex w-[190px] items-center justify-center text-ink-3">
        <StatePicture kind={kind} />
      </div>
    </section>
  );
}
