import { motion, useReducedMotion } from "framer-motion";
import logo from "@/assets/logo.jpg";

/** Premium, low-cost loading treatment shared by app bootstrap and route chunks. */
export default function VayloLoader({ message = "Getting your training space ready" }: { message?: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <main
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-[100] flex min-h-[100svh] flex-col items-center justify-center overflow-hidden bg-[#05070f] px-6 py-12 text-center"
      style={{
        paddingTop: "max(3rem, var(--vaylo-inset-top))",
        paddingBottom: "max(3rem, var(--vaylo-inset-bottom))",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 42%, hsla(263 90% 58% / .20), transparent 34%), radial-gradient(ellipse at 52% 48%, hsla(210 100% 58% / .12), transparent 60%)",
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-sky-400/20 to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex flex-col items-center"
      >
        <div className="relative mb-8 grid h-32 w-32 place-items-center">
          <motion.div
            aria-hidden
            className="absolute inset-0 rounded-[2rem] border border-sky-400/25"
            animate={reduceMotion ? undefined : { rotate: 360, scale: [1, 1.04, 1] }}
            transition={{ rotate: { duration: 18, repeat: Infinity, ease: "linear" }, scale: { duration: 3, repeat: Infinity, ease: "easeInOut" } }}
          />
          <motion.div
            aria-hidden
            className="absolute inset-2 rounded-[1.7rem] border border-violet-400/25"
            animate={reduceMotion ? undefined : { rotate: -360 }}
            transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
          />
          <div className="relative grid h-20 w-20 place-items-center overflow-hidden rounded-2xl bg-[#03040a] shadow-[0_0_45px_hsla(263_90%_60%_/_0.28)] ring-1 ring-white/10">
            <img src={logo} alt="" className="h-full w-full object-cover" />
          </div>
          <motion.span
            aria-hidden
            className="absolute -right-0.5 top-5 h-2 w-2 rounded-full bg-sky-300 shadow-[0_0_14px_hsla(200_100%_70%_/_0.9)]"
            animate={reduceMotion ? undefined : { opacity: [0.35, 1, 0.35], scale: [0.8, 1.15, 0.8] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <p className="text-[12px] font-bold uppercase tracking-[0.32em] text-sky-200/80">Vaylo Sports</p>
        <h1 className="mt-2 font-display text-xl font-semibold tracking-tight text-white">Built around your next win</h1>
        <p className="mt-2 max-w-xs text-sm text-slate-400">{message}</p>

        <div className="mt-7 flex items-center gap-2" aria-hidden>
          {[0, 1, 2].map((dot) => (
            <motion.span
              key={dot}
              className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-violet-400 to-sky-300"
              animate={reduceMotion ? undefined : { opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
              transition={{ duration: 1.1, repeat: Infinity, delay: dot * 0.16, ease: "easeInOut" }}
            />
          ))}
        </div>
      </motion.div>
    </main>
  );
}
