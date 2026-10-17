import pathlib

path = pathlib.Path("src/pages/Profile.tsx")
text = path.read_text(encoding="utf-8")

needle = "\r\n      </div>\r\n        <CosmeticShop open={showCosmetics} onClose={() => setShowCosmetics(false)} />\r\n      <HealthConnectPrompt open={showHealthConnect} onClose={() => setShowHealthConnect(false)} />\r\n    </div>\r\n  );\r\n};\r\n\r\n  return (\r\n    <>\r\n      <CosmeticShop open={showCosmetics} onClose={() => setShowCosmetics(false)} />\r\n      <HealthConnectPrompt open={showHealthConnect} onClose={() => setShowHealthConnect(false)} />\r\n    </>\r\n  );\r\n};\r\n\r\nexport default Profile;\r\n"

if needle not in text:
    raise SystemExit("needle not found")

replacement = "\r\n      </div>\r\n    </div>\r\n  );\r\n};\r\n\r\nexport default Profile;\r\n"

path.write_text(text.replace(needle, replacement), encoding="utf-8")
print("patched")
