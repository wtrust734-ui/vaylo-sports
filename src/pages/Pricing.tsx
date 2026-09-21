import { Navigate } from "react-router-dom";

// The legacy pricing page is retired. /pricing now points at the single
// subscription page (Credit Plan + Unlimited Plan).
export default function Pricing() {
  return <Navigate to="/subscription" replace />;
}
