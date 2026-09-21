import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const OfflineBanner = () => {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return (
    <AnimatePresence>
      {!online && (
        <motion.div initial={{ y: -40 }} animate={{ y: 0 }} exit={{ y: -40 }}
          className="fixed top-0 left-0 right-0 z-[70] flex items-center justify-center gap-2 bg-warning px-4 py-2 pt-safe-t text-xs font-semibold text-warning-foreground shadow-lg">
          <WifiOff size={14} /> You're offline — cached plans, workouts and routines still work. New logs sync when you reconnect.
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OfflineBanner;
