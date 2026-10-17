from pathlib import Path
p = Path("src/pages/Profile.tsx")
t = p.read_text(encoding="utf-8")
profile_start = t.find("const Profile = () => {")
export_idx = t.find("export default Profile;")
body = t[profile_start:export_idx]

i = body.find("PersonalizationSetting />")
print(body[i-40:i+2000])
