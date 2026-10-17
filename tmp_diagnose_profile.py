from pathlib import Path
import re

p = Path("src/pages/Profile.tsx")
t = p.read_text(encoding="utf-8")

# Find component definitions
defs = re.findall(r"^const\s+(\w+)\s*=\s*(?:(\{.*?\}\s*)?\([^)]*\)\s*=>\s*:?\s*\{?\s*(?:React\.)?\b(FC|React\.FC|\([^)]*\))\b)?", t, re.M)
print("component defs found (naive):", [d[0] for d in defs][:50])
print("----")

# Find usage of imported components in JSX
for name in ["CosmeticShop", "HealthConnectPrompt", "PersonalizationSetting", "AccountSubscriptionCard"]:
    idxs = [m.start() for m in re.finditer(rf"\b{name}\b", t)]
    print(f"{name}: {len(idxs)} occurrence(s)")
    for i in idxs:
        s = max(0, i-60)
        e = min(len(t), i+60)
        print("   @", i, "->", repr(t[s:e]))
    print("----")
