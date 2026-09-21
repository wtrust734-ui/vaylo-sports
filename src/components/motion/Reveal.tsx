import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { DURATION, EASE } from "@/lib/motion";
import { forwardRef, type ReactNode } from "react";

interface RevealProps extends Omit<HTMLMotionProps<"div">, "initial" | "animate" | "whileInView"> {
  children: ReactNode;
  delay?: number;
  y?: number;
  as?: "div" | "section" | "article" | "li";
  once?: boolean;
  duration?: number;
}

/**
 * Scroll-triggered fade + slight translateY.
 * Triggers once. GPU-accelerated (transform + opacity only).
 */
const Reveal = forwardRef<HTMLDivElement, RevealProps>(
  ({ children, delay = 0, y = 20, once = true, duration = DURATION.medium, ...rest }, ref) => {
    const reduce = useReducedMotion();
    return (
      <motion.div
        ref={ref}
        initial={reduce ? false : { opacity: 0, y }}
        whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once, margin: "-40px" }}
        transition={{ duration, delay, ease: EASE.out }}
        {...rest}
      >
        {children}
      </motion.div>
    );
  },
);
Reveal.displayName = "Reveal";

export default Reveal;
