import { motion, useReducedMotion } from "framer-motion";
import { Children, type ReactNode } from "react";
import { EASE } from "@/lib/motion";

interface Props {
  children: ReactNode;
  delay?: number; // stagger interval in seconds
  className?: string;
  y?: number;
}

const StaggerList = ({ children, delay = 0.06, className, y = 16 }: Props) => {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
      variants={{ hidden: {}, visible: { transition: { staggerChildren: delay, delayChildren: 0.04 } } }}
    >
      {Children.map(children, (child, i) => (
        <motion.div
          key={i}
          variants={{
            hidden: { opacity: 0, y },
            visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE.out } },
          }}
        >
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
};

export default StaggerList;
