from pathlib import Path
import re

p = Path("src/pages/Profile.tsx")
t = p.read_text(encoding="utf-8")

profile_start = t.find("const Profile = () => {")
export_idx = t.find("export default Profile;")
body = t[profile_start:export_idx]

# Find the main Profile return JSX start
ret_match = list(re.finditer(r"return\s*\(", body))
print("return( count inside Profile body:", len(ret_match))

# Show the tail of the main return: PersonalizationSetting..Delete account..closing
i = body.find("PersonalizationSetting />")
print("PersonalizationSetting /> at offset:", i)
print(repr(body[i-80:i+400]))
